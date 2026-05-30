/**
 * RecoveryPolicy — single source of truth for recovery eligibility and stage execution.
 *
 * Three recovery entry points (RecoveryCoordinator.checkEligibility,
 * RecoveryCoordinator.shouldContinue, OpsRecovery.runRecoverySequence) used to
 * evaluate the same invariants differently. This module unifies them so the same
 * trigger-aware policy is applied everywhere, and provides a stage wrapper that
 * automatically emits a `recovery:degraded` event when a stage throws.
 *
 * Background: 1.0 GA blockers U-P0-2 (partial-failure visibility) and U-P0-4
 * (deploy lock vs recovery race) — see docs/launchpad/qa-1.0-ga-fix-plan-2026-04-20.md
 */

import type { Database, ProjectRow } from '../db/index.js';
import { loadServiceViewRecord } from '../db/views/service-view.js';
import type { EventBus } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('recovery-policy');

/** Default staleness threshold for deploy locks (30 minutes). */
export const DEFAULT_LOCK_STALE_MS = 1_800_000;

/** Why recovery was (or was not) allowed for a given trigger. */
export type EligibilityReason =
  | 'eligible'
  | 'project_not_found'
  | 'archived'
  | 'stopped'
  | 'recovering_in_progress'
  | 'circuit_breaker_open'
  | 'global_budget_exceeded'
  | 'deploy_in_progress'
  | 'partial_failure_state_transition';

/** Recovery entry point asking the policy. */
export type RecoveryTrigger =
  | 'deploy_failed' // RecoveryCoordinator.handleDeployFailed
  | 'container_failure' // handleContainerFailure (container:die / oom / missing)
  | 'health_degraded' // handleHealthDegraded
  | 'continue_check' // shouldContinue (recovery already running, may we proceed?)
  | 'ops_sequence'; // OpsRecovery.runRecoverySequence read-only check

/** Result of an eligibility check. */
export interface RecoveryEligibilityResult {
  eligible: boolean;
  reason: EligibilityReason;
  /** Short message safe to surface to UI/logs. */
  message?: string;
}

/**
 * Minimal shape of a project row consumed by the policy.
 * Keeps the dependency narrow so tests don't have to mock the whole ProjectRow.
 */
export interface RecoveryProjectSnapshot {
  id?: string;
  name?: string;
  status?: string | null;
  archived_at: string | null;
  deploy_lock_session: string | null;
  deploy_lock_at: string | null;
}

/** External signals the policy needs in order to decide. */
export interface RecoveryEligibilityContext {
  db: Pick<Database, 'getProject' | 'getDeployableForProject'>;
  /** Optional — when omitted the circuit-breaker invariant is skipped. */
  isCircuitBreakerOpen?: (projectId: string) => boolean | Promise<boolean>;
  /** Optional — when omitted the global-budget invariant is skipped. */
  isGlobalBudgetExceeded?: () => boolean;
  /** Lock staleness threshold in ms. Defaults to {@link DEFAULT_LOCK_STALE_MS}. */
  lockStaleMs?: number;
}

/**
 * Single source of truth for recovery eligibility. Every recovery entry point
 * MUST call this function so the same invariants apply everywhere.
 */
