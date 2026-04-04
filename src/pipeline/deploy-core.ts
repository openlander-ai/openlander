import { createModuleLogger } from '../lib/logger.js';
import { sleep } from '../lib/sleep.js';
const log = createModuleLogger('deploy');

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { rm } from 'node:fs/promises';

import type { Docker } from './docker.js';
import type { CloudflareTunnelManager } from './cloudflare.js';
import { cloneRepo } from './git.js';
import { allocatePort, scanUsedPorts } from './port.js';
import { getProjectUrl } from './traefik.js';
import type { CloudflareTunnel } from './tunnel.js';
import { BuildRecovery } from './build-recovery.js';
import { DeployOrchestrator, type ServiceNode } from './orchestrator.js';
import type { Database } from '../db/index.js';
import { eventBus } from '../events/index.js';
import { resolveEnvVars } from './resolve-env.js';

import {
  ContainerNotFoundError,
  DeployLockedError,
  InvalidProjectNameError,
  PreflightCheckError,
  isDockerNotFoundError,
} from '../errors.js';
import { preflightCheckOrThrow } from './preflight.js';
import { buildDeployConfig } from './build-deploy-config.js';
import type { JobManager } from './job-manager.js';
import type { ComposePipeline } from './compose.js';
import type { AutoDetector } from './auto-detect.js';
import type { EnvManager } from './env.js';
import { getPolicy, type OpenLanderConfig } from '../config/index.js';

import {
  extractProjectName,
  containerName as projectContainerName,
  collectKnownContainerNames,
} from './helpers.js';
import {
  getRouteName,
  deriveServiceName,
  detectFailStep,
  parsePendingFix,
} from './deploy/helpers.js';
import { ContainerLifecycle } from './deploy/lifecycle.js';
import { RollbackExecutor } from './deploy/rollback.js';
import { TunnelManager } from './deploy/tunnel.js';
import { BuildExecutor } from './deploy/build-step.js';
import { ContainerRunner } from './deploy/run-step.js';
import { getImageExposedPort, mapPullError } from './image-utils.js';

import {
  buildProject,
  cloneAndAnalyze,
  handlePostDeploy,
  runAndVerify,
  type DeployOrchestrationDeps,
} from './deploy/orchestrator.js';
import {
  buildMonorepoResults,
  deployMonorepoService,
  rollbackMonorepoService,
  type MonorepoOrchestrationDeps,
} from './deploy/monorepo-orchestrator.js';
import { detectMonorepoDependencies } from './deploy/monorepo-deps.js';

/**
 * Project configuration for a deployment.
 */
export interface ProjectConfig {
  /** Repo URL (e.g., github.com/user/repo) */
  repoUrl: string;
  /** Branch to deploy (default: repo default branch) */
  branch?: string;
  /** Project name (auto-generated from repo if not provided) */
  name?: string;
  /** Environment variables */
  envVars?: Record<string, string>;
  /** Visibility mode */
  visibility?: 'internal' | 'quick-share' | 'shared' | 'production';
  /** SSH key path for private repos */
  sshKeyPath?: string;
  /** Deployment trigger source */
  trigger?: 'chat' | 'webhook' | 'api';
  /** Target environment (e.g., production, development) */
  environment?: string;
  dockerfilePath?: string;
  dockerTarget?: string;
  buildContext?: string;
  preferDockerfile?: boolean;
  force?: boolean;
  /** Preview deployment plan without building or deploying */
  dryRun?: boolean;
  /** @internal Pre-allocated project ID from startDeploy(). Do not set manually. */
  _projectId?: string;
  _noCacheBuild?: boolean;
  _preferredPort?: number;
  /** Specific docker-compose services to deploy. Deploys all if omitted. */
  composeServices?: string[];
  /** Deployment source type (git or pre-built image) */
  source?: 'git' | 'image';
  /** Full Docker image reference (e.g., registry.example.com/app:latest) */
  imageUrl?: string;
  /** Command override array for container entrypoint */
  imageCmd?: string[];
  /** Port the application listens on inside the container */
  containerPort?: number;
}

/**
 * Result of a deployment pipeline execution.
 */
export interface DeployResult {
  success: boolean;
  projectId: string;
  projectName: string;
  previousImageTag?: string;
  containerId?: string;
  url?: string;
  publicUrl?: string;
  port?: number;
  commitSha?: string;
  buildDurationMs?: number;
  error?: string;
  buildLogTail?: string;
  preflightWarnings?: string[];
}

export type RedeployStrategy = 'blue-green' | 'force';

export interface RedeployOptions {
  noCache?: boolean;
  strategy?: RedeployStrategy;
  healthCheckPath?: string;
  healthCheckRetries?: number;
  healthCheckIntervalMs?: number;
  cmd?: string[];
  lockSessionId?: string;
}

export interface MonorepoConfig {
  repoUrl: string;
  branch?: string;
  clonePath: string;
  commitSha: string;
  dockerfiles: string[];
  envVars?: Record<string, string>;
  visibility?: 'internal' | 'quick-share' | 'shared' | 'production';
  trigger?: 'chat' | 'webhook' | 'api';
  /** Parent project name (auto-generated from repo if not provided) */
  name?: string;
  /** @internal Pre-allocated parent ID from startMonorepoDeploy(). Do not set manually. */
  _parentId?: string;
}

export interface MonorepoResult {
  success: boolean;
  parentProjectId: string;
  parentName: string;
  children: DeployResult[];
  buildDurationMs: number;
}

export interface DryRunPlan {
  projectName: string;
  repoUrl: string;
  branch?: string;
  dockerfile: string | null;
  composeDetected: boolean;
  preferDockerfile: boolean;
  envVarsProvided: number;
  existingProject: boolean;
}

export interface StartDeployResult {
  projectId: string;
  projectName: string;
  status: 'building' | 'preflight_failed' | 'dry_run';
  preflightWarnings?: string[];
  preflightError?: string;
  dryRunPlan?: DryRunPlan;
}

export interface StartMonorepoResult {
  parentProjectId: string;
  parentName: string;
  status: 'building';
}

interface PreviewDeployOptions {
  parentProjectId: string;
  previewName: string;
  repoUrl: string;
  branch: string;
  prNumber: number;
  commitSha: string;
}

interface PreviewDeployResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Deterministic deployment pipeline.
 *
 * This is the core of OpenLander — rule-based, sequential execution.
 * No LLM involved. Steps:
 *   1. git clone
 *   2. Verify Dockerfile exists
 *   3. docker build
 *   4. docker run (port + Traefik labels)
 *   5. expose (TryCloudflare if requested)
 *
 * The LLM agent calls this pipeline via tools — it never executes
 * Docker commands directly.
 */
export class DeployPipeline {
  private readonly tunnelManager: TunnelManager;
  private readonly lifecycle: ContainerLifecycle;
  private readonly rollbackExecutor: RollbackExecutor;
  private readonly buildExecutor: BuildExecutor;
  private readonly containerRunner: ContainerRunner;

