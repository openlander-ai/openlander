import { createModuleLogger } from '../../lib/logger.js';
import { getRouteName } from './helpers.js';
import { containerName as projectContainerName } from '../helpers.js';

import type { Database } from '../../db/index.js';
import { eventBus } from '../../events/index.js';
import { ContainerNotFoundError, OpenLanderError } from '../../errors.js';
import type { ProjectStatus, StateTransitionOptions } from '../../monitor/project-state-manager.js';
import type { Docker } from '../docker.js';
import { allocatePort, clearPortScanCache } from '../port.js';
import { SHARED_NETWORK_NAME } from '../../config/index.js';
import type { TunnelManager } from './tunnel.js';

const log = createModuleLogger('deploy:lifecycle');

export interface CoordinatorSuppressor {
  suppressProject(projectId: string, durationMs: number): void;
}

interface ProjectStateTransitioner {
  transition: (
    projectId: string,
    targetStatus: ProjectStatus,
    reason: string,
    options?: StateTransitionOptions,
  ) => Promise<boolean>;
}

function createFallbackStateManager(db: Database): ProjectStateTransitioner {
  return {
    transition(projectId: string, targetStatus: ProjectStatus): Promise<boolean> {
      db.updateProject(projectId, { status: targetStatus });
      return Promise.resolve(true);
    },
  };
}

