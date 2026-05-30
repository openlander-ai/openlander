import { createModuleLogger } from '../../lib/logger.js';
import { getRouteName } from './helpers.js';
import { containerName as projectContainerName } from '../helpers.js';

import type { Database } from '../../db/index.js';
import type { ServiceRow } from '../../db/types.js';
import { deployableServiceIdToProjectId } from '../../db/service-ids.js';
import {
  loadServiceViewRecord,
  loadServiceViewRecords,
  type ServiceViewRecord,
} from '../../db/views/service-view.js';
import { eventBus } from '../../events/index.js';
import { ContainerNotFoundError, OpenLanderError } from '../../errors.js';
import type { ProjectStatus, StateTransitionOptions } from '../../monitor/project-state-manager.js';
import type { RuntimeBackend } from '../runtime/index.js';
import { allocatePort, clearPortScanCache } from '../port.js';
import { SHARED_NETWORK_NAME } from '../../config/index.js';
import type { TunnelManager } from './tunnel.js';

const log = createModuleLogger('deploy:lifecycle');

export interface CoordinatorSuppressor {
  suppressProject(projectId: string, durationMs: number): void;
}

interface ArchiveRuntimeOptions {
  archivedAt?: string;
  emitEvent?: boolean;
}

interface UnarchiveRuntimeOptions {
  emitEvent?: boolean;
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
    async transition(projectId: string, targetStatus: ProjectStatus): Promise<boolean> {
      await db.updateProject(projectId, { status: targetStatus });
      return true;
    },
  };
}

export class ContainerLifecycle {
  private readonly stateManager: ProjectStateTransitioner;

  constructor(
    private readonly runtime: RuntimeBackend,
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
    const children = await this.db.getComposeChildProjects(projectId);
    const hasChildren = children.length > 0;
    if (children.length > 0) {
      await Promise.all(children.map((child) => this.start(child.id)));
    }

    const project = await this.db.getProject(projectId);
    const startContainerId = project
      ? (await loadServiceViewRecord(this.db, project)).view.containerId
      : null;
    if (!project || !startContainerId) {
      if (hasChildren) {
        await this.stateManager.transition(projectId, 'running', 'container-healthy');
      }
      return;
    }

    try {
      await this.runtime.startContainer(startContainerId);
    } catch (err) {
      if (err instanceof ContainerNotFoundError) {
        log.warn(
          { projectId },
          'Container not found during start — may have been removed externally',
        );
        await this.stateManager.transition(projectId, 'error', 'container-unhealthy');
        for (const env of await this.db.getEnvironmentsByProject(projectId)) {
          await this.db.updateEnvironment(env.id, { status: 'error' });
        }
        throw new Error(`Container for project ${project.name} no longer exists. Please redeploy.`);
      }
      throw err;
    }

    await this.stateManager.transition(projectId, 'running', 'container-restart-success');
    for (const env of await this.db.getEnvironmentsByProject(projectId)) {
      await this.db.updateEnvironment(env.id, { status: 'running' });
    }
    await eventBus.emit('container:start', { projectId, containerId: startContainerId });
  }

  async stop(projectId: string): Promise<void> {
    this.coordinator?.suppressProject(projectId, 60_000);

    // PR 2: switch compose-child lookup to services.parent_service_id.
    const children = await this.db.getComposeChildProjects(projectId);
    if (children.length > 0) {
      await Promise.all(children.map((child) => this.stop(child.id)));
    }

    const project = await this.db.getProject(projectId);
    const stopContainerId = project
      ? (await loadServiceViewRecord(this.db, project)).view.containerId
      : null;
    if (!project || !stopContainerId) {
      await this.stateManager.transition(projectId, 'stopped', 'container-manual-stop');
      await eventBus.emit('container:stop', { projectId, containerId: '' });
      return;
    }

    try {
      await this.runtime.stopContainer(stopContainerId);
    } catch (err) {
      if (!(err instanceof ContainerNotFoundError)) {
        throw err;
      }
    }

    // Remove container after stop so Docker events can no longer fire for this project
    try {
      await this.runtime.removeContainer(stopContainerId);
    } catch (err) {
      log.debug({ err, projectId }, 'Stop remove container skipped (already removed)');
    }

    await this.stateManager.transition(projectId, 'stopped', 'container-remove');
    await this.db.updateProject(projectId, { containerId: null });
    for (const env of await this.db.getEnvironmentsByProject(projectId)) {
      await this.db.updateEnvironment(env.id, { status: 'stopped' });
    }
    await eventBus.emit('container:stop', { projectId, containerId: stopContainerId });
  }

