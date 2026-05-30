import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createModuleLogger } from '../../lib/logger.js';
import { findDockerfiles } from '../../lib/repo-scanner.js';
import { scanDockerfileArgs, scanEnvFile, scanEnvTemplate } from '../../lib/env-parser.js';
import { scanForEnvUsage } from '../env-scan.js';
import { cloneRepo } from '../git.js';
import { resolveEnvVars } from '../resolve-env.js';
import { ManagedServiceLinker } from '../managed-service-linker.js';
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
import type { ComposePipeline } from '../compose.js';
import { acquireDeployLockOrThrow } from '../../db/repos/deploy-lock-helper.js';
import { ProjectNotFoundError, ServiceConfigError } from '../../errors.js';

const log = createModuleLogger('plan-engine');

export interface CreatePlanOptions {
  repoUrl?: string;
  branch?: string;
  name?: string;
  source?: 'git' | 'image';
  imageUrl?: string;
  imageCmd?: string[];
  containerPort?: number;
  envVars?: Record<string, string>;
  visibility?: 'internal' | 'quick-share' | 'shared';
  environment?: string;
  sshKeyPath?: string;
  trigger?: string;
  preferDockerfile?: boolean;
  dockerfilePath?: string;
  dockerTarget?: string;
  projectId?: string;
}

interface PlanExecutionContext {
  visibility?: 'internal' | 'quick-share' | 'shared';
  environment?: string;
  sshKeyPath?: string;
  trigger?: string;
  imageCmd?: string[];
  containerPort?: number;
}

export interface PlanUpdates {
  env?: { provided?: Record<string, string> } | Record<string, string>;
  build?: Partial<DeployPlan['build']>;
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
  postgresql: ['postgres', 'postgresql'],
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
    composeBuildServices?: PlanBuildService[];
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
    let composeBuildServices: PlanBuildService[] | undefined;
    let generatedDockerfile: string | undefined;

