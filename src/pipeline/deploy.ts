import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('deploy');

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { nanoid } from 'nanoid';

import type { Docker } from './docker.js';
import { cloneRepo } from './git.js';
import { allocatePort } from './port.js';
import { buildTraefikLabels } from './traefik.js';
import { CloudflareTunnel } from './tunnel.js';
import type { Database } from '../db/index.js';
import { eventBus } from '../events/index.js';
import { DockerfileNotFoundError } from '../errors.js';
import { ensureDockerfile } from './dockerfile-gen.js';
import type { JobManager } from './job-manager.js';

/**
 * Project configuration for a deployment.
 */
export interface ProjectConfig {
  /** Repo URL (e.g., github.com/user/repo) */
  repoUrl: string;
  /** Branch to deploy (default: main) */
  branch?: string;
  /** Project name (auto-generated from repo if not provided) */
  name?: string;
  /** Environment variables */
  envVars?: Record<string, string>;
  /** Visibility mode */
  visibility?: 'internal' | 'quick-share' | 'production';
  /** SSH key path for private repos */
  sshKeyPath?: string;
  /** Deployment trigger source */
  trigger?: 'chat' | 'webhook' | 'api';
  /** @internal Pre-allocated project ID from startDeploy(). Do not set manually. */
  _projectId?: string;
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
}

export interface MonorepoConfig {
  repoUrl: string;
  branch?: string;
  clonePath: string;
  commitSha: string;
  dockerfiles: string[];
  envVars?: Record<string, string>;
  visibility?: 'internal' | 'quick-share' | 'production';
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
  status: 'building';
}

