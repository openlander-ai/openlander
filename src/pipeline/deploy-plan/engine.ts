import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createModuleLogger } from '../../lib/logger.js';
import { findDockerfiles } from '../../lib/repo-scanner.js';
import { scanDockerfileArgs, scanEnvFile, scanEnvTemplate } from '../../lib/env-parser.js';
import { scanForEnvUsage } from '../env-scan.js';
import { cloneRepo } from '../git.js';
import { resolveEnvVars } from '../resolve-env.js';
import { analyzeInfrastructure } from '../../lib/infra-analyzer.js';
import {
  extractProjectName,
  composeContainerName,
  containerName as projectContainerName,
} from '../helpers.js';
import { parseImageUrl } from '../image-utils.js';
import type {
  DeployPlan,
  PlanService,
  PlanEnvEntry,
  PlanBuildService,
  DeployPlanComplexity,
} from './types.js';
import { PlanStateMachine } from './types.js';
import { computeComplexity, computeMissingEnvVars } from './plan-utils.js';
import type { Database } from '../../db/index.js';
import type { DeployPipeline } from '../deploy.js';
import type { EnvManager } from '../env.js';
import type { ServiceManager } from '../service-manager.js';
import type { AutoDetector } from '../auto-detect.js';
import type { OpenLanderConfig } from '../../config/index.js';
import type { EventBus } from '../../events/index.js';
import type { ComposePipeline } from '../compose.js';

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
}

const SERVICE_ENV_VARS: Record<string, string> = {
  postgresql: 'DATABASE_URL',
  mysql: 'MYSQL_URL',
  redis: 'REDIS_URL',
  mongodb: 'MONGODB_URI',
  rabbitmq: 'RABBITMQ_URL',
};

export interface ExecutePlanResult {
  status: 'building' | 'failed';
  plan_id: string;
  project_name: string;
  project_id?: string;
  estimated_seconds?: number;
  error?: string;
}

export class PlanEngine {
  private db: Database;
  private pipeline: DeployPipeline;
  private env: EnvManager;
  private serviceManager: ServiceManager;
  private events?: EventBus;
  private composePipeline?: ComposePipeline;