export async function checkRecoveryEligibility(
  projectId: string,
  trigger: RecoveryTrigger,
  ctx: RecoveryEligibilityContext,
): Promise<RecoveryEligibilityResult> {
  const lockStaleMs = ctx.lockStaleMs ?? DEFAULT_LOCK_STALE_MS;

  let project: RecoveryProjectSnapshot | undefined;
  try {
    project = await ctx.db.getProject(projectId);
  } catch (err) {
    // Treat DB lookup failure as "project not found" — caller will emit
    // recovery:blocked rather than starting a recovery on unknown state.
    log.warn({ err, projectId, trigger }, 'Recovery eligibility lookup failed');
    return {
      eligible: false,
      reason: 'project_not_found',
      message: 'Project state lookup failed',
    };
  }

  if (!project) {
    return { eligible: false, reason: 'project_not_found' };
  }

  if (project.archived_at) {
    return {
      eligible: false,
      reason: 'archived',
      message: 'Project is archived',
    };
  }

  const status = (await loadServiceViewRecord(ctx.db, project as ProjectRow)).view.status;
  const statusMessage = status === 'idle' ? 'unknown' : status;

  if (status === 'stopped') {
    return {
      eligible: false,
      reason: 'stopped',
      message: 'Project is stopped',
    };
  }

  // Deploy-lock invariant — applies to every trigger uniformly.
  // Stale locks (older than lockStaleMs) are treated as expired and do NOT block.
  if (project.deploy_lock_session) {
    const isStale = isLockStale(project.deploy_lock_at, lockStaleMs);
    if (!isStale) {
      return {
        eligible: false,
        reason: 'deploy_in_progress',
        message: 'Deploy lock is held by another process',
      };
    }
  }

  // continue_check is invoked while recovery is already running — `recovering`
  // status is the expected state, not a blocker.
  if (trigger === 'continue_check') {
    if (status !== 'running' && status !== 'recovering') {
      return {
        eligible: false,
        reason: 'recovering_in_progress',
        message: `Project is in status ${statusMessage}, cannot continue recovery`,
      };
    }
  }

  // Circuit breaker — Coordinator entry points consult it. OpsRecovery has its
  // own breaker accounting (see RecoveryPipeline.execute) so we skip it there.
  if (trigger !== 'ops_sequence' && ctx.isCircuitBreakerOpen) {
    if (await ctx.isCircuitBreakerOpen(projectId)) {
      return {
        eligible: false,
        reason: 'circuit_breaker_open',
        message: 'Circuit breaker is open',
      };
    }
  }

  // Global LLM budget — OpsRecovery checks at the LLM call site, not here.
  if (trigger !== 'ops_sequence' && ctx.isGlobalBudgetExceeded) {
    if (ctx.isGlobalBudgetExceeded()) {
      return {
        eligible: false,
        reason: 'global_budget_exceeded',
        message: 'Global LLM budget exceeded',
      };
    }
  }

  return { eligible: true, reason: 'eligible' };
}

function isLockStale(lockAt: string | null, lockStaleMs: number): boolean {
  if (!lockAt) {
    // Lock session present but no timestamp — treat as fresh to be safe.
    return false;
  }
  const ts = new Date(lockAt).getTime();
  if (!Number.isFinite(ts)) {
    return false;
  }
  return Date.now() - ts >= lockStaleMs;
}

// ---------------------------------------------------------------------------
// Stage wrapper
// ---------------------------------------------------------------------------

/** Logical stage of a recovery flow — used for partial-failure observability. */
export type RecoveryStage = 'enqueue' | 'transition' | 'emit' | 'execute';

/** Context passed to {@link withRecoveryStage}. */
export interface RecoveryStageContext {
  events: Pick<EventBus, 'emit'>;
  projectId: string;
  /** Optional metadata included in the recovery:degraded event. */
  metadata?: Record<string, unknown>;
}

/** Result of a stage execution. ok:false means caller should NOT proceed to next stage. */
export type RecoveryStageResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; error?: unknown };

/**
 * Wraps a recovery stage. If `fn` throws, emits `recovery:degraded` with stage
 * metadata and returns ok:false. Callers MUST stop executing subsequent stages
 * when ok is false to avoid the partial-failure invariant violation that
 * U-P0-2 was filed for.
 *
 * Failure to emit the event is itself caught and logged — silent swallowing
 * (the U-P0-9/U-P0-10 pattern) is forbidden.
 */
export async function withRecoveryStage<T>(
  stage: RecoveryStage,
  ctx: RecoveryStageContext,
  fn: () => Promise<T>,
): Promise<RecoveryStageResult<T>> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    try {
      await ctx.events.emit('recovery:degraded', {
        stage,
        projectId: ctx.projectId,
        reason,
        metadata: ctx.metadata,
      });
    } catch (emitErr) {
      log.error(
        { err: emitErr, stage, projectId: ctx.projectId, originalReason: reason },
        'Failed to emit recovery:degraded event',
      );
    }

    log.warn({ err: error, stage, projectId: ctx.projectId }, 'Recovery stage failed');
    return { ok: false, reason, error };
  }
}
