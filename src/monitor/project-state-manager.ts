import { DOCKER_LABELS } from '../config/index.js';
import type { EnvironmentRow } from '../db/types.js';
import { loadServiceViewRecord } from '../db/views/service-view.js';
import { createModuleLogger } from '../lib/logger.js';
import type { ContainerInfo } from '../pipeline/docker/types.js';
import type { AppContext } from '../app.js';

const log = createModuleLogger('project-state-manager');

/**
 * ProjectStatus — unified type for project state machine.
 * Extracted from ProjectRow.status in src/db/types.ts.
 * Schema: src/db/schema.drizzle.ts:20-22
 */
export type ProjectStatus = 'stopped' | 'building' | 'running' | 'recovering' | 'error';

/**
 * Options for state transitions.
 * skipEvents: true → reconciliation mode (no EventBus emission, prevents recovery cascade)
 */
export interface StateTransitionOptions {
  skipEvents?: boolean;
}

/**
 * Represents a single state transition event.
 */
export interface StateTransition {
  from: ProjectStatus;
  to: ProjectStatus;
  reason: string;
  timestamp: Date;
  projectId: string;
  options?: StateTransitionOptions;
}

/**
 * Valid state transitions (state machine rules).
 * Reconciliation transitions (ANY → running/stopped) only allowed with skipEvents:true.
 */
export const VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  stopped: ['building'],
  building: ['running', 'error'],
  running: ['recovering', 'stopped', 'building'],
  recovering: ['running', 'error'],
  error: ['building', 'stopped', 'recovering', 'running'],
};

/**
 * Reconciliation-only transitions (skipEvents:true required).
 * Used by ContainerStateReconciler to sync DB state with Docker reality.
 */
export const RECONCILIATION_TRANSITIONS: ProjectStatus[] = ['running', 'stopped'];

type PersistedProjectStatus = ProjectStatus;

/**
 * ProjectStateManager — centralized state machine for project lifecycle.
 *
 * Responsibilities:
 * - Validate state transitions against VALID_TRANSITIONS
 * - Persist transitions to DB (project status field)
 * - Emit state:transition events (unless skipEvents:true)
 * - Reconcile Docker state vs DB state (skipEvents:true, no recovery cascade)
 *
 * Implementation in T7.
 */
export class ProjectStateManager {
  private readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  /**
   * Attempt a state transition.
   * @returns true if transition succeeded, false if rejected (invalid transition)
   * @throws on DB errors
   */
  async transition(
    projectId: string,
    targetStatus: ProjectStatus,
    reason: string,
    options?: StateTransitionOptions,
  ): Promise<boolean> {
    const project = await this.ctx.db.getProject(projectId);
    // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
    const currentStatus = project?.status ?? null;
    if (!currentStatus) {
      return false;
    }

    if (currentStatus === targetStatus) {
      return true;
    }

    const isReconciliation = options?.skipEvents === true;
    const validTargets = VALID_TRANSITIONS[currentStatus];
    const isValidTransition = validTargets.includes(targetStatus);
    const isAllowedReconciliationTarget =
      isReconciliation && RECONCILIATION_TRANSITIONS.includes(targetStatus);

    if (!isValidTransition && !isAllowedReconciliationTarget) {
      log.warn(
        {
          projectId,
          from: currentStatus,
          to: targetStatus,
          reason,
          skipEvents: options?.skipEvents,
        },
        'Invalid state transition rejected',
      );
      return false;
    }

    const persistedStatus = this.toPersistedStatus(targetStatus);
    if (!persistedStatus) {
      log.warn(
        { projectId, to: targetStatus, reason },
        'Non-persistable state transition rejected',
      );
      return false;
    }

    const recoveringUpdate: { recoveringStartedAt?: string | null } =
      persistedStatus === 'recovering'
        ? { recoveringStartedAt: new Date().toISOString() }
        : { recoveringStartedAt: null };

    await this.ctx.db.updateProject(projectId, {
      status: persistedStatus,
      ...recoveringUpdate,
    });

    if (!options?.skipEvents) {
      await this.ctx.eventBus.emit('project:status-changed', {
        projectId,
        from: currentStatus,
        to: targetStatus,
        reason,
      });
    }

    return true;
  }

  /**
   * Get current state of a project.
   * @returns ProjectStatus or null if project not found
   */
  async getState(projectId: string): Promise<ProjectStatus | null> {
    const project = await this.ctx.db.getProject(projectId);
    // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
    return project?.status ?? null;
  }

