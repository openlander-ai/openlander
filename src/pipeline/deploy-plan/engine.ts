import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createModuleLogger } from '../../lib/logger.js';
import { findDockerfiles } from '../../lib/repo-scanner.js';
import { scanDockerfileArgs, scanEnvFile, scanEnvTemplate } from '../../lib/env-parser.js';
import { scanForEnvUsage } from '../env-scan.js';
import {
  inferEnvValueRequirement,
  mergeEnvValueRequirement,
  validateEnvValue,
} from '../env-requirements.js';
import { cloneRepo, redactRepoUrl } from '../git.js';
import { resolveEnvVars } from '../resolve-env.js';
import { ManagedServiceLinker } from '../managed-service-linker.js';
import { getServiceAdapter } from '../service-adapters/index.js';
import { analyzeInfrastructure } from '../../lib/infra-analyzer.js';
import {
  extractProjectName,
  composeContainerName,
  containerName as projectContainerName,
} from '../helpers.js';
import { parseImageUrl } from '../image-utils.js';
import type {
  DeployPlan,
  DeployPlanStatus,
  PlanService,
  PlanEnvEntry,
  PlanBuildService,
  DeployPlanComplexity,
} from './types.js';
import type { EnvValueIssue } from '../env-requirements.js';
import { PlanStateMachine } from './types.js';
import { computeComplexity, computeMissingEnvVars } from './plan-utils.js';
import type { Database } from '../../db/index.js';
import type { ServiceRow } from '../../db/index.js';
import type { DeployPipeline } from '../deploy.js';
import type { EnvManager } from '../env.js';
import type { ServiceManager } from '../service-manager.js';
import type { Docker } from '../docker.js';
import type { AutoDetector } from '../auto-detect.js';
import type { OpenLanderConfig } from '../../config/index.js';
import type { EventBus } from '../../events/index.js';
import {
  filterServicesByProfiles,
  findComposeHostPortUsages,
  fingerprintComposeServices,
  inferComposeRuntimeRoles,
  inferComposeHealthcheckPort,
  validateComposeProfiles,
  type ComposePipeline,
} from '../compose.js';
import { resolveComposeFilePath, resolveComposeFilePaths } from '../compose-spec.js';
import { acquireDeployLockOrThrow } from '../../db/repos/deploy-lock-helper.js';
import {
  InvalidTrafficServiceError,
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
  ServiceConfigError,
  TrafficServiceRequiredError,
} from '../../errors.js';
import { targetIdentityResolver } from '../../db/target-identity-resolver.js';

const log = createModuleLogger('plan-engine');

export interface CreatePlanOptions {
  repoUrl?: string;
  branch?: string;
  name?: string;
  source?: 'git' | 'image';
  imageUrl?: string;
  imageCmd?: string[];
  containerPort?: number;
  healthCheckPath?: string;
  envVars?: Record<string, string>;
  visibility?: 'internal' | 'quick-share' | 'shared';
  environment?: string;
  sshKeyPath?: string;
  gitCredentialId?: string;
  trigger?: string;
  preferDockerfile?: boolean;
  dockerfilePath?: string;
  dockerTarget?: string;
  projectId?: string;
  targetProjectId?: string;
  trafficService?: string;
  composeFile?: string;
  composeFiles?: string[];
  composeProfiles?: string[];
}

interface PlanExecutionContext {
  visibility?: 'internal' | 'quick-share' | 'shared';
  environment?: string;
  sshKeyPath?: string;
  trigger?: string;
  imageCmd?: string[];
  containerPort?: number;
  healthCheckPath?: string;
  targetProjectId?: string;
  composeFile?: string;
  composeFiles?: string[];
  composeProfiles?: string[];
  composeServiceFingerprints?: Record<string, string>;
}

export interface PlanUpdates {
  env?: { provided?: Record<string, string>; trusted?: string[] } | Record<string, string>;
  build?: Partial<DeployPlan['build']>;
  compose_file?: string;
  compose_files?: string[];
  compose_profiles?: string[];
  traffic_service?: string;
  services?: PlanService[];
  health?: Partial<DeployPlan['health']>;
}

export interface PlanEngineDeps {
  db: Database;
  pipeline: DeployPipeline;
  env: EnvManager;
  serviceManager: ServiceManager;
  autoDetector: AutoDetector;
  config: OpenLanderConfig;
  events?: EventBus;
  composePipeline?: ComposePipeline;
  docker?: Docker;
}

const SERVICE_ENV_VARS: Record<string, string> = {
  postgresql: 'DATABASE_URL',
  mysql: 'DATABASE_URL',
  redis: 'REDIS_URL',
  mongodb: 'MONGODB_URI',
  rabbitmq: 'RABBITMQ_URL',
};

/**
 * Approval classification by detected service type. Metadata only — does not
 * gate execution. Standard managed datastores are safe to propose; minio
 * (object storage) needs explicit opt-in; rabbitmq is not auto-creatable.
 */
const SERVICE_APPROVAL: Record<string, PlanService['approval']> = {
  postgresql: 'safe_resource',
  mysql: 'safe_resource',
  redis: 'safe_resource',
  mongodb: 'safe_resource',
  rabbitmq: 'not_auto_creatable',
  minio: 'explicit_resource',
};

/**
 * Name/image tokens used to match a detected dependency type against a
 * compose-declared service during the compose cross-check.
 */
const COMPOSE_TYPE_TOKENS: Record<string, string[]> = {
  postgresql: ['postgres', 'postgresql', 'pgvector'],
  mysql: ['mysql', 'mariadb'],
  redis: ['redis'],
  mongodb: ['mongo'],
  rabbitmq: ['rabbitmq', 'amqp'],
};

export interface ExecutePlanResult {
  status: 'building' | 'failed' | 'needs_approval' | 'needs_target_project';
  plan_id: string;
  project_name: string;
  project_id?: string;
  service_id?: string;
  target_project_id?: string;
  runtime_project_id?: string;
  estimated_seconds?: number;
  error?: string;
  message?: string;
  /**
   * Populated only when status === 'needs_approval'. Lists the identifiers to
   * pass into approvals.create_resources (or approve via approve_all_safe_resources).
   * Identifiers reference services[] (resolution='proposed_project_service'); the
   * full service objects are not duplicated here.
   */
  approval_required?: { create_resources: string[] };
  _agent_guidance?: { next_steps: string[] };
}

export interface ExecutePlanApproval {
  approveAllSafeResources?: boolean;
  createResources?: string[];
}

interface ExecutePlanProjectTarget {
  id: string;
  name: string;
}

interface ExecuteApprovalGateResult {
  approvedSafeResources: Set<string>;
  response?: ExecutePlanResult;
}

interface ExecuteTargetResolutionResult {
  attachTargetProject: ExecutePlanProjectTarget | null;
  targetProject: ExecutePlanProjectTarget | null;
  response?: ExecutePlanResult;
}

interface ExecuteDeployLock {
  projectId: string | null;
  release: () => void;
}

interface ExecuteDispatchResult {
  startedProjectId: string;
  startedProjectName: string;
  preflightError?: string;
}

type DeferredRuntimeEnvVars = Promise<
  { ok: true; envVars: Record<string, string> } | { ok: false; error: string }
>;

export class PlanEngine {
  private db: Database;
  private pipeline: DeployPipeline;
  private env: EnvManager;
  private events?: EventBus;
  private composePipeline?: ComposePipeline;
  private serviceManager: ServiceManager;
  private docker?: Docker;

  constructor(deps: PlanEngineDeps) {
    this.db = deps.db;
    this.pipeline = deps.pipeline;
    this.env = deps.env;
    this.events = deps.events;
    this.composePipeline = deps.composePipeline;
    this.serviceManager = deps.serviceManager;
    this.docker = deps.docker;
  }

  private preparePlanForStorage(plan: DeployPlan): DeployPlan {
    return plan;
  }

