import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('deploy');

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { nanoid } from 'nanoid';

import type { Docker } from './docker.js';
import type { CloudflareTunnelManager } from './cloudflare.js';
import { cloneRepo } from './git.js';
import { scanUsedPorts } from './port.js';
import { getProjectUrl } from './traefik.js';
import type { CloudflareTunnel } from './tunnel.js';
import { BuildRecovery } from './build-recovery.js';
import { DeployOrchestrator, type ServiceNode } from './orchestrator.js';
import type { Database } from '../db/index.js';
import { eventBus } from '../events/index.js';

import { ContainerNotFoundError, PreflightCheckError } from '../errors.js';
import { preflightCheckOrThrow } from './preflight.js';
import { buildDeployConfig } from './build-deploy-config.js';
import type { JobManager } from './job-manager.js';
import type { ComposePipeline } from './compose.js';
import type { AutoDetector } from './auto-detect.js';
import type { EnvManager } from './env.js';

import { extractProjectName } from './helpers.js';
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
      const knownIds = new Set<string>();
      const knownNames = new Set<string>();

      for (const project of this.db.listProjects()) {
        if (project.container_id) knownIds.add(project.container_id);
        knownNames.add(`ol-${project.name}`);

        for (const env of this.db.getEnvironmentsByProject(project.id)) {
          if (env.container_id) knownIds.add(env.container_id);
          knownNames.add(`ol-${getRouteName(project.name, env.type)}`);
        }
      }

      for (const service of this.db.listServices()) {
        if (service.container_id) knownIds.add(service.container_id);
        if (service.container_name) knownNames.add(service.container_name);
      }

      for (const container of managed) {
        if (knownIds.has(container.id)) continue;
        if (knownNames.has(container.name)) continue;
        if (container.labels?.['openlander.role']) continue;

        log.info({ id: container.id, name: container.name }, 'Removing orphan container');
        try {
          await this.docker.removeContainer(container.id);
        } catch (err) {
          log.debug({ err, container: container.name }, 'Orphan container removal failed');
        }
      }
    } catch (err) {
      log.debug({ err }, 'Orphan container cleanup failed — Docker may not be available');
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
      this.db.updateProject(existing.id, {
        status: 'building',
        ...(config.buildContext ? { buildContext: config.buildContext } : {}),
        ...(config.dockerfilePath ? { dockerfilePath: config.dockerfilePath } : {}),
        ...(config.dockerTarget ? { dockerTarget: config.dockerTarget } : {}),
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
      repoUrl: config.repoUrl,
      branch: config.branch,
      dockerfilePath: config.dockerfilePath,
      dockerTarget: config.dockerTarget,
      buildContext: config.buildContext,
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
        repoUrl: config.repoUrl,
        branch: config.branch,
      });
      this.db.updateProject(projectId, { status: 'building' });
      this.jobManager?.trackJob(projectId, projectName);
    } else if (config.branch) {
      this.db.updateProject(projectId, { branch: config.branch });
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

    const envType = (config.environment || 'production') as 'production' | 'development';
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
    const routeName = getRouteName(projectName, environment.type);
    const shouldSyncProjectState = environment.type === 'production';
    const orchestrationDeps = this.createOrchestrationDeps();
    if (deployConfig.envVars) {
      this.db.mergeEnvVars(
        projectId,
        deployConfig.envVars,
        shouldSyncProjectState ? undefined : environmentId,
      );
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
        await this.docker.removeContainer(environment.container_id);
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
    if (shouldSyncProjectState) {
      this.db.updateProject(projectId, {
        status: 'building',
        containerId: null,
        imageTag: null,
        assignedPort: null,
      });
    }
    let buildLog = '';
    let clonePath = '';
    let diffContext: string | undefined;
    let commitSha: string | undefined;
    let commitMessage: string | undefined;
    let imageTag = `openlander/${routeName}:latest`;
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
          shouldSyncProjectState,
          config: deployConfig,
          clonePath: cloneResult.clonePath,
          commitSha: cloneResult.commitSha,
          buildLog,
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
        previousEnvironmentImageTag: environment.image_tag,
        previousProjectImageTag: project.image_tag,
        shouldSyncProjectState,
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
        shouldSyncProjectState,
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
        const containerName = `ol-${routeName}`;
        await this.docker.removeContainer(containerName);
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
      if (shouldSyncProjectState) {
        this.db.updateProject(projectId, { status: 'error' });
      }
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
  async redeploy(projectId: string, options?: { noCache?: boolean }): Promise<DeployResult> {
    const project = this.db.getProject(projectId);
    if (!project) {
      return {
        success: false,
        projectId,
        projectName: 'unknown',
        error: `Project not found: ${projectId}`,
      };
    }

    await this.cleanupProjectContainers(projectId, 'remove');

    this.db.updateProject(projectId, { previousImageTag: project.image_tag });

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
      },
      db: this.db,
    });

    return this.deploy(config);
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
  async rollback(projectId: string, environmentId?: string): Promise<DeployResult> {
    return this.rollbackExecutor.rollbackToImage(projectId, environmentId);
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
    const containerName = `ol-${projectName}`;

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

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, parsed.content, 'utf8');
    log.info({ projectId, filePath: normalizedPath }, 'Applied pending fix before build');
    return normalizedPath;
  }
}
