import type { Database, ProjectRow } from '../db/index.js';
import { isDockerNotFoundError } from '../errors.js';
import type { EventBus } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';
import type { Docker } from '../pipeline/docker.js';

const log = createModuleLogger('container-state-reconciler');

const DEFAULT_INTERVAL_MS = 30_000;
const MISSING_CONTAINER_SUGGESTION = 'Run restart_project to redeploy.';
const RECONCILE_ELIGIBLE_STATUSES: ReadonlySet<ProjectRow['status']> = new Set([
  'running',
  'error',
  'recovering',
]);

export class ContainerStateReconciler {
  private intervalId?: ReturnType<typeof setInterval>;
  private orphanCount = 0;
  private reconciling = false;

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly events: EventBus,
    private readonly options: { intervalMs?: number } = {},
  ) {}

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      void this.reconcile();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);

    void this.reconcile();
  }

  stop(): void {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = undefined;
  }

  getOrphanCount(): number {
    return this.orphanCount;
  }

  async reconcile(): Promise<void> {
    if (this.reconciling) {
      return;
    }

    this.reconciling = true;
    try {
      await this.detectMissingContainers();
      await this.detectOrphanContainers();
    } finally {
      this.reconciling = false;
    }
  }

  private async detectMissingContainers(): Promise<void> {
    const projects = this.db.listProjects().filter((project) => {
      return project.container_id !== null && RECONCILE_ELIGIBLE_STATUSES.has(project.status);
    });

    for (const project of projects) {
      const containerId = project.container_id;
      if (!containerId) {
        continue;
      }

      try {
        await this.docker.inspectContainer(containerId);
      } catch (error) {
        if (!isDockerNotFoundError(error)) {
          log.debug(
            { err: error, containerId, projectId: project.id },
            'Failed to inspect container during reconciliation',
          );
          continue;
        }

        await this.events.emit('container:missing', {
          projectId: project.id,
          projectName: project.name,
          containerId,
          suggestion: MISSING_CONTAINER_SUGGESTION,
        });

        log.warn(
          { err: error, containerId, projectId: project.id },
          'Detected project container missing from Docker',
        );
      }
    }
  }

  private async detectOrphanContainers(): Promise<void> {
    try {
      const containers = await this.docker.listAllContainers();
      const projects = this.db.listProjects();
      const services = this.db.listServices();

      const knownContainerIds = new Set<string>();
      for (const project of projects) {
        if (project.container_id) {
          knownContainerIds.add(project.container_id);
        }
      }

      for (const service of services) {
        if (service.container_id) {
          knownContainerIds.add(service.container_id);
        }
      }

      const orphans = containers.filter((container) => {
        const isOpenLanderContainer =
          container.name.startsWith('ol-') || container.name.startsWith('openlander');
        return isOpenLanderContainer && !knownContainerIds.has(container.id);
      });

      this.orphanCount = orphans.length;

      if (orphans.length > 0) {
        log.info(
          {
            count: orphans.length,
            containers: orphans.map((container) => ({
              id: container.id.slice(0, 12),
              name: container.name,
              state: container.state,
            })),
          },
          'Detected orphan OpenLander containers',
        );
      }
    } catch (error) {
      this.orphanCount = 0;
      log.debug({ err: error }, 'Failed to reconcile orphan containers');
    }
  }
}