  private resolveBuildConfig(
    clonePath: string,
    opts: CreatePlanOptions,
    warnings: string[],
    detectedEnv: PlanEnvEntry[],
  ): {
    buildMethod: 'dockerfile' | 'compose';
    userDockerfile: string;
    generatedDockerfile?: string;
    composeFilePath?: string;
    composeFilePaths?: string[];
    composeBuildServices?: PlanBuildService[];
    composeServiceFingerprints?: Record<string, string>;
    trafficServiceCandidates?: string[];
    relativeDockerfiles: string[];
  } {
    const dockerfiles = findDockerfiles(clonePath);
    const relativeDockerfiles = dockerfiles.map((d) => relative(clonePath, d));
    let userDockerfile = opts.dockerfilePath ?? 'Dockerfile';
    let dockerfileExists = existsSync(join(clonePath, userDockerfile));

    // If the specified/default Dockerfile doesn't exist but we found one elsewhere, use it.
    const firstFound = relativeDockerfiles[0];
    if (!dockerfileExists && firstFound) {
      userDockerfile = firstFound;
      dockerfileExists = true;
      warnings.push(
        `Specified "${opts.dockerfilePath ?? 'Dockerfile'}" not found; using discovered ${userDockerfile}`,
      );
    }

    if (relativeDockerfiles.length > 1) {
      warnings.push(
        `${String(relativeDockerfiles.length)} Dockerfiles found: ${relativeDockerfiles.join(', ')}`,
      );
    }

    let buildMethod: 'dockerfile' | 'compose' = 'dockerfile';
    let composeFilePath: string | undefined;
    let composeFilePaths: string[] | undefined;
    let composeBuildServices: PlanBuildService[] | undefined;
    let generatedDockerfile: string | undefined;

    if (opts.composeFile && opts.composeFiles) {
      throw new ServiceConfigError('compose_file and compose_files cannot be combined.');
    }
    if ((opts.composeFile || opts.composeFiles) && (opts.preferDockerfile || opts.dockerfilePath)) {
      throw new ServiceConfigError(
        'Compose file selection cannot be combined with prefer_dockerfile or dockerfile_path.',
        { composeFile: opts.composeFile, composeFiles: opts.composeFiles },
      );
    }
    if ((opts.composeFile || opts.composeFiles) && !this.composePipeline) {
      throw new ServiceConfigError('Compose support is unavailable in this runtime.', {
        composeFile: opts.composeFile,
        composeFiles: opts.composeFiles,
      });
    }

    let composeServiceFingerprints: Record<string, string> | undefined;
    if (!opts.preferDockerfile && !opts.dockerfilePath && this.composePipeline) {
      const autoDetectedComposeFile =
        !opts.composeFiles && !opts.composeFile
          ? this.composePipeline.detectComposeFile(clonePath)
          : null;
      const detectedComposeFiles = opts.composeFiles
        ? resolveComposeFilePaths(clonePath, opts.composeFiles)
        : opts.composeFile
          ? [resolveComposeFilePath(clonePath, opts.composeFile)]
          : autoDetectedComposeFile
            ? [autoDetectedComposeFile]
            : [];
      const detectedComposeFile = detectedComposeFiles[0];
      if (detectedComposeFile) {
        buildMethod = 'compose';
        composeFilePath = relative(clonePath, detectedComposeFile);
        composeFilePaths = detectedComposeFiles.map((path) => relative(clonePath, path));
        const parsed =
          detectedComposeFiles.length === 1
            ? this.composePipeline.parseComposeFile(detectedComposeFile)
            : this.composePipeline.parseComposeFiles(detectedComposeFiles);
        validateComposeProfiles(parsed.services, opts.composeProfiles);
        const activeServices = filterServicesByProfiles(parsed.services, opts.composeProfiles);
        const activeProject = { ...parsed, services: activeServices };
        const runtimeRoles = inferComposeRuntimeRoles(activeServices);
        const hostPortUsages = findComposeHostPortUsages(activeProject);
        composeServiceFingerprints = fingerprintComposeServices(activeServices);
        if (hostPortUsages.length > 0) {
          warnings.push(
            'Compose host ports will be replaced with OpenLander-managed ports: ' +
              hostPortUsages
                .map((usage) => `${usage.service} (${usage.ports.join(', ')})`)
                .join('; '),
          );
        }

        composeBuildServices = activeServices.map((svc) => {
          let dockerfile: string | undefined;
          if (typeof svc.build === 'string') {
            const candidate = join(svc.build, 'Dockerfile');
            dockerfile = existsSync(join(clonePath, candidate)) ? candidate : svc.build;
          } else if (svc.build && typeof svc.build === 'object') {
            dockerfile = svc.build.dockerfile
              ? join(svc.build.context, svc.build.dockerfile)
              : join(svc.build.context, 'Dockerfile');
          }

          let port: number | undefined;
          if (svc.ports?.[0]) {
            const value = svc.ports[0].split('/')[0] ?? '';
            const target = value.split(':').at(-1);
            if (target && /^\d+$/.test(target)) {
              port = parseInt(target, 10);
            }
          }
          if (port === undefined && svc.expose?.[0]) {
            const exposeMatch = svc.expose[0].match(/^(\d+)/);
            if (exposeMatch?.[1]) {
              port = parseInt(exposeMatch[1], 10);
            }
          }
          port ??= inferComposeHealthcheckPort(svc);

          return {
            name: svc.name,
            runtime_role: runtimeRoles.get(svc.name) ?? 'application',
            dockerfile,
            port,
            host_ports: svc.ports && svc.ports.length > 0 ? svc.ports : undefined,
            // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
            image: svc.image,
            depends_on: svc.dependsOn,
            command: svc.command,
            entrypoint: svc.entrypoint,
            restart: svc.restart,
            healthcheck: svc.healthcheck,
          };
        });

        for (const svc of activeServices) {
          if (svc.envFile) {
            for (const envFileRef of svc.envFile) {
              const fullPath = join(clonePath, envFileRef.path);
              if (!existsSync(fullPath)) {
                const templateEntries = scanEnvTemplate(clonePath, envFileRef.path, detectedEnv);
                detectedEnv.push(
                  ...(envFileRef.required
                    ? templateEntries
                    : templateEntries.map((entry) => ({ ...entry, required: false }))),
                );
                if (envFileRef.required) {
                  warnings.push(
                    `Service "${svc.name}" requires env_file "${envFileRef.path}" but file not in repo`,
                  );
                }
              } else {
                detectedEnv.push(...scanEnvFile(fullPath, envFileRef.path, detectedEnv));
              }
            }
          }

          if (!svc.volumes) {
            continue;
          }

          for (const vol of svc.volumes) {
            const bindParts = vol.split(':');
            const hostPath = bindParts[0];
            if (bindParts.length < 2 || !hostPath) {
              continue;
            }
            if (!hostPath.startsWith('.') && !hostPath.startsWith('/')) {
              continue;
            }

            const absHost = hostPath.startsWith('.') ? join(clonePath, hostPath) : hostPath;
            if (!existsSync(absHost) && hostPath.startsWith('.')) {
              warnings.push(`Service "${svc.name}" mounts "${hostPath}" but file not in repo`);
            }
          }
        }
      }
    }

    if (buildMethod === 'dockerfile' && !dockerfileExists) {
      generatedDockerfile = 'auto-generated';
      warnings.push('No Dockerfile found; will auto-generate one during build');
    }

    return {
      buildMethod,
      userDockerfile,
      generatedDockerfile,
      composeFilePath,
      composeFilePaths,
      composeBuildServices,
      composeServiceFingerprints,
      trafficServiceCandidates: composeBuildServices
        // eslint-disable-next-line openlander-internal/no-dropped-columns -- PlanBuildService.port is Compose plan metadata, not a services DB row.
        ?.filter((service) => service.runtime_role === 'application' && service.port !== undefined)
        .map((service) => service.name),
      relativeDockerfiles,
    };
  }

  private async getReusableServicesForProject(
    projectName: string,
    projectId?: string,
  ): Promise<ServiceRow[]> {
    const project =
      (projectId ? await this.db.getProject(projectId) : null) ??
      (await this.db.getProjectByName(projectName));
    if (!project) {
      return [];
    }

    const services = await this.db.listServices();
    return services.filter((service) => service.project_id === project.id);
  }

  private async detectPlanServices(
    clonePath: string,
    projectName: string,
    projectId?: string,
    composeBuildServices?: PlanBuildService[],
  ): Promise<PlanService[]> {
    log.info({ clonePath }, 'Analyzing infrastructure');
    const existingServices = await this.getReusableServicesForProject(projectName, projectId);
    const infraAnalysis = analyzeInfrastructure(clonePath, existingServices);

    const services: PlanService[] = [];
    for (const missingService of infraAnalysis.missing) {
      // Compose cross-check: when building from a compose stack, a detected
      // dependency that is already declared in compose must not be proposed as
      // a managed create. Reclassify it as a compose_service instead.
      const declaredInCompose =
        composeBuildServices !== undefined &&
        this.composeDeclaresServiceType(composeBuildServices, missingService.type);
      const approval = SERVICE_APPROVAL[missingService.type];
      services.push({
        type: missingService.type,
        action: 'create',
        connect_via:
          missingService.connectVia ??
          SERVICE_ENV_VARS[missingService.type] ??
          `${missingService.type.toUpperCase()}_URL`,
        // resolution reconciles the legacy `action` with the routing policy:
        // compose-declared deps are compose_service; types OpenLander cannot
        // auto-create (not_auto_creatable, e.g. rabbitmq) route to
        // needs_user_input instead of advertising a managed create it won't do.
        resolution: declaredInCompose
          ? 'compose_service'
          : approval === 'not_auto_creatable'
            ? 'needs_user_input'
            : 'proposed_project_service',
        reason: missingService.detectedFrom,
        approval,
      });
    }

    for (const availableService of infraAnalysis.available) {
      services.push({
        type: availableService.type,
        action: 'reuse',
        service_id: availableService.id,
        name: availableService.name,
        connect_via:
          availableService.connectVia ??
          SERVICE_ENV_VARS[availableService.type] ??
          `${availableService.type.toUpperCase()}_URL`,
        resolution: 'existing_project_service',
        reason: availableService.detectedFrom,
        approval: SERVICE_APPROVAL[availableService.type],
      });
    }

    return services;
  }

  /**
   * Whether the compose stack already declares a service that satisfies the
   * given detected dependency type (by service name or image reference).
   * Used by the compose cross-check to avoid proposing a managed create for a
   * dependency the user already runs as a compose service.
   */
  private composeDeclaresServiceType(
    composeBuildServices: PlanBuildService[],
    type: PlanService['type'],
  ): boolean {
    const tokens = COMPOSE_TYPE_TOKENS[type] ?? [];
    return composeBuildServices.some((svc) => {
      const haystacks = [svc.name.toLowerCase(), (svc.image ?? '').toLowerCase()];
      return tokens.some((token) => haystacks.some((value) => value.includes(token)));
    });
  }

  private detectEnvVars(
    clonePath: string,
    userDockerfile: string,
    detectedEnv: PlanEnvEntry[],
  ): void {
    // Scope env scanning to the build context directory (derived from dockerfile path).
    // e.g., 'services/api/Dockerfile' → scopeDir='services/api'
    // Falls back to full repo scan when Dockerfile is at root.
    const scopeDir = userDockerfile.includes('/')
      ? userDockerfile.substring(0, userDockerfile.lastIndexOf('/'))
      : undefined;

    const ENV_TEMPLATE_FILES = ['.env.example', '.env.sample', '.env.template'];
    for (const envFileName of ENV_TEMPLATE_FILES) {
      const envPath = scopeDir
        ? join(clonePath, scopeDir, envFileName)
        : join(clonePath, envFileName);
      if (!existsSync(envPath)) {
        continue;
      }
      const envSource = scopeDir ? join(scopeDir, envFileName) : envFileName;
      detectedEnv.push(...scanEnvFile(envPath, envSource, detectedEnv));
    }
    detectedEnv.push(...scanDockerfileArgs(clonePath, userDockerfile, detectedEnv));

    const sourceResult = scanForEnvUsage(clonePath, scopeDir);
    for (const variable of sourceResult.vars) {
      if (detectedEnv.some((entry) => entry.key === variable.key)) {
        continue;
      }

      detectedEnv.push({
        key: variable.key,
        source: variable.files[0]?.path ?? 'source',
        required: !variable.optional,
      });
    }
  }

  private buildExecutionContext(opts: CreatePlanOptions): PlanExecutionContext | undefined {
    const execution: PlanExecutionContext = {
      visibility: opts.visibility,
      environment: opts.environment,
      sshKeyPath: opts.sshKeyPath,
      trigger: opts.trigger,
      imageCmd: opts.imageCmd,
      containerPort: opts.containerPort,
      healthCheckPath: opts.healthCheckPath,
      targetProjectId: opts.targetProjectId,
      composeFile: opts.composeFile,
      composeFiles: opts.composeFiles,
      composeProfiles: opts.composeProfiles,
    };

    if (
      !execution.visibility &&
      !execution.environment &&
      !execution.sshKeyPath &&
      !execution.trigger &&
      !execution.imageCmd &&
      execution.containerPort === undefined &&
      !execution.healthCheckPath &&
      !execution.targetProjectId &&
      !execution.composeFile &&
      !execution.composeFiles &&
      !execution.composeProfiles
    ) {
      return undefined;
    }

    return execution;
  }

  private getExecutionContext(plan: DeployPlan): PlanExecutionContext {
    return (plan as DeployPlan & { execution?: PlanExecutionContext }).execution ?? {};
  }

