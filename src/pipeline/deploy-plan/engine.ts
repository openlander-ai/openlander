import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createModuleLogger } from '../../lib/logger.js';
import { cloneRepo } from '../git.js';
import { analyzeInfrastructure } from '../../lib/infra-analyzer.js';
import { extractProjectName } from '../helpers.js';
import type { DeployPlan, PlanService, PlanEnvEntry, PlanBuildService } from './types.js';
import { PlanStateMachine } from './types.js';
import type { Database } from '../../db/index.js';
import type { DeployPipeline } from '../deploy.js';
import type { EnvManager } from '../env.js';
import type { ServiceManager } from '../service-manager.js';
import type { AutoDetector } from '../auto-detect.js';
import type { OpenLanderConfig } from '../../config/index.js';
import type { EventBus } from '../../events/index.js';
import type { ComposePipeline } from '../compose.js';

const log = createModuleLogger('plan-engine');

function findDockerfiles(dir: string, maxDepth = 3): string[] {
  const results: string[] = [];
  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(current).sort((a, b) => a.localeCompare(b));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'vendor') continue;
      const fullPath = join(current, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile() && entry === 'Dockerfile') {
          results.push(fullPath);
        } else if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        }
      } catch {
        continue;
      }
    }
  }
  walk(dir, 0);
  return results;
}

export interface CreatePlanOptions {
  repoUrl: string;
  branch?: string;
  name?: string;
  envVars?: Record<string, string>;
  preferDockerfile?: boolean;
  dockerfilePath?: string;
  dockerTarget?: string;
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
  private serviceManager: ServiceManager;
  private events?: EventBus;
  private composePipeline?: ComposePipeline;

  constructor(deps: PlanEngineDeps) {
    this.db = deps.db;
    this.pipeline = deps.pipeline;
    this.serviceManager = deps.serviceManager;
    this.events = deps.events;
    this.composePipeline = deps.composePipeline;
  }

  private preparePlanForStorage(plan: DeployPlan): DeployPlan {
    return plan;
  }

  async createPlan(opts: CreatePlanOptions): Promise<DeployPlan> {
    const { repoUrl, branch, name, envVars = {} } = opts;

    const { nanoid } = await import('nanoid');
    const planId = `plan_${nanoid(12)}`;

    const projectName = name || extractProjectName(repoUrl);

    log.info({ repoUrl, branch }, 'Cloning repository');
    const cloneResult = await cloneRepo({ repoUrl, branch });
    const clonePath = cloneResult.path;
    const commitSha = cloneResult.commitSha;

    const warnings: string[] = [];
    const detectedEnv: PlanEnvEntry[] = [];

    const dockerfiles = findDockerfiles(clonePath);
    const relativeDockerfiles = dockerfiles.map((d) => relative(clonePath, d));

    const userDockerfile = opts.dockerfilePath ?? 'Dockerfile';
    const dockerfileExists = existsSync(join(clonePath, userDockerfile));
    let generatedDockerfile: string | undefined;

    if (relativeDockerfiles.length > 1) {
      warnings.push(
        `${String(relativeDockerfiles.length)} Dockerfiles found: ${relativeDockerfiles.join(', ')}`,
      );
    }

    let buildMethod: 'dockerfile' | 'compose' = 'dockerfile';
    let composeFilePath: string | undefined;
    let composeBuildServices: PlanBuildService[] | undefined;

    if (!opts.preferDockerfile && this.composePipeline) {
      const detected = this.composePipeline.detectComposeFile(clonePath);
      if (detected) {
        buildMethod = 'compose';
        composeFilePath = relative(clonePath, detected);
        const parsed = this.composePipeline.parseComposeFile(detected);

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
          };
        });