  private get detectFailStep(): (buildLog: string) => string {
    return detectFailStep;
  }

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly env: EnvManager,
    private readonly config: OpenLanderConfig,
    private readonly jobManager?: JobManager,
    private readonly composePipeline?: ComposePipeline,
    private readonly autoDetector?: AutoDetector,
  ) {
    this.tunnelManager = new TunnelManager(this.db);
    this.lifecycle = new ContainerLifecycle(this.docker, this.db);
    this.rollbackExecutor = new RollbackExecutor(this.docker, this.db);
    this.buildExecutor = new BuildExecutor(this.docker);
    this.containerRunner = new ContainerRunner(this.docker, this.db);
    this.cleanupStaleTunnels();
    void this.cleanupOrphanContainers();
  }

  /**
   * On startup, any project with quick-share/shared visibility has a dead tunnel
   * (the cloudflared child process doesn't survive restarts). Reset to internal.
   */
  private cleanupStaleTunnels(): void {
    this.tunnelManager.cleanupStale();
  }

  private async cleanupOrphanContainers(): Promise<void> {
    try {
      const managed = await this.docker.listManagedContainers();
      const { knownIds, knownNames } = collectKnownContainerNames(
        this.db.listProjects(),
        (projectId) => this.db.getEnvironmentsByProject(projectId),
        (projectName, env) => projectContainerName(getRouteName(projectName, env.type)),
        this.db.listServices(),
      );

      for (const container of managed) {
        if (knownIds.has(container.id)) continue;
        if (knownNames.has(container.name)) continue;
        if (container.labels?.['openlander.role']) continue;

        log.info({ id: container.id, name: container.name }, 'Removing orphan container');
        try {
          await this.docker.safeRemoveContainer(container.id);
        } catch (err) {
          log.debug({ err, container: container.name }, 'Orphan container removal failed');
        }
      }
    } catch (err) {
      log.debug({ err }, 'Orphan container cleanup failed — Docker may not be available');
    }
  }

  private validateProjectName(name: string): void {
    const PROJECT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;
    if (!PROJECT_NAME_REGEX.test(name)) {
      throw new InvalidProjectNameError(name);
    }
  }

  /**
   * Start a deployment in the background (non-blocking).
   * Runs preflight check first and returns immediately if it fails.
   */
  async startDeploy(config: ProjectConfig): Promise<StartDeployResult> {
    const source = config.source ?? 'git';
    const projectName =
      config.name ??
      extractProjectName(source === 'image' ? (config.imageUrl ?? 'image') : config.repoUrl);
    this.validateProjectName(projectName);
    const projectId = nanoid(12);

    try {
      await preflightCheckOrThrow(this.db, this.docker, projectName);
    } catch (error) {
      if (error instanceof PreflightCheckError && config.force) {
        await this.forceCleanConflicts(projectName, error);
        try {
          await preflightCheckOrThrow(this.db, this.docker, projectName);
        } catch (retryError) {
          if (retryError instanceof PreflightCheckError) {
            return {
              projectId,
              projectName,
              status: 'preflight_failed',
              preflightError: retryError.message,
              preflightWarnings: retryError.result.warnings,
            };
          }
          throw retryError;
        }
      } else if (error instanceof PreflightCheckError) {
        return {
          projectId,
          projectName,
          status: 'preflight_failed',
          preflightError: error.message,
          preflightWarnings: error.result.warnings,
        };
      } else {
        throw error;
      }
    }

    if (config.dryRun) {
      if (source === 'image') {
        return {
          projectId: '',
          projectName,
          status: 'dry_run' as const,
          dryRunPlan: {
            projectName,
            repoUrl: config.imageUrl ?? '',
            branch: undefined,
            dockerfile: null,
            composeDetected: false,
            preferDockerfile: false,
            envVarsProvided: config.envVars ? Object.keys(config.envVars).length : 0,
            existingProject: !!this.db.getProjectByName(projectName),
          },
        };
      }

      const cloneResult = await cloneRepo({
        repoUrl: config.repoUrl,
        branch: config.branch,
        sshKeyPath: config.sshKeyPath,
      });

      const hasExplicitDockerfilePath =
        typeof config.dockerfilePath === 'string' && config.dockerfilePath.trim().length > 0;
      const preferDockerfile = config.preferDockerfile === true || hasExplicitDockerfilePath;
      const composePath = preferDockerfile
        ? null
        : this.composePipeline?.detectComposeFile(cloneResult.path);
      const dockerfilePath = join(cloneResult.path, config.dockerfilePath ?? 'Dockerfile');
      const dockerfileExists = existsSync(dockerfilePath);

      return {
        projectId: '',
        projectName,
        status: 'dry_run' as const,
        dryRunPlan: {
          projectName,
          repoUrl: config.repoUrl,
          branch: config.branch,
          dockerfile: dockerfileExists ? (config.dockerfilePath ?? 'Dockerfile') : null,
          composeDetected: !!composePath,
          preferDockerfile,
          envVarsProvided: config.envVars ? Object.keys(config.envVars).length : 0,
          existingProject: !!this.db.getProjectByName(projectName),
        },
      };
    }

    // Check if project with this name already exists
    const existing = this.db.getProjectByName(projectName);
    if (existing) {
      const isStale = existing.status === 'error';
      if (isStale) {
        this.db.updateProject(existing.id, {
          containerId: null,
          imageTag: null,
          assignedPort: null,
          previousImageTag: null,
          buildContext: config.buildContext ?? null,
          dockerTarget: config.dockerTarget ?? null,
        });
      }
      this.db.updateProject(existing.id, {
        status: 'building',
        ...(config.buildContext ? { buildContext: config.buildContext } : {}),
        ...(config.dockerfilePath ? { dockerfilePath: config.dockerfilePath } : {}),
        ...(config.dockerTarget ? { dockerTarget: config.dockerTarget } : {}),
        ...(source === 'image'
          ? {
              source,
              imageUrl: config.imageUrl,
              imageCmd: config.imageCmd,
              containerPort: config.containerPort,
            }
          : {}),
      });
      this.jobManager?.trackJob(existing.id, projectName);

      this.fireAndForgetDeploy(
        { ...config, name: projectName, _projectId: existing.id },
        existing.id,
        config.trigger,
      );

      return { projectId: existing.id, projectName, status: 'building' };
    }

    // Preflight passed - create project and start background deploy
    this.db.createProject({
      id: projectId,
      name: projectName,
      repoUrl: source === 'image' ? '' : config.repoUrl,
      branch: config.branch,
      dockerfilePath: config.dockerfilePath,
      dockerTarget: config.dockerTarget,
      buildContext: config.buildContext,
      ...(source === 'image'
        ? {
            source,
            imageUrl: config.imageUrl,
            imageCmd: config.imageCmd,
            containerPort: config.containerPort,
          }
        : {}),
    });
    this.db.updateProject(projectId, { status: 'building' });
    this.jobManager?.trackJob(projectId, projectName);

    this.fireAndForgetDeploy(
      { ...config, name: projectName, _projectId: projectId },
      projectId,
      config.trigger,
    );

    return { projectId, projectName, status: 'building' };
  }

  private fireAndForgetDeploy(
    config: ProjectConfig,
    projectId: string,
    trigger?: 'chat' | 'webhook' | 'api',
  ): void {
    void this.deploy(config)
      .then((result) => {
        if (!result.success) {
          this.recordBackgroundFailure(
            projectId,
            result.error ?? 'Deploy returned failure',
            trigger,
          );
        }
      })
      .catch((err: unknown) => {
        this.recordBackgroundFailure(
          projectId,
          err instanceof Error ? err.message : String(err),
          trigger,
        );
      });
  }

  private recordBackgroundFailure(
    projectId: string,
    errMsg: string,
    trigger: 'chat' | 'webhook' | 'api' = 'api',
  ): void {
    log.error({ projectId, error: errMsg }, 'Background deploy failed');
    this.jobManager?.updatePhase(projectId, 'failed', errMsg);
    this.db.updateProject(projectId, { status: 'error' });
    for (const env of this.db.getEnvironmentsByProject(projectId)) {
      this.db.updateEnvironment(env.id, { status: 'error' });
    }
    try {
      const lastLog = this.db.getLastDeployLog(projectId);
      if (lastLog?.status === 'failed') {
        return;
      }
      const environments = this.db.getEnvironmentsByProject(projectId);
      const envId = environments[0]?.id;
      this.db.createDeployLog({
        id: nanoid(12),
        projectId,
        environmentId: envId,
        status: 'failed',
        trigger,
        buildLog: `[fatal] Deploy crashed before build: ${errMsg}`,
        durationMs: 0,
      });
    } catch {
      // best-effort — outer catch already logged the error
    }
  }

  startMonorepoDeploy(config: MonorepoConfig): StartMonorepoResult {
    const parentName = config.name ?? extractProjectName(config.repoUrl);
    const parentId = nanoid(12);

    // Create parent record NOW for immediate status queries
    this.db.createProject({
      id: parentId,
      name: parentName,
      repoUrl: config.repoUrl,
      branch: config.branch,
    });
    this.db.updateProject(parentId, { status: 'building' });
    this.jobManager?.trackJob(parentId, parentName);

    // Fire-and-forget: run the monorepo deploy in background
    void this.deployMonorepo({ ...config, _parentId: parentId }).catch(() => {
      // Error handling is done inside deployMonorepo()
    });

    return { parentProjectId: parentId, parentName, status: 'building' };
  }

  async deploy(config: ProjectConfig): Promise<DeployResult> {
    const source = config.source ?? 'git';
    const projectName =
      config.name ??
      extractProjectName(source === 'image' ? (config.imageUrl ?? 'image') : config.repoUrl);
    const trigger = config.trigger ?? 'api';

    // Use pre-allocated projectId from startDeploy() if available,
    // otherwise create a new one (synchronous callers like redeploy, CLI)
    const projectId = config._projectId ?? nanoid(12);

    if (!config._projectId) {
      // Create project record in DB (skipped when called from startDeploy)
      this.db.createProject({
        id: projectId,
        name: projectName,
        repoUrl: source === 'image' ? '' : config.repoUrl,
        branch: config.branch,
        ...(source === 'image'
          ? {
              source,
              imageUrl: config.imageUrl,
              imageCmd: config.imageCmd,
              containerPort: config.containerPort,
            }
          : {}),
      });
      this.db.updateProject(projectId, { status: 'building' });
      this.jobManager?.trackJob(projectId, projectName);
    } else if (config.branch) {
      this.db.updateProject(projectId, {
        branch: config.branch,
        ...(source === 'image'
          ? {
              source,
              imageUrl: config.imageUrl,
              imageCmd: config.imageCmd,
              containerPort: config.containerPort,
            }
          : {}),
      });
    } else if (source === 'image') {
      this.db.updateProject(projectId, {
        source,
        imageUrl: config.imageUrl,
        imageCmd: config.imageCmd,
        containerPort: config.containerPort,
      });
    }

    // Preflight check - skip if already called from startDeploy()
    let preflightWarnings: string[] | undefined;
    if (!config._projectId) {
      try {
        const preflightResult = await preflightCheckOrThrow(this.db, this.docker, projectName);
        preflightWarnings =
          preflightResult.warnings.length > 0 ? preflightResult.warnings : undefined;
      } catch (error) {
        if (error instanceof PreflightCheckError) {
          this.db.updateProject(projectId, { status: 'error' });
          this.jobManager?.updatePhase(projectId, 'failed', error.message);
          return {
            success: false,
            projectId,
            projectName,
            error: error.message,
            preflightWarnings: error.result.warnings,
            buildDurationMs: 0,
          };
        }
        throw error;
      }
    }

    const envType = 'production' as const;
    let targetEnvironment = this.db
      .getEnvironmentsByProject(projectId)
      .find((env) => env.type === envType);

    if (!targetEnvironment) {
      const project = this.db.getProject(projectId);
      targetEnvironment = this.db.createEnvironment({
        id: `${projectId}-${envType}`,
        projectId,
        type: envType,
        branch: config.branch ?? project?.branch ?? 'main',
      });
    }

    const result = await this.deployEnvironment(projectId, targetEnvironment.id, {
      ...config,
      _projectId: projectId,
      name: projectName,
      trigger,
    });
    if (preflightWarnings && result.preflightWarnings === undefined) {
      return { ...result, preflightWarnings };
    }
    return result;
  }

  async deployEnvironment(
    projectId: string,
    environmentId: string,
    config: Partial<ProjectConfig> = {},
  ): Promise<DeployResult> {
    const startTime = Date.now();
    const project = this.db.getProject(projectId);
    if (!project) {
      return {
        success: false,
        projectId,
        projectName: 'unknown',
        error: `Project not found: ${projectId}`,
        buildDurationMs: Date.now() - startTime,
      };
    }
    const environment = this.db.getEnvironment(environmentId);
    if (!environment || environment.project_id !== projectId) {
      return {
        success: false,
        projectId,
        projectName: project.name,
        error: `Environment not found: ${environmentId}`,
        buildDurationMs: Date.now() - startTime,
      };
    }
    const deployConfig: Partial<ProjectConfig> = { ...config };
    const projectName = deployConfig.name ?? project.name;
    const trigger = deployConfig.trigger ?? 'api';
    const source = deployConfig.source ?? 'git';
    const repoUrl = deployConfig.repoUrl ?? project.repo_url ?? '';
    if (source !== 'image' && !repoUrl) {
      return {
        success: false,
        projectId,
        projectName,
        error: `Missing repo URL for project: ${projectId}`,
        buildDurationMs: Date.now() - startTime,
      };
    }
    const routeName = getRouteName(projectName);
    const orchestrationDeps = this.createOrchestrationDeps();
    if (deployConfig.envVars) {
      this.db.mergeEnvVars(projectId, deployConfig.envVars);
    }
    if (environment.container_id) {
      try {
        const runtimeLog = await this.docker.getLogs(environment.container_id, 500);
        if (runtimeLog) {
          const lastLog = this.db.getLastDeployLog(projectId, environmentId);
          if (lastLog) {
            this.db.updateRuntimeLog(lastLog.id, runtimeLog);
          }
        }
      } catch {
        // Container may already be gone — best-effort capture
      }

      try {
        await this.docker.safeRemoveContainer(environment.container_id);
      } catch {
        // container may already be removed
      }
    }
    await eventBus.emit('deploy:start', { projectId, repoUrl });
    this.db.updateEnvironment(environmentId, {
      status: 'building',
      containerId: null,
      imageTag: null,
      assignedPort: null,
    });
    this.db.updateProject(projectId, {
      status: 'building',
      containerId: null,
      imageTag: null,
      assignedPort: null,
    });
    let buildLog = '';
    let clonePath = '';
    let diffContext: string | undefined;
    let commitSha: string | undefined;
    let commitMessage: string | undefined;
    let imageTag = `openlander/${routeName}:${String(Date.now())}`;
    const previousTag = `openlander/${routeName}:previous`;
    let preservedPreviousTag: string | null = null;
    if (source !== 'image') {
      const currentRunningTag = environment.image_tag ?? project.image_tag;
      if (currentRunningTag && currentRunningTag !== previousTag) {
        try {
          await this.docker.tagImage(currentRunningTag, `openlander/${routeName}`, 'previous');
          await this.markRollbackImage(previousTag);
          preservedPreviousTag = currentRunningTag;
        } catch (err) {
          if (!isDockerNotFoundError(err)) {
            log.warn({ err, currentRunningTag }, 'Failed to preserve previous image for rollback');
          }
        }
      } else if (currentRunningTag === previousTag) {
        preservedPreviousTag = currentRunningTag;
      }
    } else {
      const currentRunningTag = environment.image_tag ?? project.image_tag;
      if (currentRunningTag) {
        this.db.updateProject(projectId, { previousImageTag: currentRunningTag });
        preservedPreviousTag = currentRunningTag;
      }
    }
    let dockerfilePath: string | undefined;
    try {
      if (source === 'image') {
        const imageUrl = deployConfig.imageUrl;
        if (!imageUrl) {
          throw new Error('Missing image URL for image deployment source');
        }

        await (
          eventBus as unknown as {
            emit(event: string, payload: Record<string, unknown>): Promise<void>;
          }
        ).emit('deploy:image-pull', { projectId, image: imageUrl });
        buildLog += `[pull] Pulling image ${imageUrl}\n`;
        try {
          await this.docker.pullImage(imageUrl);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          throw new Error(mapPullError(err));
        }
        await (
          eventBus as unknown as {
            emit(event: string, payload: Record<string, unknown>): Promise<void>;
          }
        ).emit('deploy:image-pulled', { projectId, image: imageUrl });
        buildLog += `[pull] Pulled image ${imageUrl}\n`;

        imageTag = imageUrl;
        if (!deployConfig.containerPort) {
          const exposedPort = await getImageExposedPort(this.docker, imageTag);
          if (exposedPort) {
            deployConfig.containerPort = exposedPort;
            buildLog += `[image] Detected EXPOSE port ${String(exposedPort)}\n`;
          }
        }
      } else {
        const cloneResult = await cloneAndAnalyze(orchestrationDeps, {
          projectId,
          projectName,
          environmentId,
          repoUrl,
          branch: environment.branch,
          sshKeyPath: deployConfig.sshKeyPath,
        });
        clonePath = cloneResult.clonePath;
        diffContext = cloneResult.diffContext;
        buildLog = cloneResult.buildLog;
        commitSha = cloneResult.commitSha;
        commitMessage = cloneResult.commitMessage;
        const buildResult = await buildProject(orchestrationDeps, {
          projectId,
          environmentId,
          branch: environment.branch,
          routeName,
          trigger,
          imageTag,
          repoUrl,
          startTime,
          shouldSyncProjectState: true,
          config: deployConfig,
          clonePath: cloneResult.clonePath,
          commitSha: cloneResult.commitSha,
          buildLog,
          environmentType: environment.type,
        });
        buildLog = buildResult.buildLog;
        if (buildResult.type === 'compose') {
          return buildResult.result;
        }
        dockerfilePath = buildResult.dockerfilePath;
      }

      const runResult = await runAndVerify(orchestrationDeps, {
        projectId,
        environmentId,
        projectName,
        routeName,
        environmentType: environment.type,
        imageTag,
        dockerfilePath,
        previousEnvironmentImageTag: preservedPreviousTag ?? environment.image_tag,
        previousProjectImageTag: preservedPreviousTag ?? project.image_tag,
        shouldSyncProjectState: true,
        config: deployConfig,
        buildLog,
      });
      buildLog = runResult.buildLog;
      const postDeploy = await handlePostDeploy(orchestrationDeps, {
        projectId,
        environmentId,
        config: deployConfig,
        repoUrl,
        trigger,
        startTime,
        buildLog,
        commitSha,
        commitMessage,
        shouldSyncProjectState: true,
        port: runResult.port,
        internalUrl: runResult.internalUrl,
      });
      return {
        success: true,
        projectId,
        projectName,
        containerId: runResult.containerId,
        url: runResult.internalUrl,
        publicUrl: postDeploy.publicUrl,
        port: runResult.port,
        commitSha,
        buildDurationMs: postDeploy.totalDuration,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const attachedLog = (error as Error & { buildLog?: string }).buildLog;
      if (attachedLog) {
        buildLog = attachedLog;
      }
      const failStep = this.detectFailStep(buildLog);
      const buildLogWithError = buildLog + `[error] ${errorMsg}\n`;
      this.jobManager?.updatePhase(projectId, 'failed', errorMsg);

      try {
        const containerName = projectContainerName(routeName);
        await this.docker.safeRemoveContainer(containerName);
        log.info({ projectId, containerName }, 'Cleaned up orphan container after failed deploy');
      } catch {
        // container may not exist — that's fine
      }

      // Classify for diagnosis only — auto-recovery.ts handles retry via agent.
      try {
        const recovery = new BuildRecovery();
        const classification = recovery.classify(buildLogWithError, {
          projectId,
          projectName,
          imageTag,
          clonePath,
          buildLog: buildLogWithError,
          failedStep: failStep as 'clone' | 'dockerfile' | 'build' | 'run' | 'runtime',
        });
        this.jobManager?.setAutoDiagnosis(projectId, {
          category: classification.category,
          tier: classification.tier,
          cause: classification.message,
          autoFixable: false,
          suggestedAction: classification.suggestedAction,
        });
      } catch (classifyError) {
        log.warn({ err: classifyError, projectId }, 'Build failure classification failed');
      }
      this.db.updateEnvironment(environmentId, { status: 'error' });
      this.db.updateProject(projectId, { status: 'error' });
      this.db.createDeployLog({
        id: nanoid(12),
        projectId,
        environmentId,
        status: 'failed',
        trigger,
        commitSha,
        commitMessage,
        buildLog: buildLogWithError,
        durationMs: Date.now() - startTime,
      });
      await eventBus.emit('deploy:failed', {
        projectId,
        step: failStep,
        error: errorMsg,
        buildLog: buildLogWithError,
        diffContext,
      });
      const logLines = buildLogWithError.split('\n').filter(Boolean);
      const buildLogTail = logLines.slice(-100).join('\n');
      this.jobManager?.updatePhase(projectId, 'failed', errorMsg, buildLogTail);
      return {
        success: false,
        projectId,
        projectName,
        error: errorMsg,
        buildLogTail,
        buildDurationMs: Date.now() - startTime,
      };
    } finally {
      if (clonePath) {
        try {
          const { rmSync } = await import('node:fs');
          rmSync(clonePath, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }
  }

  private async markRollbackImage(imageTag: string): Promise<void> {
    const dockerWithClient = this.docker as unknown as {
      getClient?: () => {
        createContainer: (opts: {
          Image: string;
          Labels?: Record<string, string>;
          Cmd?: string[];
        }) => Promise<{
          id: string;
          commit: (opts: { repo: string; tag: string; changes?: string[] }) => Promise<unknown>;
          remove: (opts: { force: boolean }) => Promise<void>;
        }>;
      };
    };
    const getClient = dockerWithClient.getClient;
    if (typeof getClient !== 'function') {
      return;
    }
    const client = getClient();

    const [repo, tag] = imageTag.split(':');
    if (!repo || !tag) {
      return;
    }

    const temp = await client.createContainer({
      Image: imageTag,
      Labels: { 'ol.rollback': 'true' },
      Cmd: ['true'],
    });

    try {
      await temp.commit({
        repo,
        tag,
        changes: ['LABEL ol.rollback=true'],
      });
    } finally {
      try {
        await temp.remove({ force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }

  private createOrchestrationDeps(): DeployOrchestrationDeps {
    return {
      docker: this.docker,
      db: this.db,
      env: this.env,
      buildExecutor: this.buildExecutor,
      containerRunner: this.containerRunner,
      composePipeline: this.composePipeline,
      autoDetector: this.autoDetector,
      jobManager: this.jobManager,
      applyPendingFix: (projectId: string, clonePath: string) =>
        this.applyPendingFix(projectId, clonePath),
      exposeTunnel: (projectId: string, port: number) => this.exposeTunnel(projectId, port),
      secretScanEnabled: this.config.ai.secretScan.enabled,
    };
  }

  private createMonorepoDeps(): MonorepoOrchestrationDeps {
    return {
      docker: this.docker,
      db: this.db,
      env: this.env,
      buildExecutor: this.buildExecutor,
      containerRunner: this.containerRunner,
      jobManager: this.jobManager,
    };
  }

  async deployMonorepo(config: MonorepoConfig): Promise<MonorepoResult> {
    const startTime = Date.now();
    const parentName = config.name ?? extractProjectName(config.repoUrl);
    const trigger = config.trigger ?? 'api';

    // Use pre-allocated parentId from startMonorepoDeploy() if available
    const parentId = config._parentId ?? nanoid(12);

    if (!config._parentId) {
      this.db.createProject({
        id: parentId,
        name: parentName,
        repoUrl: config.repoUrl,
        branch: config.branch,
      });
      this.db.updateProject(parentId, { status: 'building' });
      this.jobManager?.trackJob(parentId, parentName);
    }

    await eventBus.emit('deploy:start', {
      projectId: parentId,
      repoUrl: config.repoUrl,
      phase: 'orchestrate',
      scope: 'parent',
      status: 'in_progress',
      message: `Starting monorepo deploy (${String(config.dockerfiles.length)} services)`,
    });
    await eventBus.emit('deploy:clone', {
      projectId: parentId,
      path: config.clonePath,
      commitSha: config.commitSha,
      phase: 'clone',
      scope: 'parent',
      status: 'success',
      message: `Using cloned repository (${config.commitSha.slice(0, 7)})`,
    });

    const serviceNameCounts = new Map<string, number>();
    const services: ServiceNode[] = config.dockerfiles.map((dockerfilePath) => {
      const baseName = deriveServiceName(dockerfilePath);
      const count = (serviceNameCounts.get(baseName) ?? 0) + 1;
      serviceNameCounts.set(baseName, count);
      const serviceName = count === 1 ? baseName : `${baseName}-${String(count)}`;
      return {
        name: serviceName,
        dockerfile: dockerfilePath,
        dependsOn: [],
      };
    });

    const existingChildren = this.db.getChildProjects(parentId);
    detectMonorepoDependencies(services, parentName, (serviceName) => {
      const envVarsToScan: Record<string, string> = {};
      const childName = `${parentName}/${serviceName}`;
      const existingChild = existingChildren.find((child) => child.name === childName);

      if (existingChild) {
        Object.assign(envVarsToScan, this.env.getAll(existingChild.id));
      }

      if (config.envVars) {
        Object.assign(envVarsToScan, config.envVars);
      }

      return envVarsToScan;
    });

    const serviceNames = new Set(services.map((s) => s.name));
    if (serviceNames.has('app') && !serviceNames.has('main')) {
      const legacyChildren = this.db
        .getChildProjects(parentId)
        .filter((c) => c.name === `${parentName}/main`);
      for (const child of legacyChildren) {
        if (child.container_id) {
          try {
            await this.docker.safeRemoveContainer(child.container_id);
          } catch {
            /* best effort */
          }
        }
        this.db.updateProject(child.id, { status: 'stopped', containerId: null });
        log.info(
          { childId: child.id, oldName: child.name },
          'Cleaned up legacy "main" child (renamed to "app")',
        );
      }
    }

    const orchestrator = new DeployOrchestrator();
    let topology;
    try {
      topology = orchestrator.buildTopology(
        services,
        config.repoUrl,
        config.clonePath,
        config.commitSha,
        config.branch,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.db.updateProject(parentId, { status: 'error' });
      this.jobManager?.updatePhase(parentId, 'failed', errorMsg);
      await eventBus.emit('deploy:failed', {
        projectId: parentId,
        step: 'topology',
        error: errorMsg,
        phase: 'orchestrate',
        scope: 'parent',
        status: 'failed',
        message: `Monorepo topology build failed: ${errorMsg}`,
        durationMs: Date.now() - startTime,
      });
      return {
        success: false,
        parentProjectId: parentId,
        parentName,
        children: services.map((service) => ({
          success: false,
          projectId: '',
          projectName: `${parentName}/${service.name}`,
          error: `Topology build failed: ${errorMsg}`,
          buildDurationMs: Date.now() - startTime,
        })),
        buildDurationMs: Date.now() - startTime,
      };
    }

    const usedPorts = (await scanUsedPorts(this.db, this.docker)).all;
    const validation = orchestrator.validateTopology(topology, usedPorts);
    if (!validation.valid) {
      const validationError = validation.errors.join('; ');
      this.db.updateProject(parentId, { status: 'error' });
      this.jobManager?.updatePhase(parentId, 'failed', validationError);
      await eventBus.emit('deploy:failed', {
        projectId: parentId,
        step: 'topology',
        error: validationError,
        phase: 'orchestrate',
        scope: 'parent',
        status: 'failed',
        message: `Monorepo topology validation failed: ${validationError}`,
        durationMs: Date.now() - startTime,
      });
      return {
        success: false,
        parentProjectId: parentId,
        parentName,
        children: services.map((service) => ({
          success: false,
          projectId: '',
          projectName: `${parentName}/${service.name}`,
          error: `Topology validation failed: ${validationError}`,
          buildDurationMs: Date.now() - startTime,
        })),
        buildDurationMs: Date.now() - startTime,
      };
    }

    const resultByService = new Map<string, DeployResult>();
    const monorepoDeps = this.createMonorepoDeps();

    const orchestration = await orchestrator.executeOrdered(topology, {
      deployService: (service) =>
        deployMonorepoService(monorepoDeps, {
          service,
          parentId,
          parentName,
          config,
          trigger,
          resultByService,
        }),
      rollbackService: (service) =>
        rollbackMonorepoService(monorepoDeps, {
          service,
          trigger,
          startTime,
        }),
      waitForHealthy: async (service, deployment) => {
        if (!deployment.projectId) {
          log.warn({ serviceName: service.name }, 'Monorepo health check: no projectId — skipping');
          return { healthy: true };
        }

        const project = this.db.getProject(deployment.projectId);
        const containerId = project?.container_id;
        if (!containerId) {
          log.warn(
            { serviceName: service.name },
            'Monorepo health check: containerId not found — skipping',
          );
          return { healthy: true };
        }

        log.info(
          { serviceName: service.name, containerId },
          'Monorepo health check: waiting for readiness (60s)',
        );

        try {
          const healthResult = await this.docker.waitForHealthy(containerId, 60000);
          if (healthResult.healthy) {
            return { healthy: true };
          }

          log.warn(
            { serviceName: service.name, error: healthResult.error },
            'Monorepo health check: not healthy within 60s — proceeding anyway',
          );
          return { healthy: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn(
            { serviceName: service.name, error: message },
            'Monorepo health check: not healthy within 60s — proceeding anyway',
          );
          return { healthy: true };
        }
      },
    });

    const childResults = buildMonorepoResults({
      services,
      parentName,
      resultByService,
      orchestration,
      startTime,
    });

    const allSuccess = orchestration.success && childResults.every((r) => r.success);
    this.db.updateProject(parentId, { status: allSuccess ? 'running' : 'error' });
    this.jobManager?.updatePhase(parentId, allSuccess ? 'done' : 'failed');

    if (allSuccess) {
      await eventBus.emit('deploy:success', {
        projectId: parentId,
        url: getProjectUrl(parentName),
        totalDurationMs: Date.now() - startTime,
        phase: 'complete',
        scope: 'parent',
        status: 'success',
        message: `Monorepo deploy complete (${String(childResults.length)} services)`,
      });
    } else {
      const failedSummary = childResults
        .filter((child) => !child.success)
        .map((child) => `${child.projectName}: ${child.error ?? 'unknown error'}`)
        .join('; ');

      await eventBus.emit('deploy:failed', {
        projectId: parentId,
        step: 'monorepo',
        error: failedSummary || 'One or more monorepo services failed',
        phase: 'complete',
        scope: 'parent',
        status: 'failed',
        message: 'Monorepo deploy failed',
        durationMs: Date.now() - startTime,
      });
    }

    return {
      success: allSuccess,
      parentProjectId: parentId,
      parentName,
      children: childResults,
      buildDurationMs: Date.now() - startTime,
    };
  }

  /** Redeploy an existing project (pull latest, rebuild, swap containers). */
  async redeploy(projectId: string, options?: RedeployOptions): Promise<DeployResult> {
    const project = this.db.getProject(projectId);
    if (!project) {
      return {
        success: false,
        projectId,
        projectName: 'unknown',
        error: `Project not found: ${projectId}`,
      };
    }

    this.validateProjectName(project.name);

    if (project.archived_at) {
      return {
        success: false,
        projectId,
        projectName: project.name,
        error: `Project "${project.name}" is archived. Use unarchive_project first, then redeploy.`,
      };
    }

    const lockSession = options?.lockSessionId ?? nanoid(12);
    const locked = this.db.acquireDeployLock(projectId, lockSession);
    if (!locked) {
      const lockInfo = this.db.getDeployLockInfo(projectId);
      throw new DeployLockedError(projectId, lockInfo?.session ?? 'unknown');
    }

    try {
      const targetEnvironment = this.db
        .getEnvironmentsByProject(projectId)
        .find((environment) => environment.type === 'production');
      if (!targetEnvironment) {
        return {
          success: false,
          projectId,
          projectName: project.name,
          error: 'Production environment not found',
        };
      }

      const strategy = options?.strategy ?? 'force';
      if (strategy === 'blue-green') {
        return await this.blueGreenRedeploy(projectId, options);
      }

      const redeployRouteName = getRouteName(project.name);
      const redeployPreviousLabel = `openlander/${redeployRouteName}:previous`;
      const currentRunningTag = project.image_tag;
      let redeployPreviousTag: string | null = currentRunningTag;
      if (project.source !== 'image' && currentRunningTag) {
        if (currentRunningTag !== redeployPreviousLabel) {
          try {
            await this.docker.tagImage(
              currentRunningTag,
              `openlander/${redeployRouteName}`,
              'previous',
            );
            redeployPreviousTag = redeployPreviousLabel;
          } catch (err) {
            if (!isDockerNotFoundError(err)) {
              log.warn(
                { err, currentRunningTag },
                'Failed to preserve previous image for rollback',
              );
            }
          }
        } else {
          redeployPreviousTag = redeployPreviousLabel;
        }
      }

      await this.cleanupProjectContainers(projectId, 'remove');

      this.db.updateProject(projectId, { previousImageTag: redeployPreviousTag });

      const previousPort = project.assigned_port ?? undefined;

      this.db.updateProject(projectId, {
        status: 'building',
        containerId: null,
        imageTag: null,
        assignedPort: null,
      });
      for (const env of this.db.getEnvironmentsByProject(projectId)) {
        this.db.updateEnvironment(env.id, {
          assignedPort: null,
          containerId: null,
          imageTag: null,
          previousImageTag: redeployPreviousTag,
          status: 'idle',
        });
      }
      this.jobManager?.trackJob(projectId, project.name);

      const config = buildDeployConfig({
        projectId,
        runtimeOverrides: {
          _projectId: projectId,
          _preferredPort: previousPort,
          _noCacheBuild: project.source === 'image' ? true : options?.noCache,
          environment: 'production',
          ...(options?.cmd && { imageCmd: options.cmd }),
        },
        db: this.db,
      });

      return await this.deploy(config);
    } finally {
      this.db.releaseDeployLock(projectId);
    }
  }

  private async blueGreenRedeploy(
    projectId: string,
    options?: RedeployOptions,
  ): Promise<DeployResult> {
    const startTime = Date.now();
    const healthCheckPath = this.normalizeHealthCheckPath(options?.healthCheckPath ?? '/');
    const healthCheckRetries = options?.healthCheckRetries ?? 10;
    const healthCheckIntervalMs = options?.healthCheckIntervalMs ?? 2_000;

    let projectName = 'unknown';
    let imageTag: string | undefined;
    let newPort: number | undefined;
    let greenContainerId: string | undefined;
    let shouldCleanupGreen = false;
    let buildLog = '';
    let clonePath: string | undefined;
    let commitSha: string | undefined;
    let blueContainerId: string | undefined;
    let environmentId: string | undefined;

    try {
      const project = this.db.getProject(projectId);
      if (!project) {
        return {
          success: false,
          projectId,
          projectName,
          error: `Project not found: ${projectId}`,
          buildDurationMs: Date.now() - startTime,
        };
      }

      projectName = project.name;
      this.validateProjectName(projectName);
      blueContainerId = project.container_id ?? undefined;

      if (project.status !== 'running' || !blueContainerId) {
        return {
          success: false,
          projectId,
          projectName,
          error: `Project ${projectName} is not running`,
          buildDurationMs: Date.now() - startTime,
        };
      }

      if (!project.repo_url) {
        return {
          success: false,
          projectId,
          projectName,
          error: `Project ${projectName} does not have a repository URL`,
          buildDurationMs: Date.now() - startTime,
        };
      }

      const prodEnv = this.db
        .getEnvironmentsByProject(projectId)
        .find((env) => env.type === 'production');
      environmentId = prodEnv?.id;

      const deployConfig = buildDeployConfig({
        projectId,
        runtimeOverrides: {
          _projectId: projectId,
          _noCacheBuild: options?.noCache,
        },
        db: this.db,
      });

      this.jobManager?.trackJob(projectId, projectName);
      this.db.updateProject(projectId, { status: 'building' });
      if (prodEnv) {
        this.db.updateEnvironment(prodEnv.id, { status: 'building' });
      }

      await eventBus.emit('deploy:start', { projectId, repoUrl: project.repo_url });

      this.jobManager?.updatePhase(projectId, 'cloning');
      buildLog += '[clone] Cloning repository...\n';
      const cloneResult = await cloneRepo({
        repoUrl: project.repo_url,
        branch: project.branch,
      });
      clonePath = cloneResult.path;
      commitSha = cloneResult.commitSha;
      buildLog += `[clone] Done (${cloneResult.commitSha})\n`;

      this.jobManager?.updatePhase(projectId, 'building');
      imageTag = `openlander/${projectName}:${String(Date.now())}`;
      buildLog += '[build] Building image...\n';

      await this.buildExecutor.build(
        {
          clonePath: cloneResult.path,
          projectId,
          imageTag,
          dockerfilePath: deployConfig.dockerfilePath,
          buildContext: deployConfig.buildContext,
          dockerTarget: deployConfig.dockerTarget,
          noCache: options?.noCache,
        },
        (line) => {
          buildLog += `${line}\n`;
        },
      );

      const buildDuration = Date.now() - startTime;
      buildLog += `[build] Done (${String(Math.round(buildDuration / 1000))}s)\n`;

      await eventBus.emit('deploy:build', {
        projectId,
        imageTag,
        durationMs: buildDuration,
      });

      this.jobManager?.updatePhase(projectId, 'starting');
      newPort = await allocatePort(this.db, this.docker, {}, 'production');
      const containerPort = (await this.docker.getImageExposedPort(imageTag)) ?? newPort;
      const envVars = resolveEnvVars({ projectId, environmentId }, { env: this.env });
      const secretFiles = this.env.getSecretFilesForDeploy(projectId);
      const networkName = getPolicy('production').networkName;

      greenContainerId = await this.docker.runContainer({
        imageTag,
        name: projectContainerName(`${projectName}-green`),
        port: newPort,
        containerPort,
        envVars,
        traefikLabels: { 'traefik.enable': 'false' },
        network: networkName,
        secretFiles,
      });
      shouldCleanupGreen = true;

      await eventBus.emit('deploy:run', {
        projectId,
        containerId: greenContainerId,
        port: newPort,
        url: getProjectUrl(projectName),
      });

      buildLog += `[health] Checking http://localhost:${String(newPort)}${healthCheckPath}\n`;
      const healthy = await this.healthCheck(
        newPort,
        healthCheckPath,
        healthCheckRetries,
        healthCheckIntervalMs,
      );

      if (!healthy) {
        throw new Error(
          `Health check failed for ${projectName} on port ${String(newPort)} path ${healthCheckPath}`,
        );
      }
      buildLog += '[health] Passed\n';

      // Promote green container: stop old blue, rename green to canonical name.
      // This avoids creating a new container (which caused port conflicts)
      // and achieves zero-downtime promotion.
      await this.docker.stopContainer(blueContainerId);
      await this.docker.safeRemoveContainer(blueContainerId);

      // Add Traefik labels to the green container so it receives traffic
      const canonicalName = projectContainerName(projectName);
      const greenContainer = this.docker.getClient().getContainer(greenContainerId);
      await greenContainer.rename({ name: canonicalName });
      shouldCleanupGreen = false;

      this.db.updateProject(projectId, {
        status: 'running',
        containerId: greenContainerId,
        assignedPort: newPort,
        imageTag,
        previousImageTag: project.image_tag,
      });
      if (prodEnv) {
        this.db.updateEnvironment(prodEnv.id, {
          status: 'running',
          containerId: greenContainerId,
          assignedPort: newPort,
          imageTag,
          previousImageTag: prodEnv.image_tag,
        });
      }

      const durationMs = Date.now() - startTime;
      const projectUrl = getProjectUrl(projectName);

      this.db.createDeployLog({
        id: nanoid(12),
        projectId,
        environmentId,
        status: 'success',
        trigger: 'api',
        commitSha,
        buildLog,
        durationMs,
      });

      this.jobManager?.updatePhase(projectId, 'done');
      await eventBus.emit('deploy:success', {
        projectId,
        url: projectUrl,
        totalDurationMs: durationMs,
      });

      return {
        success: true,
        projectId,
        projectName,
        previousImageTag: project.image_tag ?? undefined,
        containerId: greenContainerId,
        url: projectUrl,
        port: newPort,
        commitSha,
        buildDurationMs: durationMs,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      buildLog += `[error] ${errorMsg}\n`;

      let blueStillServing = false;
      if (blueContainerId) {
        try {
          const container = this.docker.getClient().getContainer(blueContainerId);
          const info = await container.inspect();
          blueStillServing = info.State.Running;
        } catch {
          blueStillServing = false;
        }
      }

      if (!blueStillServing && blueContainerId) {
        try {
          const blueContainer = this.docker.getClient().getContainer(blueContainerId);
          await blueContainer.restart();
          blueStillServing = true;
          buildLog += '[recovery] Restarted blue container after failed promotion\n';
        } catch (restartErr) {
          buildLog += `[recovery] Failed to restart blue: ${String(restartErr)}\n`;
        }
      }

      if (blueStillServing) {
        this.db.updateProject(projectId, { status: 'running' });
        if (environmentId) {
          const prodEnvErr = this.db.getEnvironment(environmentId);
          if (prodEnvErr) {
            this.db.updateEnvironment(environmentId, { status: 'running' });
          }
        }
      } else {
        this.db.updateProject(projectId, { status: 'error' });
        if (environmentId) {
          const prodEnvErr = this.db.getEnvironment(environmentId);
          if (prodEnvErr) {
            this.db.updateEnvironment(environmentId, { status: 'error' });
          }
        }
      }

      this.db.createDeployLog({
        id: nanoid(12),
        projectId,
        environmentId,
        status: 'failed',
        trigger: 'api',
        commitSha,
        buildLog,
        durationMs: Date.now() - startTime,
      });

      this.jobManager?.updatePhase(projectId, 'failed', errorMsg);

      await eventBus.emit('deploy:failed', {
        projectId,
        step: 'blue-green',
        error: errorMsg,
        buildLog,
      });

      return {
        success: false,
        projectId,
        projectName,
        url: getProjectUrl(projectName),
        port: newPort,
        buildDurationMs: Date.now() - startTime,
        error: blueStillServing
          ? `Blue-green deploy failed (previous version still serving): ${errorMsg}`
          : errorMsg,
      };
    } finally {
      if (shouldCleanupGreen && greenContainerId) {
        await this.cleanupGreenContainer(greenContainerId);
      }
      if (clonePath) {
        await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  private async healthCheck(
    port: number,
    path: string,
    retries: number,
    intervalMs: number,
  ): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(`http://localhost:${String(port)}${path}`);
        if (response.ok) return true;
      } catch (err) {
        log.debug({ err }, 'Health check probe failed — container not ready yet');
      }
      if (i < retries - 1) {
        await sleep(intervalMs);
      }
    }
    return false;
  }

  private normalizeHealthCheckPath(path: string): string {
    return path.startsWith('/') ? path : `/${path}`;
  }

  private async cleanupGreenContainer(containerId: string): Promise<void> {
    try {
      await this.docker.stopContainer(containerId);
    } catch (err) {
      log.warn({ err }, 'Failed to stop green container during cleanup');
    }

    try {
      await this.docker.safeRemoveContainer(containerId);
    } catch (err) {
      log.warn({ err }, 'Failed to remove green container during cleanup');
    }
  }

  async deployPreview(options: PreviewDeployOptions): Promise<PreviewDeployResult> {
    try {
      const existing = this.db.getProjectByName(options.previewName);
      if (existing) {
        this.db.updateProject(existing.id, {
          parentProjectId: options.parentProjectId,
          isPreview: 1,
          prNumber: options.prNumber,
        });

        const result = await this.redeploy(existing.id);
        if (!result.success) {
          return { success: false, error: result.error };
        }
        return { success: true, url: getProjectUrl(options.previewName) };
      }

      const result = await this.deploy({
        repoUrl: options.repoUrl,
        branch: options.branch,
        name: options.previewName,
        trigger: 'webhook',
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      if (result.projectId) {
        this.db.updateProject(result.projectId, {
          parentProjectId: options.parentProjectId,
          isPreview: 1,
          prNumber: options.prNumber,
        });
      }

      return { success: true, url: getProjectUrl(options.previewName) };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  }

  /** Rollback a project to its previous image tag. */
  async rollback(
    projectId: string,
    environmentId?: string,
    lockSessionId?: string,
  ): Promise<DeployResult> {
    const project = this.db.getProject(projectId);
    if (!project) {
      return this.rollbackExecutor.rollbackToImage(projectId, environmentId);
    }

    const lockSession = lockSessionId ?? nanoid(12);
    const locked = this.db.acquireDeployLock(projectId, lockSession);
    if (!locked) {
      const lockInfo = this.db.getDeployLockInfo(projectId);
      throw new DeployLockedError(projectId, lockInfo?.session ?? 'unknown');
    }

    try {
      return await this.rollbackExecutor.rollbackToImage(projectId, environmentId);
    } finally {
      this.db.releaseDeployLock(projectId);
    }
  }

  private async cleanupProjectContainers(
    projectId: string,
    mode: 'stop' | 'remove',
  ): Promise<void> {
    if (mode === 'stop') {
      await this.lifecycle.stop(projectId);
      return;
    }

    await this.lifecycle.cleanupProjectContainers(projectId);
  }

  private async forceCleanConflicts(
    projectName: string,
    error: PreflightCheckError,
  ): Promise<void> {
    const containerName = projectContainerName(projectName);

    if (!error.result.checks.nameAvailable.pass) {
      log.info({ containerName }, 'Force mode: removing conflicting container');
      await this.lifecycle.forceCleanConflicts(containerName);
    }
  }

  /** Stop a project's container. */
  async stop(projectId: string, environmentId?: string): Promise<void> {
    if (environmentId) {
      const environment = this.db.getEnvironment(environmentId);
      if (!environment?.container_id) return;

      try {
        await this.docker.stopContainer(environment.container_id);
      } catch (err) {
        if (!(err instanceof ContainerNotFoundError)) throw err;
      }
      this.db.updateEnvironment(environmentId, { status: 'stopped' });
      await eventBus.emit('container:stop', { projectId, containerId: environment.container_id });
      return;
    }

    const children = this.db.getChildProjects(projectId);
    if (children.length > 0) {
      await this.lifecycle.stop(projectId);
      this.closeTunnel(projectId);
      return;
    }

    await this.lifecycle.stop(projectId);
    this.closeTunnel(projectId);
  }

  /** Start a stopped project's container. */
  async start(projectId: string, environmentId?: string): Promise<void> {
    if (environmentId) {
      const environment = this.db.getEnvironment(environmentId);
      if (!environment?.container_id) return;

      try {
        await this.docker.startContainer(environment.container_id);
      } catch (err) {
        if (err instanceof ContainerNotFoundError) {
          log.debug(
            { projectId, environmentId },
            'Container not found during start — may have been removed externally',
          );
        } else {
          throw err;
        }
      }
      this.db.updateEnvironment(environmentId, { status: 'running' });
      await eventBus.emit('container:start', { projectId, containerId: environment.container_id });
      return;
    }

    await this.lifecycle.start(projectId);
  }

  /** Remove a project entirely. */
  async remove(projectId: string, cloudflare?: CloudflareTunnelManager): Promise<void> {
    const project = this.db.getProject(projectId);
    if (!project) return;

    if (this.composePipeline) {
      try {
        await this.composePipeline.stopCompose(projectId);
      } catch (err) {
        log.debug({ err, projectId }, 'Compose stop during project delete skipped');
      }
    }

    const descendants = new Set<string>([projectId]);
    const queue = [projectId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const children = this.db.getChildProjects(current);
      for (const child of children) {
        if (descendants.has(child.id)) continue;
        descendants.add(child.id);
        queue.push(child.id);
      }
    }

    if (cloudflare) {
      for (const targetId of descendants) {
        const domains = this.db.getDomainMappings(targetId);
        for (const mapping of domains) {
          try {
            await cloudflare.removeTunnel(targetId, mapping.domain);
          } catch (err) {
            log.debug(
              { err, domain: mapping.domain },
              'Domain cleanup during project delete failed — may already be removed',
            );
          }
        }
      }
    }

    await this.lifecycle.remove(projectId, this.tunnelManager);
  }

  async archive(projectId: string): Promise<void> {
    await this.lifecycle.archive(projectId, this.tunnelManager);
  }

  async unarchive(projectId: string): Promise<void> {
    await this.lifecycle.unarchive(projectId);
  }

  /** Create a TryCloudflare tunnel for a project. */
  async exposeTunnel(projectId: string, _port: number): Promise<string> {
    return this.tunnelManager.expose(projectId, _port);
  }

  /** Close a project's tunnel. */
  closeTunnel(projectId: string): void {
    this.tunnelManager.close(projectId);
  }

  getTunnel(projectId: string): CloudflareTunnel | undefined {
    return this.tunnelManager.get(projectId);
  }

  /** Get container logs. */
  async getLogs(projectId: string, lines = 50): Promise<string> {
    return this.lifecycle.getLogs(projectId, lines);
  }

  private applyPendingFix(projectId: string, clonePath: string): string | null {
    const rawPendingFix = this.db.consumePendingFix(projectId);
    if (!rawPendingFix) {
      return null;
    }

    const parsed = parsePendingFix(rawPendingFix);
    if (!parsed) {
      throw new Error('Invalid pending fix payload in database');
    }

    const normalizedPath = parsed.filePath.trim().replace(/\\/g, '/');
    if (!normalizedPath || normalizedPath.startsWith('/')) {
      throw new Error('Pending fix file path must be relative');
    }

    const cloneRoot = resolve(clonePath);
    const targetPath = resolve(clonePath, normalizedPath);
    if (!targetPath.startsWith(`${cloneRoot}/`) && targetPath !== cloneRoot) {
      throw new Error('Pending fix path escaped repository root');
    }

    if (parsed.content !== undefined) {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, parsed.content, 'utf8');
    } else if (parsed.patches && parsed.patches.length > 0) {
      if (!existsSync(targetPath)) {
        throw new Error(`Cannot apply patches: ${parsed.filePath} not found in repository`);
      }

      let content = readFileSync(targetPath, 'utf8');
      for (const patch of parsed.patches) {
        const regex = new RegExp(patch.pattern, patch.flags ?? 'gm');
        content = content.replace(regex, patch.replacement);
      }

      writeFileSync(targetPath, content, 'utf8');
    } else {
      throw new Error('Invalid pending fix: must have content or patches');
    }

    log.info({ projectId, filePath: normalizedPath }, 'Applied pending fix before build');
    return normalizedPath;
  }
}