    if (!opts.preferDockerfile && !opts.dockerfilePath && this.composePipeline) {
      const detectedComposeFile = this.composePipeline.detectComposeFile(clonePath);
      if (detectedComposeFile) {
        buildMethod = 'compose';
        composeFilePath = relative(clonePath, detectedComposeFile);
        const parsed = this.composePipeline.parseComposeFile(detectedComposeFile);

        composeBuildServices = parsed.services.map((svc) => {
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
            const portMatch = svc.ports[0].match(/:(\d+)/);
            if (portMatch?.[1]) {
              port = parseInt(portMatch[1], 10);
            }
          }
          if (port === undefined && svc.expose?.[0]) {
            const exposeMatch = svc.expose[0].match(/^(\d+)/);
            if (exposeMatch?.[1]) {
              port = parseInt(exposeMatch[1], 10);
            }
          }

          return {
            name: svc.name,
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

        for (const svc of parsed.services) {
          if (svc.envFile) {
            for (const envFileRef of svc.envFile) {
              const fullPath = join(clonePath, envFileRef.path);
              if (!existsSync(fullPath)) {
                detectedEnv.push(...scanEnvTemplate(clonePath, envFileRef.path, detectedEnv));
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
      composeBuildServices,
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
    };

    if (
      !execution.visibility &&
      !execution.environment &&
      !execution.sshKeyPath &&
      !execution.trigger &&
      !execution.imageCmd &&
      execution.containerPort === undefined
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
  private safeProposedResources(services: PlanService[]): PlanService[] {
    return services.filter(
      (service) =>
        service.resolution === 'proposed_project_service' && service.approval === 'safe_resource',
    );
  }

  private hasSafeProposedResources(services: PlanService[]): boolean {
    return this.safeProposedResources(services).length > 0;
  }

  /**
   * Status priority: needs_input (missing>0) > needs_approval (>=1 safe proposed
   * resource) > ready. A missing user secret always wins; a safe proposed
   * managed resource never downgrades a plan to 'ready' (which would skip the
   * approval gate and provision with empty approvedSafeResources).
   */
  private computePlanStatus(missing: string[], services: PlanService[]): DeployPlanStatus {
    return missing.length > 0
      ? 'needs_input'
      : this.hasSafeProposedResources(services)
        ? 'needs_approval'
        : 'ready';
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
        `Reusable managed service not found for ${planService.type}: ${planService.name ?? planService.service_id ?? 'unknown'}`,
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
        `Cannot provision managed service ${planService.type}: docker is unavailable.`,
        { serviceType: planService.type, envVarName },
      );
    }

    const serviceName = `${targetProject.name}-${planService.type}`;
    const network = await this.docker.ensureProjectNetwork(targetProject.name);
    const created = await this.serviceManager.create({
      name: serviceName,
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
      const suggestedEnv = await this.serviceManager.getSuggestedEnv(created, {
        targetProjectId: targetProject.id,
      });
      const connectionString = suggestedEnv[0]?.value;
      if (typeof connectionString !== 'string' || connectionString.trim().length === 0) {
        throw new ServiceConfigError(
          `Provisioned managed service ${serviceName} did not provide a connection string for ${envVarName}`,
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
          'Failed to roll back orphaned managed service after provisioning failure',
        );
      }
      throw provisionError;
    }
  }

  private getServiceConnectionString(service: ServiceRow, envVarName: string): string {
    let parsed: unknown;
    try {
      parsed = service.credentials ? JSON.parse(service.credentials) : null;
    } catch (error) {
      throw new ServiceConfigError(`Invalid managed service credentials: ${service.id}`, {
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
        `Managed service ${service.name} did not provide a connection string for ${envVarName}`,
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
      // eslint-disable-next-line openlander-internal/no-dropped-columns -- PlanService.type is deploy-plan metadata, not services.type DB row access.
      const envVarName = SERVICE_ENV_VARS[service.type];
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
        'skipping automatic managed service provisioning for those dependencies.';
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
    repoUrl: string;
    planBranch: string;
    commitSha: string;
    imageUrl?: string;
    buildMethod: DeployPlan['build']['method'];
    userDockerfile: string;
    dockerTarget?: string;
    generatedDockerfile?: string;
    composeFilePath?: string;
    composeBuildServices?: PlanBuildService[];
    relativeDockerfiles: string[];
    services: PlanService[];
    autoEnvVars: Record<string, string>;
    requiredEnvVars: string[];
    envVars: Record<string, string>;
    detectedEnv: PlanEnvEntry[];
    missing: string[];
    warnings: string[];
  }): DeployPlan {
    const now = new Date().toISOString();
    const dockerfileDir = params.userDockerfile.includes('/')
      ? params.userDockerfile.substring(0, params.userDockerfile.lastIndexOf('/'))
      : '.';

    const composeBuildServicesWithUrls = params.composeBuildServices?.map((service) => ({
      name: service.name,
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
      status: params.status,
      complexity: params.complexity,
      app: {
        name: params.projectName,
        source: {
          repo_url: params.repoUrl,
          branch: params.planBranch,
          commit_sha: params.commitSha,
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
        compose_services: composeBuildServicesWithUrls,
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
      },
      health: {
        path: '/',
        retries: 10,
        interval_ms: 2000,
      },
      missing: params.missing,
      warnings: params.warnings,
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
    const { repoUrl, branch, name, envVars = {}, sshKeyPath, source, imageUrl, projectId } = opts;
    const { nanoid } = await import('nanoid');
    const planId = `plan_${nanoid(12)}`;

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
      const projectName = targetProject?.name ?? name ?? fallbackProjectName;
      // Image-source plans carry no detected service dependencies (services: []),
      // so computePlanStatus resolves to 'ready' here.
      const initialStatus: DeployPlan['status'] = this.computePlanStatus([], []);
      const complexity: DeployPlanComplexity = 'simple';

      const plan = this.assemblePlan({
        planId,
        status: initialStatus,
        complexity,
        projectName,
        projectId: targetProject?.id,
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
        missing: [],
        warnings: [],
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
    const projectName = targetProject?.name ?? name ?? extractProjectName(repoUrl);

    log.info({ repoUrl, branch }, 'Cloning repository');
    const cloneResult = await cloneRepo({ repoUrl, branch, sshKeyPath });
    const clonePath = cloneResult.path;
    const commitSha = cloneResult.commitSha;

    const warnings: string[] = [];
    const detectedEnv: PlanEnvEntry[] = [];
    const {
      buildMethod,
      userDockerfile,
      generatedDockerfile,
      composeFilePath,
      composeBuildServices,
      relativeDockerfiles,
    } = this.resolveBuildConfig(clonePath, opts, warnings, detectedEnv);

    const detectedServices = await this.detectPlanServices(
      clonePath,
      projectName,
      projectId,
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
    const existingEnvVars = projectId ? await this.env.getAll(projectId) : {};

    const missingEntries = computeMissingEnvVars(
      detectedEnvWithServiceRequirements,
      envVars,
      autoEnvVars,
      existingEnvVars,
      this.plannedServiceEnvKeys(services),
    );
    const missing = missingEntries.map((entry) => entry.key);

    const isCompose = buildMethod === 'compose';
    const serviceCount = isCompose ? (composeBuildServices?.length ?? 0) : services.length;
    const complexity = computeComplexity({
      missingCount: missing.length,
      serviceCount,
      isCompose,
    });

    const initialStatus: DeployPlan['status'] = this.computePlanStatus(missing, services);

    const planBranch = cloneResult.branch;
    const plan = this.assemblePlan({
      planId,
      status: initialStatus,
      complexity,
      projectName,
      projectId: targetProject?.id,
      repoUrl,
      planBranch,
      commitSha,
      buildMethod,
      userDockerfile,
      dockerTarget: opts.dockerTarget,
      generatedDockerfile,
      composeFilePath,
      composeBuildServices,
      relativeDockerfiles,
      services,
      autoEnvVars,
      requiredEnvVars,
      envVars,
      detectedEnv: detectedEnvWithServiceRequirements,
      missing,
      warnings,
    });

    const execution = this.buildExecutionContext(opts);
    if (execution) {
      (plan as DeployPlan & { execution?: PlanExecutionContext }).execution = execution;
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

    const merged: DeployPlan = {
      ...plan,
      env: {
        ...plan.env,
        provided: plan.env.provided,
      },
      build: {
        ...plan.build,
        ...(updates.build || {}),
      },
    };

    if (updates.env) {
      const envUpdate = updates.env;
      if ('provided' in envUpdate) {
        // Structured: { provided: { KEY: "val" } }
        const structured: { provided?: Record<string, string> } = envUpdate;
        if (structured.provided) {
          merged.env.provided = { ...plan.env.provided, ...structured.provided };
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

    merged.status = this.computePlanStatus(missing, merged.services);
    merged.updated_at = new Date().toISOString();

    log.info({ planId, status: merged.status }, 'Updating deploy plan');
    await this.db.updateDeployPlan(planId, {
      status: merged.status,
      planJson: JSON.stringify(this.preparePlanForStorage(merged)),
    });

    return merged;
  }

  async executePlan(
    planId: string,
    deployOnly?: string[],
    lockSessionId?: string,
    triggerOverride?: 'chat' | 'webhook' | 'api',
    approval?: ExecutePlanApproval,
  ): Promise<ExecutePlanResult> {
    // Re-read from DB to prevent race condition
    const freshRow = await this.db.getDeployPlan(planId);
    if (!freshRow) {
      throw new Error(`Plan not found: ${planId}`);
    }
    const freshPlan = JSON.parse(freshRow.plan_json) as DeployPlan;
    if (freshPlan.status === 'needs_input') {
      const missingKeys = freshPlan.missing.join(', ') || 'unknown';
      throw new Error(
        `Plan requires missing environment variables: ${missingKeys}. ` +
          `Call update_deploy_plan to provide them, then execute again.`,
      );
    }

    // Approval gate. Runs BEFORE the deploy lock (acquired further below), so a
    // throw past this point leaves the persisted status untouched at
    // 'needs_approval'. When approved we flip the status IN MEMORY only via
    // PlanStateMachine.transition(plan, 'ready') — it is never persisted, so the
    // DB sequence stays needs_approval -> executing.
    const approvedSafeResources = new Set<string>();
    if (freshPlan.status === 'needs_approval') {
      const safeProposals = this.safeProposedResources(freshPlan.services);
      const approvedAll = approval?.approveAllSafeResources === true;
      const approvedIds = new Set(approval?.createResources ?? []);
      const allApproved = safeProposals.every(
        (svc) => approvedAll || approvedIds.has(this.proposedResourceIdentifier(svc)),
      );

      if (!allApproved) {
        // SAFETY: unapproved needs_approval plans create NOTHING and return a
        // structured response (no throw, no DB write).
        return {
          status: 'needs_approval',
          plan_id: planId,
          project_name: freshPlan.app.name,
          approval_required: {
            create_resources: safeProposals.map((svc) => this.proposedResourceIdentifier(svc)),
          },
          _agent_guidance: {
            next_steps: [
              'Re-run execute_deploy_plan with approve_all_safe_resources=true to approve every proposed resource.',
              'Or pass approvals.create_resources with the identifiers above to approve individually. The identifiers are listed in approval_required.create_resources and in services[] (resolution="proposed_project_service").',
            ],
          },
        };
      }

      for (const svc of safeProposals) {
        approvedSafeResources.add(this.proposedResourceIdentifier(svc));
      }
    }

    if (freshPlan.status !== 'ready' && freshPlan.status !== 'needs_approval') {
      throw new Error(`Plan status is "${freshPlan.status}" — only "ready" plans can be executed.`);
    }

    const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;
    if (!PROJECT_NAME_REGEX.test(freshPlan.app.name)) {
      throw new Error(
        `Invalid project name "${freshPlan.app.name}": must contain only lowercase letters, numbers, and hyphens, starting with a letter or number`,
      );
    }

    // In-memory only: bring an approved needs_approval plan to 'ready'. Never
    // persisted (no updateDeployPlan call here).
    const plan =
      freshPlan.status === 'needs_approval'
        ? PlanStateMachine.transition(freshPlan, 'ready')
        : freshPlan;

    // New-app guard: an approved create of a safe proposed managed service needs
    // an existing target project to provision against, but for a NEW app the
    // project row is only created later inside the pipeline. Block here BEFORE the
    // deploy lock and provisioning loop, creating nothing. 'needs_target_project'
    // is a response-only status (not a DeployPlanStatus / validTransitions edge).
    const targetProject =
      (plan.project_id ? await this.db.getProject(plan.project_id) : null) ??
      (await this.db.getProjectByName(plan.app.name));
    const hasApprovedCreate = plan.services.some(
      (svc) =>
        svc.action === 'create' &&
        svc.resolution === 'proposed_project_service' &&
        svc.approval === 'safe_resource' &&
        approvedSafeResources.has(this.proposedResourceIdentifier(svc)),
    );
    if (hasApprovedCreate && !targetProject) {
      return {
        plan_id: planId,
        status: 'needs_target_project',
        project_name: plan.app.name,
        message:
          'Managed auto-provisioning is supported only for existing projects. This is a new app, so there is no target project to provision the managed service on yet.',
        approval_required: {
          create_resources: this.safeProposedResources(plan.services)
            .filter((svc) => approvedSafeResources.has(this.proposedResourceIdentifier(svc)))
            .map((svc) => this.proposedResourceIdentifier(svc)),
        },
        _agent_guidance: {
          next_steps: [
            'Managed auto-provisioning is supported only for existing projects; a brand-new app has no project to provision onto.',
            'To deploy this new app now, pass an external connection URL (e.g. DATABASE_URL) in env_vars so no managed service needs provisioning.',
            'Auto-provisioning becomes available once the app is deployed under an existing project group.',
          ],
        },
      };
    }

    const existingProject = targetProject ?? (await this.db.getProjectByName(plan.app.name));
    let lockProjectId: string | null = null;
    let deployLockReleased = false;
    const safeReleaseDeployLock = () => {
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

    if (existingProject) {
      const lockSession = lockSessionId ?? `plan-${planId}`;
      // Release happens asynchronously in event listeners (deploy:success /
      // deploy:failed / compose:up / compose:failed) via `safeReleaseDeployLock`,
      // so we use the bare acquire helper instead of `withDeployLock`.
      await acquireDeployLockOrThrow(this.db, {
        projectId: existingProject.id,
        sessionId: lockSession,
      });
      lockProjectId = existingProject.id;
    }

    const executingPlan = PlanStateMachine.transition(plan, 'executing');
    await this.db.updateDeployPlan(planId, {
      status: 'executing',
      planJson: JSON.stringify(this.preparePlanForStorage(executingPlan)),
    });

    // Durable approval audit: a needs_approval plan's safe managed resources
    // were approved over MCP and execution is now committed (lock held, status
    // persisted). Record it in the action_runs approval ledger so deploy-plan
    // approvals are as observable as destructive_mcp ones. Best-effort — a
    // failed audit write must never break the deploy (mirrors the floating
    // releaseDeployLock pattern). Fires only when an approval was granted:
    // approvedSafeResources is populated solely on the needs_approval branch.
    if (approvedSafeResources.size > 0) {
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

    try {
      const mergedEnv = await resolveEnvVars(
        {
          projectId: plan.project_id ?? plan.app.name,
          autoEnvVars: plan.env.auto,
          inlineEnvVars: plan.env.provided,
        },
        { env: this.env },
      );

      for (const planService of plan.services) {
        const envVarName = planService.connect_via || SERVICE_ENV_VARS[planService.type];
        if (!envVarName || this.hasExplicitEnvValue(plan.env.provided, envVarName)) {
          if (envVarName) {
            log.info(
              { serviceType: planService.type, envVarName },
              'Skipping managed service env injection because explicit env var was provided',
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
            // compose_service / not_auto_creatable / unapproved: fail fast,
            // create nothing.
            throw new ServiceConfigError(
              `Managed service ${planService.type} requires an explicit ${envVarName} value before deploy.`,
              {
                serviceType: planService.type,
                envVarName,
                nextSteps: [
                  `Provide an external ${envVarName} value in env_vars.`,
                  'Or call openlander_managed_service.create_service for the target project, set its suggested_env on the deployable service, then redeploy.',
                ],
              },
            );
          }

          if (!targetProject) {
            throw new ServiceConfigError(
              `Provisioning managed service ${planService.type} requires an existing target project.`,
              { serviceType: planService.type, envVarName },
            );
          }
          const connectionString = await this.provisionApprovedService(
            planService,
            targetProject,
            envVarName,
          );
          mergedEnv[envVarName] = connectionString;
        } else {
          if (!targetProject) {
            throw new ServiceConfigError(
              `Reusable managed service ${planService.name ?? planService.service_id ?? planService.type} requires an existing target project.`,
              {
                serviceType: planService.type,
                serviceName: planService.name,
                serviceId: planService.service_id,
              },
            );
          }
          const reusable = await this.resolveReusableService(planService, targetProject.id);
          mergedEnv[envVarName] = this.getServiceConnectionString(reusable, envVarName);
          // Backfill a connection row for the reused service (idempotent).
          await this.db.upsertServiceConnection({
            projectId: targetProject.id,
            serviceId: reusable.id,
          });
        }
      }

      log.info({ planId, planCommit: plan.app.source.commit_sha }, 'Executing plan (non-blocking)');

      const deployMode = this.getDeployMode(plan);
      const execution = {
        ...this.getExecutionContext(plan),
        ...(triggerOverride ? { trigger: triggerOverride } : {}),
      };
      const isImage = plan.build.method === 'image';
      const propagatedLockSession = lockProjectId ? (lockSessionId ?? `plan-${planId}`) : undefined;

      let startedProjectId: string;
      let startedProjectName: string;
      let preflightError: string | undefined;

      if (deployMode === 'monorepo') {
        const cloneResult = await cloneRepo({
          repoUrl: plan.app.source.repo_url,
          branch: plan.app.source.branch,
          sshKeyPath: execution.sshKeyPath,
        });
        const dockerfiles =
          deployOnly && deployOnly.length > 0
            ? deployOnly
            : plan.build.dockerfiles_found && plan.build.dockerfiles_found.length > 0
              ? plan.build.dockerfiles_found
              : [plan.build.dockerfile];
        // TODO(0.1.x): MonorepoConfig does not have _lockSessionId — monorepo deploys
        // triggered via the plan engine are still vulnerable to the lock-session
        // ownership regression fixed for single-project deploys. Add _lockSessionId
        // to MonorepoConfig and thread it through startMonorepoDeploy / deployMonorepo
        // when the plumbing is in place.
        const startResult = await this.pipeline.startMonorepoDeploy({
          repoUrl: plan.app.source.repo_url,
          branch: plan.app.source.branch,
          clonePath: cloneResult.path,
          commitSha: cloneResult.commitSha,
          dockerfiles,
          envVars: mergedEnv,
          name: plan.app.name,
          ...(execution.visibility ? { visibility: execution.visibility } : {}),
          ...(execution.trigger
            ? { trigger: execution.trigger as 'chat' | 'webhook' | 'api' }
            : {}),
        });

        startedProjectId = startResult.parentProjectId;
        startedProjectName = startResult.parentName;
      } else {
        const isCompose = deployMode === 'compose';
        const startResult = await this.pipeline.startDeploy({
          repoUrl: plan.app.source.repo_url,
          branch: plan.app.source.branch,
          name: plan.app.name,
          envVars: mergedEnv,
          ...(isImage ? { source: 'image' as const } : {}),
          ...(isImage && plan.app.source.image_url ? { imageUrl: plan.app.source.image_url } : {}),
          ...(execution.imageCmd ? { imageCmd: execution.imageCmd } : {}),
          ...(execution.containerPort !== undefined
            ? { containerPort: execution.containerPort }
            : {}),
          preferDockerfile: isCompose ? false : !plan.build.generated_dockerfile,
          dockerfilePath:
            !isCompose && plan.build.dockerfile !== 'Dockerfile'
              ? plan.build.dockerfile
              : undefined,
          dockerTarget: plan.build.target,
          buildContext: plan.build.context !== '.' ? plan.build.context : undefined,
          composeServices: isCompose ? deployOnly : undefined,
          ...(execution.visibility ? { visibility: execution.visibility } : {}),
          ...(execution.environment ? { environment: execution.environment } : {}),
          ...(execution.sshKeyPath ? { sshKeyPath: execution.sshKeyPath } : {}),
          ...(execution.trigger
            ? { trigger: execution.trigger as 'chat' | 'webhook' | 'api' }
            : {}),
          // Propagate the plan-engine's lock session so that startDeploy's
          // inner deploy() runs inline under the same session (skipping a new
          // acquire that would conflict with the already-held lock).
          _lockSessionId: propagatedLockSession,
        });

        if (startResult.status === 'preflight_failed') {
          preflightError = startResult.preflightError;
        }

        startedProjectId = startResult.projectId;
        startedProjectName = startResult.projectName;
      }

      if (this.events) {
        const unsubSuccess = this.events.on('deploy:success', (payload) => {
          if (payload.projectId === startedProjectId) {
            const completed = PlanStateMachine.transition(executingPlan, 'completed');
            void this.db
              .updateDeployPlan(planId, {
                status: 'completed',
                planJson: JSON.stringify(this.preparePlanForStorage(completed)),
              })
              .catch((error: unknown) => {
                log.warn({ planId, error }, 'Failed to mark deploy plan completed');
              });
            safeReleaseDeployLock();
            log.info({ planId, projectId: payload.projectId }, 'Plan completed via event');
            cleanup();
          }
        });

        const unsubFailed = this.events.on('deploy:failed', (payload) => {
          if (payload.projectId === startedProjectId) {
            const errMsg = payload.error || 'Deploy failed';
            const failed = PlanStateMachine.transition(executingPlan, 'failed', errMsg);
            void this.db
              .updateDeployPlan(planId, {
                status: 'failed',
                planJson: JSON.stringify(this.preparePlanForStorage(failed)),
                errorMessage: errMsg,
              })
              .catch((error: unknown) => {
                log.warn({ planId, error }, 'Failed to mark deploy plan failed');
              });
            safeReleaseDeployLock();
            log.info(
              { planId, projectId: payload.projectId, error: errMsg },
              'Plan failed via event',
            );
            cleanup();
          }
        });

        const unsubComposeUp = this.events.on('compose:up', (payload) => {
          if (payload.projectId === startedProjectId) {
            const completed = PlanStateMachine.transition(executingPlan, 'completed');
            void this.db
              .updateDeployPlan(planId, {
                status: 'completed',
                planJson: JSON.stringify(this.preparePlanForStorage(completed)),
              })
              .catch((error: unknown) => {
                log.warn({ planId, error }, 'Failed to mark deploy plan completed');
              });
            safeReleaseDeployLock();
            log.info({ planId, projectId: payload.projectId }, 'Plan completed via event');
            cleanup();
          }
        });

        const unsubComposeFailed = this.events.on('compose:failed', (payload) => {
          if (payload.projectId === startedProjectId) {
            const errMsg = payload.error || 'Deploy failed';
            const failed = PlanStateMachine.transition(executingPlan, 'failed', errMsg);
            void this.db
              .updateDeployPlan(planId, {
                status: 'failed',
                planJson: JSON.stringify(this.preparePlanForStorage(failed)),
                errorMessage: errMsg,
              })
              .catch((error: unknown) => {
                log.warn({ planId, error }, 'Failed to mark deploy plan failed');
              });
            safeReleaseDeployLock();
            log.info(
              { planId, projectId: payload.projectId, error: errMsg },
              'Plan failed via event',
            );
            cleanup();
          }
        });

        const cleanup = () => {
          unsubSuccess();
          unsubFailed();
          unsubComposeUp();
          unsubComposeFailed();
        };
      }

      if (preflightError) {
        const errMsg = preflightError;
        const failedPlan = PlanStateMachine.transition(executingPlan, 'failed', errMsg);
        await this.db.updateDeployPlan(planId, {
          status: 'failed',
          planJson: JSON.stringify(this.preparePlanForStorage(failedPlan)),
          errorMessage: errMsg,
        });
        safeReleaseDeployLock();
        return {
          status: 'failed',
          plan_id: planId,
          project_name: startedProjectName,
          error: errMsg,
        };
      }

      const existingProject = await this.db.getProjectByName(startedProjectName);
      let estimatedSeconds = 60;
      if (existingProject) {
        const lastLog = await this.db.getLastDeployLog(existingProject.id);
        if (lastLog?.duration_ms != null && lastLog.status === 'success') {
          estimatedSeconds = Math.ceil(lastLog.duration_ms / 1000);
        }
      }

      return {
        status: 'building',
        plan_id: planId,
        project_name: startedProjectName,
        project_id: startedProjectId,
        estimated_seconds: estimatedSeconds,
      };
    } catch (error) {
      safeReleaseDeployLock();
      const errorMsg = error instanceof Error ? error.message : String(error);
      const failedPlan = PlanStateMachine.transition(executingPlan, 'failed', errorMsg);
      await this.db.updateDeployPlan(planId, {
        status: 'failed',
        planJson: JSON.stringify(this.preparePlanForStorage(failedPlan)),
        errorMessage: errorMsg,
      });

      log.error({ planId, error }, 'Plan execution failed');
      return {
        status: 'failed',
        plan_id: planId,
        project_name: plan.app.name,
        error: errorMsg,
      };
    }
  }
}
