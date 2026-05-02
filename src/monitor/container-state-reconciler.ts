import type { Database, ProjectRow } from '../db/index.js';
import { isDockerNotFoundError } from '../errors.js';
import type { EventBus } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';
import type { Docker } from '../pipeline/docker.js';
import type { ProjectStateManager } from './project-state-manager.js';

const log = createModuleLogger('container-state-reconciler');

const DEFAULT_INTERVAL_MS = 30_000;
const MISSING_CONTAINER_SUGGESTION = 'Run restart_project to redeploy.';
// 1.0 GA: 60 minutes (raised from 30 to reduce false positives on slow
// recoveries that legitimately take >30 min — e.g. large npm install +
// Docker pull + multi-service compose). The watchdog still escapes truly
// stuck rows; we just give legitimate long recoveries more room.
//
// 1.0 GA B3: this timeout is intentionally LONGER than `PROJECT_LOCK_TIMEOUT_MS`
// (15min in `src/llm/agent-pool.ts`) and `cleanExpiredDeployLocks` default
// (15min). The two layers solve different problems: deploy locks gate
// concurrent mutations, the watchdog frees rows that got stuck in the
// `recovering` status field. Recovery itself can legitimately exceed the
// lock TTL when the lock-holder is alive and renewing it.
//
// 1.0.x backlog: make configurable via OpenLanderConfig.ai.recovery.stuckTimeoutMs
// and short-circuit the timeout when an active deploy lock is held for the
// project (lock holder owns the lifecycle).
const RECOVERING_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const RECONCILE_ELIGIBLE_STATUSES: ReadonlySet<ProjectRow['status']> = new Set([
  'running',
  'error',
  'recovering',
]);

const INITIAL_STAGGER_MS = 3_000;

export class ContainerStateReconciler {
  private intervalId?: ReturnType<typeof setInterval>;
  private initialTimerId?: ReturnType<typeof setTimeout>;
  private orphanCount = 0;
  private reconciling = false;
  private stateManager?: ProjectStateManager;

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly events: EventBus,
    private readonly options: { intervalMs?: number } = {},
  ) {}

  setStateManager(sm: ProjectStateManager): void {
    this.stateManager = sm;
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      void this.reconcile();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);

    // Stagger the first reconcile so concurrent monitors don't pile on
    // Docker's API at startup (prevents the listContainers thundering herd).
    this.initialTimerId = setTimeout(() => {
      this.initialTimerId = undefined;
      void this.reconcile();
    }, INITIAL_STAGGER_MS);
  }

  stop(): void {
    if (this.initialTimerId) {
      clearTimeout(this.initialTimerId);
      this.initialTimerId = undefined;
    }

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
      await this.timeoutStuckRecovering();
    } finally {
      this.reconciling = false;
    }
  }

  private async detectMissingContainers(): Promise<void> {
    // PR 4.5: batch-resolve deployables once so canonical-first reads of
    // status/container_id flow through a `??` fallback to legacy `projects`
    // columns until migration 0012 drops them.
    const allProjects = await this.db.listProjects();
    const deployables = new Map<
      string,
      Awaited<ReturnType<typeof this.db.getDeployableForProject>>
    >();
    for (const p of allProjects) {
      deployables.set(p.id, await this.db.getDeployableForProject(p.id));
    }
    const projects = allProjects.filter((project) => {
      const d = deployables.get(project.id);
      const containerId = d?.container_id ?? project.container_id;
      const status = d?.status ?? project.status;
      return Boolean(containerId) && RECONCILE_ELIGIBLE_STATUSES.has(status);
    });

    for (const project of projects) {
      const d = deployables.get(project.id);
      const containerId = d?.container_id ?? project.container_id;
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

        if (this.stateManager) {
          await this.stateManager.transition(project.id, 'stopped', 'container-missing');
        }

        log.warn(
          { err: error, containerId, projectId: project.id },
          'Detected project container missing from Docker',
        );
      }
    }
  }

  private async timeoutStuckRecovering(): Promise<void> {
    if (!this.stateManager) return;
    const now = Date.now();
    const recovering = await this.db.listProjects('recovering');
    for (const project of recovering) {
      // PR 4.5: canonical-first read of recovering_started_at with `??` fallback.
      const deployable = await this.db.getDeployableForProject(project.id);
      const recoveringStartedAt =
        deployable?.recovering_started_at ?? project.recovering_started_at;
      if (!recoveringStartedAt) continue;
      const elapsed = now - new Date(recoveringStartedAt).getTime();
      if (elapsed < RECOVERING_TIMEOUT_MS) continue;

      // 1.0 GA: skip the timeout when a deploy lock is currently held for
      // this project. The lock holder (recovery agent / manual redeploy)
      // owns the lifecycle and may legitimately need more than the watchdog
      // window. acquireDeployLock cleans expired locks itself, so we can
      // trust deploy_lock_session as a live-liveness signal.
      const lockInfo =
        typeof this.db.getDeployLockInfo === 'function'
          ? await this.db.getDeployLockInfo(project.id)
          : null;
      if (lockInfo) {
        log.debug(
          {
            projectId: project.id,
            elapsedMs: elapsed,
            lockSession: lockInfo.session,
          },
          'Recovering project past timeout but deploy lock still held — deferring to lock holder',
        );
        continue;
      }

      log.warn(
        { projectId: project.id, elapsedMs: elapsed },
        'Project stuck in recovering state beyond timeout — transitioning to error',
      );
      await this.stateManager.transition(project.id, 'error', 'recovering-timeout');
      await this.events.emit('project:status-changed', {
        projectId: project.id,
        from: 'recovering',
        to: 'error',
        reason: 'Recovery timed out after 60 minutes',
      });
    }
  }

  private async detectOrphanContainers(): Promise<void> {
    try {
      const containers = await this.docker.listAllContainers();
      const projects = await this.db.listProjects();
      const services = await this.db.listServices();

      const knownContainerIds = new Set<string>();
      for (const project of projects) {
        // PR 4.5: canonical-first read of container_id with `??` fallback.
        const deployable = await this.db.getDeployableForProject(project.id);
        const containerId = deployable?.container_id ?? project.container_id;
        if (containerId) {
          knownContainerIds.add(containerId);
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
