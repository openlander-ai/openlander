import type { Database, ProjectRow, ServiceRow } from '../db/index.js';
import { projectIdToDeployableServiceId } from '../db/service-ids.js';
import { isDockerNotFoundError } from '../errors.js';
import type { EventBus } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';
import type { Docker } from '../pipeline/docker.js';
import type { ProjectStateManager } from './project-state-manager.js';

const log = createModuleLogger('container-state-reconciler');

const DEFAULT_INTERVAL_MS = 30_000;
const MISSING_CONTAINER_SUGGESTION = 'Run restart_service to redeploy.';
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

type DeployableByProject = Map<string, ServiceRow | undefined>;

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
      const [projects, services] = await Promise.all([
        this.db.listProjects(),
        this.db.listServices(),
      ]);
      const deployablesByProject = this.buildDeployablesByProject(projects, services);

      await this.detectMissingContainers(projects, deployablesByProject);
      await this.detectOrphanContainers(projects, services, deployablesByProject);
      await this.timeoutStuckRecovering(deployablesByProject);
    } finally {
      this.reconciling = false;
    }
  }

  private buildDeployablesByProject(
    projects: readonly ProjectRow[],
    services: readonly ServiceRow[],
  ): DeployableByProject {
    const deployableIds = new Set(
      projects.map((project) => projectIdToDeployableServiceId(project.id)),
    );
    const deployablesByProject: DeployableByProject = new Map();
    for (const service of services) {
      if (!deployableIds.has(service.id)) continue;
      deployablesByProject.set(service.project_id, service);
    }
    return deployablesByProject;
  }

  private async detectMissingContainers(
    allProjects: readonly ProjectRow[],
    deployablesByProject: DeployableByProject,
  ): Promise<void> {
    const projects = allProjects.filter((project) => {
      const d = deployablesByProject.get(project.id);
      const containerRef = d?.container_id ?? d?.container_name ?? project.container_id;
      const status = d?.status ?? project.status;
      return Boolean(containerRef) && RECONCILE_ELIGIBLE_STATUSES.has(status);
    });

    for (const project of projects) {
      const d = deployablesByProject.get(project.id);
      const containerRef = d?.container_id ?? d?.container_name ?? project.container_id;
      if (!containerRef) {
        continue;
      }

      try {
        await this.docker.inspectContainer(containerRef);
      } catch (error) {
        if (!isDockerNotFoundError(error)) {
          log.debug(
            { err: error, containerRef, projectId: project.id },
            'Failed to inspect container during reconciliation',
          );
          continue;
        }

        await this.events.emit('container:missing', {
          projectId: project.id,
          projectName: project.name,
          containerId: containerRef,
          suggestion: MISSING_CONTAINER_SUGGESTION,
        });

        if (this.stateManager) {
          await this.stateManager.transition(project.id, 'stopped', 'container-missing');
        }

        log.warn(
          { err: error, containerRef, projectId: project.id },
          'Detected project container missing from Docker',
        );
      }
    }
  }

  private async timeoutStuckRecovering(deployablesByProject: DeployableByProject): Promise<void> {
    if (!this.stateManager) return;
    const now = Date.now();
    const recovering = await this.db.listProjects('recovering');
    for (const project of recovering) {
      // PR 4.5: canonical-first read of recovering_started_at with `??` fallback.
      const deployable = deployablesByProject.get(project.id);
      const recoveringStartedAt =
        deployable?.recovering_started_at ?? project.recovering_started_at;
      if (!recoveringStartedAt) continue;
      const elapsed = now - new Date(recoveringStartedAt).getTime();
      if (elapsed < RECOVERING_TIMEOUT_MS) continue;

      if (typeof this.db.cleanExpiredDeployLocks === 'function') {
        await this.db.cleanExpiredDeployLocks();
      }

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

  private async detectOrphanContainers(
    projects: readonly ProjectRow[],
    services: readonly ServiceRow[],
    deployablesByProject: DeployableByProject,
  ): Promise<void> {
    try {
      const containers = await this.docker.listAllContainers();

      const knownContainerRefs = new Set<string>();
      for (const project of projects) {
        // PR 4.5: canonical-first read of container_id with `??` fallback.
        const deployable = deployablesByProject.get(project.id);
        const containerId = deployable?.container_id ?? project.container_id;
        const containerName = deployable?.container_name;
        if (containerId) {
          knownContainerRefs.add(containerId);
        }
        if (containerName) {
          knownContainerRefs.add(containerName);
        }
      }

      for (const service of services) {
        if (service.container_id) {
          knownContainerRefs.add(service.container_id);
        }
        if (service.container_name) {
          knownContainerRefs.add(service.container_name);
        }
      }

      const orphans = containers.filter((container) => {
        const isOpenLanderContainer =
          container.name.startsWith('ol-') || container.name.startsWith('openlander');
        return (
          isOpenLanderContainer &&
          !knownContainerRefs.has(container.id) &&
          !knownContainerRefs.has(container.name)
        );
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