  private getDeployMode(plan: DeployPlan): 'single' | 'monorepo' | 'compose' {
    if (plan.build.method === 'compose') {
      return 'compose';
    }

    if (plan.build.dockerfile !== 'Dockerfile') {
      return 'single';
    }

    if ((plan.build.dockerfiles_found?.length ?? 0) > 1) {
      return 'monorepo';
    }

    return 'single';
  }

  private buildAutoEnvVars(services: PlanService[]): Record<string, string> {
    void services;
    return {};
  }

  /**
   * Safe managed resources the plan proposes to auto-provision on approval:
   * resolution === 'proposed_project_service' && approval === 'safe_resource'.
   * compose_service / not_auto_creatable / explicit_resource are never in this
   * set — they are not auto-provisioned by execute_deploy_plan.
   */
  private serviceEnvVarName(service: PlanService): string | undefined {
    // eslint-disable-next-line openlander-internal/no-dropped-columns -- PlanService.type is deploy-plan metadata, not services.type DB row access.
    return service.connect_via || SERVICE_ENV_VARS[service.type];
  }

  private planServiceSatisfiedByExplicitEnv(
    service: PlanService,
    providedEnv: Record<string, string>,
  ): boolean {
    const envVarName = this.serviceEnvVarName(service);
    return Boolean(envVarName && this.hasExplicitEnvValue(providedEnv, envVarName));
  }

  private safeProposedResources(
    services: PlanService[],
    providedEnv: Record<string, string> = {},
  ): PlanService[] {
    return services.filter(
      (service) =>
        service.resolution === 'proposed_project_service' &&
        service.approval === 'safe_resource' &&
        !this.planServiceSatisfiedByExplicitEnv(service, providedEnv),
    );
  }

  private hasSafeProposedResources(
    services: PlanService[],
    providedEnv: Record<string, string> = {},
  ): boolean {
    return this.safeProposedResources(services, providedEnv).length > 0;
  }

  /**
   * Status priority: needs_input (missing>0) > needs_approval (>=1 safe proposed
   * resource) > ready. A missing user secret always wins; a safe proposed
   * managed resource never downgrades a plan to 'ready' (which would skip the
   * approval gate and provision with empty approvedSafeResources).
   */
  private computePlanStatus(
    missing: string[],
    services: PlanService[],
    providedEnv: Record<string, string> = {},
    envIssues: EnvValueIssue[] = [],
    trafficServiceRequired = false,
  ): DeployPlanStatus {
    return missing.length > 0 ||
      envIssues.some((issue) => issue.severity === 'fail') ||
      trafficServiceRequired
      ? 'needs_input'
      : this.hasSafeProposedResources(services, providedEnv)
        ? 'needs_approval'
        : 'ready';
  }

  private validatePlanEnvValues(
    entries: PlanEnvEntry[],
    providedEnv: Record<string, string>,
    trustedEnvKeys: ReadonlySet<string> = new Set<string>(),
  ): EnvValueIssue[] {
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    const issues: EnvValueIssue[] = [];

    for (const [key, value] of Object.entries(providedEnv)) {
      const entry = byKey.get(key);
      const requirement = mergeEnvValueRequirement(key, entry?.requirement);
      issues.push(
        ...validateEnvValue(key, value, requirement, entry?.required ?? false, {
          trustedSource: trustedEnvKeys.has(key),
        }),
      );
    }

    return issues;
  }

  private trustedEnvKeySet(env: DeployPlan['env']): Set<string> {
    return new Set((env.trusted ?? []).filter((key) => key in env.provided));
  }

  /**
   * Stable identifier used to match a safe proposed resource against the
   * caller's `approvals.create_resources` list. Proposed (action:'create')
   * services carry no name, so the service `type` (e.g. "postgresql") is the
   * stable identifier the agent approves.
   */
  private proposedResourceIdentifier(service: PlanService): string {
    return service.name ?? service.type;
  }

  private plannedServiceEnvKeys(services: PlanService[]): Set<string> {
    return new Set(
      services
        .filter(
          (service) =>
            service.action === 'reuse' ||
            // Safe proposed managed resources have their connect_via satisfied by
            // auto-provisioning on approval, so they are not "missing" env.
            (service.resolution === 'proposed_project_service' &&
              service.approval === 'safe_resource'),
        )
        .map((service) => service.connect_via)
        .filter(Boolean),
    );
  }

  private requiredEnvEntriesForServiceChoices(
    services: PlanService[],
    detectedEnv: PlanEnvEntry[],
  ): PlanEnvEntry[] {
    const seen = new Set(detectedEnv.map((entry) => entry.key));
    const entries: PlanEnvEntry[] = [];
    for (const planService of services) {
      if (
        planService.action !== 'create' ||
        !planService.connect_via ||
        seen.has(planService.connect_via)
      ) {
        continue;
      }
      seen.add(planService.connect_via);
      entries.push({
        key: planService.connect_via,
        source: `detected ${planService.type} dependency`,
        required: true,
        requirement: inferEnvValueRequirement(planService.connect_via),
      });
    }
    return entries;
  }

  private serviceKindMatchesPlanType(service: ServiceRow, type: PlanService['type']): boolean {
    switch (type) {
      case 'postgresql':
        return service.kind === 'postgres';
      case 'mongodb':
        return service.kind === 'mongo';
      default:
        return service.kind === type;
    }
  }

  private async resolveReusableService(
    planService: PlanService,
    targetProjectId: string,
  ): Promise<ServiceRow> {
    if (planService.service_id) {
      const service = await this.db.getService(planService.service_id);
      if (
        service &&
        service.project_id === targetProjectId &&
        this.serviceKindMatchesPlanType(service, planService.type)
      ) {
        return service;
      }
    }

    const services = await this.db.listServices();
    const service = services.find(
      (candidate) =>
        candidate.name === planService.name &&
        candidate.project_id === targetProjectId &&
        this.serviceKindMatchesPlanType(candidate, planService.type),
    );
    if (!service) {
      throw new ServiceConfigError(
        `Reusable Database/Cache/Storage resource not found for ${planService.type}: ${planService.name ?? planService.service_id ?? 'unknown'}`,
        {
          serviceType: planService.type,
          serviceName: planService.name,
          serviceId: planService.service_id,
        },
      );
    }
    return service;
  }

  /**
   * Provision an approved safe proposed_project_service managed resource and
   * return its connection string for `envVarName`. Reuses the same sequence as
   * the create_service tool: docker.ensureProjectNetwork -> serviceManager.create
   * -> db.attachServiceToProject -> serviceManager.getSuggestedEnv. Also upserts
   * a consumer/provider service_connections row (conflict-safe, idempotent).
   */
  private async provisionApprovedService(
    planService: PlanService,
    targetProject: { id: string; name: string },
    envVarName: string,
  ): Promise<string> {
    if (!this.docker) {
      throw new ServiceConfigError(
        `Cannot provision Database/Cache/Storage resource ${planService.type}: docker is unavailable.`,
        { serviceType: planService.type, envVarName },
      );
    }

    const serviceName = `${targetProject.name}-${planService.type}`;
    const network = await this.docker.ensureProjectNetwork(targetProject.name);
    const created = await this.serviceManager.create({
      name: serviceName,
      projectId: targetProject.id,
      template: planService.type,
      ...(network ? { network, aliases: [serviceName] } : {}),
    });
    // Everything after create() is wrapped so any failure — suggested-env
    // lookup, a missing connection string, or wiring — rolls back the
    // just-created container/volume/row instead of orphaning it.
    //
    // Wiring goes through the shared linker: attach + connection row + persisted
    // env + auto_injected_env_keys + dependency edge. This path previously
    // attached + upserted only, leaving the env unpersisted (deploy-time
    // mergedEnv only), no injected-key metadata, and no dependency edge. Passing
    // the connection string keeps the persisted env identical to the deploy-time
    // value from getSuggestedEnv.
    try {
      await this.waitForProvisionedServiceReady(created, planService, envVarName);
      const suggestedEnv = await this.serviceManager.getSuggestedEnv(created, {
        targetProjectId: targetProject.id,
      });
      const connectionString = suggestedEnv[0]?.value;
      if (typeof connectionString !== 'string' || connectionString.trim().length === 0) {
        throw new ServiceConfigError(
          `Provisioned Database/Cache/Storage resource ${serviceName} did not provide a connection string for ${envVarName}`,
          { serviceId: created.id, envVarName },
        );
      }

      await new ManagedServiceLinker(this.db, this.env).connect({
        projectId: targetProject.id,
        service: created,
        source: 'deploy_plan',
        credentials: { connectionString },
      });

      return connectionString;
    } catch (provisionError) {
      // Mirror create_service: best-effort tear down the orphaned service and
      // rethrow. Do not silently swallow the cleanup failure (AGENTS.md).
      try {
        await this.serviceManager.remove(created.id, { force: true });
      } catch (cleanupError) {
        log.warn(
          { err: cleanupError, serviceId: created.id, serviceType: planService.type },
          'Failed to roll back orphaned Database/Cache/Storage resource after provisioning failure',
        );
      }
      throw provisionError;
    }
  }

  private async waitForProvisionedServiceReady(
    service: ServiceRow,
    planService: PlanService,
    envVarName: string,
  ): Promise<void> {
    if (!this.docker) {
      throw new ServiceConfigError(
        `Managed resource ${service.name} (${planService.type}) cannot be checked before app start because Docker is unavailable.`,
        { serviceId: service.id, serviceType: planService.type, envVarName },
      );
    }

    const adapter = getServiceAdapter(service.kind) ?? getServiceAdapter(planService.type);
    if (!adapter) {
      log.warn(
        { serviceId: service.id, serviceType: planService.type, envVarName },
        'Skipping managed resource readiness gate because no adapter is available',
      );
      return;
    }

    try {
      await adapter.waitForReady(service, this.docker);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceConfigError(
        `Managed resource ${service.name} (${planService.type}) was not ready before app start: ${message}`,
        { serviceId: service.id, serviceType: planService.type, envVarName },
      );
    }
  }

