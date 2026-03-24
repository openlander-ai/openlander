import { nanoid } from 'nanoid';

import type { Database, EnvironmentRow, ProjectRow } from '../../db/index.js';
import { getPolicy } from '../../config/index.js';
import type { OpenLanderEnv } from '../../config/index.js';
import { eventBus } from '../../events/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { allocatePort } from '../port.js';
import { buildTraefikLabels, getProjectUrl } from '../traefik.js';
import type { Docker } from '../docker.js';
import { getRouteName } from './helpers.js';

const log = createModuleLogger('deploy:rollback');

export interface RollbackResult {
  success: boolean;
  projectId: string;
  projectName: string;
  containerId?: string;
  url?: string;
  port?: number;
  buildDurationMs?: number;
  error?: string;
}

type RollbackTarget =
  | { project: ProjectRow; environment: EnvironmentRow }
  | { project: ProjectRow; environment?: undefined };

export class RollbackExecutor {
  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
  ) {}

  async rollbackToImage(projectId: string, environmentId?: string): Promise<RollbackResult> {
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

    const target = this.resolveTarget(project, environmentId);
    if (!target.success) {
      return target.result;
    }

    const rollbackImageTag = target.target.environment
      ? target.target.environment.previous_image_tag
      : target.target.project.previous_image_tag;

    if (!rollbackImageTag) {
      return {
        success: false,
        projectId,
        projectName: project.name,
        error: 'No previous image available for rollback',
      };
    }

    const currentImageTag = target.target.environment
      ? (target.target.environment.image_tag ?? '')
      : (target.target.project.image_tag ?? '');

    try {
      await this.cleanupRunningContainer(target.target);

      const { port, containerName, environmentType } = await this.resolveContainerRuntime(
        target.target,
      );
      const containerPort = (await this.docker.getImageExposedPort(rollbackImageTag)) ?? port;

      const envType: OpenLanderEnv =
        environmentType === 'development' ? 'development' : 'production';
      const containerId = await this.docker.runContainer({
        imageTag: rollbackImageTag,
        name: containerName,
        port,
        containerPort,
        envVars: this.db.getEnvVars(projectId, target.target.environment?.id),
        traefikLabels: buildTraefikLabels(project.name, containerPort, undefined, envType),
        network: getPolicy(envType).networkName,
      });

      if (target.target.environment) {
        this.db.updateEnvironment(target.target.environment.id, {
          status: 'running',
          containerId,
          imageTag: rollbackImageTag,
          previousImageTag: currentImageTag,
          assignedPort: port,
        });
      } else {
        this.db.updateProject(projectId, {
          status: 'running',
          assignedPort: port,
          containerId,
          imageTag: rollbackImageTag,
          previousImageTag: currentImageTag,
        });
      }

      await eventBus.emit('deploy:rollback', {
        projectId,
        fromImage: currentImageTag,
        toImage: rollbackImageTag,
      });

      const totalDuration = Date.now() - startTime;
      this.db.createDeployLog({
        id: nanoid(12),
        projectId,
        environmentId: target.target.environment?.id,
        status: 'success',
        trigger: 'api',
        commitMessage: undefined,
        buildLog: `[rollback] ${currentImageTag} → ${rollbackImageTag}\n`,
        durationMs: totalDuration,
      });

      if (target.target.environment) {
        return {
          success: true,
          projectId,
          projectName: project.name,
          buildDurationMs: totalDuration,
        };
      }

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

      if (target.target.environment) {
        this.db.updateEnvironment(target.target.environment.id, { status: 'error' });
      } else {
        this.db.updateProject(projectId, { status: 'error' });
      }

      return {
        success: false,
        projectId,
        projectName: project.name,
        error: target.target.environment ? errorMsg : `Rollback failed: ${errorMsg}`,
        buildDurationMs: Date.now() - startTime,
      };
    }
  }

  private resolveTarget(
    project: ProjectRow,
    environmentId?: string,
  ): { success: true; target: RollbackTarget } | { success: false; result: RollbackResult } {
    if (!environmentId) {
      return { success: true, target: { project } };
    }

    const environment = this.db.getEnvironment(environmentId);
    if (!environment || environment.project_id !== project.id) {
      return {
        success: false,
        result: {
          success: false,
          projectId: project.id,
          projectName: project.name,
          error: `Environment not found: ${environmentId}`,
        },
      };
    }

    return { success: true, target: { project, environment } };
  }

  private async cleanupRunningContainer(target: RollbackTarget): Promise<void> {
    const containerId = target.environment
      ? target.environment.container_id
      : target.project.container_id;
    const status = target.environment ? target.environment.status : target.project.status;

    if (!containerId || status !== 'running') {
      return;
    }

    try {
      await this.docker.stopContainer(containerId);
      await this.docker.removeContainer(containerId);
    } catch (err) {
      log.warn({ err, containerId }, 'Container cleanup during rollback failed');
    }
  }

  private async resolveContainerRuntime(
    target: RollbackTarget,
  ): Promise<{ port: number; containerName: string; environmentType?: EnvironmentRow['type'] }> {
    if (!target.environment) {
      return {
        port: await allocatePort(this.db, this.docker, {}, 'production'),
        containerName: `ol-${target.project.name}`,
      };
    }

    const routeName = getRouteName(target.project.name, target.environment.type);
    const port =
      target.environment.assigned_port ??
      (await allocatePort(this.db, this.docker, {}, target.environment.type));

    return {
      port,
      containerName: `ol-${routeName}-${String(Date.now())}`,
      environmentType: target.environment.type,
    };
  }
}