  /**
   * Reconcile all active projects: compare Docker state vs DB state.
   * If mismatch found, update DB to match Docker (source of truth).
   * MUST use skipEvents:true to prevent recovery cascade.
   *
   * @returns { reconciled: count, skipped: count }
   */
  async reconcileAll(): Promise<{ reconciled: number; skipped: number }> {
    const [containers, projects] = await Promise.all([
      this.ctx.docker.listManagedContainers(),
      this.ctx.db.listRuntimeProjectsForReconciliation(),
    ]);
    const containerIndex = this.buildContainerIndex(containers);

    let reconciled = 0;
    let skipped = 0;

    for (const project of projects) {
      const didReconcile = await this.reconcileProject(project.id, containerIndex);
      if (didReconcile) {
        reconciled += 1;
      } else {
        skipped += 1;
      }
    }

    const runningContainerIds = new Set(
      containers.filter((c) => c.status === 'running').map((c) => c.id),
    );
    const environmentsByProject = await this.ctx.db.getEnvironmentsByProjectIds(
      projects.map((project) => project.id),
    );
    reconciled += await this.reconcileStaleEnvironments(environmentsByProject, runningContainerIds);

    return { reconciled, skipped };
  }

  /**
   * Reconcile a single project.
   * @returns true if reconciliation occurred, false if no change needed
   */
  async reconcileOne(projectId: string): Promise<boolean> {
    const containers = await this.ctx.docker.listManagedContainers();
    return this.reconcileProject(projectId, this.buildContainerIndex(containers));
  }

  private async reconcileProject(
    projectId: string,
    containers: Map<string, ContainerInfo>,
  ): Promise<boolean> {
    const project = await this.ctx.db.getProject(projectId);
    if (!project || project.archived_at !== null) {
      return false;
    }

    const { service: deployable, view } = await loadServiceViewRecord(this.ctx.db, project);
    // Preserve the reconciler's historic probe order:
    // service.container_id → service.container_name → project.container_id.
    // ServiceView.containerId intentionally contains the project fallback.
    const projectContainerRef =
      deployable && !deployable.container_id
        ? (view.containerName ?? view.containerId)
        : (view.containerId ?? view.containerName);
    const projectStatus = view.status;

    const container = this.findProjectContainer(
      project.id,
      project.name,
      projectContainerRef,
      containers,
    );
    const dockerRunning = container?.status === 'running';

    if (dockerRunning && projectStatus !== 'running') {
      return this.transition(project.id, 'running', 'docker reconciliation: container is running', {
        skipEvents: true,
      });
    }

    if (!container && (projectStatus === 'running' || projectStatus === 'building')) {
      return this.transition(project.id, 'stopped', 'docker reconciliation: container missing', {
        skipEvents: true,
      });
    }

    return false;
  }

  private async reconcileStaleEnvironments(
    environmentsByProject: Map<string, EnvironmentRow[]>,
    runningContainerIds: Set<string>,
  ): Promise<number> {
    let count = 0;

    for (const envs of environmentsByProject.values()) {
      for (const env of envs) {
        if (env.status !== 'building') continue;
        const isContainerRunning =
          env.container_id != null && runningContainerIds.has(env.container_id);
        const newStatus = isContainerRunning ? 'running' : 'stopped';
        await this.ctx.db.updateEnvironment(env.id, { status: newStatus });
        count += 1;
        log.info(
          { envId: env.id, type: env.type, from: 'building', to: newStatus },
          'Stale environment status reconciled',
        );
      }
    }

    return count;
  }

  private buildContainerIndex(containers: ContainerInfo[]): Map<string, ContainerInfo> {
    const index = new Map<string, ContainerInfo>();

    for (const container of containers) {
      index.set(`id:${container.id}`, container);

      const labeledProject = container.labels?.[DOCKER_LABELS.PROJECT];
      if (labeledProject) {
        index.set(`project:${labeledProject}`, container);
      }

      index.set(`name:${container.name}`, container);
    }

    return index;
  }

  private findProjectContainer(
    projectId: string,
    projectName: string,
    containerRef: string | null,
    containers: Map<string, ContainerInfo>,
  ): ContainerInfo | undefined {
    if (containerRef) {
      const byId = containers.get(`id:${containerRef}`);
      if (byId) {
        return byId;
      }

      const byName = containers.get(`name:${containerRef}`);
      if (byName) {
        return byName;
      }
    }

    return containers.get(`project:${projectName}`) ?? containers.get(`project:${projectId}`);
  }

  private toPersistedStatus(status: ProjectStatus): PersistedProjectStatus | null {
    return status;
  }
}
