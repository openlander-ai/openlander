import { nanoid } from 'nanoid';

import type { Database, EnvironmentRow, ProjectRow } from '../../db/index.js';
import { getPolicy } from '../../config/index.js';
import type { OpenLanderEnv } from '../../config/index.js';
import { eventBus } from '../../events/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { allocatePort } from '../port.js';
import { buildTraefikLabels, getProjectUrl } from '../traefik.js';
import type { Docker } from '../docker.js';
import { loadResourceLimitsForProject } from '../config-snapshot.js';
import { getRouteName } from './helpers.js';
import { containerName as projectContainerName } from '../helpers.js';
import { isDockerNotFoundError } from '../../errors.js';
import type { ProjectStatus, StateTransitionOptions } from '../../monitor/project-state-manager.js';

const log = createModuleLogger('deploy:rollback');

export interface RollbackResult {
  success: boolean;
  projectId: string;
  projectName: string;
  previousImageTag?: string;
  rollbackImageTag?: string;
  containerId?: string;
  url?: string;
  port?: number;
  buildDurationMs?: number;
  error?: string;
}

type RollbackTarget =
  | { project: ProjectRow; environment: EnvironmentRow }
  | { project: ProjectRow; environment?: undefined };

function createFallbackStateManager(db: Database): {
  transition: (
    projectId: string,
    targetStatus: ProjectStatus,
    reason: string,
    options?: StateTransitionOptions,
  ) => Promise<boolean>;
} {
  return {
    transition(projectId: string, targetStatus: ProjectStatus): Promise<boolean> {
      db.updateProject(projectId, { status: targetStatus });
      return Promise.resolve(true);
    },
  };
}

export class RollbackExecutor {
  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    stateManager?: {
      transition: (
        projectId: string,
        targetStatus: ProjectStatus,
        reason: string,
        options?: StateTransitionOptions,
      ) => Promise<boolean>;
    },
  ) {
    this.stateManager = stateManager ?? createFallbackStateManager(db);
  }

  private readonly stateManager: {
    transition: (
      projectId: string,
      targetStatus: ProjectStatus,
      reason: string,
      options?: StateTransitionOptions,
    ) => Promise<boolean>;
  };

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
      await this.docker.inspectImage(rollbackImageTag);
    } catch {
      return {
        success: false,
        projectId,
        projectName: project.name,
        error: 'No previous image available for rollback — the image may have been pruned',
      };
    }

    try {
      await this.stateManager.transition(projectId, 'recovering', 'deploy-started');
      await this.cleanupRunningContainer(target.target);

      const { port, containerName } = await this.resolveContainerRuntime(target.target);
      const containerPort = (await this.docker.getImageExposedPort(rollbackImageTag)) ?? port;

      const envType: OpenLanderEnv = 'production';

      const resourceLimits = loadResourceLimitsForProject(this.db, projectId);

      const containerId = await this.docker.runContainer({
        imageTag: rollbackImageTag,
        name: containerName,
        port,
        containerPort,
        envVars: this.db.getEnvVars(projectId, productionEnvironment?.id),
        traefikLabels: buildTraefikLabels(project.name, containerPort, undefined, envType),
        network: getPolicy(envType).networkName,
        resourceLimits: resourceLimits ?? undefined,
      });

      await this.stateManager.transition(projectId, 'running', 'deploy-success');
      this.db.updateProject(projectId, {
        assignedPort: port,
        containerPort,
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
          containerPort,
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
        previousImageTag: currentImageTag,
        rollbackImageTag,
        containerId,
        url: getProjectUrl(project.name),
        port,
        buildDurationMs: totalDuration,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (isDockerNotFoundError(error)) {
        return {
          success: false,
          projectId,
          projectName: project.name,
          error: 'No previous image available for rollback — the image may have been pruned',
          buildDurationMs: Date.now() - startTime,
        };
      }

      await this.stateManager.transition(projectId, 'error', 'deploy-runtime-error');
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
      await this.docker.safeRemoveContainer(containerId);
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
