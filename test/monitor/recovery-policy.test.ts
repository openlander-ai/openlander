/**
 * Unit tests for src/monitor/recovery-policy.ts.
 *
 * Validates the trigger × invariant matrix for checkRecoveryEligibility and the
 * partial-failure semantics of withRecoveryStage.
 *
 * Background: 1.0 GA blockers U-P0-2 (partial-failure visibility) and U-P0-4
 * (deploy lock vs recovery race) require a single source of truth for both
 * eligibility decisions and stage-level error observability.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import { EventBus } from '../../src/events/index.js';
import {
  DEFAULT_LOCK_STALE_MS,
  checkRecoveryEligibility,
  withRecoveryStage,
  type RecoveryEligibilityContext,
  type RecoveryProjectSnapshot,
  type RecoveryTrigger,
} from '../../src/monitor/recovery-policy.js';

// Suppress logger output in test runs.
vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<RecoveryProjectSnapshot> = {}): RecoveryProjectSnapshot {
  return {
    id: 'project-1',
    name: 'test-project',
    status: 'running',
    archived_at: null,
    deploy_lock_session: null,
    deploy_lock_at: null,
    ...overrides,
  };
}

function makeCtx(
  project: RecoveryProjectSnapshot | undefined,
  options: {
    isCircuitBreakerOpen?: boolean;
    isGlobalBudgetExceeded?: boolean;
    lockStaleMs?: number;
    throwOnGetProject?: boolean;
  } = {},
): RecoveryEligibilityContext {
  const db = {
    getProject: vi.fn(() => {
      if (options.throwOnGetProject) {
        throw new Error('SQLITE_BUSY: database is locked');
      }
      return project;
    }),
  } as unknown as Pick<Database, 'getProject'>;

  return {
    db,
    isCircuitBreakerOpen: () => Boolean(options.isCircuitBreakerOpen),
    isGlobalBudgetExceeded: () => Boolean(options.isGlobalBudgetExceeded),
    ...(options.lockStaleMs !== undefined ? { lockStaleMs: options.lockStaleMs } : {}),
  };
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const ALL_TRIGGERS: RecoveryTrigger[] = [
  'deploy_failed',
  'container_failure',
  'health_degraded',
  'continue_check',
  'ops_sequence',
];

// ---------------------------------------------------------------------------
// checkRecoveryEligibility — invariant matrix
// ---------------------------------------------------------------------------

describe('checkRecoveryEligibility — invariant matrix', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-04-20T10:00:00.000Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns project_not_found when getProject returns undefined', () => {
    for (const trigger of ALL_TRIGGERS) {
      const ctx = makeCtx(undefined);
      const result = checkRecoveryEligibility('project-1', trigger, ctx);
      expect(result).toEqual(
        expect.objectContaining({ eligible: false, reason: 'project_not_found' }),
      );
    }
  });

  it('returns project_not_found when getProject throws (DB error)', () => {
    for (const trigger of ALL_TRIGGERS) {
      const ctx = makeCtx(makeProject(), { throwOnGetProject: true });
      const result = checkRecoveryEligibility('project-1', trigger, ctx);
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('project_not_found');
    }
  });

  it('blocks every trigger when project is archived', () => {
    for (const trigger of ALL_TRIGGERS) {
      const ctx = makeCtx(makeProject({ archived_at: '2026-04-01T00:00:00Z' }));
      const result = checkRecoveryEligibility('project-1', trigger, ctx);
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('archived');
    }
  });

  it('blocks every trigger when project status is stopped', () => {
    for (const trigger of ALL_TRIGGERS) {
      const ctx = makeCtx(makeProject({ status: 'stopped' }));
      const result = checkRecoveryEligibility('project-1', trigger, ctx);
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('stopped');
    }
  });

  it('blocks every trigger when deploy_lock_session is fresh (within staleness window)', () => {
    for (const trigger of ALL_TRIGGERS) {
      const ctx = makeCtx(
        makeProject({
          deploy_lock_session: 'active-uuid',
          deploy_lock_at: minutesAgo(2),
        }),
      );
      const result = checkRecoveryEligibility('project-1', trigger, ctx);
      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('deploy_in_progress');
    }
  });

  it('allows every trigger when deploy_lock_session is stale (>30 min)', () => {
    for (const trigger of ALL_TRIGGERS) {
      const ctx = makeCtx(
        makeProject({
          deploy_lock_session: 'stale-uuid',
          deploy_lock_at: minutesAgo(31),
        }),
      );
      const result = checkRecoveryEligibility('project-1', trigger, ctx);
      expect(result.eligible).toBe(true);
      expect(result.reason).toBe('eligible');
    }
  });

  it('respects custom lockStaleMs override', () => {
    // Lock at 6 minutes ago, custom stale threshold = 5 minutes → should be stale.
    const ctx = makeCtx(
      makeProject({
        deploy_lock_session: 'session',
        deploy_lock_at: minutesAgo(6),
      }),
      { lockStaleMs: 5 * 60 * 1000 },
    );
    const result = checkRecoveryEligibility('project-1', 'deploy_failed', ctx);
    expect(result.eligible).toBe(true);
  });

  it('treats lock with missing deploy_lock_at as fresh (safe default)', () => {
    const ctx = makeCtx(
      makeProject({
        deploy_lock_session: 'session-no-timestamp',
        deploy_lock_at: null,
      }),
    );
    const result = checkRecoveryEligibility('project-1', 'deploy_failed', ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('deploy_in_progress');
  });

  it('blocks coordinator triggers when circuit breaker is open, but allows ops_sequence', () => {
    for (const trigger of ALL_TRIGGERS) {
      const ctx = makeCtx(makeProject(), { isCircuitBreakerOpen: true });
      const result = checkRecoveryEligibility('project-1', trigger, ctx);
      if (trigger === 'ops_sequence') {
        expect(result.eligible).toBe(true);
      } else {
        expect(result.eligible).toBe(false);
        expect(result.reason).toBe('circuit_breaker_open');
      }
    }
  });

  it('blocks coordinator triggers when global budget is exceeded, but allows ops_sequence', () => {
    for (const trigger of ALL_TRIGGERS) {
      const ctx = makeCtx(makeProject(), { isGlobalBudgetExceeded: true });
      const result = checkRecoveryEligibility('project-1', trigger, ctx);
      if (trigger === 'ops_sequence') {
        expect(result.eligible).toBe(true);
      } else {
        expect(result.eligible).toBe(false);
        expect(result.reason).toBe('global_budget_exceeded');
      }
    }
  });

  it('returns eligible for a healthy project on every trigger', () => {
    for (const trigger of ALL_TRIGGERS) {
      const ctx = makeCtx(makeProject());
      const result = checkRecoveryEligibility('project-1', trigger, ctx);
      expect(result).toEqual({ eligible: true, reason: 'eligible' });
    }
  });

  it('continue_check rejects unexpected statuses (e.g. building)', () => {
    const ctx = makeCtx(makeProject({ status: 'building' }));
    const result = checkRecoveryEligibility('project-1', 'continue_check', ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('recovering_in_progress');
  });

  it('continue_check accepts both running and recovering statuses', () => {
    for (const status of ['running', 'recovering']) {
      const ctx = makeCtx(makeProject({ status }));
      const result = checkRecoveryEligibility('project-1', 'continue_check', ctx);
      expect(result.eligible).toBe(true);
    }
  });

  it('uses DEFAULT_LOCK_STALE_MS when lockStaleMs is omitted', () => {
    // Lock at exactly DEFAULT - 1ms ago → fresh
    const ctx = makeCtx(
      makeProject({
        deploy_lock_session: 'session',
        deploy_lock_at: new Date(Date.now() - DEFAULT_LOCK_STALE_MS + 1).toISOString(),
      }),
    );
    const result = checkRecoveryEligibility('project-1', 'deploy_failed', ctx);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('deploy_in_progress');
  });
});

// ---------------------------------------------------------------------------
// withRecoveryStage — partial-failure semantics
// ---------------------------------------------------------------------------

describe('withRecoveryStage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok:true with the resolved value on success', async () => {
    const events = new EventBus();
    const emitSpy = vi.spyOn(events, 'emit');

    const result = await withRecoveryStage(
      'transition',
      { events, projectId: 'project-1' },
      async () => 'done',
    );

    expect(result).toEqual({ ok: true, value: 'done' });
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('returns ok:false and emits recovery:degraded when fn throws', async () => {
    const events = new EventBus();
    const emitSpy = vi.spyOn(events, 'emit');

    const error = new Error('PSM rejected transition');
    const result = await withRecoveryStage(
      'transition',
      { events, projectId: 'project-1', metadata: { trigger: 'container:die' } },
      async () => {
        throw error;
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('PSM rejected transition');
      expect(result.error).toBe(error);
    }

    const degradedCalls = emitSpy.mock.calls.filter(([event]) => event === 'recovery:degraded');
    expect(degradedCalls).toHaveLength(1);
    expect(degradedCalls[0][1]).toEqual({
      projectId: 'project-1',
      stage: 'transition',
      reason: 'PSM rejected transition',
      metadata: { trigger: 'container:die' },
    });
  });

  it('preserves stage label across all RecoveryStage values', async () => {
    const stages = ['enqueue', 'transition', 'emit', 'execute'] as const;
    for (const stage of stages) {
      const events = new EventBus();
      const emitSpy = vi.spyOn(events, 'emit');
      await withRecoveryStage(stage, { events, projectId: 'project-1' }, async () => {
        throw new Error('boom');
      });
      const degradedCalls = emitSpy.mock.calls.filter(([event]) => event === 'recovery:degraded');
      expect(degradedCalls).toHaveLength(1);
      expect(degradedCalls[0][1]).toMatchObject({ stage });
    }
  });

  it('does NOT silently swallow when emit also throws — outer log.error catches it', async () => {
    const events = {
      emit: vi.fn(async () => {
        throw new Error('event bus exploded');
      }),
    };

    const result = await withRecoveryStage(
      'execute',
      { events, projectId: 'project-1' },
      async () => {
        throw new Error('original failure');
      },
    );

    // The original failure must still be reported via ok:false — not silently
    // dropped just because emit happened to fail.
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('original failure');
    }
    expect(events.emit).toHaveBeenCalledTimes(1);
  });

  it('coerces non-Error throws into a string reason', async () => {
    const events = new EventBus();
    const emitSpy = vi.spyOn(events, 'emit');

    const result = await withRecoveryStage(
      'execute',
      { events, projectId: 'project-1' },
      async () => {
        throw 'string failure';
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('string failure');
    }
    const degradedCalls = emitSpy.mock.calls.filter(([event]) => event === 'recovery:degraded');
    expect(degradedCalls).toHaveLength(1);
    expect(degradedCalls[0][1]).toMatchObject({ reason: 'string failure' });
  });
});