  private getServiceConnectionString(service: ServiceRow, envVarName: string): string {
    let parsed: unknown;
    try {
      parsed = service.credentials ? JSON.parse(service.credentials) : null;
    } catch (error) {
      throw new ServiceConfigError(`Invalid Database/Cache/Storage credentials: ${service.id}`, {
        serviceId: service.id,
        envVarName,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const credentials =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    const connectionString = credentials?.['connectionString'];
    if (typeof connectionString !== 'string' || connectionString.trim().length === 0) {
      throw new ServiceConfigError(
        `Database/Cache/Storage resource ${service.name} did not provide a connection string for ${envVarName}`,
        { serviceId: service.id, envVarName },
      );
    }

    return connectionString;
  }

  private hasExplicitEnvValue(envVars: Record<string, string>, key: string): boolean {
    return typeof envVars[key] === 'string' && envVars[key].trim().length > 0;
  }

  private filterServicesWithExplicitEnv(params: {
    services: PlanService[];
    providedEnv: Record<string, string>;
    warnings?: string[];
  }): PlanService[] {
    const skipped: string[] = [];
    const filtered = params.services.filter((service) => {
      const envVarName = this.serviceEnvVarName(service);
      if (!envVarName || !this.hasExplicitEnvValue(params.providedEnv, envVarName)) {
        return true;
      }

      // eslint-disable-next-line openlander-internal/no-dropped-columns -- PlanService.type is deploy-plan metadata, not services.type DB row access.
      skipped.push(`${service.type} (${envVarName})`);
      return false;
    });

    if (skipped.length > 0 && params.warnings) {
      const warning =
        `Explicit env var(s) provided for ${skipped.join(', ')}; ` +
        'skipping automatic Database/Cache provisioning for those dependencies.';
      if (!params.warnings.includes(warning)) {
        params.warnings.push(warning);
      }
    }

    return filtered;
  }

  private assemblePlan(params: {
    planId: string;
    status: DeployPlan['status'];
    complexity: DeployPlanComplexity;
    projectName: string;
    projectId?: string;
    targetProjectId?: string;
    repoUrl: string;
    planBranch: string;
    commitSha: string;
    gitCredentialId?: string;
    imageUrl?: string;
    buildMethod: DeployPlan['build']['method'];
    userDockerfile: string;
    dockerTarget?: string;
    generatedDockerfile?: string;
    composeFilePath?: string;
    composeFilePaths?: string[];
    composeProfiles?: string[];
    composeBuildServices?: PlanBuildService[];
    trafficService?: string;
    trafficServiceCandidates?: string[];
    relativeDockerfiles: string[];
    services: PlanService[];
    autoEnvVars: Record<string, string>;
    requiredEnvVars: string[];
    envVars: Record<string, string>;
    detectedEnv: PlanEnvEntry[];
    envIssues: EnvValueIssue[];
    missing: string[];
    warnings: string[];
    environment: 'production' | 'development';
  }): DeployPlan {
    const now = new Date().toISOString();
    const dockerfileDir = params.userDockerfile.includes('/')
      ? params.userDockerfile.substring(0, params.userDockerfile.lastIndexOf('/'))
      : '.';

    const composeBuildServicesWithUrls = params.composeBuildServices?.map((service) => ({
      name: service.name,
      runtime_role: service.runtime_role,
      dockerfile: service.dockerfile,
      // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
      port: service.port,
      host_ports: service.host_ports,
      // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
      image: service.image,
      depends_on: service.depends_on,
      command: service.command,
      entrypoint: service.entrypoint,
      restart: service.restart,
      healthcheck: service.healthcheck,
      // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
      internal_url: service.port
        ? // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
          `http://${composeContainerName(params.projectName, service.name)}:${String(service.port)}`
        : `http://${composeContainerName(params.projectName, service.name)}`,
    }));

    const internalUrl = `http://${projectContainerName(params.projectName)}`;
    const internalUrlNote = 'Port determined after build. Set EXPOSE in Dockerfile.';

    return {
      plan_id: params.planId,
      project_id: params.projectId,
      target_project_id: params.targetProjectId,
      status: params.status,
      complexity: params.complexity,
      app: {
        name: params.projectName,
        source: {
          repo_url: params.repoUrl,
          branch: params.planBranch,
          commit_sha: params.commitSha,
          git_credential_id: params.gitCredentialId,
          image_url: params.imageUrl,
        },
      },
      build: {
        method: params.buildMethod,
        dockerfile: params.userDockerfile,
        context: dockerfileDir,
        target: params.dockerTarget,
        generated_dockerfile: params.generatedDockerfile,
        compose_file: params.composeFilePath,
        compose_files:
          params.composeFilePaths && params.composeFilePaths.length > 1
            ? params.composeFilePaths
            : undefined,
        compose_profiles: params.composeProfiles,
        compose_services: composeBuildServicesWithUrls,
        traffic_service: params.trafficService,
        traffic_service_candidates:
          params.trafficServiceCandidates && params.trafficServiceCandidates.length > 1
            ? params.trafficServiceCandidates
            : undefined,
        dockerfiles_found:
          params.relativeDockerfiles.length > 0 ? params.relativeDockerfiles : undefined,
      },
      services: params.services,
      secrets: [],
      env: {
        auto: params.autoEnvVars,
        required: params.requiredEnvVars,
        provided: params.envVars,
        detected: params.detectedEnv,
        issues: params.envIssues,
      },
      health: {
        path: '/',
        retries: 10,
        interval_ms: 2000,
      },
      missing: params.missing,
      warnings: params.warnings,
      environment: params.environment,
      production: params.environment === 'production',
      created_at: now,
      updated_at: now,
      internal_url: internalUrl,
      internal_url_note: internalUrlNote,
    };
  }

  private async getExistingTargetProject(projectId: string | undefined) {
    if (!projectId) return null;
    const project = await this.db.getProject(projectId);
    if (!project) {
      throw new ProjectNotFoundError(projectId);
    }
    return project;
  }

  private detectServiceDependencies(envVars: Record<string, string>, warnings: string[]): void {
    const olHostPattern = /ol-[a-z0-9][\w-]*/gi;
    const referencedServices: string[] = [];
    for (const [key, value] of Object.entries(envVars)) {
      const matches = value.match(olHostPattern);
      if (matches) {
        for (const match of matches) {
          referencedServices.push(`${key} → ${match}`);
        }
      }
    }
    if (referencedServices.length > 0) {
      warnings.push(
        `Env vars reference other OpenLander containers: ${referencedServices.join(', ')}. ` +
          'Ensure those projects are deployed and running first, or the app may fail to connect at startup.',
      );
    }
  }

  private detectPersistenceWarnings(clonePath: string, warnings: string[]): void {
    const depFiles: { name: string; pattern: RegExp }[] = [
      {
        name: 'package.json',
        pattern: /better-sqlite3|"sqlite3"|sql\.js|drizzle.*sqlite|prisma.*sqlite/i,
      },
      { name: 'requirements.txt', pattern: /sqlite|peewee|sqlalchemy/i },
      { name: 'pyproject.toml', pattern: /sqlite|peewee|sqlalchemy/i },
      { name: 'Gemfile', pattern: /sqlite3/i },
      { name: 'go.mod', pattern: /go-sqlite3|modernc\.org\/sqlite/i },
      { name: 'Cargo.toml', pattern: /rusqlite|diesel.*sqlite/i },
    ];

    for (const { name, pattern } of depFiles) {
      const filePath = join(clonePath, name);
      if (!existsSync(filePath)) continue;

      try {
        const content = readFileSync(filePath, 'utf-8');
        if (pattern.test(content)) {
          warnings.push(
            'SQLite dependency detected. Data stored in SQLite will be lost on container restart ' +
              'unless a persistent volume is mounted. Use add_volume to attach storage at the ' +
              'database path (e.g., /app/data).',
          );
          return;
        }
      } catch {
        continue;
      }
    }
  }

  async createPlan(opts: CreatePlanOptions): Promise<DeployPlan> {
    const {
      repoUrl,
      branch,
      name,
      envVars = {},
      sshKeyPath,
      source,
      imageUrl,
      projectId,
      targetProjectId,
    } = opts;
    const { nanoid } = await import('nanoid');
    const planId = `plan_${nanoid(12)}`;
    if (projectId && targetProjectId) {
      throw new ServiceConfigError('projectId and targetProjectId cannot be used together.', {
        projectId,
        targetProjectId,
      });
    }

    if (source === 'image' || imageUrl) {
      const normalizedImageUrl = imageUrl?.trim();
      if (!normalizedImageUrl) {
        throw new Error('imageUrl is required when source is "image"');
      }

      const parsedImage = parseImageUrl(normalizedImageUrl);
      if (!parsedImage) {
        throw new Error(`Invalid Docker image URL: ${normalizedImageUrl}`);
      }

      const imageNameParts = parsedImage.name.split('/');
      const fallbackProjectName = imageNameParts[imageNameParts.length - 1] || parsedImage.name;
      const targetProject = await this.getExistingTargetProject(projectId);
      const attachTargetProject = await this.getExistingTargetProject(targetProjectId);
      const projectName = targetProject?.name ?? name ?? fallbackProjectName;
      // Image-source plans carry no detected service dependencies (services: []),
      // but caller-provided env_vars can still require value validation.
      const envIssues = this.validatePlanEnvValues([], envVars);
      const initialStatus: DeployPlan['status'] = this.computePlanStatus(
        [],
        [],
        envVars,
        envIssues,
      );
      const complexity: DeployPlanComplexity = 'simple';

      const plan = this.assemblePlan({
        planId,
        status: initialStatus,
        complexity,
        projectName,
        projectId: targetProject?.id,
        targetProjectId: attachTargetProject?.id,
        repoUrl: '',
        planBranch: '',
        commitSha: '',
        imageUrl: normalizedImageUrl,
        buildMethod: 'image',
        userDockerfile: 'Dockerfile',
        dockerTarget: opts.dockerTarget,
        relativeDockerfiles: [],
        services: [],
        autoEnvVars: {},
        requiredEnvVars: [],
        envVars,
        detectedEnv: [],
        envIssues,
        missing: [],
        warnings: [],
        environment: opts.environment === 'development' ? 'development' : 'production',
      });

      const execution = this.buildExecutionContext(opts);
      if (execution) {
        (plan as DeployPlan & { execution?: PlanExecutionContext }).execution = execution;
      }

      log.info({ planId, status: initialStatus, buildMethod: 'image' }, 'Creating deploy plan');
      await this.db.createDeployPlan({
        id: planId,
        projectName,
        status: initialStatus,
        complexity,
        planJson: JSON.stringify(this.preparePlanForStorage(plan)),
        commitSha: '',
      });

      return plan;
    }

    if (!repoUrl) {
      throw new Error('repoUrl is required when source is "git" or undefined');
    }

    const targetProject = await this.getExistingTargetProject(projectId);
    const attachTargetProject = await this.getExistingTargetProject(targetProjectId);
    const resourceProject = attachTargetProject ?? targetProject;
    const projectName = targetProject?.name ?? name ?? extractProjectName(repoUrl);

    log.info({ repoUrl: redactRepoUrl(repoUrl), branch }, 'Cloning repository');
    const cloneResult = await cloneRepo({
      repoUrl,
      branch,
      sshKeyPath,
      gitCredentialId: opts.gitCredentialId,
    });
    const clonePath = cloneResult.path;
    const commitSha = cloneResult.commitSha;

    const warnings: string[] = [];
    const detectedEnv: PlanEnvEntry[] = [];
    const {
      buildMethod,
      userDockerfile,
      generatedDockerfile,
      composeFilePath,
      composeFilePaths,
      composeBuildServices,
      composeServiceFingerprints,
      trafficServiceCandidates,
      relativeDockerfiles,
    } = this.resolveBuildConfig(clonePath, opts, warnings, detectedEnv);
    let trafficService: string | undefined;
    if (buildMethod === 'compose') {
      const candidates = trafficServiceCandidates ?? [];
      if (opts.trafficService && !candidates.includes(opts.trafficService)) {
        throw new InvalidTrafficServiceError(opts.trafficService, candidates);
      }
      trafficService = opts.trafficService ?? (candidates.length === 1 ? candidates[0] : undefined);
    }
    if (
      attachTargetProject &&
      (buildMethod === 'compose' ||
        (userDockerfile === 'Dockerfile' && relativeDockerfiles.length > 1))
    ) {
      throw new ServiceConfigError(
        'target_project_id currently supports a single Application only. Select one Dockerfile or deploy the Compose/monorepo app as a separate Project.',
        {
          targetProjectId: attachTargetProject.id,
          buildMethod,
          dockerfilesFound: relativeDockerfiles,
        },
      );
    }

    const detectedServices = await this.detectPlanServices(
      clonePath,
      resourceProject?.name ?? projectName,
      resourceProject?.id,
      buildMethod === 'compose' ? composeBuildServices : undefined,
    );
    this.detectEnvVars(clonePath, userDockerfile, detectedEnv);
    this.detectPersistenceWarnings(clonePath, warnings);
    this.detectServiceDependencies(envVars, warnings);
    const services = this.filterServicesWithExplicitEnv({
      services: detectedServices,
      providedEnv: envVars,
      warnings,
    });
    const detectedEnvWithServiceRequirements = [
      ...detectedEnv,
      ...this.requiredEnvEntriesForServiceChoices(services, detectedEnv),
    ];

    const requiredEnvVars = Array.from(
      new Set(detectedEnvWithServiceRequirements.filter((e) => e.required).map((e) => e.key)),
    );
    const autoEnvVars = this.buildAutoEnvVars(services);

    // Fetch existing env vars from database if projectId is provided
    const existingEnvVars = resourceProject?.id ? await this.env.getAll(resourceProject.id) : {};

    const missingEntries = computeMissingEnvVars(
      detectedEnvWithServiceRequirements,
      envVars,
      autoEnvVars,
      existingEnvVars,
      this.plannedServiceEnvKeys(services),
    );
    const missing = missingEntries.map((entry) => entry.key);
    const envIssues = this.validatePlanEnvValues(detectedEnvWithServiceRequirements, envVars);

    const isCompose = buildMethod === 'compose';
    const serviceCount = isCompose ? (composeBuildServices?.length ?? 0) : services.length;
    const complexity = computeComplexity({
      missingCount: missing.length,
      serviceCount,
      isCompose,
    });

    const initialStatus: DeployPlan['status'] = this.computePlanStatus(
      missing,
      services,
      envVars,
      envIssues,
      (trafficServiceCandidates?.length ?? 0) > 1 && !trafficService,
    );

    const planBranch = cloneResult.branch;
    const plan = this.assemblePlan({
      planId,
      status: initialStatus,
      complexity,
      projectName,
      projectId: targetProject?.id,
      targetProjectId: attachTargetProject?.id,
      repoUrl,
      planBranch,
      commitSha,
      gitCredentialId: cloneResult.gitCredentialId,
      buildMethod,
      userDockerfile,
      dockerTarget: opts.dockerTarget,
      generatedDockerfile,
      composeFilePath,
      composeFilePaths,
      composeProfiles: opts.composeProfiles,
      composeBuildServices,
      trafficService,
      trafficServiceCandidates,
      relativeDockerfiles,
      services,
      autoEnvVars,
      requiredEnvVars,
      envVars,
      detectedEnv: detectedEnvWithServiceRequirements,
      envIssues,
      missing,
      warnings,
      environment: opts.environment === 'development' ? 'development' : 'production',
    });

    const execution = this.buildExecutionContext(opts);
    if (execution || composeServiceFingerprints) {
      (plan as DeployPlan & { execution?: PlanExecutionContext }).execution = {
        ...execution,
        ...(composeServiceFingerprints ? { composeServiceFingerprints } : {}),
      };
    }

    log.info({ planId, status: initialStatus, buildMethod }, 'Creating deploy plan');
    await this.db.createDeployPlan({
      id: planId,
      projectName,
      status: initialStatus,
      complexity,
      planJson: JSON.stringify(this.preparePlanForStorage(plan)),
      commitSha,
    });

    return plan;
  }

  async updatePlan(planId: string, updates: PlanUpdates): Promise<DeployPlan> {
    const row = await this.db.getDeployPlan(planId);
    if (!row) {
      throw new Error(`Deploy plan not found: ${planId}`);
    }

    const plan = JSON.parse(row.plan_json) as DeployPlan;

    const terminalStatuses = ['executing', 'completed', 'failed', 'rolled_back'];
    if (terminalStatuses.includes(plan.status)) {
      throw new Error(`Cannot update plan in ${plan.status} status`);
    }

    let refreshedComposeBuild: Partial<DeployPlan['build']> = {};
    let refreshedComposeExecution: Partial<PlanExecutionContext> = {};
    const requestedComposeFile = updates.compose_file ?? updates.build?.compose_file;
    const requestedComposeFiles = updates.compose_files ?? updates.build?.compose_files;
    const requestedComposeProfiles = updates.compose_profiles ?? updates.build?.compose_profiles;
    if (requestedComposeFile !== undefined && requestedComposeFiles !== undefined) {
      throw new ServiceConfigError('compose_file and compose_files cannot be combined.');
    }
    if (
      requestedComposeFile !== undefined ||
      requestedComposeFiles !== undefined ||
      requestedComposeProfiles !== undefined
    ) {
      if (!plan.app.source.repo_url) {
        throw new ServiceConfigError('Compose settings require a Git repository plan.');
      }
      const execution = this.getExecutionContext(plan);
      const cloneResult = await cloneRepo({
        repoUrl: plan.app.source.repo_url,
        branch: plan.app.source.branch,
        sshKeyPath: execution.sshKeyPath,
        gitCredentialId: plan.app.source.git_credential_id,
      });
      const composeWarnings: string[] = [];
      const composeDetectedEnv: PlanEnvEntry[] = [];
      const selectedComposeFiles =
        requestedComposeFiles ??
        (requestedComposeFile === undefined ? plan.build.compose_files : undefined);
      const selectedComposeFile =
        requestedComposeFile ?? (selectedComposeFiles ? undefined : plan.build.compose_file);
      const resolved = this.resolveBuildConfig(
        cloneResult.path,
        {
          repoUrl: plan.app.source.repo_url,
          composeFile: selectedComposeFile,
          composeFiles: selectedComposeFiles,
          composeProfiles: requestedComposeProfiles ?? plan.build.compose_profiles,
        },
        composeWarnings,
        composeDetectedEnv,
      );
      if (
        resolved.buildMethod !== 'compose' ||
        !resolved.composeFilePath ||
        !resolved.composeFilePaths
      ) {
        throw new ServiceConfigError('The selected file is not a valid Compose deployment.', {
          composeFile: selectedComposeFile,
          composeFiles: selectedComposeFiles,
        });
      }
      const candidates = resolved.trafficServiceCandidates ?? [];
      const explicitlyUpdatedTraffic =
        updates.traffic_service ?? updates.build?.traffic_service ?? undefined;
      const retainedTraffic = explicitlyUpdatedTraffic ?? plan.build.traffic_service;
      const trafficService =
        retainedTraffic && candidates.includes(retainedTraffic)
          ? retainedTraffic
          : candidates.length === 1
            ? candidates[0]
            : undefined;
      if (explicitlyUpdatedTraffic && !candidates.includes(explicitlyUpdatedTraffic)) {
        throw new InvalidTrafficServiceError(explicitlyUpdatedTraffic, candidates);
      }
      refreshedComposeBuild = {
        method: 'compose',
        compose_file: resolved.composeFilePath,
        compose_files: resolved.composeFilePaths.length > 1 ? resolved.composeFilePaths : undefined,
        compose_profiles: requestedComposeProfiles ?? plan.build.compose_profiles,
        compose_services: resolved.composeBuildServices,
        traffic_service: trafficService,
        traffic_service_candidates: candidates.length > 1 ? candidates : undefined,
      };
      refreshedComposeExecution = {
        composeFile: resolved.composeFilePath,
        composeFiles: resolved.composeFilePaths.length > 1 ? resolved.composeFilePaths : undefined,
        composeProfiles: requestedComposeProfiles ?? plan.build.compose_profiles,
        composeServiceFingerprints: resolved.composeServiceFingerprints,
      };
    }

    const merged: DeployPlan = {
      ...plan,
      env: {
        ...plan.env,
        provided: plan.env.provided,
        trusted: plan.env.trusted,
      },
      build: {
        ...plan.build,
        ...(updates.build || {}),
        ...refreshedComposeBuild,
        ...(updates.compose_file !== undefined ? { compose_file: updates.compose_file } : {}),
        ...(updates.compose_files !== undefined ? { compose_files: updates.compose_files } : {}),
        ...(updates.compose_profiles !== undefined
          ? { compose_profiles: updates.compose_profiles }
          : {}),
        ...(updates.traffic_service !== undefined
          ? { traffic_service: updates.traffic_service }
          : {}),
      },
    };
    if (Object.keys(refreshedComposeExecution).length > 0) {
      (merged as DeployPlan & { execution?: PlanExecutionContext }).execution = {
        ...this.getExecutionContext(plan),
        ...refreshedComposeExecution,
      };
    }
    const trafficCandidates = merged.build.traffic_service_candidates ?? [];
    if (
      merged.build.traffic_service &&
      trafficCandidates.length > 0 &&
      !trafficCandidates.includes(merged.build.traffic_service)
    ) {
      throw new InvalidTrafficServiceError(merged.build.traffic_service, trafficCandidates);
    }

    if (updates.env) {
      const envUpdate = updates.env;
      if ('provided' in envUpdate || 'trusted' in envUpdate) {
        // Structured: { provided: { KEY: "val" }, trusted: ["KEY"] }
        const structured: { provided?: Record<string, string>; trusted?: string[] } = envUpdate;
        if (structured.provided) {
          merged.env.provided = { ...plan.env.provided, ...structured.provided };
        }
        if (Array.isArray(structured.trusted)) {
          const trusted = new Set(plan.env.trusted ?? []);
          for (const key of structured.trusted) {
            if (typeof key === 'string' && key.length > 0) {
              trusted.add(key);
            }
          }
          merged.env.trusted = [...trusted].filter((key) => key in merged.env.provided);
        }
      } else {
        // Flat: { KEY: "val" } → treat as provided
        merged.env.provided = { ...plan.env.provided, ...(envUpdate as Record<string, string>) };
      }
    }

    if (updates.services) {
      merged.services = updates.services;
      merged.env.auto = this.buildAutoEnvVars(merged.services);
    } else {
      merged.services = this.filterServicesWithExplicitEnv({
        services: merged.services,
        providedEnv: merged.env.provided,
        warnings: merged.warnings,
      });
      merged.env.auto = this.buildAutoEnvVars(merged.services);
    }
    if (updates.health) {
      merged.health = { ...plan.health, ...updates.health };
    }

    const requiredEntries: PlanEnvEntry[] = merged.env.required.map((key) => {
      const detected = merged.env.detected.find((entry) => entry.key === key && entry.required);
      return detected || { key, source: 'required', required: true };
    });

    const missingEntries = computeMissingEnvVars(
      requiredEntries,
      merged.env.provided,
      merged.env.auto,
      {},
      this.plannedServiceEnvKeys(merged.services),
    );
    const missing = missingEntries.map((entry) => entry.key);
    merged.missing = missing;
    merged.env.issues = this.validatePlanEnvValues(
      merged.env.detected,
      merged.env.provided,
      this.trustedEnvKeySet(merged.env),
    );

    merged.status = this.computePlanStatus(
      missing,
      merged.services,
      merged.env.provided,
      merged.env.issues,
      trafficCandidates.length > 1 && !merged.build.traffic_service,
    );
    merged.updated_at = new Date().toISOString();

    log.info({ planId, status: merged.status }, 'Updating deploy plan');
    await this.db.updateDeployPlan(planId, {
      status: merged.status,
      planJson: JSON.stringify(this.preparePlanForStorage(merged)),
    });

    return merged;
  }

  private async loadPlanForExecution(planId: string): Promise<DeployPlan> {
    // Re-read from DB to prevent race condition.
    const freshRow = await this.db.getDeployPlan(planId);
    if (!freshRow) {
      throw new Error(`Plan not found: ${planId}`);
    }
    return JSON.parse(freshRow.plan_json) as DeployPlan;
  }

  private assertPlanHasRequiredInput(plan: DeployPlan): void {
    const trafficCandidates = plan.build.traffic_service_candidates ?? [];
    if (trafficCandidates.length > 1 && !plan.build.traffic_service) {
      throw new TrafficServiceRequiredError(trafficCandidates);
    }
    if (plan.status !== 'needs_input') {
      return;
    }

    const blockingIssues = plan.env.issues?.filter((issue) => issue.severity === 'fail') ?? [];
    const missingKeys = plan.missing.join(', ') || 'none';
    const invalidKeys = blockingIssues.map((issue) => `${issue.key}: ${issue.message}`).join('; ');
    throw new Error(
      `Plan requires environment input. Missing: ${missingKeys}.` +
        (invalidKeys ? ` Invalid: ${invalidKeys}.` : '') +
        ' ' +
        `Call update_deploy_plan to provide them, then execute again.`,
    );
  }

  private evaluateApprovalGate(
    planId: string,
    plan: DeployPlan,
    approval?: ExecutePlanApproval,
  ): ExecuteApprovalGateResult {
    const approvedSafeResources = new Set<string>();
    if (plan.status !== 'needs_approval') {
      return { approvedSafeResources };
    }

    const safeProposals = this.safeProposedResources(plan.services, plan.env.provided);
    const approvedAll = approval?.approveAllSafeResources === true;
    const approvedIds = new Set(approval?.createResources ?? []);
    const allApproved = safeProposals.every(
      (svc) => approvedAll || approvedIds.has(this.proposedResourceIdentifier(svc)),
    );

    if (!allApproved) {
      return {
        approvedSafeResources,
        response: {
          status: 'needs_approval',
          plan_id: planId,
          project_name: plan.app.name,
          approval_required: {
            create_resources: safeProposals.map((svc) => this.proposedResourceIdentifier(svc)),
          },
          _agent_guidance: {
            next_steps: [
              'Re-run execute_deploy_plan with approve_all_safe_resources=true to approve every proposed resource.',
              'Or pass approvals.create_resources with the identifiers above to approve individually. The identifiers are listed in approval_required.create_resources and in services[] (resolution="proposed_project_service").',
            ],
          },
        },
      };
    }

    for (const svc of safeProposals) {
      approvedSafeResources.add(this.proposedResourceIdentifier(svc));
    }

    return { approvedSafeResources };
  }

  private assertPlanIsExecutable(plan: DeployPlan): void {
    if (plan.status !== 'ready' && plan.status !== 'needs_approval') {
      throw new Error(`Plan status is "${plan.status}" — only "ready" plans can be executed.`);
    }
  }

  private assertValidProjectName(projectName: string): void {
    const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;
    if (!PROJECT_NAME_REGEX.test(projectName)) {
      throw new Error(
        `Invalid project name "${projectName}": must contain only lowercase letters, numbers, and hyphens, starting with a letter or number`,
      );
    }
  }

  private transitionApprovedPlanForExecution(plan: DeployPlan): DeployPlan {
    // In-memory only: bring an approved needs_approval plan to 'ready'. Never
    // persisted (no updateDeployPlan call here).
    return plan.status === 'needs_approval' ? PlanStateMachine.transition(plan, 'ready') : plan;
  }

  private async resolveExecuteTarget(params: {
    planId: string;
    plan: DeployPlan;
    planExecution: PlanExecutionContext;
    approvedSafeResources: ReadonlySet<string>;
  }): Promise<ExecuteTargetResolutionResult> {
    const { planId, plan, planExecution, approvedSafeResources } = params;
    const attachTargetProject = await this.getExistingTargetProject(planExecution.targetProjectId);
    if (attachTargetProject) {
      const collidingProject = await this.db.getProjectByName(plan.app.name);
      if (collidingProject && collidingProject.id !== attachTargetProject.id) {
        return {
          attachTargetProject,
          targetProject: null,
          response: {
            status: 'failed',
            plan_id: planId,
            project_name: plan.app.name,
            target_project_id: attachTargetProject.id,
            error: `target_project_id Application name "${plan.app.name}" collides with an existing Project.`,
            message:
              'Choose a unique Application name. Existing-Project attach creates a temporary runtime Project before it moves the Application into the target Project.',
          },
        };
      }
    }

    let targetProject: ExecutePlanProjectTarget | null =
      attachTargetProject ??
      (plan.project_id ? await this.db.getProject(plan.project_id) : null) ??
      (await this.db.getProjectByName(plan.app.name)) ??
      null;
    const hasApprovedCreate = plan.services.some(
      (svc) =>
        svc.action === 'create' &&
        svc.resolution === 'proposed_project_service' &&
        svc.approval === 'safe_resource' &&
        !this.planServiceSatisfiedByExplicitEnv(svc, plan.env.provided) &&
        approvedSafeResources.has(this.proposedResourceIdentifier(svc)),
    );

    if (hasApprovedCreate && !targetProject) {
      targetProject = await this.createPlanOwnedTargetProject(plan);
    }

    return { attachTargetProject, targetProject };
  }

  private async createPlanOwnedTargetProject(plan: DeployPlan): Promise<ExecutePlanProjectTarget> {
    const existing = await this.db.getProjectByName(plan.app.name);
    if (existing) {
      return { id: existing.id, name: existing.name };
    }

    const { nanoid } = await import('nanoid');
    const source = plan.build.method === 'image' ? 'image' : 'git';
    try {
      const created = await this.db.createProject({
        id: nanoid(12),
        name: plan.app.name,
        repoUrl: source === 'image' ? '' : plan.app.source.repo_url,
        branch: source === 'image' ? undefined : plan.app.source.branch,
        dockerfilePath: plan.build.dockerfile,
        dockerTarget: plan.build.target,
        buildContext: plan.build.context,
        buildMethod: plan.build.method === 'compose' ? 'compose' : null,
        source,
        ...(source === 'image'
          ? {
              imageUrl: plan.app.source.image_url,
            }
          : {}),
      });
      return { id: created.id, name: created.name };
    } catch (error) {
      if (error instanceof ProjectAlreadyExistsError) {
        const createdByRace = await this.db.getProjectByName(plan.app.name);
        if (createdByRace) {
          return { id: createdByRace.id, name: createdByRace.name };
        }
      }
      throw error;
    }
  }

  private bindPlanToExecutionTarget(params: {
    plan: DeployPlan;
    attachTargetProject: ExecutePlanProjectTarget | null;
    targetProject: ExecutePlanProjectTarget | null;
  }): DeployPlan {
    const { plan, attachTargetProject, targetProject } = params;
    if (attachTargetProject || !targetProject || plan.project_id === targetProject.id) {
      return plan;
    }
    return {
      ...plan,
      project_id: targetProject.id,
      target_project_id: undefined,
    };
  }

  private async acquirePlanDeployLock(params: {
    planId: string;
    lockSessionId?: string;
    targetProject: ExecutePlanProjectTarget | null;
  }): Promise<ExecuteDeployLock> {
    const { planId, lockSessionId, targetProject } = params;
    let lockProjectId: string | null = null;
    let deployLockReleased = false;

    const release = () => {
      if (!lockProjectId || deployLockReleased) {
        return;
      }

      const projectId = lockProjectId;
      deployLockReleased = true;
      void this.db
        .releaseDeployLock(projectId, lockSessionId ?? `plan-${planId}`)
        .catch((error: unknown) => {
          log.warn({ planId, projectId, error }, 'Failed to release deploy lock');
        });
    };

    if (targetProject) {
      const lockSession = lockSessionId ?? `plan-${planId}`;
      // Release happens asynchronously in event listeners (deploy:success /
      // deploy:failed / compose:up / compose:failed) via `release`, so we use
      // the bare acquire helper instead of `withDeployLock`.
      await acquireDeployLockOrThrow(this.db, {
        projectId: targetProject.id,
        sessionId: lockSession,
      });
      lockProjectId = targetProject.id;
    }

    return { projectId: lockProjectId, release };
  }

  private async persistExecutingPlan(planId: string, plan: DeployPlan): Promise<DeployPlan> {
    const executingPlan = PlanStateMachine.transition(plan, 'executing');
    await this.db.updateDeployPlan(planId, {
      status: 'executing',
      planJson: JSON.stringify(this.preparePlanForStorage(executingPlan)),
    });
    return executingPlan;
  }

  private recordApprovalAudit(params: {
    planId: string;
    plan: DeployPlan;
    targetProject: ExecutePlanProjectTarget | null;
    approvedSafeResources: ReadonlySet<string>;
  }): void {
    const { planId, plan, targetProject, approvedSafeResources } = params;
    if (approvedSafeResources.size === 0) {
      return;
    }

    void this.db
      .recordDeployPlanApproval({
        projectId: targetProject?.id ?? plan.project_id ?? '',
        plan: JSON.stringify({
          plan_id: planId,
          approved_resources: [...approvedSafeResources],
        }),
        correlationId: planId,
      })
      .catch((error: unknown) => {
        // Error-level: a failed write leaves approved provisioning un-audited
        // (the deploy still proceeds — best-effort), so make the gap alertable.
        log.error({ planId, error }, 'Failed to record deploy-plan approval audit');
      });
  }

  private async resolvePlanEnv(params: {
    plan: DeployPlan;
    attachTargetProject: ExecutePlanProjectTarget | null;
    targetProject: ExecutePlanProjectTarget | null;
    approvedSafeResources: ReadonlySet<string>;
  }): Promise<Record<string, string>> {
    const { targetProject, approvedSafeResources } = params;
    const mergedEnv = await this.resolvePlanBaseEnv(params);

    await this.applyManagedResourceEnv({
      plan: params.plan,
      targetProject,
      approvedSafeResources,
      mergedEnv,
    });

    return mergedEnv;
  }

  private async resolvePlanBaseEnv(params: {
    plan: DeployPlan;
    attachTargetProject: ExecutePlanProjectTarget | null;
    targetProject: ExecutePlanProjectTarget | null;
  }): Promise<Record<string, string>> {
    const { plan, attachTargetProject, targetProject } = params;
    return await resolveEnvVars(
      {
        projectId: targetProject?.id ?? attachTargetProject?.id ?? plan.project_id ?? plan.app.name,
        autoEnvVars: plan.env.auto,
        inlineEnvVars: plan.env.provided,
      },
      { env: this.env },
    );
  }

  private async resolvePlanEnvSettled(params: {
    plan: DeployPlan;
    attachTargetProject: ExecutePlanProjectTarget | null;
    targetProject: ExecutePlanProjectTarget | null;
    approvedSafeResources: ReadonlySet<string>;
    baseEnv: Record<string, string>;
  }): DeferredRuntimeEnvVars {
    try {
      const mergedEnv = { ...params.baseEnv };
      await this.applyManagedResourceEnv({
        plan: params.plan,
        targetProject: params.targetProject,
        approvedSafeResources: params.approvedSafeResources,
        mergedEnv,
      });
      return { ok: true, envVars: mergedEnv };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private canOverlapBuildAndProvision(params: {
    plan: DeployPlan;
    targetProject: ExecutePlanProjectTarget | null;
    approvedSafeResources: ReadonlySet<string>;
  }): boolean {
    const { plan, targetProject, approvedSafeResources } = params;
    if (this.getDeployMode(plan) !== 'single' || plan.build.method === 'image') {
      return false;
    }
    if (!targetProject) {
      return false;
    }
    let hasDeferrableProvisioning = false;
    for (const planService of plan.services) {
      const envVarName = this.serviceEnvVarName(planService);
      if (!envVarName || this.hasExplicitEnvValue(plan.env.provided, envVarName)) {
        continue;
      }
      const isApprovedSafeProposal =
        planService.action === 'create' &&
        planService.resolution === 'proposed_project_service' &&
        planService.approval === 'safe_resource' &&
        approvedSafeResources.has(this.proposedResourceIdentifier(planService));
      if (!isApprovedSafeProposal) {
        return false;
      }
      hasDeferrableProvisioning = true;
    }
    return hasDeferrableProvisioning;
  }

  private async applyManagedResourceEnv(params: {
    plan: DeployPlan;
    targetProject: ExecutePlanProjectTarget | null;
    approvedSafeResources: ReadonlySet<string>;
    mergedEnv: Record<string, string>;
  }): Promise<void> {
    const { plan, targetProject, approvedSafeResources, mergedEnv } = params;
    const workItems: Array<{
      envVarName: string;
      resolveConnectionString: () => Promise<string>;
    }> = [];

    for (const planService of plan.services) {
      // The dependency is provided by the Compose stack itself. Its connection
      // env is resolved inside Compose, so executePlan must not treat it as an
      // external/managed resource that requires an explicit URL.
      if (planService.resolution === 'compose_service') {
        continue;
      }

      const envVarName = this.serviceEnvVarName(planService);
      if (!envVarName || this.hasExplicitEnvValue(plan.env.provided, envVarName)) {
        if (envVarName) {
          log.info(
            { serviceType: planService.type, envVarName },
            'Skipping Database/Cache env injection because explicit env var was provided',
          );
        }
        continue;
      }

      if (planService.action === 'create') {
        const isApprovedSafeProposal =
          planService.resolution === 'proposed_project_service' &&
          planService.approval === 'safe_resource' &&
          approvedSafeResources.has(this.proposedResourceIdentifier(planService));

        if (!isApprovedSafeProposal) {
          // not_auto_creatable / unapproved: fail fast, create nothing.
          throw new ServiceConfigError(
            `Database/Cache resource ${planService.type} requires an explicit ${envVarName} value before deploy.`,
            {
              serviceType: planService.type,
              envVarName,
              nextSteps: [
                `Provide an external ${envVarName} value in env_vars.`,
                'Or call openlander_managed_service.create_service for the target Project, set its suggested_env on the Application, then call update_app.',
              ],
            },
          );
        }

        if (!targetProject) {
          throw new ServiceConfigError(
            `Provisioning Database/Cache resource ${planService.type} requires an existing target Project.`,
            { serviceType: planService.type, envVarName },
          );
        }
        workItems.push({
          envVarName,
          resolveConnectionString: () =>
            this.provisionApprovedService(planService, targetProject, envVarName),
        });
      } else {
        if (!targetProject) {
          throw new ServiceConfigError(
            `Reusable Database/Cache/Storage resource ${planService.name ?? planService.service_id ?? planService.type} requires an existing target Project.`,
            {
              serviceType: planService.type,
              serviceName: planService.name,
              serviceId: planService.service_id,
            },
          );
        }
        workItems.push({
          envVarName,
          resolveConnectionString: async () => {
            const reusable = await this.resolveReusableService(planService, targetProject.id);
            const connectionString = this.getServiceConnectionString(reusable, envVarName);
            await new ManagedServiceLinker(this.db, this.env).connect({
              projectId: targetProject.id,
              service: reusable,
              source: 'deploy_plan',
              credentials: { connectionString },
            });
            return connectionString;
          },
        });
      }
    }

    const resolved = await Promise.all(
      workItems.map(async (item) => ({
        envVarName: item.envVarName,
        connectionString: await item.resolveConnectionString(),
      })),
    );
    for (const { envVarName, connectionString } of resolved) {
      mergedEnv[envVarName] = connectionString;
    }
  }

  private async dispatchPlanDeploy(params: {
    plan: DeployPlan;
    planExecution: PlanExecutionContext;
    attachTargetProject: ExecutePlanProjectTarget | null;
    mergedEnv: Record<string, string>;
    deployOnly?: string[];
    triggerOverride?: 'chat' | 'webhook' | 'api';
    deployLockProjectId: string | null;
    lockSessionId?: string;
    planId: string;
    deferredRuntimeEnvVars?: () => DeferredRuntimeEnvVars;
  }): Promise<ExecuteDispatchResult> {
    const {
      plan,
      planExecution,
      attachTargetProject,
      mergedEnv,
      deployOnly,
      triggerOverride,
      deployLockProjectId,
      lockSessionId,
      planId,
      deferredRuntimeEnvVars,
    } = params;
    log.info({ planId, planCommit: plan.app.source.commit_sha }, 'Executing plan (non-blocking)');

    const deployMode = this.getDeployMode(plan);
    const execution = {
      ...planExecution,
      ...(triggerOverride ? { trigger: triggerOverride } : {}),
    };
    const isImage = plan.build.method === 'image';
    const propagatedLockSession = deployLockProjectId
      ? (lockSessionId ?? `plan-${planId}`)
      : undefined;

    if (deployMode === 'monorepo') {
      const cloneResult = await cloneRepo({
        repoUrl: plan.app.source.repo_url,
        branch: plan.app.source.branch,
        sshKeyPath: execution.sshKeyPath,
        gitCredentialId: plan.app.source.git_credential_id,
      });
      const dockerfiles =
        deployOnly && deployOnly.length > 0
          ? deployOnly
          : plan.build.dockerfiles_found && plan.build.dockerfiles_found.length > 0
            ? plan.build.dockerfiles_found
            : [plan.build.dockerfile];
      const startResult = await this.pipeline.startMonorepoDeploy({
        repoUrl: plan.app.source.repo_url,
        branch: plan.app.source.branch,
        clonePath: cloneResult.path,
        commitSha: cloneResult.commitSha,
        gitCredentialId: cloneResult.gitCredentialId,
        dockerfiles,
        envVars: mergedEnv,
        name: plan.app.name,
        ...(execution.visibility ? { visibility: execution.visibility } : {}),
        ...(execution.trigger ? { trigger: execution.trigger as 'chat' | 'webhook' | 'api' } : {}),
        _lockSessionId: propagatedLockSession,
      });

      return {
        startedProjectId: startResult.parentProjectId,
        startedProjectName: startResult.parentName,
      };
    }

    const isCompose = deployMode === 'compose';
    const startResult = await this.pipeline.startDeploy({
      repoUrl: plan.app.source.repo_url,
      branch: plan.app.source.branch,
      name: plan.app.name,
      envVars: mergedEnv,
      ...(isImage ? { source: 'image' as const } : {}),
      ...(isImage && plan.app.source.image_url ? { imageUrl: plan.app.source.image_url } : {}),
      ...(execution.imageCmd ? { imageCmd: execution.imageCmd } : {}),
      ...(execution.containerPort !== undefined ? { containerPort: execution.containerPort } : {}),
      ...(execution.healthCheckPath ? { healthCheckPath: execution.healthCheckPath } : {}),
      preferDockerfile: isCompose ? false : !plan.build.generated_dockerfile,
      dockerfilePath:
        !isCompose && plan.build.dockerfile !== 'Dockerfile' ? plan.build.dockerfile : undefined,
      dockerTarget: plan.build.target,
      buildContext: plan.build.context !== '.' ? plan.build.context : undefined,
      ...(isCompose && plan.build.compose_files
        ? { composeFiles: plan.build.compose_files }
        : isCompose && plan.build.compose_file
          ? { composeFile: plan.build.compose_file }
          : {}),
      ...(isCompose && plan.build.compose_profiles
        ? { composeProfiles: plan.build.compose_profiles }
        : {}),
      ...(isCompose && (deployOnly ?? plan.build.selected_services)
        ? { composeServices: deployOnly ?? plan.build.selected_services }
        : {}),
      ...(isCompose && plan.build.traffic_service
        ? { trafficService: plan.build.traffic_service }
        : {}),
      ...(isCompose && planExecution.composeServiceFingerprints
        ? { composeServiceFingerprints: planExecution.composeServiceFingerprints }
        : {}),
      ...(execution.visibility ? { visibility: execution.visibility } : {}),
      ...(plan.environment ? { environment: plan.environment } : {}),
      ...(execution.sshKeyPath ? { sshKeyPath: execution.sshKeyPath } : {}),
      ...(plan.app.source.git_credential_id
        ? { gitCredentialId: plan.app.source.git_credential_id }
        : {}),
      ...(execution.trigger ? { trigger: execution.trigger as 'chat' | 'webhook' | 'api' } : {}),
      ...(attachTargetProject ? { _networkProjectName: attachTargetProject.name } : {}),
      ...(deferredRuntimeEnvVars ? { _deferredRuntimeEnvVars: deferredRuntimeEnvVars } : {}),
      // Propagate the plan-engine's lock session so that startDeploy's inner
      // deploy() runs inline under the same session (skipping a new acquire that
      // would conflict with the already-held lock).
      _lockSessionId: propagatedLockSession,
    });

    return {
      startedProjectId: startResult.projectId,
      startedProjectName: startResult.projectName,
      ...(startResult.status === 'preflight_failed'
        ? { preflightError: startResult.preflightError }
        : {}),
    };
  }

  private registerPlanCompletionListeners(params: {
    planId: string;
    executingPlan: DeployPlan;
    attachTargetProject: ExecutePlanProjectTarget | null;
    startedProjectId: string;
    releaseDeployLock: () => void;
  }): void {
    if (!this.events) {
      return;
    }

    const { planId, executingPlan, attachTargetProject, startedProjectId, releaseDeployLock } =
      params;
    let cleanup = () => undefined;

    const finishSuccess = async (projectId: string): Promise<void> => {
      try {
        let completed = PlanStateMachine.transition(executingPlan, 'completed');
        if (attachTargetProject) {
          const moved = await this.db.attachServiceToProject(
            targetIdentityResolver.deployableServiceIdForRuntimeProject(projectId),
            attachTargetProject.id,
          );
          completed = {
            ...completed,
            project_id: moved.targetProjectId,
            target_project_id: moved.targetProjectId,
          };
        }
        await this.db
          .updateDeployPlan(planId, {
            status: 'completed',
            planJson: JSON.stringify(this.preparePlanForStorage(completed)),
          })
          .catch((error: unknown) => {
            log.warn({ planId, error }, 'Failed to mark deploy plan completed');
          });
        log.info({ planId, projectId }, 'Plan completed via event');
      } catch (error) {
        const errMsg =
          error instanceof Error
            ? `Deploy succeeded but target attach failed: ${error.message}`
            : `Deploy succeeded but target attach failed: ${String(error)}`;
        const failed = PlanStateMachine.transition(executingPlan, 'failed', errMsg);
        await this.db
          .updateDeployPlan(planId, {
            status: 'failed',
            planJson: JSON.stringify(this.preparePlanForStorage(failed)),
            errorMessage: errMsg,
          })
          .catch((updateError: unknown) => {
            log.warn({ planId, updateError }, 'Failed to mark target attach failure');
          });
        log.error({ planId, projectId, error }, 'Deploy plan target attach failed');
      } finally {
        releaseDeployLock();
        cleanup();
      }
    };

    const finishFailure = async (projectId: string, error: string | undefined): Promise<void> => {
      const errMsg = error || 'Deploy failed';
      const failed = PlanStateMachine.transition(executingPlan, 'failed', errMsg);
      await this.db
        .updateDeployPlan(planId, {
          status: 'failed',
          planJson: JSON.stringify(this.preparePlanForStorage(failed)),
          errorMessage: errMsg,
        })
        .catch((updateError: unknown) => {
          log.warn({ planId, updateError }, 'Failed to mark deploy plan failed');
        });
      releaseDeployLock();
      log.info({ planId, projectId, error: errMsg }, 'Plan failed via event');
      cleanup();
    };

    const unsubSuccess = this.events.on('deploy:success', (payload) => {
      if (payload.projectId === startedProjectId) {
        void finishSuccess(payload.projectId);
      }
    });

    const unsubFailed = this.events.on('deploy:failed', (payload) => {
      if (payload.projectId === startedProjectId) {
        void finishFailure(payload.projectId, payload.error);
      }
    });

    const unsubComposeUp = this.events.on('compose:up', (payload) => {
      if (payload.projectId === startedProjectId) {
        void finishSuccess(payload.projectId);
      }
    });

    const unsubComposeFailed = this.events.on('compose:failed', (payload) => {
      if (payload.projectId === startedProjectId) {
        void finishFailure(payload.projectId, payload.error);
      }
    });

    cleanup = () => {
      unsubSuccess();
      unsubFailed();
      unsubComposeUp();
      unsubComposeFailed();
    };
  }

  private async failCommittedPlan(params: {
    planId: string;
    executingPlan: DeployPlan;
    projectName: string;
    errorMessage: string;
  }): Promise<ExecutePlanResult> {
    const { planId, executingPlan, projectName, errorMessage } = params;
    const failedPlan = PlanStateMachine.transition(executingPlan, 'failed', errorMessage);
    await this.db.updateDeployPlan(planId, {
      status: 'failed',
      planJson: JSON.stringify(this.preparePlanForStorage(failedPlan)),
      errorMessage,
    });
    return {
      status: 'failed',
      plan_id: planId,
      project_name: projectName,
      error: errorMessage,
    };
  }

  private async estimatePlanDurationSeconds(projectName: string): Promise<number> {
    const existingProject = await this.db.getProjectByName(projectName);
    if (!existingProject) {
      return 60;
    }

    const lastLog = await this.db.getLastDeployLog(existingProject.id);
    if (lastLog?.duration_ms != null && lastLog.status === 'success') {
      return Math.ceil(lastLog.duration_ms / 1000);
    }
    return 60;
  }

  async executePlan(
    planId: string,
    deployOnly?: string[],
    lockSessionId?: string,
    triggerOverride?: 'chat' | 'webhook' | 'api',
    approval?: ExecutePlanApproval,
  ): Promise<ExecutePlanResult> {
    let freshPlan = await this.loadPlanForExecution(planId);
    if (deployOnly && deployOnly.length > 0) {
      if (freshPlan.build.method !== 'compose') {
        throw new ServiceConfigError('deploy_only is only valid for Compose plans.', {
          deployOnly,
        });
      }
      const available = (freshPlan.build.compose_services ?? []).map((service) => service.name);
      const unknown = deployOnly.filter((service) => !available.includes(service));
      if (unknown.length > 0) {
        throw new ServiceConfigError(`Unknown Compose service(s): ${unknown.join(', ')}`, {
          requested: deployOnly,
          available,
        });
      }
      freshPlan = {
        ...freshPlan,
        build: { ...freshPlan.build, selected_services: [...deployOnly] },
      };
    }
    this.assertPlanHasRequiredInput(freshPlan);

    const approvalGate = this.evaluateApprovalGate(planId, freshPlan, approval);
    if (approvalGate.response) {
      return approvalGate.response;
    }

    this.assertPlanIsExecutable(freshPlan);
    this.assertValidProjectName(freshPlan.app.name);

    const approvedPlan = this.transitionApprovedPlanForExecution(freshPlan);
    const planExecution = this.getExecutionContext(approvedPlan);
    const targetResolution = await this.resolveExecuteTarget({
      planId,
      plan: approvedPlan,
      planExecution,
      approvedSafeResources: approvalGate.approvedSafeResources,
    });
    if (targetResolution.response) {
      return targetResolution.response;
    }

    const { attachTargetProject, targetProject } = targetResolution;
    const plan = this.bindPlanToExecutionTarget({
      plan: approvedPlan,
      attachTargetProject,
      targetProject,
    });
    const deployLock = await this.acquirePlanDeployLock({
      planId,
      lockSessionId,
      targetProject,
    });

    const executingPlan = await this.persistExecutingPlan(planId, plan);
    this.recordApprovalAudit({
      planId,
      plan,
      targetProject,
      approvedSafeResources: approvalGate.approvedSafeResources,
    });

    try {
      let deferredRuntimeEnvVars: (() => DeferredRuntimeEnvVars) | undefined;
      const shouldOverlapBuildAndProvision = this.canOverlapBuildAndProvision({
        plan,
        targetProject,
        approvedSafeResources: approvalGate.approvedSafeResources,
      });
      const mergedEnv = shouldOverlapBuildAndProvision
        ? await this.resolvePlanBaseEnv({ plan, attachTargetProject, targetProject })
        : await this.resolvePlanEnv({
            plan,
            attachTargetProject,
            targetProject,
            approvedSafeResources: approvalGate.approvedSafeResources,
          });
      if (shouldOverlapBuildAndProvision) {
        deferredRuntimeEnvVars = () =>
          this.resolvePlanEnvSettled({
            plan,
            attachTargetProject,
            targetProject,
            approvedSafeResources: approvalGate.approvedSafeResources,
            baseEnv: mergedEnv,
          });
      }

      const dispatch = await this.dispatchPlanDeploy({
        plan,
        planExecution,
        attachTargetProject,
        mergedEnv,
        deployOnly,
        triggerOverride,
        deployLockProjectId: deployLock.projectId,
        lockSessionId,
        planId,
        deferredRuntimeEnvVars,
      });

      this.registerPlanCompletionListeners({
        planId,
        executingPlan,
        attachTargetProject,
        startedProjectId: dispatch.startedProjectId,
        releaseDeployLock: deployLock.release,
      });

      if (dispatch.preflightError) {
        deployLock.release();
        return await this.failCommittedPlan({
          planId,
          executingPlan,
          projectName: dispatch.startedProjectName,
          errorMessage: dispatch.preflightError,
        });
      }

      const estimatedSeconds = await this.estimatePlanDurationSeconds(dispatch.startedProjectName);

      return {
        status: 'building',
        plan_id: planId,
        project_name: dispatch.startedProjectName,
        project_id: dispatch.startedProjectId,
        ...(attachTargetProject
          ? {
              service_id: targetIdentityResolver.deployableServiceIdForResponse(
                dispatch.startedProjectId,
              ),
              target_project_id: attachTargetProject.id,
              runtime_project_id: dispatch.startedProjectId,
            }
          : {}),
        estimated_seconds: estimatedSeconds,
      };
    } catch (error) {
      deployLock.release();
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error({ planId, error }, 'Plan execution failed');
      return await this.failCommittedPlan({
        planId,
        executingPlan,
        projectName: plan.app.name,
        errorMessage: errorMsg,
      });
    }
  }
}