  async remove(projectId: string, tunnelManager?: TunnelManager): Promise<void> {
    // PR 2: switch compose-child lookup to services.parent_service_id.
    const children = await this.db.getComposeChildProjects(projectId);
    if (children.length > 0) {
      await Promise.all(children.map((child) => this.remove(child.id, tunnelManager)));
    }

    const project = await this.db.getProject(projectId);
    if (!project) return;

    await this.cleanupProjectContainers(projectId);

    try {
      await this.runtime.removeProjectNetwork(project.name);
    } catch (err) {
      log.warn(
        { err, projectId, projectName: project.name },
        'Failed to remove project network (non-fatal)',
      );
    }

    tunnelManager?.close(projectId);
    const removeContainerId =
      (await loadServiceViewRecord(this.db, project)).view.containerId ?? '';
    await this.db.deleteProject(projectId);
    await eventBus.emit('container:remove', { projectId, containerId: removeContainerId });
  }

  async archive(projectId: string, tunnelManager?: TunnelManager): Promise<void> {
    await this.archiveRuntimeProject(projectId, tunnelManager);
  }

  async archiveGroup(projectId: string, tunnelManager?: TunnelManager): Promise<void> {
    const project = await this.db.getProject(projectId);
    if (!project) return;

    this.coordinator?.suppressProject(projectId, 60_000);
    const deployables = await this.db.getDeployablesByGroup(projectId);
    if (deployables.length === 0) {
      await this.archiveRuntimeProject(projectId, tunnelManager);
      return;
    }

    const activeDeployables = deployables.filter((service) => !service.archived_at);
    if (activeDeployables.length === 0) {
      return;
    }

    for (const service of activeDeployables) {
      await this.assertRuntimeProjectArchivable(deployableServiceIdToProjectId(service.id));
    }

    // Freeze-safe restore-set marker: unarchiveGroup restores only services
    // archived by this operation, leaving previously archived siblings alone.
    const archivedAt = new Date().toISOString();
    for (const service of activeDeployables) {
      const runtimeProjectId = deployableServiceIdToProjectId(service.id);
      this.coordinator?.suppressProject(runtimeProjectId, 60_000);
      await this.archiveRuntimeProject(runtimeProjectId, tunnelManager, {
        archivedAt,
        emitEvent: false,
      });
    }

    await this.db.setProjectArchivedAt(projectId, archivedAt);
    clearPortScanCache();
    await eventBus.emit('project:archive', { projectId });
  }

  private async assertRuntimeProjectArchivable(
    projectId: string,
    options: { allowMissing?: boolean } = {},
  ): Promise<ServiceViewRecord | null> {
    const project = await this.db.getProject(projectId);
    if (!project) {
      if (options.allowMissing) return null;
      throw new OpenLanderError('Project not found', 'PROJECT_NOT_FOUND', 404, { projectId });
    }

    const record = await loadServiceViewRecord(this.db, project);
    const archiveStatus = record.view.status;

    if (archiveStatus === 'building') {
      throw new OpenLanderError(
        'Cannot archive a building project',
        'ARCHIVE_BUILDING_PROJECT',
        400,
        { projectId },
      );
    }

    const environments = await this.db.getEnvironmentsByProject(projectId);
    if (environments.some((environment) => environment.status === 'building')) {
      throw new OpenLanderError(
        'Cannot archive a building project',
        'ARCHIVE_BUILDING_PROJECT',
        400,
        { projectId },
      );
    }

    return record;
  }

