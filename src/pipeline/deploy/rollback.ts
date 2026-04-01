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
import { containerName as projectContainerName } from '../helpers.js';

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

    const productionEnvironment =
      target.target.environment ??
      this.db
        .getEnvironmentsByProject(projectId)
        .find((environment) => environment.type === 'production');

    const rollbackImageTag =
      productionEnvironment?.previous_image_tag ?? target.target.project.previous_image_tag;

    if (!rollbackImageTag) {
      return {
        success: false,
        projectId,
        projectName: project.name,
        error: 'No previous image available for rollback',
      };
    }

    const currentImageTag =
      productionEnvironment?.image_tag ?? target.target.project.image_tag ?? '';

    try {
      await this.cleanupRunningContainer(target.target);

      const { port, containerName } = await this.resolveContainerRuntime(target.target);
      const containerPort = (await this.docker.getImageExposedPort(rollbackImageTag)) ?? port;

      const envType: OpenLanderEnv = 'production';
      const containerId = await this.docker.runContainer({
        imageTag: rollbackImageTag,
        name: containerName,
        port,
        containerPort,
        envVars: this.db.getEnvVars(projectId, productionEnvironment?.id),
        traefikLabels: buildTraefikLabels(project.name, containerPort, undefined, envType),
        network: getPolicy(envType).networkName,
      });

      this.db.updateProject(projectId, {
        status: 'running',
        assignedPort: port,
        containerId,
        imageTag: rollbackImageTag,
        previousImageTag: currentImageTag,
      });

      if (productionEnvironment) {
        this.db.updateEnvironment(productionEnvironment.id, {
          status: 'running',
          containerId,
          imageTag: rollbackImageTag,
          previousImageTag: currentImageTag,
          assignedPort: port,
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
        environmentId: productionEnvironment?.id,
        status: 'success',
        trigger: 'api',
        commitMessage: undefined,
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
      if (productionEnvironment) {
        this.db.updateEnvironment(productionEnvironment.id, { status: 'error' });
      }

      return {
        success: false,
        projectId,
        projectName: project.name,
        error: `Rollback failed: ${errorMsg}`,
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
  ): Promise<{ port: number; containerName: string }> {
    const routeName = getRouteName(target.project.name);
    const port =
      target.environment?.assigned_port ??
      target.project.assigned_port ??
      (await allocatePort(this.db, this.docker, {}, 'production'));

    return {
      port,
      containerName: projectContainerName(routeName),
    };
  }
}
