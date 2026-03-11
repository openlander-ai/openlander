import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('deploy');

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { nanoid } from 'nanoid';

import type { Docker } from './docker.js';
import type { CloudflareTunnelManager } from './cloudflare.js';
import { cloneRepo } from './git.js';
import { allocatePort, scanUsedPorts } from './port.js';
import { buildTraefikLabels, getProjectUrl } from './traefik.js';
import { CloudflareTunnel } from './tunnel.js';
import { BuildRecovery, type BuildContext } from './build-recovery.js';
import { DeployOrchestrator, type ServiceNode } from './orchestrator.js';
import type { Database } from '../db/index.js';
import { eventBus } from '../events/index.js';
import { ContainerNotFoundError, DockerfileNotFoundError, PreflightCheckError } from '../errors.js';
import { detectFramework, ensureDockerfile, parseDockerfileExposePort } from './dockerfile-gen.js';
import { preflightCheckOrThrow } from './preflight.js';
import { detectNewEnvKeys } from './env-inject.js';
import { filterBuildTimeVars, injectBuildArgs } from './build-args.js';
import { analyzeBuildDiff, formatDiffForPrompt } from './diff-analysis.js';
import { scanForSecrets } from './secret-scan.js';
import type { JobManager } from './job-manager.js';
import type { ComposePipeline } from './compose.js';
import type { AutoDetector } from './auto-detect.js';
import type { EnvManager } from './env.js';
import type { BuildDebugger } from '../agent/debugger.js';

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
  /** @internal Pre-allocated project ID from startDeploy(). Do not set manually. */
  _projectId?: string;
  _retryCount?: number;
  _noCacheBuild?: boolean;
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