export interface StartMonorepoResult {
  parentProjectId: string;
  parentName: string;
  status: 'building';
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
    private readonly jobManager?: JobManager,
  ) {}

  /**
   * Start a deployment in the background (non-blocking).
   * Returns immediately with the project ID. Build runs asynchronously.
   * Use JobManager.getStatus() or the get_deploy_status tool to check progress.
   */
  startDeploy(config: ProjectConfig): StartDeployResult {
    const projectName = config.name ?? extractProjectName(config.repoUrl);
    const projectId = nanoid(12);

    // Create project record NOW so get_deploy_status works immediately
    this.db.createProject({
      id: projectId,
      name: projectName,
      repoUrl: config.repoUrl,
      branch: config.branch,
    });
    this.db.updateProject(projectId, { status: 'building' });
    this.jobManager?.trackJob(projectId, projectName);

    // Fire-and-forget: run the deploy pipeline in background
    // Pass _projectId so deploy() reuses the pre-created record instead of creating a new one
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

    try {
      // Step 1: git clone
      this.jobManager?.updatePhase(projectId, 'cloning');
      const cloneResult = await cloneRepo({
        repoUrl: config.repoUrl,
        branch: config.branch,
        sshKeyPath: config.sshKeyPath,
      });

      await eventBus.emit('deploy:clone', {
        projectId,
        path: cloneResult.path,
        commitSha: cloneResult.commitSha,
      });

      buildLog += `[clone] ${config.repoUrl} @ ${cloneResult.commitSha.slice(0, 8)}\n`;

      // Step 2: Auto-generate Dockerfile if missing (v0.4)
      const dockerfileResult = ensureDockerfile(cloneResult.path);
      const dockerfilePath = join(cloneResult.path, 'Dockerfile');
      if (!existsSync(dockerfilePath)) {
        throw new DockerfileNotFoundError(cloneResult.path);
      }

      if (dockerfileResult.generated && dockerfileResult.detection) {
        buildLog += `[dockerfile] Auto-generated for ${dockerfileResult.detection.framework} (${dockerfileResult.detection.language})\n`;
      } else {
        buildLog += '[dockerfile] Found Dockerfile\n';
      }

      // Step 3: docker build
      const imageTag = `openlander/${projectName}:latest`;
      const buildStart = Date.now();
      this.jobManager?.updatePhase(projectId, 'building');
      await this.docker.buildImage(cloneResult.path, imageTag);
      const buildDuration = Date.now() - buildStart;

      await eventBus.emit('deploy:build', {
        projectId,
        imageTag,
        durationMs: buildDuration,
      });

      buildLog += `[build] ${imageTag} (${String(buildDuration)}ms)\n`;

      // Step 4: docker run
      const port = allocatePort(this.db);
      const envVars = { ...config.envVars, ...this.db.getEnvVars(projectId) };
      const traefikLabels = buildTraefikLabels(projectName, port);

      this.jobManager?.updatePhase(projectId, 'starting');
      const containerId = await this.docker.runContainer({
        imageTag,
        name: `ol-${projectName}`,
        port,
        envVars,
        traefikLabels,
      });

      const internalUrl = `http://${projectName}.localhost`;

      await eventBus.emit('deploy:run', {
        projectId,
        containerId,
        port,
        url: internalUrl,
      });

      buildLog += `[run] ${containerId.slice(0, 12)} on port ${String(port)}\n`;

      // Update project in DB
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
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const failStep = this.detectFailStep(buildLog);
      this.jobManager?.updatePhase(projectId, 'failed', errorMsg);

      this.db.updateProject(projectId, { status: 'error' });

      this.db.createDeployLog({
        id: nanoid(12),
        projectId,
        status: 'failed',
        trigger,
        buildLog: buildLog + `[error] ${errorMsg}\n`,
        durationMs: Date.now() - startTime,
      });

      await eventBus.emit('deploy:failed', {
        projectId,
        step: failStep,
        error: errorMsg,
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

    const childResults = await Promise.all(
      config.dockerfiles.map(async (dockerfilePath): Promise<DeployResult> => {
        const serviceName = deriveServiceName(dockerfilePath);
        const childName = `${parentName}/${serviceName}`;
        const childId = nanoid(12);
        const imageTag = `openlander/${childName.replace('/', '-')}:latest`;

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

        try {
          this.jobManager?.updatePhase(childId, 'building');
          const contextPath = join(config.clonePath, dirname(dockerfilePath));
          await this.docker.buildImage(contextPath, imageTag);

          this.jobManager?.updatePhase(childId, 'starting');
          const port = allocatePort(this.db);
          const envVars = { ...config.envVars, ...this.db.getEnvVars(childId) };
          const traefikLabels = buildTraefikLabels(childName.replace('/', '-'), port);

          const containerId = await this.docker.runContainer({
            imageTag,
            name: `ol-${childName.replace('/', '-')}`,
            port,
            envVars,
            traefikLabels,
          });

          const internalUrl = `http://${childName.replace('/', '-')}.localhost`;

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
            durationMs: Date.now() - startTime,
          });

          this.jobManager?.updatePhase(childId, 'done');

          return {
            success: true,
            projectId: childId,
            projectName: childName,
            containerId,
            url: internalUrl,
            port,
            commitSha: config.commitSha,
            buildDurationMs: Date.now() - startTime,
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
            durationMs: Date.now() - startTime,
          });

          return {
            success: false,
            projectId: childId,
            projectName: childName,
            error: errorMsg,
            buildDurationMs: Date.now() - startTime,
          };
        }
      }),
    );

    const allSuccess = childResults.every((r) => r.success);
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

    // Stop old container if running
    if (project.container_id && project.status === 'running') {
      try {
        await this.docker.stopContainer(project.container_id);
        await this.docker.removeContainer(project.container_id);
      } catch (err) {
        log.warn({ err }, 'Container cleanup during redeploy failed');
        // Container might already be stopped
      }
    }

    // Save current image for rollback
    if (project.image_tag) {
      this.db.updateProject(projectId, { previousImageTag: project.image_tag });
    }

    // Delete the old project record and redeploy
    this.db.deleteProject(projectId);

    return this.deploy({
      repoUrl: project.repo_url ?? '',
      branch: project.branch,
      name: project.name,
      visibility: project.visibility,
    });
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
      const port = allocatePort(this.db);
      const envVars = this.db.getEnvVars(projectId);
      const traefikLabels = buildTraefikLabels(project.name, port);

      const containerId = await this.docker.runContainer({
        imageTag: rollbackImageTag,
        name: `ol-${project.name}`,
        port,
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
        url: `http://${project.name}.localhost`,
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

    await this.docker.stopContainer(project.container_id);
    this.db.updateProject(projectId, { status: 'stopped' });
    this.closeTunnel(projectId);
    await eventBus.emit('container:stop', { projectId, containerId: project.container_id });
  }

  /** Remove a project entirely. */
  async remove(projectId: string): Promise<void> {
    const children = this.db.getChildProjects(projectId);
    if (children.length > 0) {
      await Promise.all(children.map((c) => this.remove(c.id)));
    }

    const project = this.db.getProject(projectId);
    if (!project) return;

    if (project.container_id) {
      try {
        await this.docker.removeContainer(project.container_id);
      } catch (err) {
        log.debug({ err }, 'Container removal during project delete failed — may not exist');
        // Container might not exist
      }
    }

    this.closeTunnel(projectId);
    this.db.deleteProject(projectId);
    await eventBus.emit('container:remove', { projectId, containerId: project.container_id ?? '' });
  }

  /** Create a TryCloudflare tunnel for a project. */
  async exposeTunnel(projectId: string, port: number): Promise<string> {
    const tunnel = new CloudflareTunnel();
    const url = await tunnel.start(port);
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
