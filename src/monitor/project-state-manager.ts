import { DOCKER_LABELS } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';
import type { ContainerInfo } from '../pipeline/docker/types.js';
import type { AppContext } from '../app.js';

const log = createModuleLogger('project-state-manager');

/**
 * ProjectStatus — unified type for project state machine.
 * Extracted from ProjectRow.status in src/db/types.ts.
 * Schema: src/db/schema.drizzle.ts:20-22
 */
export type ProjectStatus = 'stopped' | 'building' | 'running' | 'recovering' | 'error' | 'failed';

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
  building: ['running', 'failed', 'error'],
  running: ['recovering', 'stopped', 'building'],
  recovering: ['running', 'error'],
  error: ['building', 'stopped', 'recovering'],
  failed: ['building', 'stopped'],
};

/**
 * Reconciliation-only transitions (skipEvents:true required).
 * Used by ContainerStateReconciler to sync DB state with Docker reality.
 */
export const RECONCILIATION_TRANSITIONS: ProjectStatus[] = ['running', 'stopped'];

type PersistedProjectStatus = Exclude<ProjectStatus, 'failed'>;

/**
 * ProjectStateManager — centralized state machine for project lifecycle.
 *
 * Responsibilities:
 * - Validate state transitions against VALID_TRANSITIONS
 * - Persist transitions to DB (project.status)
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
    const currentStatus = await this.getState(projectId);
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

    this.ctx.db.updateProject(projectId, { status: persistedStatus });

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
  getState(projectId: string): Promise<ProjectStatus | null> {
    const project = this.ctx.db.getProject(projectId);
    return Promise.resolve((project?.status as ProjectStatus | undefined) ?? null);
  }

  /**
   * Reconcile all active projects: compare Docker state vs DB state.
   * If mismatch found, update DB to match Docker (source of truth).
   * MUST use skipEvents:true to prevent recovery cascade.
   *
   * @returns { reconciled: count, skipped: count }
   */
  async reconcileAll(): Promise<{ reconciled: number; skipped: number }> {
    const containers = await this.ctx.docker.listManagedContainers();
    const containerIndex = this.buildContainerIndex(containers);
    const projects = this.ctx.db.listProjects();

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
    const project = this.ctx.db.getProject(projectId);
    if (!project || project.archived_at !== null) {
      return false;
    }

    const container = this.findProjectContainer(
      project.id,
      project.name,
      project.container_id,
      containers,
    );
    const dockerRunning = container?.status === 'running';

    if (dockerRunning && project.status !== 'running') {
      return this.transition(project.id, 'running', 'docker reconciliation: container is running', {
        skipEvents: true,
      });
    }

    if (!container && project.status === 'running') {
      return this.transition(project.id, 'stopped', 'docker reconciliation: container missing', {
        skipEvents: true,
      });
    }

    return false;
  }

  private buildContainerIndex(containers: ContainerInfo[]): Map<string, ContainerInfo> {
    const index = new Map<string, ContainerInfo>();

    for (const container of containers) {
      index.set(`id:${container.id}`, container);

      const labeledProject = container.labels?.[DOCKER_LABELS.PROJECT];
      if (labeledProject) {
        index.set(`project:${labeledProject}`, container);
      }
    }

    return index;
  }

  private findProjectContainer(
    projectId: string,
    projectName: string,
    containerId: string | null,
    containers: Map<string, ContainerInfo>,
  ): ContainerInfo | undefined {
    if (containerId) {
      const byId = containers.get(`id:${containerId}`);
      if (byId) {
        return byId;
      }
    }

    return containers.get(`project:${projectName}`) ?? containers.get(`project:${projectId}`);
  }

  private toPersistedStatus(status: ProjectStatus): PersistedProjectStatus | null {
    if (status === 'failed') {
      return null;
    }

    return status;
  }
}
