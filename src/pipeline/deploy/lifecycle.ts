import { createModuleLogger } from '../../lib/logger.js';
import { getRouteName } from './helpers.js';

import type { Database } from '../../db/index.js';
import { eventBus } from '../../events/index.js';
import { ContainerNotFoundError } from '../../errors.js';
import type { Docker } from '../docker.js';
import { clearPortScanCache } from '../port.js';
import type { TunnelManager } from './tunnel.js';

const log = createModuleLogger('deploy:lifecycle');

export class ContainerLifecycle {
  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
  ) {}

  async start(projectId: string): Promise<void> {
    const children = this.db
      .listProjects()
      .filter((project) => project.parent_project_id === projectId);
    const hasChildren = children.length > 0;
    if (children.length > 0) {
      await Promise.all(children.map((child) => this.start(child.id)));
    }

    const project = this.db.getProject(projectId);
    if (!project?.container_id) {
      if (hasChildren) {
        this.db.updateProject(projectId, { status: 'running' });
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
        this.db.updateProject(projectId, { status: 'error' });
        for (const env of this.db.getEnvironmentsByProject(projectId)) {
          this.db.updateEnvironment(env.id, { status: 'error' });
        }
        throw new Error(`Container for project ${project.name} no longer exists. Please redeploy.`);
      }
      throw err;
    }

    this.db.updateProject(projectId, { status: 'running' });
    for (const env of this.db.getEnvironmentsByProject(projectId)) {
      this.db.updateEnvironment(env.id, { status: 'running' });
    }
    await eventBus.emit('container:start', { projectId, containerId: project.container_id });
  }

  async stop(projectId: string): Promise<void> {
    const children = this.db
      .listProjects()
      .filter((project) => project.parent_project_id === projectId);
    if (children.length > 0) {
      await Promise.all(children.map((child) => this.stop(child.id)));
    }

    const project = this.db.getProject(projectId);
    if (!project?.container_id) {
      this.db.updateProject(projectId, { status: 'stopped' });
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

    this.db.updateProject(projectId, { status: 'stopped' });
    for (const env of this.db.getEnvironmentsByProject(projectId)) {
      this.db.updateEnvironment(env.id, { status: 'stopped' });
    }
    await eventBus.emit('container:stop', { projectId, containerId: project.container_id });
  }

  async remove(projectId: string, tunnelManager?: TunnelManager): Promise<void> {
    const children = this.db
      .listProjects()
      .filter((project) => project.parent_project_id === projectId);
    if (children.length > 0) {
      await Promise.all(children.map((child) => this.remove(child.id, tunnelManager)));
    }

    const project = this.db.getProject(projectId);
    if (!project) return;

    await this.cleanupProjectContainers(projectId);
    tunnelManager?.close(projectId);
    this.db.deleteProject(projectId);
    await eventBus.emit('container:remove', { projectId, containerId: project.container_id ?? '' });
  }

  async cleanupProjectContainers(projectId: string): Promise<void> {
    const project = this.db.getProject(projectId);
    if (!project) return;

    const environments = this.db.getEnvironmentsByProject(projectId);
    const ids = new Set<string>();
    const names = new Set<string>();

    if (project.container_id) ids.add(project.container_id);
    names.add(`ol-${project.name}`);

    const children = this.db.getChildProjects(projectId);
    for (const child of children) {
      if (child.container_id) ids.add(child.container_id);
      names.add(`ol-${child.name}`);
    }

    for (const environment of environments) {
      if (environment.container_id) ids.add(environment.container_id);
      names.add(`ol-${getRouteName(project.name, environment.type)}`);
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