export class ContainerLifecycle {
  private readonly stateManager: ProjectStateTransitioner;

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    stateManagerOrCoordinator?: ProjectStateTransitioner | CoordinatorSuppressor,
    private readonly coordinator?: CoordinatorSuppressor,
  ) {
    const hasStateManager = Boolean(
      stateManagerOrCoordinator &&
      typeof stateManagerOrCoordinator === 'object' &&
      typeof (stateManagerOrCoordinator as ProjectStateTransitioner).transition === 'function',
    );

    this.stateManager = hasStateManager
      ? (stateManagerOrCoordinator as ProjectStateTransitioner)
      : createFallbackStateManager(db);
    this.coordinator = hasStateManager
      ? coordinator
      : (stateManagerOrCoordinator as CoordinatorSuppressor | undefined);
  }

  async start(projectId: string): Promise<void> {
    // PR 2: switch compose-child lookup from parent_project_id scan to
    // services.parent_service_id via getComposeChildProjects.
    const children = this.db.getComposeChildProjects(projectId);
    const hasChildren = children.length > 0;
    if (children.length > 0) {
      await Promise.all(children.map((child) => this.start(child.id)));
    }

    const project = this.db.getProject(projectId);
    if (!project?.container_id) {
      if (hasChildren) {
        await this.stateManager.transition(projectId, 'running', 'container-healthy');
      }
      return;
    }

    try {
      await this.docker.startContainer(project.container_id);
    } catch (err) {
      if (err instanceof ContainerNotFoundError) {
        log.warn(
          { projectId },
          'Container not found during start — may have been removed externally',
        );
        await this.stateManager.transition(projectId, 'error', 'container-unhealthy');
        for (const env of this.db.getEnvironmentsByProject(projectId)) {
          this.db.updateEnvironment(env.id, { status: 'error' });
        }
        throw new Error(`Container for project ${project.name} no longer exists. Please redeploy.`);
      }
      throw err;
    }

    await this.stateManager.transition(projectId, 'running', 'container-restart-success');
    for (const env of this.db.getEnvironmentsByProject(projectId)) {
      this.db.updateEnvironment(env.id, { status: 'running' });
    }
    await eventBus.emit('container:start', { projectId, containerId: project.container_id });
  }

  async stop(projectId: string): Promise<void> {
    this.coordinator?.suppressProject(projectId, 60_000);

    // PR 2: switch compose-child lookup to services.parent_service_id.
    const children = this.db.getComposeChildProjects(projectId);
    if (children.length > 0) {
      await Promise.all(children.map((child) => this.stop(child.id)));
    }

    const project = this.db.getProject(projectId);
    if (!project?.container_id) {
      await this.stateManager.transition(projectId, 'stopped', 'container-manual-stop');
      await eventBus.emit('container:stop', { projectId, containerId: '' });
      return;
    }

    try {
      await this.docker.stopContainer(project.container_id);
    } catch (err) {
      if (!(err instanceof ContainerNotFoundError)) {
        throw err;
      }
    }

    // Remove container after stop so Docker events can no longer fire for this project
    try {
      await this.docker.removeContainer(project.container_id);
    } catch (err) {
      log.debug({ err, projectId }, 'Stop remove container skipped (already removed)');
    }

    await this.stateManager.transition(projectId, 'stopped', 'container-remove');
    this.db.updateProject(projectId, { containerId: null });
    for (const env of this.db.getEnvironmentsByProject(projectId)) {
      this.db.updateEnvironment(env.id, { status: 'stopped' });
    }
    await eventBus.emit('container:stop', { projectId, containerId: project.container_id });
  }

  async remove(projectId: string, tunnelManager?: TunnelManager): Promise<void> {
    // PR 2: switch compose-child lookup to services.parent_service_id.
    const children = this.db.getComposeChildProjects(projectId);
    if (children.length > 0) {
      await Promise.all(children.map((child) => this.remove(child.id, tunnelManager)));
    }

    const project = this.db.getProject(projectId);
    if (!project) return;

    await this.cleanupProjectContainers(projectId);

    try {
      await this.docker.removeProjectNetwork(project.name);
    } catch (err) {
      log.warn(
        { err, projectId, projectName: project.name },
        'Failed to remove project network (non-fatal)',
      );
    }

    tunnelManager?.close(projectId);
    this.db.deleteProject(projectId);
    await eventBus.emit('container:remove', { projectId, containerId: project.container_id ?? '' });
  }

  async archive(projectId: string, tunnelManager?: TunnelManager): Promise<void> {
    const project = this.db.getProject(projectId);
    if (!project) return;

    this.coordinator?.suppressProject(projectId, 60_000);

    if (project.status === 'building') {
      throw new OpenLanderError(
        'Cannot archive a building project',
        'ARCHIVE_BUILDING_PROJECT',
        400,
        { projectId },
      );
    }

    // PR 2: switch compose-child lookup to services.parent_service_id.
    const children = this.db.getComposeChildProjects(projectId);
    for (const child of children) {
      await this.archive(child.id, tunnelManager);
    }

    // Archive in DB first so if Docker emits a 'die' event during cleanup,
    // the Eligibility Gate will see archived_at and reject recovery
    this.db.archiveProject(projectId);

    if (project.container_id) {
      try {
        await this.docker.stopContainer(project.container_id);
      } catch (err) {
        log.debug({ err, projectId }, 'Archive stop skipped');
      }

      try {
        await this.docker.removeContainer(project.container_id);
      } catch (err) {
        log.debug({ err, projectId }, 'Archive remove container skipped');
      }
    }

    if (project.image_tag) {
      try {
        await this.docker.removeImage(project.image_tag);
      } catch (err) {
        log.debug({ err, projectId, imageTag: project.image_tag }, 'Archive remove image skipped');
      }
    }

    tunnelManager?.close(projectId);
    clearPortScanCache();
    await eventBus.emit('project:archive', { projectId });
  }

  async unarchive(projectId: string): Promise<void> {
    const project = this.db.getProject(projectId);
    if (!project) return;

    this.db.unarchiveProject(projectId);
    const port = await allocatePort(this.db, this.docker, {}, 'production');
    this.db.updateProject(projectId, { assignedPort: port });
    await eventBus.emit('project:unarchive', { projectId, port });
  }

  async cleanupProjectContainers(projectId: string): Promise<void> {
    const project = this.db.getProject(projectId);
    if (!project) return;

    const environments = this.db.getEnvironmentsByProject(projectId);
    const ids = new Set<string>();
    const names = new Set<string>();

    if (project.container_id) ids.add(project.container_id);
    names.add(projectContainerName(project.name));

    const children = this.db.getChildProjects(projectId);
    for (const child of children) {
      if (child.container_id) ids.add(child.container_id);
      names.add(projectContainerName(child.name));
    }

    for (const environment of environments) {
      if (environment.container_id) ids.add(environment.container_id);
      names.add(projectContainerName(getRouteName(project.name, environment.type)));
    }

    const managed =
      typeof this.docker.listManagedContainers === 'function'
        ? await this.docker.listManagedContainers()
        : [];
    const matches = managed.filter(
      (container) => ids.has(container.id) || names.has(container.name),
    );
    const identifiers = new Set<string>();
    const secretNames = new Set<string>();

    for (const container of matches) {
      identifiers.add(container.id);
      secretNames.add(container.name);
    }

    if (identifiers.size === 0) {
      for (const id of ids) identifiers.add(id);
      for (const name of names) identifiers.add(name);
      for (const name of names) secretNames.add(name);
    }

    for (const identifier of identifiers) {
      try {
        await this.docker.disconnectContainerFromNetwork(identifier, SHARED_NETWORK_NAME);
      } catch (err) {
        log.warn({ err, identifier }, 'Network disconnect during cleanup failed');
      }

      try {
        await this.docker.stopContainer(identifier);
      } catch (err) {
        log.warn({ err, identifier }, 'Container stop during cleanup failed');
      }

      try {
        await this.docker.removeContainer(identifier);
      } catch (err) {
        log.warn({ err, identifier }, 'Container removal during cleanup failed');
      }
    }

    if (identifiers.size > 0 && typeof this.docker.listManagedContainers === 'function') {
      const maxAttempts = 5;
      const intervalMs = 200;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const managed = await this.docker.listManagedContainers();
        const remaining = managed.some((c) => ids.has(c.id) || names.has(c.name));
        if (!remaining) break;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    clearPortScanCache();

    for (const name of secretNames) {
      this.docker.cleanupSecretFiles(name);
    }
  }

  async forceCleanConflicts(containerName: string): Promise<void> {
    const managed = await this.docker.listManagedContainers();
    const conflicts = managed.filter((container) => container.name === containerName);

    if (conflicts.length > 0) {
      for (const conflict of conflicts) {
        try {
          await this.docker.disconnectContainerFromNetwork(conflict.id, SHARED_NETWORK_NAME);
        } catch (err) {
          log.debug({ err, container: conflict.name }, 'Conflict network disconnect failed');
        }

        try {
          await this.docker.stopContainer(conflict.id);
        } catch (err) {
          log.debug({ err, container: conflict.name }, 'Conflict stop failed');
        }

        try {
          await this.docker.removeContainer(conflict.id);
        } catch (err) {
          log.debug({ err, container: conflict.name }, 'Conflict removal failed');
        }
      }
      return;
    }

    try {
      await this.docker.disconnectContainerFromNetwork(containerName, SHARED_NETWORK_NAME);
    } catch (err) {
      log.debug({ err, container: containerName }, 'Conflict network disconnect by name failed');
    }

    try {
      await this.docker.stopContainer(containerName);
    } catch (err) {
      log.debug({ err, container: containerName }, 'Conflict stop by name failed');
    }

    try {
      await this.docker.removeContainer(containerName);
    } catch (err) {
      log.debug({ err, container: containerName }, 'Conflict removal by name failed');
    }
  }

  async getLogs(projectId: string, tail = 50): Promise<string> {
    const project = this.db.getProject(projectId);
    if (!project?.container_id) {
      return 'No container running for this project.';
    }

    return this.docker.getLogs(project.container_id, tail);
  }
}