  private async archiveRuntimeProject(
    projectId: string,
    tunnelManager?: TunnelManager,
    options: ArchiveRuntimeOptions = {},
  ): Promise<void> {
    const archiveState = await this.assertRuntimeProjectArchivable(projectId, {
      allowMissing: true,
    });
    if (!archiveState) return;
    const { service, view } = archiveState;
    const emitEvent = options.emitEvent ?? true;

    const archiveContainerId = view.containerId;
    const archiveImageTag = view.imageTag;

    // PR 2: switch compose-child lookup to services.parent_service_id.
    const children = await this.db.getComposeChildProjects(projectId);
    for (const child of children) {
      await this.archiveRuntimeProject(child.id, tunnelManager, options);
    }

    // Archive in DB first so if Docker emits a 'die' event during cleanup,
    // the Eligibility Gate will see archived_at and reject recovery
    await this.db.archiveProject(projectId, options.archivedAt);
    if (options.archivedAt === undefined) {
      await this.clearPartialGroupArchiveMarkerAfterRuntimeArchive(service ?? undefined);
    }

    if (archiveContainerId) {
      try {
        await this.runtime.stopContainer(archiveContainerId);
      } catch (err) {
        log.debug({ err, projectId }, 'Archive stop skipped');
      }

      try {
        await this.runtime.removeContainer(archiveContainerId);
      } catch (err) {
        log.debug({ err, projectId }, 'Archive remove container skipped');
      }
    }

    if (archiveImageTag) {
      try {
        await this.runtime.removeImage(archiveImageTag);
      } catch (err) {
        log.debug({ err, projectId, imageTag: archiveImageTag }, 'Archive remove image skipped');
      }
    }

    tunnelManager?.close(projectId);
    clearPortScanCache();
    if (emitEvent) {
      await eventBus.emit('project:archive', { projectId });
    }
  }

  private async clearPartialGroupArchiveMarkerAfterRuntimeArchive(
    deployable: ServiceRow | undefined,
  ): Promise<void> {
    if (!deployable?.project_id) return;
    const groupId = deployable.project_id;
    if (groupId !== deployableServiceIdToProjectId(deployable.id)) return;

    const deployables = await this.db.getDeployablesByGroup(groupId);
    if (deployables.length <= 1) return;

    const hasActiveSibling = deployables.some(
      (service) => service.id !== deployable.id && !service.archived_at,
    );
    if (hasActiveSibling) {
      await this.db.setProjectArchivedAt(groupId, null);
    }
  }

  async unarchive(projectId: string): Promise<void> {
    await this.unarchiveRuntimeProject(projectId);
  }

  async unarchiveGroup(projectId: string): Promise<void> {
    const project = await this.db.getProject(projectId);
    if (!project) return;

    const deployables = await this.db.getDeployablesByGroup(projectId);
    if (deployables.length === 0) {
      await this.unarchiveRuntimeProject(projectId);
      return;
    }

    const restoreMarker = project.archived_at;
    if (!restoreMarker) return;

    const restoreServices = deployables.filter((service) => service.archived_at === restoreMarker);
    for (const service of restoreServices) {
      await this.unarchiveRuntimeProject(deployableServiceIdToProjectId(service.id));
    }

    await this.db.setProjectArchivedAt(projectId, null);
    clearPortScanCache();
  }

  private async unarchiveRuntimeProject(
    projectId: string,
    options: UnarchiveRuntimeOptions = {},
  ): Promise<void> {
    const project = await this.db.getProject(projectId);
    if (!project) return;

    const record = await loadServiceViewRecord(this.db, project);
    if (!project.archived_at && !record.service?.archived_at) return;

    await this.db.unarchiveProject(projectId);
    const port = await allocatePort(this.db, this.runtime, {}, 'production');
    await this.db.updateProject(projectId, { assignedPort: port });
    if (options.emitEvent ?? true) {
      await eventBus.emit('project:unarchive', { projectId, port });
    }
  }

