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
import type { EventPayload } from '../events/index.js';
import { ContainerNotFoundError, DockerfileNotFoundError, PreflightCheckError } from '../errors.js';
import { detectFramework, ensureDockerfile, parseDockerfileExposePort } from './dockerfile-gen.js';
import { preflightCheckOrThrow } from './preflight.js';
import { detectNewEnvKeys } from './env-inject.js';
import { filterBuildTimeVars } from './build-args.js';
import { analyzeBuildDiff, formatDiffForPrompt } from './diff-analysis.js';
import { scanForSecrets } from './secret-scan.js';
import type { JobManager } from './job-manager.js';
import type { ComposePipeline } from './compose.js';
import type { AutoDetector } from './auto-detect.js';
import type { EnvManager } from './env.js';
import type { BuildDebugger } from '../agent/debugger.js';
import { extractProjectName } from './helpers.js';
import {
  getRouteName,
  deriveServiceName,
  resolveDockerfilePath,
  detectFailStep,
  parsePendingFix,
} from './deploy/helpers.js';
import { ContainerLifecycle } from './deploy/lifecycle.js';
import { RollbackExecutor } from './deploy/rollback.js';
import { TunnelManager } from './deploy/tunnel.js';
import { BuildExecutor } from './deploy/build-step.js';
import { ContainerRunner } from './deploy/run-step.js';
import { RecoveryOrchestrator } from './deploy/recovery.js';

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
  _retryCount?: number;
  _noCacheBuild?: boolean;
  _preferredPort?: number;
  /** Specific docker-compose services to deploy. Deploys all if omitted. */
  composeServices?: string[];
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
    private readonly buildDebugger?: BuildDebugger,
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
    const projectName = config.name ?? extractProjectName(config.repoUrl);
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
      // Reuse existing project — redeploy instead of creating duplicate
      this.db.updateProject(existing.id, { status: 'building' });
      this.jobManager?.trackJob(existing.id, projectName);

      void this.deploy({ ...config, name: projectName, _projectId: existing.id }).catch(() => {
        // Error handling is done inside deploy()
      });

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
    });
    this.db.updateProject(projectId, { status: 'building' });
    this.jobManager?.trackJob(projectId, projectName);

    // Fire-and-forget: run the deploy pipeline in background
    void this.deploy({ ...config, name: projectName, _projectId: projectId }).catch(() => {
      // Error handling is done inside deploy()
    });

    return { projectId, projectName, status: 'building' };
  }

  /**
   * Start a monorepo deployment in the background (non-blocking).
   * Returns immediately with the parent project ID.
   */
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
    const projectName = config.name ?? extractProjectName(config.repoUrl);
    const trigger = config.trigger ?? 'chat';

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

    const projectName = config.name ?? project.name;
    const trigger = config.trigger ?? 'chat';
    const repoUrl = config.repoUrl ?? project.repo_url ?? '';
    if (!repoUrl) {
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

    if (environment.container_id) {
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
    const imageTag = `openlander/${routeName}:latest`;

    try {
      const cloneResult = await cloneRepo({
        repoUrl,
        branch: environment.branch,
        sshKeyPath: config.sshKeyPath,
      });
      clonePath = cloneResult.path;

      await eventBus.emit('deploy:clone', {
        projectId,
        path: cloneResult.path,
        commitSha: cloneResult.commitSha,
      });

      buildLog += `[clone] ${repoUrl} @ ${cloneResult.commitSha.slice(0, 8)}\n`;

      const pendingFixFile = this.applyPendingFix(projectId, cloneResult.path);
      if (pendingFixFile) {
        buildLog += `[pending-fix] Applied ${pendingFixFile}\n`;
      }

      const previousDeploy = this.db.getLastDeployLog(projectId, environmentId);
      const previousSha = previousDeploy?.commit_sha;

      if (previousSha && previousSha !== cloneResult.commitSha) {
        const diffAnalysis = await analyzeBuildDiff(cloneResult.path, previousSha);
        if (diffAnalysis) {
          diffContext = formatDiffForPrompt(diffAnalysis);
          buildLog += `[diff] ${diffAnalysis.summary}\n`;
          log.info(
            {
              projectId,
              totalChanged: diffAnalysis.totalChangedFiles,
              buildImpact: diffAnalysis.buildImpactFiles.length,
            },
            'Pre-build diff analysis complete',
          );
          await eventBus.emit('deploy:diff-analyzed', {
            projectId,
            previousSha: diffAnalysis.previousSha,
            currentSha: diffAnalysis.currentSha,
            totalChanged: diffAnalysis.totalChangedFiles,
            buildImpactFiles: diffAnalysis.buildImpactFiles,
            envTemplateChanged: diffAnalysis.envTemplateChanged,
            dockerChanged: diffAnalysis.dockerChanged,
            depsChanged: diffAnalysis.depsChanged,
          });
        }
      }

      const storedVars = this.env.getAll(projectId, environmentId);
      const storedKeys = Object.keys(storedVars);
      const detection = detectNewEnvKeys(cloneResult.path, storedKeys);

      if (detection) {
        await eventBus.emit('env:new-keys-detected', {
          projectId,
          projectName,
          newKeys: detection.newKeys,
          templateFile: detection.templateFile,
        });
      }

      const secretFindings = scanForSecrets(cloneResult.path);
      if (secretFindings.length > 0) {
        await eventBus.emit('secret:detected', {
          projectId,
          projectName,
          secrets: secretFindings,
        });
      }

      const hasExplicitDockerfilePath =
        typeof config.dockerfilePath === 'string' && config.dockerfilePath.trim().length > 0;
      const preferDockerfile = config.preferDockerfile === true || hasExplicitDockerfilePath;

      const composePath = preferDockerfile
        ? null
        : this.composePipeline?.detectComposeFile(cloneResult.path);
      const composeEnvVars = {
        ...(config.envVars ?? {}),
        ...this.env.getMergedForDeploy(projectId, environmentId),
      };
      if (composePath && this.composePipeline) {
        log.info({ composePath }, 'Compose file detected — delegating to ComposePipeline');
        const result = await this.composePipeline.deployCompose({
          repoUrl,
          branch: environment.branch,
          clonePath: cloneResult.path,
          composePath,
          profiles: [],
          services: config.composeServices,
          name: routeName,
          trigger,
          envVars: composeEnvVars,
          _parentId: projectId,
        });

        return {
          success: result.success,
          projectId: result.parentProjectId,
          projectName: result.parentName,
          buildDurationMs: result.buildDurationMs,
          error: result.error,
        };
      }

      const dockerfilePath = resolveDockerfilePath(cloneResult.path, config.dockerfilePath);
      const usingExplicitDockerfile = hasExplicitDockerfilePath;

      // Step 2: Auto-generate Dockerfile if missing (v0.4)
      const dockerfileResult = usingExplicitDockerfile ? null : ensureDockerfile(cloneResult.path);

      let autoDetected = false;
      if (
        !usingExplicitDockerfile &&
        dockerfileResult &&
        !dockerfileResult.generated &&
        !existsSync(dockerfilePath)
      ) {
        const autoDetectResult =
          (await this.autoDetector?.generateDockerfile(cloneResult.path)) ?? null;
        if (autoDetectResult?.generated && autoDetectResult.type === 'dockerfile') {
          const dockerfileContent = autoDetectResult.content.trim();
          if (dockerfileContent.length > 0) {
            writeFileSync(dockerfilePath, `${dockerfileContent}\n`, 'utf8');
            const framework = detectFramework(cloneResult.path).framework;
            await eventBus.emit('deploy:auto-detect', {
              projectId,
              framework,
              type: 'dockerfile',
            });
            buildLog += `[dockerfile] Auto-generated by LLM (${framework})\n`;
            autoDetected = true;
          }
        }
      }

      if (!existsSync(dockerfilePath)) {
        throw new DockerfileNotFoundError(cloneResult.path);
      }

      if (usingExplicitDockerfile) {
        buildLog += `[dockerfile] Using ${config.dockerfilePath as string}\n`;
      } else if (!autoDetected && dockerfileResult?.generated && dockerfileResult.detection) {
        buildLog += `[dockerfile] Auto-generated for ${dockerfileResult.detection.framework} (${dockerfileResult.detection.language})\n`;
      } else if (!autoDetected) {
        buildLog += '[dockerfile] Found Dockerfile\n';
      }

      const allEnvVarsForBuild = {
        ...config.envVars,
        ...this.env.getMergedForDeploy(projectId, environmentId),
      };
      const buildTimeVars = filterBuildTimeVars(allEnvVarsForBuild);
      const buildStart = Date.now();
      let lastBuildOutputEmit = 0;
      let dockerBuildOutput = '';
      this.jobManager?.updatePhase(projectId, 'building');
      await this.buildExecutor.build(
        {
          clonePath: cloneResult.path,
          projectId,
          imageTag,
          dockerfilePath: config.dockerfilePath,
          buildArgs: buildTimeVars,
          noCache: config._noCacheBuild === true,
          buildContext: config.buildContext,
          dockerTarget: config.dockerTarget,
        },
        (line) => {
          dockerBuildOutput += line + '\n';

          const now = Date.now();
          if (now - lastBuildOutputEmit <= 50) return;
          lastBuildOutputEmit = now;

          void eventBus.emit('build:output', {
            projectId,
            line,
            stream: 'stdout',
          });
        },
      );
      if (dockerBuildOutput) {
        buildLog += '--- Docker build output ---\n' + dockerBuildOutput;
      }
      const buildDuration = Date.now() - buildStart;

      await eventBus.emit('deploy:build', {
        projectId,
        imageTag,
        durationMs: buildDuration,
      });

      buildLog += `[build] ${imageTag} (${String(buildDuration)}ms)\n`;

      // Step 4: docker run
      const containerPort = parseDockerfileExposePort(dockerfilePath) ?? undefined;
      const envVars = {
        ...config.envVars,
        ...this.env.getMergedForDeploy(projectId, environmentId),
      };

      this.jobManager?.updatePhase(projectId, 'starting');
      const secretFilesMounts = this.env.getSecretFilesForDeploy(projectId);
      const runResult = await this.containerRunner.run({
        imageTag,
        projectName,
        containerName: routeName,
        projectId,
        environmentType: environment.type,
        environmentId,
        preferredPort: config._preferredPort,
        containerPort,
        envVars,
        secretFiles: secretFilesMounts,
      });
      const { containerId, port, url: internalUrl } = runResult;

      await eventBus.emit('deploy:run', {
        projectId,
        containerId,
        port,
        url: internalUrl,
      });

      buildLog += `[run] ${containerId.slice(0, 12)} on port ${String(port)}\n`;

      // Step 4b: Post-deploy health check — detect crash loops before marking as running
      const healthResult = await this.docker.waitForHealthy(containerId, 20000);

      await eventBus.emit('monitor:healthcheck', {
        projectId,
        healthy: healthResult.healthy,
        responseTimeMs: 0,
      });

      if (!healthResult.healthy) {
        const containerLogs = await this.docker
          .getLogs(containerId, 50)
          .catch(() => '(no logs available)');
        log.error(
          { projectId, error: healthResult.error, exitCode: healthResult.exitCode },
          'Container crashed after deploy',
        );

        this.db.updateEnvironment(environmentId, {
          status: 'error',
          assignedPort: port,
          containerId,
          imageTag,
        });

        if (shouldSyncProjectState) {
          this.db.updateProject(projectId, {
            status: 'error',
            assignedPort: port,
            containerId,
            imageTag,
            visibility: config.visibility ?? 'internal',
          });
        }

        await eventBus.emit('deploy:crash', {
          projectId,
          containerId,
          error: healthResult.error,
          exitCode: healthResult.exitCode,
        });

        throw new Error(
          `Container crashed after start: ${healthResult.error ?? 'unknown'}\n\nContainer logs:\n${containerLogs}`,
        );
      }

      this.db.updateEnvironment(environmentId, {
        status: 'running',
        assignedPort: port,
        containerId,
        imageTag,
        previousImageTag: environment.image_tag,
      });

      if (shouldSyncProjectState) {
        this.db.updateProject(projectId, {
          status: 'running',
          assignedPort: port,
          containerId,
          imageTag,
          previousImageTag: project.image_tag,
          visibility: config.visibility ?? 'internal',
        });
      }

      // Merge env vars into DB (preserves previously set vars)
      if (config.envVars) {
        if (shouldSyncProjectState) {
          this.db.mergeEnvVars(projectId, config.envVars);
        } else {
          this.db.mergeEnvVars(projectId, config.envVars, environmentId);
        }
      }

      // Step 5: Expose publicly if requested
      let publicUrl: string | undefined;
      if (config.visibility === 'quick-share' && shouldSyncProjectState) {
        publicUrl = await this.exposeTunnel(projectId, port);
        buildLog += `[tunnel] ${publicUrl}\n`;
      }

      const totalDuration = Date.now() - startTime;

      // Record deploy log
      this.db.createDeployLog({
        id: nanoid(12),
        projectId,
        environmentId,
        status: 'success',
        trigger,
        commitSha: cloneResult.commitSha,
        buildLog,
        durationMs: totalDuration,
      });

      await eventBus.emit('deploy:success', {
        projectId,
        url: publicUrl ?? internalUrl,
        totalDurationMs: totalDuration,
      });

      this.jobManager?.updatePhase(projectId, 'done');
      return {
        success: true,
        projectId,
        projectName,
        containerId,
        url: internalUrl,
        publicUrl,
        port,
        commitSha: cloneResult.commitSha,
        buildDurationMs: totalDuration,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const failStep = this.detectFailStep(buildLog);
      const buildLogWithError = buildLog + `[error] ${errorMsg}\n`;
      const retryCount = config._retryCount ?? 0;
      this.jobManager?.updatePhase(projectId, 'failed', errorMsg);

      try {
        const recovery = new BuildRecovery(this.docker, this.db, eventBus);
        const recoveryOrchestrator = new RecoveryOrchestrator(this.buildDebugger);
        const action = await recoveryOrchestrator.handleBuildFailure({
          projectId,
          projectName,
          imageTag,
          clonePath,
          buildLogWithError,
          failedStep: failStep,
          retryCount,
          buildRecovery: recovery,
          emit: async <T extends 'build:inform' | 'build:dockerfile-fixed' | 'build:suggest'>(
            eventName: T,
            payload: EventPayload[T],
          ) => {
            await eventBus.emit(eventName, payload);
          },
        });

        if (action.type === 'retry') {
          const retryConfig: ProjectConfig = {
            ...config,
            repoUrl,
            name: projectName,
            _projectId: projectId,
            _retryCount: action.retryCount,
          };
          if (action.noCacheBuild) {
            retryConfig._noCacheBuild = true;
          }

          buildLog += `${action.logMessage}\n`;
          return await this.deployEnvironment(projectId, environmentId, retryConfig);
        }
      } catch (recoveryError) {
        log.warn(
          { err: recoveryError, projectId },
          'Build recovery failed; falling back to default error flow',
        );
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
      const buildLogTail = logLines.slice(-30).join('\n');

      this.jobManager?.updatePhase(projectId, 'failed', errorMsg, buildLogTail);

      return {
        success: false,
        projectId,
        projectName,
        error: errorMsg,
        buildLogTail,
        buildDurationMs: Date.now() - startTime,
      };
    }
  }

  async deployMonorepo(config: MonorepoConfig): Promise<MonorepoResult> {
    const startTime = Date.now();
    const parentName = config.name ?? extractProjectName(config.repoUrl);
    const trigger = config.trigger ?? 'chat';

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

    const orchestration = await orchestrator.executeOrdered(topology, {
      deployService: async (service) => {
        const dockerfilePath = service.dockerfile;
        const childName = `${parentName}/${service.name}`;
        const childId = nanoid(12);
        const imageTag = `openlander/${childName.replace('/', '-')}:latest`;
        const childStartTime = Date.now();

        this.db.createProject({
          id: childId,
          name: childName,
          repoUrl: config.repoUrl,
          branch: config.branch,
          parentProjectId: parentId,
          dockerfilePath,
        });
        this.db.updateProject(childId, { status: 'building' });
        this.jobManager?.trackJob(childId, childName);

        await eventBus.emit('deploy:start', {
          projectId: childId,
          parentProjectId: parentId,
          repoUrl: config.repoUrl,
          phase: 'build',
          scope: service.name,
          status: 'in_progress',
          message: `[${service.name}] Starting service deployment`,
        });

        if (!dockerfilePath) {
          const noDockerfileError = `Service ${service.name} has no Dockerfile path`;
          await eventBus.emit('deploy:failed', {
            projectId: childId,
            parentProjectId: parentId,
            step: 'dockerfile',
            error: noDockerfileError,
            phase: 'build',
            scope: service.name,
            status: 'failed',
            message: `[${service.name}] ${noDockerfileError}`,
          });
          const failed: DeployResult = {
            success: false,
            projectId: childId,
            projectName: childName,
            error: noDockerfileError,
            buildDurationMs: Date.now() - childStartTime,
          };
          resultByService.set(service.name, failed);
          return {
            success: false,
            projectId: childId,
            error: failed.error,
          };
        }

        try {
          this.jobManager?.updatePhase(childId, 'building');
          const envVars = {
            ...config.envVars,
            ...service.envVars,
            ...this.env.getMergedForDeploy(childId),
          };
          const buildTimeVarsForChild = filterBuildTimeVars(envVars);
          let lastBuildOutputEmit = 0;
          await this.buildExecutor.build(
            {
              clonePath: config.clonePath,
              projectId: childId,
              imageTag,
              dockerfilePath,
              buildArgs: buildTimeVarsForChild,
            },
            (line) => {
              const now = Date.now();
              if (now - lastBuildOutputEmit <= 50) return;
              lastBuildOutputEmit = now;

              void eventBus.emit('build:output', {
                projectId: childId,
                parentProjectId: parentId,
                line,
                stream: 'stdout',
                phase: 'build',
                scope: service.name,
                status: 'in_progress',
                message: line,
                logChunk: line,
              });
            },
          );

          await eventBus.emit('deploy:build', {
            projectId: childId,
            parentProjectId: parentId,
            imageTag,
            durationMs: Date.now() - childStartTime,
            phase: 'build',
            scope: service.name,
            status: 'success',
            message: `[${service.name}] Docker image built`,
          });

          this.jobManager?.updatePhase(childId, 'starting');
          const childDockerfilePath = join(config.clonePath, dockerfilePath);
          const childContainerPort = parseDockerfileExposePort(childDockerfilePath) ?? undefined;
          const runResult = await this.containerRunner.run({
            imageTag,
            projectName: childName.replace('/', '-'),
            containerName: childName.replace('/', '-'),
            projectId: childId,
            containerPort: childContainerPort,
            envVars,
            secretFiles: this.env.getSecretFilesForDeploy(childId),
          });
          const { containerId, port, url: internalUrl } = runResult;

          await eventBus.emit('deploy:run', {
            projectId: childId,
            parentProjectId: parentId,
            containerId,
            port,
            url: internalUrl,
            phase: 'run',
            scope: service.name,
            status: 'success',
            message: `[${service.name}] Service running on port ${String(port)}`,
          });

          this.db.updateProject(childId, {
            status: 'running',
            assignedPort: port,
            containerId,
            imageTag,
            visibility: config.visibility ?? 'internal',
          });

          this.db.createDeployLog({
            id: nanoid(12),
            projectId: childId,
            status: 'success',
            trigger,
            commitSha: config.commitSha,
            buildLog: `[monorepo] ${dockerfilePath} → ${imageTag}\n`,
            durationMs: Date.now() - childStartTime,
          });

          this.jobManager?.updatePhase(childId, 'done');

          await eventBus.emit('deploy:success', {
            projectId: childId,
            parentProjectId: parentId,
            url: internalUrl,
            totalDurationMs: Date.now() - childStartTime,
            phase: 'complete',
            scope: service.name,
            status: 'success',
            message: `[${service.name}] Service deploy complete`,
          });

          const successResult: DeployResult = {
            success: true,
            projectId: childId,
            projectName: childName,
            containerId,
            url: internalUrl,
            port,
            commitSha: config.commitSha,
            buildDurationMs: Date.now() - childStartTime,
          };
          resultByService.set(service.name, successResult);
          return {
            success: true,
            projectId: childId,
            url: internalUrl,
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.db.updateProject(childId, { status: 'error' });
          this.jobManager?.updatePhase(childId, 'failed', errorMsg);

          await eventBus.emit('deploy:failed', {
            projectId: childId,
            parentProjectId: parentId,
            step: 'service-deploy',
            error: errorMsg,
            phase: 'build',
            scope: service.name,
            status: 'failed',
            message: `[${service.name}] ${errorMsg}`,
            durationMs: Date.now() - childStartTime,
          });

          this.db.createDeployLog({
            id: nanoid(12),
            projectId: childId,
            status: 'failed',
            trigger,
            buildLog: `[monorepo] ${dockerfilePath} FAILED: ${errorMsg}\n`,
            durationMs: Date.now() - childStartTime,
          });

          const failedResult: DeployResult = {
            success: false,
            projectId: childId,
            projectName: childName,
            error: errorMsg,
            buildDurationMs: Date.now() - childStartTime,
          };
          resultByService.set(service.name, failedResult);

          return {
            success: false,
            projectId: childId,
            error: errorMsg,
          };
        }
      },
      rollbackService: async (service) => {
        if (!service.projectId) {
          return;
        }
        const project = this.db.getProject(service.projectId);
        if (!project) {
          return;
        }

        if (project.container_id) {
          try {
            await this.docker.stopContainer(project.container_id);
            await this.docker.removeContainer(project.container_id);
          } catch (error) {
            log.warn(
              { err: error, service: service.name },
              'Monorepo rollback container cleanup failed',
            );
          }
        }

        this.db.updateProject(service.projectId, {
          status: 'error',
          containerId: null,
          assignedPort: null,
        });

        this.jobManager?.updatePhase(
          service.projectId,
          'failed',
          'Rolled back due to dependency deployment failure',
        );

        this.db.createDeployLog({
          id: nanoid(12),
          projectId: service.projectId,
          status: 'failed',
          trigger,
          buildLog: `[monorepo] ${service.name} ROLLED_BACK: dependency deployment failure\n`,
          durationMs: Date.now() - startTime,
        });
      },
    });

    const orchestrationByService = new Map(
      orchestration.services.map((service) => [service.name, service]),
    );
    const childResults = services.map((service) => {
      const result = resultByService.get(service.name);
      const orchestrationStatus = orchestrationByService.get(service.name);
      const projectName = `${parentName}/${service.name}`;

      if (!result) {
        return {
          success: false,
          projectId: '',
          projectName,
          error: orchestrationStatus?.error ?? 'Service did not produce a deploy result',
          buildDurationMs: Date.now() - startTime,
        };
      }

      if (orchestrationStatus?.status === 'rolled_back') {
        return {
          ...result,
          success: false,
          error: result.error ?? 'Rolled back due to dependency deployment failure',
        };
      }

      if (orchestrationStatus?.status === 'skipped') {
        return {
          ...result,
          success: false,
          error: result.error ?? 'Skipped due to dependency deployment failure',
        };
      }

      return result;
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

    if (project.image_tag) {
      this.db.updateProject(projectId, { previousImageTag: project.image_tag });
    }

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

    return this.deploy({
      repoUrl: project.repo_url ?? '',
      branch: project.branch,
      name: project.name,
      visibility: project.visibility,
      dockerTarget: project.docker_target ?? undefined,
      dockerfilePath:
        project.dockerfile_path !== 'Dockerfile' ? project.dockerfile_path : undefined,
      _projectId: projectId,
      _preferredPort: previousPort,
      _noCacheBuild: options?.noCache === true,
    });
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
