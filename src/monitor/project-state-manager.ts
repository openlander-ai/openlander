import type { AppContext } from '../app.js';

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
  transition(
    _projectId: string,
    _targetStatus: ProjectStatus,
    _reason: string,
    _options?: StateTransitionOptions,
  ): Promise<boolean> {
    void this.ctx;
    return Promise.reject(new Error('Not implemented — see T7'));
  }

  /**
   * Get current state of a project.
   * @returns ProjectStatus or null if project not found
   */
  getState(_projectId: string): Promise<ProjectStatus | null> {
    return Promise.reject(new Error('Not implemented — see T7'));
  }

  /**
   * Reconcile all active projects: compare Docker state vs DB state.
   * If mismatch found, update DB to match Docker (source of truth).
   * MUST use skipEvents:true to prevent recovery cascade.
   *
   * @returns { reconciled: count, skipped: count }
   */
  reconcileAll(): Promise<{ reconciled: number; skipped: number }> {
    return Promise.reject(new Error('Not implemented — see T7'));
  }

  /**
   * Reconcile a single project.
   * @returns true if reconciliation occurred, false if no change needed
   */
  reconcileOne(_projectId: string): Promise<boolean> {
    return Promise.reject(new Error('Not implemented — see T7'));
  }
}
