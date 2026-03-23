import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('blue-green');

import type { Docker } from './docker.js';
import type { Database } from '../db/index.js';
import type { EnvManager } from './env.js';
import type { EventBus } from '../events/index.js';
import type { JobManager } from './job-manager.js';
import { cloneRepo } from './git.js';
import { allocatePort } from './port.js';
import { buildTraefikLabels, getProjectUrl } from './traefik.js';
import { resolveEnvVars } from './resolve-env.js';

export interface BlueGreenResult {
  success: boolean;
  projectId: string;
  projectName: string;
  /** New container ID after switch */
  containerId?: string;
  /** New image tag */
  imageTag?: string;
  /** New port */
  port?: number;
  /** Total time for blue-green deploy */
  durationMs?: number;
  error?: string;
}

export class BlueGreenDeployer {
  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly env: EnvManager,
    private readonly eventBus: EventBus,
    private readonly jobManager?: JobManager,
  ) {}

  /**
   * Perform a blue-green deployment for an existing project.
   * Steps:
   *   1. Build new image (git pull + docker build)
   *   2. Start new container on a fresh port ("green")
   *   3. Health-check the green container (HTTP GET /, retries)
   *   4. Switch Traefik labels to point to green container
   *   5. Stop and remove the old "blue" container
   *   6. Update DB with new container/port/image
   */
  async deploy(
    projectId: string,
    options?: {
      healthCheckPath?: string;
      healthCheckRetries?: number;
      healthCheckIntervalMs?: number;
    },
  ): Promise<BlueGreenResult> {
    const startTime = Date.now();
    const healthCheckPath = this.normalizeHealthCheckPath(options?.healthCheckPath ?? '/');
    const healthCheckRetries = options?.healthCheckRetries ?? 10;
    const healthCheckIntervalMs = options?.healthCheckIntervalMs ?? 2_000;

    let projectName = 'unknown';
    let imageTag: string | undefined;
    let newPort: number | undefined;
    let greenContainerId: string | undefined;
    let shouldCleanupGreen = false;
    let buildOutput = '';

    try {
      const project = this.db.getProject(projectId);
      if (!project) {
        return {
          success: false,
          projectId,
          projectName,
          error: `Project not found: ${projectId}`,
          durationMs: Date.now() - startTime,
        };
      }

      projectName = project.name;

      if (project.status !== 'running' || !project.container_id) {
        return {
          success: false,
          projectId,
          projectName,
          error: `Project ${projectName} is not running`,
          durationMs: Date.now() - startTime,
        };
      }

      if (!project.repo_url) {
        return {
          success: false,
          projectId,
          projectName,
          error: `Project ${projectName} does not have a repository URL`,
          durationMs: Date.now() - startTime,
        };
      }

      await this.eventBus.emit('deploy:start', {
        projectId,
        repoUrl: project.repo_url,
      });

      this.db.updateProject(projectId, { status: 'building' });

      const cloneResult = await cloneRepo({
        repoUrl: project.repo_url,
        branch: project.branch,
      });

      imageTag = `openlander/${projectName}:${String(Date.now())}`;
      const buildStart = Date.now();
      await this.docker.buildImage(cloneResult.path, imageTag, {
        onProgress: (event) => {
          const line = event.stream?.trimEnd() ?? event.error ?? '';
          if (line) buildOutput += line + '\n';
        },
      });
      const buildDuration = Date.now() - buildStart;
      if (buildOutput) {
        log.debug({ projectName }, 'Blue-green build output:\n%s', buildOutput);
      }

      await this.eventBus.emit('deploy:build', {
        projectId,
        imageTag,
        durationMs: buildDuration,
      });

      newPort = await allocatePort(this.db, this.docker);
      const containerPort = (await this.docker.getImageExposedPort(imageTag)) ?? newPort;
      const envVars = resolveEnvVars({ projectId }, { env: this.env });
      const traefikLabels = buildTraefikLabels(projectName, containerPort);

      greenContainerId = await this.docker.runContainer({
        imageTag,
        name: `ol-${projectName}-green`,
        port: newPort,
        containerPort,
        envVars,
        traefikLabels,
      });
      shouldCleanupGreen = true;

      const routedUrl = getProjectUrl(projectName);
      await this.eventBus.emit('deploy:run', {
        projectId,
        containerId: greenContainerId,
        port: newPort,
        url: routedUrl,
      });

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

      await this.docker.stopContainer(project.container_id);
      await this.docker.removeContainer(project.container_id);

      this.db.updateProject(projectId, {
        status: 'running',
        containerId: greenContainerId,
        assignedPort: newPort,
        imageTag,
        previousImageTag: project.image_tag,
      });

      shouldCleanupGreen = false;
      const durationMs = Date.now() - startTime;

      this.jobManager?.updatePhase(projectId, 'done');
      await this.eventBus.emit('deploy:success', {
        projectId,
        url: routedUrl,
        totalDurationMs: durationMs,
      });

      return {
        success: true,
        projectId,
        projectName,
        containerId: greenContainerId,
        imageTag,
        port: newPort,
        durationMs,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const buildLogWithOutput = buildOutput
        ? `--- Docker build output ---\n${buildOutput}[error] ${errorMsg}\n`
        : `[error] ${errorMsg}\n`;

      this.db.updateProject(projectId, { status: 'error' });
      this.jobManager?.updatePhase(projectId, 'failed', errorMsg);

      await this.eventBus.emit('deploy:failed', {
        projectId,
        step: 'blue-green',
        error: errorMsg,
        buildLog: buildLogWithOutput,
      });

      return {
        success: false,
        projectId,
        projectName,
        imageTag,
        port: newPort,
        durationMs: Date.now() - startTime,
        error: errorMsg,
      };
    } finally {
      if (shouldCleanupGreen && greenContainerId) {
        await this.cleanupContainer(greenContainerId);
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
        // Container not ready yet
      }
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
    return false;
  }

  private normalizeHealthCheckPath(path: string): string {
    return path.startsWith('/') ? path : `/${path}`;
  }

  private async cleanupContainer(containerId: string): Promise<void> {
    try {
      await this.docker.stopContainer(containerId);
    } catch (err) {
      log.warn({ err }, 'Failed to stop green container during cleanup');
      // Container may already be stopped
    }

    try {
      await this.docker.removeContainer(containerId);
    } catch (err) {
      log.warn({ err }, 'Failed to remove green container during cleanup');
      // Container may already be removed
    }
  }
}