        for (const svc of parsed.services) {
          if (!svc.envFile) continue;
          for (const envFileRef of svc.envFile) {
            const fullPath = join(clonePath, envFileRef.path);
            if (!existsSync(fullPath)) {
              this.scanEnvTemplate(clonePath, envFileRef.path, detectedEnv);
              if (envFileRef.required) {
                warnings.push(
                  `Service "${svc.name}" requires env_file "${envFileRef.path}" but file not in repo`,
                );
              }
            } else {
              this.scanEnvFile(fullPath, envFileRef.path, detectedEnv);
            }
          }

          if (svc.volumes) {
            for (const vol of svc.volumes) {
              const bindParts = vol.split(':');
              const hostPath = bindParts[0];
              if (bindParts.length >= 2 && hostPath) {
                if (hostPath.startsWith('.') || hostPath.startsWith('/')) {
                  const absHost = hostPath.startsWith('.') ? join(clonePath, hostPath) : hostPath;
                  if (!existsSync(absHost) && hostPath.startsWith('.')) {
                    warnings.push(
                      `Service "${svc.name}" mounts "${hostPath}" but file not in repo`,
                    );
                  }
                }
              }
            }
          }
        }
      }
    }

    if (buildMethod === 'dockerfile' && !dockerfileExists) {
      generatedDockerfile = 'auto-generated';
      warnings.push('No Dockerfile found; will auto-generate one during build');
    }

    log.info({ clonePath }, 'Analyzing infrastructure');
    const existingServices = this.db.listServices();
    const infraAnalysis = analyzeInfrastructure(clonePath, existingServices);

    const services: PlanService[] = [];

    for (const m of infraAnalysis.missing) {
      services.push({
        type: m.type,
        action: 'create',
        connect_via: SERVICE_ENV_VARS[m.type] || `${m.type.toUpperCase()}_URL`,
      });
    }

    for (const available of infraAnalysis.available) {
      services.push({
        type: available.type,
        action: 'reuse',
        name: available.name,
        connect_via: SERVICE_ENV_VARS[available.type] || `${available.type.toUpperCase()}_URL`,
      });
    }

    const ENV_TEMPLATE_FILES = ['.env.example', '.env.sample', '.env.template'];
    for (const envFileName of ENV_TEMPLATE_FILES) {
      const envPath = join(clonePath, envFileName);
      if (existsSync(envPath)) {
        this.scanEnvFile(envPath, envFileName, detectedEnv);
      }
    }

    this.scanDockerfileArgs(clonePath, userDockerfile, detectedEnv);

    const requiredEnvVars = new Set(detectedEnv.filter((e) => e.required).map((e) => e.key));

    const missing: string[] = [];
    const autoEnvVars: Record<string, string> = {};

    for (const service of services) {
      const envVarName = SERVICE_ENV_VARS[service.type];
      if (envVarName) {
        autoEnvVars[envVarName] = `${service.type}://localhost`;
      }
    }

    for (const varName of requiredEnvVars) {
      const isAutoGenerated = varName in autoEnvVars;
      const isProvided = varName in envVars;

      if (!isAutoGenerated && !isProvided) {
        missing.push(varName);
      }
    }

    const serviceCount = services.length;
    const missingCount = missing.length;
    const composeServiceCount = composeBuildServices?.length ?? 0;
    let complexity: 'simple' | 'standard' | 'complex';

    if (serviceCount === 0 && missingCount === 0 && composeServiceCount <= 1) {
      complexity = 'simple';
    } else if (serviceCount >= 2 || composeServiceCount >= 3 || missingCount > 3) {
      complexity = 'complex';
    } else {
      complexity = 'standard';
    }

    const initialStatus = missing.length > 0 ? 'needs_input' : 'ready';

    const now = new Date().toISOString();
    const planBranch = branch || 'default';
    const dockerfileDir = userDockerfile.includes('/')
      ? userDockerfile.substring(0, userDockerfile.lastIndexOf('/'))
      : '.';

    const plan: DeployPlan = {
      plan_id: planId,
      status: initialStatus,
      complexity,
      app: {
        name: projectName,
        source: {
          repo_url: repoUrl,
          branch: planBranch,
          commit_sha: commitSha,
        },
      },
      build: {
        method: buildMethod,
        dockerfile: userDockerfile,
        context: dockerfileDir,
        target: opts.dockerTarget,
        generated_dockerfile: generatedDockerfile,
        compose_file: composeFilePath,
        compose_services: composeBuildServices,
        dockerfiles_found: relativeDockerfiles.length > 0 ? relativeDockerfiles : undefined,
      },
      services,
      secrets: [],
      env: {
        auto: autoEnvVars,
        required: Array.from(requiredEnvVars),
        provided: envVars,
        detected: detectedEnv,
      },
      health: {
        path: '/',
        retries: 10,
        interval_ms: 2000,
      },
      missing,
      warnings,
      created_at: now,
      updated_at: now,
    };

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

  private scanEnvFile(filePath: string, source: string, out: PlanEnvEntry[]): void {
    try {
      const content = readFileSync(filePath, 'utf8');
      const seen = new Set(out.map((e) => e.key));
      const pattern = /^([A-Z_][A-Z0-9_]*)\s*=[ \t]*(.*)?$/gm;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const key = match[1];
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const rawValue = match[2]?.trim();
        const hasDefault = rawValue !== undefined && rawValue !== '' && !rawValue.startsWith('#');
        out.push({
          key,
          source,
          required: !hasDefault,
          default: hasDefault ? rawValue : undefined,
        });
      }
    } catch {
      // intentional: skip unreadable env files
    }
  }

  private scanEnvTemplate(clonePath: string, envFilePath: string, out: PlanEnvEntry[]): void {
    const dir = join(clonePath, envFilePath, '..');
    const templates = ['.env.example', '.env.sample', '.env.template'];
    for (const tpl of templates) {
      const tplPath = join(dir, tpl);
      if (existsSync(tplPath)) {
        const relativeTpl = relative(clonePath, tplPath);
        this.scanEnvFile(tplPath, `${envFilePath} → ${relativeTpl}`, out);
        return;
      }
    }
  }

  private scanDockerfileArgs(clonePath: string, dockerfilePath: string, out: PlanEnvEntry[]): void {
    try {
      const content = readFileSync(join(clonePath, dockerfilePath), 'utf8');
      const seen = new Set(out.map((e) => e.key));
      const argPattern = /^ARG\s+([A-Z_][A-Z0-9_]*)(?:\s*=[ \t]*(.*))?$/gm;
      let match: RegExpExecArray | null;
      while ((match = argPattern.exec(content)) !== null) {
        const key = match[1];
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const defaultVal = match[2]?.trim();
        out.push({
          key,
          source: `Dockerfile ARG (${dockerfilePath})`,
          required: !defaultVal,
          default: defaultVal || undefined,
        });
      }
    } catch {
      // intentional: skip when Dockerfile absent
    }
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

    const missing: string[] = [];
    for (const varName of merged.env.required) {
      const isAutoGenerated = varName in merged.env.auto;
      const isProvided = varName in merged.env.provided;

      if (!isAutoGenerated && !isProvided) {
        missing.push(varName);
      }
    }
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
    if (freshPlan.status !== 'ready') {
      throw new Error(`Plan is already ${freshPlan.status}. Cannot execute concurrently.`);
    }

    const plan = freshPlan;

    const executingPlan = PlanStateMachine.transition(plan, 'executing');
    this.db.updateDeployPlan(planId, {
      status: 'executing',
      planJson: JSON.stringify(this.preparePlanForStorage(executingPlan)),
    });

    try {
      const mergedEnv = {
        ...plan.env.auto,
        ...plan.env.provided,
      };

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

      if (this.events) {
        const unsubSuccess = this.events.on('deploy:success', (payload) => {
          if (payload.projectId === startResult.projectId) {
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
          if (payload.projectId === startResult.projectId) {
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
        };
      }

      const isCompose = plan.build.method === 'compose';
      const startResult = await this.pipeline.startDeploy({
        repoUrl: plan.app.source.repo_url,
        branch: plan.app.source.branch,
        name: plan.app.name,
        envVars: mergedEnv,
        preferDockerfile: isCompose ? false : !plan.build.generated_dockerfile,
        dockerfilePath:
          !isCompose && plan.build.dockerfile !== 'Dockerfile' ? plan.build.dockerfile : undefined,
        dockerTarget: plan.build.target,
        buildContext: plan.build.context !== '.' ? plan.build.context : undefined,
        composeServices: deployOnly,
      });

      if (startResult.status === 'preflight_failed') {
        const errMsg = startResult.preflightError || 'Preflight check failed';
        const failedPlan = PlanStateMachine.transition(executingPlan, 'failed', errMsg);
        this.db.updateDeployPlan(planId, {
          status: 'failed',
          planJson: JSON.stringify(this.preparePlanForStorage(failedPlan)),
          errorMessage: errMsg,
        });
        return {
          status: 'failed',
          plan_id: planId,
          project_name: startResult.projectName,
          error: errMsg,
        };
      }

      const existingProject = this.db.getProjectByName(startResult.projectName);
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
        project_name: startResult.projectName,
        project_id: startResult.projectId,
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