  constructor(deps: PlanEngineDeps) {
    this.db = deps.db;
    this.pipeline = deps.pipeline;
    this.env = deps.env;
    this.serviceManager = deps.serviceManager;
    this.events = deps.events;
    this.composePipeline = deps.composePipeline;
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

          return {
            name: svc.name,
            dockerfile,
            port,
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

  private detectPlanServices(clonePath: string): PlanService[] {
    log.info({ clonePath }, 'Analyzing infrastructure');
    const existingServices = this.db.listServices();
    const infraAnalysis = analyzeInfrastructure(clonePath, existingServices);

    const services: PlanService[] = [];
    for (const missingService of infraAnalysis.missing) {
      services.push({
        type: missingService.type,
        action: 'create',
        connect_via:
          SERVICE_ENV_VARS[missingService.type] || `${missingService.type.toUpperCase()}_URL`,
      });
    }

    for (const availableService of infraAnalysis.available) {
      services.push({
        type: availableService.type,
        action: 'reuse',
        name: availableService.name,
        connect_via:
          SERVICE_ENV_VARS[availableService.type] || `${availableService.type.toUpperCase()}_URL`,
      });
    }

    return services;
  }

  private detectEnvVars(
    clonePath: string,
    userDockerfile: string,
    detectedEnv: PlanEnvEntry[],
  ): void {
    const ENV_TEMPLATE_FILES = ['.env.example', '.env.sample', '.env.template'];
    for (const envFileName of ENV_TEMPLATE_FILES) {
      const envPath = join(clonePath, envFileName);
      if (!existsSync(envPath)) {
        continue;
      }
      detectedEnv.push(...scanEnvFile(envPath, envFileName, detectedEnv));
    }
    detectedEnv.push(...scanDockerfileArgs(clonePath, userDockerfile, detectedEnv));

    const sourceResult = scanForEnvUsage(clonePath);
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
    const autoEnvVars: Record<string, string> = {};
    for (const service of services) {
      const envVarName = SERVICE_ENV_VARS[service.type];
      if (envVarName) {
        autoEnvVars[envVarName] = `${service.type}://localhost`;
      }
    }
    return autoEnvVars;
  }

  private assemblePlan(params: {
    planId: string;
    status: DeployPlan['status'];
    complexity: DeployPlanComplexity;
    projectName: string;
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
      port: service.port,
      image: service.image,
      depends_on: service.depends_on,
      command: service.command,
      entrypoint: service.entrypoint,
      restart: service.restart,
      healthcheck: service.healthcheck,
      internal_url: service.port
        ? `http://${composeContainerName(params.projectName, service.name)}:${String(service.port)}`
        : `http://${composeContainerName(params.projectName, service.name)}`,
    }));

    const internalUrl = `http://${projectContainerName(params.projectName)}`;
    const internalUrlNote = 'Port determined after build. Set EXPOSE in Dockerfile.';

    return {
      plan_id: params.planId,
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
    const { repoUrl, branch, name, envVars = {}, sshKeyPath, source, imageUrl } = opts;
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
      const projectName = name || fallbackProjectName;
      const initialStatus: DeployPlan['status'] = 'ready';
      const complexity: DeployPlanComplexity = 'simple';

      const plan = this.assemblePlan({
        planId,
        status: initialStatus,
        complexity,
        projectName,
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
      this.db.createDeployPlan({
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

    const projectName = name || extractProjectName(repoUrl);

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

    const services = this.detectPlanServices(clonePath);
    this.detectEnvVars(clonePath, userDockerfile, detectedEnv);
    this.detectPersistenceWarnings(clonePath, warnings);
    this.detectServiceDependencies(envVars, warnings);

    const requiredEnvVars = Array.from(
      new Set(detectedEnv.filter((e) => e.required).map((e) => e.key)),
    );
    const autoEnvVars = this.buildAutoEnvVars(services);

    const missingEntries = computeMissingEnvVars(detectedEnv, envVars, autoEnvVars);
    const missing = missingEntries.map((entry) => entry.key);

    const isCompose = buildMethod === 'compose';
    const serviceCount = isCompose ? (composeBuildServices?.length ?? 0) : services.length;
    const complexity = computeComplexity({
      missingCount: missing.length,
      serviceCount,
      isCompose,
    });

    const initialStatus = missing.length > 0 ? 'needs_input' : 'ready';

    const planBranch = cloneResult.branch;
    const plan = this.assemblePlan({
      planId,
      status: initialStatus,
      complexity,
      projectName,
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
      detectedEnv,
      missing,
      warnings,
    });

    const execution = this.buildExecutionContext(opts);
    if (execution) {
      (plan as DeployPlan & { execution?: PlanExecutionContext }).execution = execution;
    }

    log.info({ planId, status: initialStatus, buildMethod }, 'Creating deploy plan');
    this.db.createDeployPlan({
      id: planId,
      projectName,
      status: initialStatus,
      complexity,
      planJson: JSON.stringify(this.preparePlanForStorage(plan)),
      commitSha,
    });

    return plan;
  }

  updatePlan(planId: string, updates: PlanUpdates): DeployPlan {
    const row = this.db.getDeployPlan(planId);
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
        const structured = envUpdate as { provided?: Record<string, string> };
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
    );
    const missing = missingEntries.map((entry) => entry.key);
    merged.missing = missing;

    merged.status = missing.length === 0 ? 'ready' : 'needs_input';
    merged.updated_at = new Date().toISOString();

    log.info({ planId, status: merged.status }, 'Updating deploy plan');
    this.db.updateDeployPlan(planId, {
      status: merged.status,
      planJson: JSON.stringify(this.preparePlanForStorage(merged)),
    });

    return merged;
  }

  async executePlan(planId: string, deployOnly?: string[]): Promise<ExecutePlanResult> {
    // Re-read from DB to prevent race condition
    const freshRow = this.db.getDeployPlan(planId);
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
    if (freshPlan.status !== 'ready') {
      throw new Error(`Plan status is "${freshPlan.status}" — only "ready" plans can be executed.`);
    }

    const plan = freshPlan;

    const executingPlan = PlanStateMachine.transition(plan, 'executing');
    this.db.updateDeployPlan(planId, {
      status: 'executing',
      planJson: JSON.stringify(this.preparePlanForStorage(executingPlan)),
    });

    try {
      const mergedEnv = resolveEnvVars(
        {
          projectId: plan.project_id ?? plan.app.name,
          autoEnvVars: plan.env.auto,
          inlineEnvVars: plan.env.provided,
        },
        { env: this.env },
      );

      for (const service of plan.services) {
        if (service.action === 'create') {
          log.info({ serviceType: service.type }, 'Creating service');
          const serviceName = service.name || `${service.type}-${String(Date.now())}`;
          const created = await this.serviceManager.create({
            name: serviceName,
            template: service.type,
          });
          // Use created service's credentials for env injection
          if (created.credentials) {
            const creds = JSON.parse(created.credentials) as { connectionString?: string };
            const envVarName = SERVICE_ENV_VARS[service.type];
            if (envVarName && creds.connectionString) {
              mergedEnv[envVarName] = creds.connectionString;
            }
          }
        }
      }

      log.info({ planId, planCommit: plan.app.source.commit_sha }, 'Executing plan (non-blocking)');

      const deployMode = this.getDeployMode(plan);
      const execution = this.getExecutionContext(plan);
      const isImage = plan.build.method === 'image';

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
        const startResult = this.pipeline.startMonorepoDeploy({
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
            this.db.updateDeployPlan(planId, {
              status: 'completed',
              planJson: JSON.stringify(this.preparePlanForStorage(completed)),
            });
            log.info({ planId, projectId: payload.projectId }, 'Plan completed via event');
            cleanup();
          }
        });

        const unsubFailed = this.events.on('deploy:failed', (payload) => {
          if (payload.projectId === startedProjectId) {
            const errMsg = payload.error || 'Deploy failed';
            const failed = PlanStateMachine.transition(executingPlan, 'failed', errMsg);
            this.db.updateDeployPlan(planId, {
              status: 'failed',
              planJson: JSON.stringify(this.preparePlanForStorage(failed)),
              errorMessage: errMsg,
            });
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
            this.db.updateDeployPlan(planId, {
              status: 'completed',
              planJson: JSON.stringify(this.preparePlanForStorage(completed)),
            });
            log.info({ planId, projectId: payload.projectId }, 'Plan completed via event');
            cleanup();
          }
        });

        const unsubComposeFailed = this.events.on('compose:failed', (payload) => {
          if (payload.projectId === startedProjectId) {
            const errMsg = payload.error || 'Deploy failed';
            const failed = PlanStateMachine.transition(executingPlan, 'failed', errMsg);
            this.db.updateDeployPlan(planId, {
              status: 'failed',
              planJson: JSON.stringify(this.preparePlanForStorage(failed)),
              errorMessage: errMsg,
            });
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
        const errMsg = preflightError || 'Preflight check failed';
        const failedPlan = PlanStateMachine.transition(executingPlan, 'failed', errMsg);
        this.db.updateDeployPlan(planId, {
          status: 'failed',
          planJson: JSON.stringify(this.preparePlanForStorage(failedPlan)),
          errorMessage: errMsg,
        });
        return {
          status: 'failed',
          plan_id: planId,
          project_name: startedProjectName,
          error: errMsg,
        };
      }

      const existingProject = this.db.getProjectByName(startedProjectName);
      let estimatedSeconds = 60;
      if (existingProject) {
        const lastLog = this.db.getLastDeployLog(existingProject.id);
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
      const errorMsg = error instanceof Error ? error.message : String(error);
      const failedPlan = PlanStateMachine.transition(executingPlan, 'failed', errorMsg);
      this.db.updateDeployPlan(planId, {
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