  async cleanupProjectContainers(projectId: string): Promise<void> {
    const project = await this.db.getProject(projectId);
    if (!project) return;

    const environments = await this.db.getEnvironmentsByProject(projectId);
    const ids = new Set<string>();
    const names = new Set<string>();

    const cleanupContainerId = (await loadServiceViewRecord(this.db, project)).view.containerId;
    if (cleanupContainerId) ids.add(cleanupContainerId);
    names.add(projectContainerName(project.name));

    const children = await this.db.getChildProjects(projectId);
    const childRecords = await loadServiceViewRecords(this.db, children);
    for (const child of children) {
      const childContainerId = childRecords.get(child.id)?.view.containerId ?? null;
      if (childContainerId) ids.add(childContainerId);
      names.add(projectContainerName(child.name));
    }

    for (const environment of environments) {
      if (environment.container_id) ids.add(environment.container_id);
      names.add(projectContainerName(getRouteName(project.name, environment.type)));
    }

    const managed =
      typeof this.runtime.listManagedContainers === 'function'
        ? await this.runtime.listManagedContainers()
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
        await this.runtime.disconnectContainerFromNetwork(identifier, SHARED_NETWORK_NAME);
      } catch (err) {
        log.warn({ err, identifier }, 'Network disconnect during cleanup failed');
      }

      try {
        await this.runtime.stopContainer(identifier);
      } catch (err) {
        log.warn({ err, identifier }, 'Container stop during cleanup failed');
      }

      try {
        await this.runtime.removeContainer(identifier);
      } catch (err) {
        log.warn({ err, identifier }, 'Container removal during cleanup failed');
      }
    }

    if (identifiers.size > 0 && typeof this.runtime.listManagedContainers === 'function') {
      const maxAttempts = 5;
      const intervalMs = 200;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const managed = await this.runtime.listManagedContainers();
        const remaining = managed.some((c) => ids.has(c.id) || names.has(c.name));
        if (!remaining) break;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    clearPortScanCache();

    for (const name of secretNames) {
      this.runtime.cleanupSecretFiles(name);
    }
  }

  async forceCleanConflicts(containerName: string): Promise<void> {
    const managed = await this.runtime.listManagedContainers();
    const conflicts = managed.filter((container) => container.name === containerName);

    if (conflicts.length > 0) {
      for (const conflict of conflicts) {
        try {
          await this.runtime.disconnectContainerFromNetwork(conflict.id, SHARED_NETWORK_NAME);
        } catch (err) {
          log.debug({ err, container: conflict.name }, 'Conflict network disconnect failed');
        }

        try {
          await this.runtime.stopContainer(conflict.id);
        } catch (err) {
          log.debug({ err, container: conflict.name }, 'Conflict stop failed');
        }

        try {
          await this.runtime.removeContainer(conflict.id);
        } catch (err) {
          log.debug({ err, container: conflict.name }, 'Conflict removal failed');
        }
      }
      return;
    }

    try {
      await this.runtime.disconnectContainerFromNetwork(containerName, SHARED_NETWORK_NAME);
    } catch (err) {
      log.debug({ err, container: containerName }, 'Conflict network disconnect by name failed');
    }

    try {
      await this.runtime.stopContainer(containerName);
    } catch (err) {
      log.debug({ err, container: containerName }, 'Conflict stop by name failed');
    }

    try {
      await this.runtime.removeContainer(containerName);
    } catch (err) {
      log.debug({ err, container: containerName }, 'Conflict removal by name failed');
    }
  }

  async getLogs(projectId: string, tail = 50, opts?: { timestamps?: boolean }): Promise<string> {
    const project = await this.db.getProject(projectId);
    if (!project) {
      return 'No container running for this project.';
    }
    const logsContainerId = (await loadServiceViewRecord(this.db, project)).view.containerId;
    if (!logsContainerId) {
      return 'No container running for this project.';
    }

    return opts
      ? this.runtime.getLogs(logsContainerId, tail, opts)
      : this.runtime.getLogs(logsContainerId, tail);
  }
}
