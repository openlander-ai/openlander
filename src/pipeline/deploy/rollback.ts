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
type ProjectDeployable = Awaited<ReturnType<Database['getDeployableForProject']>>;

function createFallbackStateManager(db: Database): {
  transition: (
    projectId: string,
    targetStatus: ProjectStatus,
    reason: string,
    options?: StateTransitionOptions,
  ) => Promise<boolean>;
} {
  return {
    async transition(projectId: string, targetStatus: ProjectStatus): Promise<boolean> {
      await db.updateProject(projectId, { status: targetStatus });
      return true;
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
    const project = await this.db.getProject(projectId);
    if (!project) {
      return {
        success: false,
        projectId,
        projectName: 'unknown',
        error: `Project not found: ${projectId}`,
      };
    }

    const target = await this.resolveTarget(project, environmentId);
    if (!target.success) {
      return target.result;
    }

    const productionEnvironment =
      target.target.environment ??
      (await this.db.getEnvironmentsByProject(projectId)).find(
        (environment) => environment.type === 'production',
      );

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

      const projectDeployable = await this.db.getDeployableForProject(projectId);
      const { port, containerName } = await this.resolveContainerRuntime(
        target.target,
        productionEnvironment,
        projectDeployable,
      );
      await this.cleanupRunningContainer(
        target.target,
        productionEnvironment,
        projectDeployable,
        containerName,
      );
      const containerPort = (await this.docker.getImageExposedPort(rollbackImageTag)) ?? port;

      const envType: OpenLanderEnv = 'production';

      const resourceLimits = await loadResourceLimitsForProject(this.db, projectId);

      const containerId = await this.docker.runContainer({
        imageTag: rollbackImageTag,
        name: containerName,
        port,
        containerPort,
        envVars: await this.db.getEnvVars(projectId, productionEnvironment?.id),
        traefikLabels: buildTraefikLabels(project.name, containerPort, undefined, envType),
        network: getPolicy(envType).networkName,
        resourceLimits: resourceLimits ?? undefined,
      });

      await this.stateManager.transition(projectId, 'running', 'deploy-success');
      await this.db.updateProject(projectId, {
        assignedPort: port,
        containerPort,
        containerId,
        imageTag: rollbackImageTag,
        previousImageTag: currentImageTag,
      });

      if (productionEnvironment) {
        await this.db.updateEnvironment(productionEnvironment.id, {
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
      await this.db.createDeployLog({
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
        await this.db.updateEnvironment(productionEnvironment.id, { status: 'error' });
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

  private async resolveTarget(
    project: ProjectRow,
    environmentId?: string,
  ): Promise<
    { success: true; target: RollbackTarget } | { success: false; result: RollbackResult }
  > {
    if (!environmentId) {
      return { success: true, target: { project } };
    }

    const environment = await this.db.getEnvironment(environmentId);
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

  private async cleanupRunningContainer(
    target: RollbackTarget,
    productionEnvironment: EnvironmentRow | undefined,
    projectDeployable: ProjectDeployable,
    containerName: string,
  ): Promise<void> {
    const refs = new Set<string>();
    const runningRefs = new Set<string>();
    const addRef = (
      containerId: string | null | undefined,
      status: string | null | undefined,
    ): void => {
      if (!containerId) return;
      refs.add(containerId);
      if (status === 'running') {
        runningRefs.add(containerId);
      }
    };

    addRef(target.environment?.container_id, target.environment?.status);
    addRef(productionEnvironment?.container_id, productionEnvironment?.status);
    addRef(projectDeployable?.container_id, projectDeployable?.status);

    // Docker rejects a new container when the old canonical name still exists,
    // even if metadata no longer points at its container id.
    refs.add(containerName);

    for (const ref of refs) {
      if (runningRefs.has(ref)) {
        try {
          await this.docker.stopContainer(ref);
        } catch (err) {
          if (!isDockerNotFoundError(err)) {
            log.warn({ err, containerId: ref }, 'Container stop during rollback cleanup failed');
          }
        }
      }
      await this.docker.safeRemoveContainer(ref);
    }
  }

  private async resolveContainerRuntime(
    target: RollbackTarget,
    productionEnvironment: EnvironmentRow | undefined,
    projectDeployable: ProjectDeployable,
  ): Promise<{ port: number; containerName: string }> {
    const environment = target.environment ?? productionEnvironment;
    const routeName = getRouteName(target.project.name, environment?.type);
    const port =
      environment?.assigned_port ??
      projectDeployable?.assigned_port ??
      (await allocatePort(this.db, this.docker, {}, 'production'));

    return {
      port,
      containerName: projectContainerName(routeName),
    };
  }
}
