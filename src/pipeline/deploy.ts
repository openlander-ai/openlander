import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
  ) {}

  async deploy(config: ProjectConfig): Promise<DeployResult> {
    const startTime = Date.now();
    const projectName = config.name ?? extractProjectName(config.repoUrl);
    const projectId = nanoid(12);
    const trigger = config.trigger ?? 'chat';

    // Create project record in DB
    this.db.createProject({
      id: projectId,
      name: projectName,
      repoUrl: config.repoUrl,
      branch: config.branch,
    });

    this.db.updateProject(projectId, { status: 'building' });

    await eventBus.emit('deploy:start', { projectId, repoUrl: config.repoUrl });

    let buildLog = '';

    try {
      // Step 1: git clone
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
      } catch {
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
        } catch {
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
    const project = this.db.getProject(projectId);
    if (!project?.container_id) return;

    await this.docker.stopContainer(project.container_id);
    this.db.updateProject(projectId, { status: 'stopped' });

    // Stop tunnel if exists
    this.closeTunnel(projectId);

    await eventBus.emit('container:stop', { projectId, containerId: project.container_id });
  }

  /** Remove a project entirely. */
  async remove(projectId: string): Promise<void> {
    const project = this.db.getProject(projectId);
    if (!project) return;

    if (project.container_id) {
      try {
        await this.docker.removeContainer(project.container_id);
      } catch {
        // Container might not exist
      }
    }

    this.closeTunnel(projectId);
    this.db.deleteProject(projectId);

    await eventBus.emit('container:remove', {
      projectId,
      containerId: project.container_id ?? '',
    });
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