export interface StartDeployResult {
  projectId: string;
  projectName: string;
  status: 'building' | 'preflight_failed';
  preflightWarnings?: string[];
  preflightError?: string;
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
  private tunnels = new Map<string, CloudflareTunnel>();

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly env: EnvManager,
    private readonly jobManager?: JobManager,
    private readonly composePipeline?: ComposePipeline,
    private readonly autoDetector?: AutoDetector,
    private readonly buildDebugger?: BuildDebugger,
  ) {
    // Cleanup stale quick-share/shared tunnel state from previous process
    this.cleanupStaleTunnels();
  }

  /**
   * On startup, any project with quick-share/shared visibility has a dead tunnel
   * (the cloudflared child process doesn't survive restarts). Reset to internal.
   */
  private cleanupStaleTunnels(): void {
    const projects = this.db.listProjects();
    for (const project of projects) {
      if (project.visibility === 'quick-share' || project.visibility === 'shared') {
        log.info({ projectId: project.id, name: project.name }, 'Clearing stale tunnel state');
        this.db.updateProject(project.id, {
          visibility: 'internal',
          publicUrl: null,
        });
      }
    }
  }

  /**
   * Start a deployment in the background (non-blocking).
   * Runs preflight check first and returns immediately if it fails.
   */
  async startDeploy(config: ProjectConfig): Promise<StartDeployResult> {
    const projectName = config.name ?? extractProjectName(config.repoUrl);
    const projectId = nanoid(12);

    // Run preflight check first (before creating project record)
    try {
      await preflightCheckOrThrow(this.db, this.docker, projectName);
    } catch (error) {
      if (error instanceof PreflightCheckError) {
        return {
          projectId,
          projectName,
          status: 'preflight_failed',
          preflightError: error.message,
          preflightWarnings: error.result.warnings,
        };
      }
      throw error;
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
    const parentName = config.clonePath.split('/').pop() ?? extractProjectName(config.repoUrl);
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
    const startTime = Date.now();
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
    }

    await eventBus.emit('deploy:start', { projectId, repoUrl: config.repoUrl });

    let buildLog = '';
    let clonePath = '';
    let diffContext: string | undefined;
    const imageTag = `openlander/${projectName}:latest`;

    try {
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
              buildDurationMs: Date.now() - startTime,
            };
          }
          throw error;
        }
      }

      // Step 1: git clone
      const cloneResult = await cloneRepo({
        repoUrl: config.repoUrl,
        branch: config.branch,
        sshKeyPath: config.sshKeyPath,
      });
      clonePath = cloneResult.path;

      await eventBus.emit('deploy:clone', {
        projectId,
        path: cloneResult.path,
        commitSha: cloneResult.commitSha,
      });

      buildLog += `[clone] ${config.repoUrl} @ ${cloneResult.commitSha.slice(0, 8)}\n`;

      const previousDeploy = this.db.getLastDeployLog(projectId);
      const previousSha = previousDeploy?.commit_sha;

      if (config._projectId && previousSha && previousSha !== cloneResult.commitSha) {
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

      if (config._projectId) {
        const storedVars = this.env.getAll(config._projectId);
        const storedKeys = Object.keys(storedVars);
        const detection = detectNewEnvKeys(cloneResult.path, storedKeys);

        if (detection) {
          const project = this.db.getProject(config._projectId);
          await eventBus.emit('env:new-keys-detected', {
            projectId: config._projectId,
            projectName: project?.name ?? config._projectId,
            newKeys: detection.newKeys,
            templateFile: detection.templateFile,
          });
        }
      }

      const secretFindings = scanForSecrets(cloneResult.path);
      if (secretFindings.length > 0) {
        const project = this.db.getProject(projectId);
        await eventBus.emit('secret:detected', {
          projectId,
          projectName: project?.name ?? projectName,
          secrets: secretFindings,
        });
      }

      const composePath = this.composePipeline?.detectComposeFile(cloneResult.path);
      const composeEnvVars = {
        ...(config.envVars ?? {}),
        ...this.env.getMergedForDeploy(projectId),
      };
      if (composePath && this.composePipeline) {
        log.info({ composePath }, 'Compose file detected — delegating to ComposePipeline');
        const result = await this.composePipeline.deployCompose({
          repoUrl: config.repoUrl,
          branch: config.branch,
          clonePath: cloneResult.path,
          composePath,
          name: projectName,
          trigger: config.trigger,
          envVars: composeEnvVars,
          _parentId: config._projectId,
        });

        return {
          success: result.success,
          projectId: result.parentProjectId,
          projectName: result.parentName,
          buildDurationMs: result.buildDurationMs,
          error: result.error,
        };
      }

      // Step 2: Auto-generate Dockerfile if missing (v0.4)
      const dockerfileResult = ensureDockerfile(cloneResult.path);
      const dockerfilePath = join(cloneResult.path, 'Dockerfile');

      let autoDetected = false;
      if (!dockerfileResult.generated && !existsSync(dockerfilePath)) {
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

      if (!autoDetected && dockerfileResult.generated && dockerfileResult.detection) {
        buildLog += `[dockerfile] Auto-generated for ${dockerfileResult.detection.framework} (${dockerfileResult.detection.language})\n`;
      } else if (!autoDetected) {
        buildLog += '[dockerfile] Found Dockerfile\n';
      }

      // Inject build-time ARGs into Dockerfile before building
      const allEnvVarsForBuild = { ...config.envVars, ...this.env.getMergedForDeploy(projectId) };
      const buildTimeVars = filterBuildTimeVars(allEnvVarsForBuild);
      if (Object.keys(buildTimeVars).length > 0) {
        const dfContent = readFileSync(dockerfilePath, 'utf8');
        writeFileSync(
          dockerfilePath,
          injectBuildArgs(dfContent, Object.keys(buildTimeVars)),
          'utf8',
        );
      }

      // Step 3: docker build
      const buildStart = Date.now();
      let lastBuildOutputEmit = 0;
      let dockerBuildOutput = '';
      this.jobManager?.updatePhase(projectId, 'building');
      await this.docker.buildImage(cloneResult.path, imageTag, {
        noCache: config._noCacheBuild === true,
        buildArgs: buildTimeVars,
        onProgress: (event) => {
          const line = event.stream?.trim() ?? event.error ?? '';
          if (!line) return;

          dockerBuildOutput += line + '\n';

          const now = Date.now();
          if (now - lastBuildOutputEmit <= 50) return;
          lastBuildOutputEmit = now;

          void eventBus.emit('build:output', {
            projectId,
            line,
            stream: event.error ? 'error' : 'stdout',
          });
        },
      });
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
      const port = await allocatePort(this.db, this.docker);
      const containerPort = parseDockerfileExposePort(dockerfilePath) ?? port;
      const envVars = { ...config.envVars, ...this.env.getMergedForDeploy(projectId) };
      const traefikLabels = buildTraefikLabels(projectName, containerPort);

      this.jobManager?.updatePhase(projectId, 'starting');
      const containerId = await this.docker.runContainer({
        imageTag,
        name: `ol-${projectName}`,
        port,
        containerPort,
        envVars,
        traefikLabels,
      });

      const internalUrl = getProjectUrl(projectName);

      await eventBus.emit('deploy:run', {
        projectId,
        containerId,
        port,
        url: internalUrl,
      });

      buildLog += `[run] ${containerId.slice(0, 12)} on port ${String(port)}\n`;

      // Step 4b: Post-deploy health check — detect crash loops before marking as running
      const healthResult = await this.docker.waitForHealthy(containerId, 20000);
      if (!healthResult.healthy) {
        const containerLogs = await this.docker
          .getLogs(containerId, 50)
          .catch(() => '(no logs available)');
        log.error(
          { projectId, error: healthResult.error, exitCode: healthResult.exitCode },
          'Container crashed after deploy',
        );

        // Update DB to reflect actual error state
        this.db.updateProject(projectId, {
          status: 'error',
          assignedPort: port,
          containerId,
          imageTag,
          visibility: config.visibility ?? 'internal',
        });

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

      // Container is healthy — update project in DB
      this.db.updateProject(projectId, {
        status: 'running',
        assignedPort: port,
        containerId,
        imageTag,
        visibility: config.visibility ?? 'internal',
      });

      // Set env vars in DB
      if (config.envVars) {
        this.db.setEnvVarsBulk(projectId, config.envVars);
      }

      // Step 5: Expose publicly if requested
      let publicUrl: string | undefined;
      if (config.visibility === 'quick-share') {
        publicUrl = await this.exposeTunnel(projectId, port);
        buildLog += `[tunnel] ${publicUrl}\n`;
      }

      const totalDuration = Date.now() - startTime;

      // Record deploy log
      this.db.createDeployLog({
        id: nanoid(12),
        projectId,
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
        preflightWarnings,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const failStep = this.detectFailStep(buildLog);
      const buildLogWithError = buildLog + `[error] ${errorMsg}\n`;
      const retryCount = config._retryCount ?? 0;
      this.jobManager?.updatePhase(projectId, 'failed', errorMsg);

      try {
        const recovery = new BuildRecovery(this.docker, this.db, eventBus);
        const failedStep: BuildContext['failedStep'] =
          failStep === 'clone' ||
          failStep === 'dockerfile' ||
          failStep === 'build' ||
          failStep === 'run' ||
          failStep === 'runtime'
            ? failStep
            : 'build';

        const recoveryContext: BuildContext = {
          projectId,
          projectName,
          imageTag,
          clonePath,
          buildLog: buildLogWithError,
          failedStep,
        };

        const classification = recovery.classify(buildLogWithError, recoveryContext);

        if (classification.tier === 1 && classification.autoFixable && retryCount < 2) {
          const fixResult = await recovery.attemptTier1Fix(classification, recoveryContext);

          if (fixResult.fixed && fixResult.retryNeeded) {
            const nextRetryCount = retryCount + 1;
            const retryConfig: ProjectConfig = {
              ...config,
              name: projectName,
              _projectId: projectId,
              _retryCount: nextRetryCount,
            };

            if (classification.category === 'cache-corrupt') {
              retryConfig._noCacheBuild = true;
            }

            buildLog += `[recovery] Tier 1 auto-fix: ${fixResult.action}\n`;
            return await this.deploy(retryConfig);
          }
        }

        // Tier 2.5: Dockerfile content auto-fix loop
        if (classification.tier === 2.5 && classification.autoFixable && retryCount < 3) {
          if (!this.buildDebugger) {
            await eventBus.emit('build:inform', {
              projectId,
              summary: 'Dockerfile error detected but no LLM configured. Fix Dockerfile manually.',
              tier: 3,
            });
          } else if (clonePath) {
            buildLog += '[recovery] Dockerfile content error detected. Attempting fix...\n';

            const dockerfilePath = join(clonePath, 'Dockerfile');
            const currentDockerfile = existsSync(dockerfilePath)
              ? readFileSync(dockerfilePath, 'utf8')
              : 'Not available';

            const fixResult = await this.buildDebugger.fixDockerfile({
              projectPath: clonePath,
              currentDockerfile,
              buildError: buildLogWithError,
              projectName,
            });

            // Write fixed Dockerfile
            writeFileSync(dockerfilePath, fixResult.dockerfileContent + '\n', 'utf8');

            buildLog += `[recovery] Fixed Dockerfile:\n${fixResult.changes.map((c) => `  - ${c}`).join('\n')}\n`;

            // Emit event for timeline display
            await eventBus.emit('build:dockerfile-fixed', {
              projectId,
              changes: fixResult.changes,
              explanation: fixResult.explanation,
              retryCount: retryCount + 1,
            });

            // Retry deploy with fixed Dockerfile
            const nextRetryCount = retryCount + 1;
            const retryConfig: ProjectConfig = {
              ...config,
              name: projectName,
              _projectId: projectId,
              _retryCount: nextRetryCount,
              _noCacheBuild: true,
            };

            return await this.deploy(retryConfig);
          }
        }

        if (
          classification.tier === 2 &&
          classification.suggestible &&
          classification.suggestedAction
        ) {
          await eventBus.emit('build:suggest', {
            projectId,
            suggestion: classification.suggestedAction,
          });
        }

        if (classification.tier === 3) {
          const summary = recovery.extractErrorSummary(buildLogWithError);
          await eventBus.emit('build:inform', { projectId, summary, tier: 3 });
        }
      } catch (recoveryError) {
        log.warn(
          { err: recoveryError, projectId },
          'Build recovery failed; falling back to default error flow',
        );
      }

      this.db.updateProject(projectId, { status: 'error' });

      this.db.createDeployLog({
        id: nanoid(12),
        projectId,
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

      return {
        success: false,
        projectId,
        projectName,
        error: errorMsg,
        buildDurationMs: Date.now() - startTime,
      };
    }
  }

  async deployMonorepo(config: MonorepoConfig): Promise<MonorepoResult> {
    const startTime = Date.now();
    const parentName = config.clonePath.split('/').pop() ?? extractProjectName(config.repoUrl);
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

        if (!dockerfilePath) {
          const failed: DeployResult = {
            success: false,
            projectId: childId,
            projectName: childName,
            error: `Service ${service.name} has no Dockerfile path`,
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
          const contextPath = join(config.clonePath, dirname(dockerfilePath));
          const envVars = {
            ...config.envVars,
            ...service.envVars,
            ...this.env.getMergedForDeploy(childId),
          };
          const buildTimeVarsForChild = filterBuildTimeVars(envVars);
          if (Object.keys(buildTimeVarsForChild).length > 0) {
            const childDfPath = join(config.clonePath, dockerfilePath);
            const dfContent = readFileSync(childDfPath, 'utf8');
            writeFileSync(
              childDfPath,
              injectBuildArgs(dfContent, Object.keys(buildTimeVarsForChild)),
              'utf8',
            );
          }
          await this.docker.buildImage(contextPath, imageTag, { buildArgs: buildTimeVarsForChild });

          this.jobManager?.updatePhase(childId, 'starting');
          const port = await allocatePort(this.db, this.docker);
          const childDockerfilePath = join(config.clonePath, dockerfilePath);
          const childContainerPort = parseDockerfileExposePort(childDockerfilePath) ?? port;
          const traefikLabels = buildTraefikLabels(childName.replace('/', '-'), childContainerPort);

          const containerId = await this.docker.runContainer({
            imageTag,
            name: `ol-${childName.replace('/', '-')}`,
            port,
            containerPort: childContainerPort,
            envVars,
            traefikLabels,
          });

          const internalUrl = getProjectUrl(childName.replace('/', '-'));

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

    return {
      success: allSuccess,
      parentProjectId: parentId,
      parentName,
      children: childResults,
      buildDurationMs: Date.now() - startTime,
    };
  }

  /** Redeploy an existing project (pull latest, rebuild, swap containers). */
  async redeploy(projectId: string): Promise<DeployResult> {
    const project = this.db.getProject(projectId);
    if (!project) {
      return {
        success: false,
        projectId,
        projectName: 'unknown',
        error: `Project not found: ${projectId}`,
      };
    }

    // Stop old container if exists (by ID or by name)
    if (project.container_id) {
      try {
        await this.docker.stopContainer(project.container_id);
        await this.docker.removeContainer(project.container_id);
      } catch (err) {
        log.warn({ err }, 'Container cleanup by ID during redeploy failed');
      }
    }
    // Also try removing by convention name to catch orphans
    try {
      await this.docker.removeContainer(`ol-${project.name}`);
    } catch {
      // Container may not exist — that's fine
    }

    // Save current image for rollback
    if (project.image_tag) {
      this.db.updateProject(projectId, { previousImageTag: project.image_tag });
    }

    // Reset project state for fresh deploy (keep same ID so build/stream listeners work)
    this.db.updateProject(projectId, {
      status: 'building',
      containerId: null,
      imageTag: null,
      assignedPort: null,
    });
    this.jobManager?.trackJob(projectId, project.name);

    return this.deploy({
      repoUrl: project.repo_url ?? '',
      branch: project.branch,
      name: project.name,
      visibility: project.visibility,
      _projectId: projectId,
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
  async rollback(projectId: string): Promise<DeployResult> {
    const startTime = Date.now();
    const project = this.db.getProject(projectId);
    if (!project) {
      return {
        success: false,
        projectId,
        projectName: 'unknown',
        error: `Project not found: ${projectId}`,
      };
    }

    if (!project.previous_image_tag) {
      return {
        success: false,
        projectId,
        projectName: project.name,
        error: 'No previous image available for rollback',
      };
    }

    const rollbackImageTag = project.previous_image_tag;
    const currentImageTag = project.image_tag ?? '';

    try {
      // Stop and remove current container
      if (project.container_id && project.status === 'running') {
        try {
          await this.docker.stopContainer(project.container_id);
          await this.docker.removeContainer(project.container_id);
        } catch (err) {
          log.warn({ err }, 'Container cleanup during rollback failed');
          // Container might already be stopped
        }
      }

      // Allocate a new port and start container with previous image
      const port = await allocatePort(this.db, this.docker);
      const containerPort = (await this.docker.getImageExposedPort(rollbackImageTag)) ?? port;
      const envVars = this.env.getMergedForDeploy(projectId);
      const traefikLabels = buildTraefikLabels(project.name, containerPort);

      const containerId = await this.docker.runContainer({
        imageTag: rollbackImageTag,
        name: `ol-${project.name}`,
        port,
        containerPort,
        envVars,
        traefikLabels,
      });

      // Update DB: swap image tags
      this.db.updateProject(projectId, {
        status: 'running',
        assignedPort: port,
        containerId,
        imageTag: rollbackImageTag,
        previousImageTag: currentImageTag,
      });

      await eventBus.emit('deploy:rollback', {
        projectId,
        fromImage: currentImageTag,
        toImage: rollbackImageTag,
      });

      const totalDuration = Date.now() - startTime;

      // Record deploy log
      const { nanoid } = await import('nanoid');
      this.db.createDeployLog({
        id: nanoid(12),
        projectId,
        status: 'success',
        trigger: 'api',
        buildLog: `[rollback] ${currentImageTag} → ${rollbackImageTag}\n`,
        durationMs: totalDuration,
      });

      return {
        success: true,
        projectId,
        projectName: project.name,
        containerId,
        url: getProjectUrl(project.name),
        port,
        buildDurationMs: totalDuration,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.db.updateProject(projectId, { status: 'error' });

      return {
        success: false,
        projectId,
        projectName: project.name,
        error: `Rollback failed: ${errorMsg}`,
        buildDurationMs: Date.now() - startTime,
      };
    }
  }

  /** Stop a project's container. */
  async stop(projectId: string): Promise<void> {
    const children = this.db.getChildProjects(projectId);
    if (children.length > 0) {
      await Promise.all(children.map((c) => this.stop(c.id)));
      this.db.updateProject(projectId, { status: 'stopped' });
      return;
    }

    const project = this.db.getProject(projectId);
    if (!project?.container_id) return;

    try {
      await this.docker.stopContainer(project.container_id);
    } catch (err) {
      if (err instanceof ContainerNotFoundError) {
        log.debug(
          { projectId },
          'Container not found during stop — may have been removed externally',
        );
      } else {
        throw err;
      }
    }
    this.db.updateProject(projectId, { status: 'stopped' });
    this.closeTunnel(projectId);
    await eventBus.emit('container:stop', { projectId, containerId: project.container_id });
  }

  /** Start a stopped project's container. */
  async start(projectId: string): Promise<void> {
    const children = this.db.getChildProjects(projectId);
    if (children.length > 0) {
      await Promise.all(children.map((c) => this.start(c.id)));
      this.db.updateProject(projectId, { status: 'running' });
      return;
    }

    const project = this.db.getProject(projectId);
    if (!project?.container_id) return;

    try {
      await this.docker.startContainer(project.container_id);
    } catch (err) {
      if (err instanceof ContainerNotFoundError) {
        log.warn(
          { projectId },
          'Container not found during start — may have been removed externally',
        );
        this.db.updateProject(projectId, { status: 'error' });
        throw new Error(`Container for project ${project.name} no longer exists. Please redeploy.`);
      }
      throw err;
    }
    this.db.updateProject(projectId, { status: 'running' });
    await eventBus.emit('container:start', { projectId, containerId: project.container_id });
  }

  /** Remove a project entirely. */
  async remove(projectId: string, cloudflare?: CloudflareTunnelManager): Promise<void> {
    const children = this.db.getChildProjects(projectId);
    if (children.length > 0) {
      await Promise.all(children.map((c) => this.remove(c.id, cloudflare)));
    }

    const project = this.db.getProject(projectId);
    if (!project) return;

    if (project.container_id) {
      try {
        await this.docker.removeContainer(project.container_id);
      } catch (err) {
        log.debug({ err }, 'Container removal during project delete failed — may not exist');
      }
    }

    // Clean up Cloudflare DNS records and tunnel routes for production domains
    if (cloudflare) {
      const domains = this.db.getDomainMappings(projectId);
      for (const mapping of domains) {
        try {
          await cloudflare.removeTunnel(projectId, mapping.domain);
        } catch (err) {
          log.debug(
            { err, domain: mapping.domain },
            'Domain cleanup during project delete failed — may already be removed',
          );
        }
      }
    }

    this.closeTunnel(projectId);
    this.db.deleteProject(projectId);
    await eventBus.emit('container:remove', { projectId, containerId: project.container_id ?? '' });
  }

  /** Create a TryCloudflare tunnel for a project. */
  async exposeTunnel(projectId: string, _port: number): Promise<string> {
    const project = this.db.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const tunnel = new CloudflareTunnel();
    const url = await tunnel.start(project.name);
    this.tunnels.set(projectId, tunnel);

    this.db.updateProject(projectId, {
      visibility: 'quick-share',
      publicUrl: url,
    });

    await eventBus.emit('tunnel:url', { projectId, url });
    return url;
  }

  /** Close a project's tunnel. */
  closeTunnel(projectId: string): void {
    const tunnel = this.tunnels.get(projectId);
    if (tunnel) {
      tunnel.stop();
      this.tunnels.delete(projectId);
      this.db.updateProject(projectId, {
        visibility: 'internal',
        publicUrl: null,
      });
    }
  }

  getTunnel(projectId: string): CloudflareTunnel | undefined {
    return this.tunnels.get(projectId);
  }

  /** Get container logs. */
  async getLogs(projectId: string, lines = 50): Promise<string> {
    const project = this.db.getProject(projectId);
    if (!project?.container_id) {
      return 'No container running for this project.';
    }
    return this.docker.getLogs(project.container_id, lines);
  }

  private detectFailStep(buildLog: string): string {
    if (!buildLog.includes('[clone]')) return 'clone';
    if (!buildLog.includes('[dockerfile]')) return 'dockerfile';
    if (!buildLog.includes('[build]')) return 'build';
    if (!buildLog.includes('[run]')) return 'run';
    // If all steps completed but error still occurred, it's a runtime crash
    if (buildLog.includes('Container crashed after start')) return 'runtime';
    return 'unknown';
  }
}

// --- Helpers ---

/** Extract project name from a repo URL. */
function extractProjectName(repoUrl: string): string {
  // Handle: github.com/user/repo, https://github.com/user/repo.git, git@github.com:user/repo.git
  const cleaned = repoUrl
    .replace(/\.git$/, '')
    .replace(/^(https?:\/\/|git@)/, '')
    .replace(/:/g, '/');

  const parts = cleaned.split('/');
  return parts[parts.length - 1] ?? 'project';
}

function deriveServiceName(dockerfilePath: string): string {
  const dir = dirname(dockerfilePath);
  if (dir === '.' || dir === '') return 'main';
  return dir.split('/')[0] ?? 'service';
}
