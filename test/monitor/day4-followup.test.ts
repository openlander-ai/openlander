/**
 * Day 4 — code-reviewer Major follow-up tests.
 *
 * M1: recovery:degraded listener coverage
 *   - IncidentReporter registers a listener for recovery:degraded
 *   - ActivityLogger persists recovery:degraded to activity_log
 *
 * M2: void withRecoveryStage → .catch — unhandled rejection prevention
 *   - Verified indirectly: withRecoveryStage returns a Promise and .catch is called
 *     so rejections from trySavePattern do NOT propagate as unhandled rejections.
 *   - Direct test: if withRecoveryStage rejects at the microtask level,
 *     the rejection is caught and does not throw.
 *
 * M3: ingestRuntimeSignal maps signal.kind → correct RecoveryTrigger
 *   - probe_failed / post_deploy_regression → health_degraded trigger
 *   - container_died / container_oom / container_missing → container_failure trigger
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import { EventBus } from '../../src/events/index.js';
import { RecoveryCoordinator } from '../../src/_ai-ops/recovery-coordinator.js';
import { IncidentReporter } from '../../src/monitor/incident-reporter.js';
import { ActivityLogger } from '../../src/monitor/activity-logger.js';
import type { RuntimeSignal } from '../../src/health/types.js';

// Suppress logger noise in test output
vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../src/pipeline/auto-recovery.js', () => ({
  consumeMcpDeploy: vi.fn(() => false),
}));

// activity-event-mapper uses ulid from db repo — stub it
vi.mock('../../src/db/repos/activity-log.repo.js', () => ({
  ulid: () => 'test-ulid',
}));

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeConfig(): OpenLanderConfig {
  return {
    language: 'en',
    ai: {
      autoRecovery: { enabled: true },
      buildDebugger: { enabled: false },
      webAgent: { enabled: false },
      envDetection: { enabled: false },
      secretScan: { enabled: false },
      rollbackSuggestion: { enabled: false },
      operationalMonitoring: { enabled: false },
      codingPlan: { enabled: false },
    },
  } as unknown as OpenLanderConfig;
}

function makeDb(overrides: Partial<Database> = {}): Database {
  return {
    getProject: vi.fn(() => ({
      id: 'project-1',
      name: 'test-project',
      status: 'running',
      archived_at: null,
      container_id: 'container-1',
      deploy_lock_session: null,
      deploy_lock_at: null,
    })),
    // PR 4.5: canonical-first reads need this helper.
    getDeployableForProject: vi.fn().mockReturnValue(undefined),
    updateProject: vi.fn(),
    isCircuitBreakerOpen: vi.fn(() => false),
    insertActivityLog: vi.fn(),
    getActionRunsByApprovalStatus: vi.fn(() => []),
    ...overrides,
  } as unknown as Database;
}

function makeChannelManager() {
  return { broadcast: vi.fn() };
}

// ---------------------------------------------------------------------------
// M1: recovery:degraded listener — IncidentReporter
// ---------------------------------------------------------------------------

describe('M1 — IncidentReporter: recovery:degraded listener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a listener for recovery:degraded on start()', () => {
    const events = new EventBus();
    const db = makeDb();
    const reporter = new IncidentReporter(makeChannelManager() as never, events, db, makeConfig());

    reporter.start();

    expect(events.listenerCount('recovery:degraded')).toBe(1);

    reporter.stop();
  });

  it('deregisters the recovery:degraded listener on stop()', () => {
    const events = new EventBus();
    const db = makeDb();
    const reporter = new IncidentReporter(makeChannelManager() as never, events, db, makeConfig());

    reporter.start();
    reporter.stop();

    expect(events.listenerCount('recovery:degraded')).toBe(0);
  });

  it('logs a warning when recovery:degraded is emitted (does not throw)', async () => {
    const events = new EventBus();
    const db = makeDb();
    const reporter = new IncidentReporter(makeChannelManager() as never, events, db, makeConfig());

    reporter.start();

    // Should not throw when recovery:degraded is emitted
    await expect(
      events.emit('recovery:degraded', {
        projectId: 'project-1',
        stage: 'transition',
        reason: 'PSM rejected transition',
        metadata: { trigger: 'container:die' },
      }),
    ).resolves.toBeUndefined();

    reporter.stop();
  });
});

// ---------------------------------------------------------------------------
// M1: recovery:degraded listener — ActivityLogger
// ---------------------------------------------------------------------------

describe('M1 — ActivityLogger: recovery:degraded persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes recovery:degraded in persisted event types (listener registered)', () => {
    const events = new EventBus();
    const db = makeDb();
    const logger = new ActivityLogger(events, db);

    logger.start();

    expect(events.listenerCount('recovery:degraded')).toBeGreaterThanOrEqual(1);

    logger.stop();
  });

  it('calls db.insertActivityLog when recovery:degraded is emitted', async () => {
    const insertActivityLog = vi.fn();
    const db = makeDb({ insertActivityLog });
    const events = new EventBus();
    const logger = new ActivityLogger(events, db);

    logger.start();

    await events.emit('recovery:degraded', {
      projectId: 'project-1',
      stage: 'execute',
      reason: 'pattern save failed',
      metadata: { phase: 'pattern-save', success: false },
    });

    // queueMicrotask defers the insert — flush microtasks
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(insertActivityLog).toHaveBeenCalledOnce();
    const [row] = insertActivityLog.mock.calls[0] as [Record<string, unknown>];
    expect(row.event_type).toBe('recovery:degraded');
    expect(row.severity).toBe('warning');
    expect(row.project_id).toBe('project-1');

    logger.stop();
  });

  it('deregisters the recovery:degraded listener on stop()', () => {
    const events = new EventBus();
    const db = makeDb();
    const logger = new ActivityLogger(events, db);

    logger.start();
    const countBefore = events.listenerCount('recovery:degraded');
    logger.stop();

    expect(events.listenerCount('recovery:degraded')).toBeLessThan(countBefore);
  });
});

// ---------------------------------------------------------------------------
// M2: trySavePattern .catch — unhandled rejection prevention
// ---------------------------------------------------------------------------

describe('M2 — withRecoveryStage .catch: unhandled rejection prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a microtask-level rejection inside withRecoveryStage does not escape as unhandled', async () => {
    // We test the pattern directly: withRecoveryStage returns a Promise.
    // When .catch() is chained, the rejection is handled — no unhandled rejection.
    const { withRecoveryStage } = await import('../../src/monitor/recovery-policy.js');
    const events = new EventBus();

    let caughtError: unknown = null;

    const promise = withRecoveryStage('execute', { events, projectId: 'project-1' }, async () => {
      // Simulate a microtask-level rejection
      await Promise.resolve();
      throw new Error('async rejection in trySavePattern');
    });

    // .catch mirrors what the fixed trySavePattern does
    await promise.catch((err: unknown) => {
      caughtError = err;
    });

    // withRecoveryStage itself catches fn rejections and returns ok:false —
    // the outer .catch should NOT be called (promise resolves with ok:false result)
    expect(caughtError).toBeNull();
  });

  it('withRecoveryStage resolves (not rejects) even when fn throws — .catch receives no error', async () => {
    const { withRecoveryStage } = await import('../../src/monitor/recovery-policy.js');
    const events = new EventBus();

    let outerCatchCalled = false;

    const result = await withRecoveryStage(
      'execute',
      { events, projectId: 'project-1' },
      async () => {
        throw new Error('fn failure');
      },
    ).catch(() => {
      outerCatchCalled = true;
    });

    // withRecoveryStage resolves with ok:false — outer .catch is NOT invoked
    expect(outerCatchCalled).toBe(false);
    expect(result).toMatchObject({ ok: false, reason: 'fn failure' });
  });
});

// ---------------------------------------------------------------------------
// M3: ingestRuntimeSignal → signal kind → correct trigger mapping
// ---------------------------------------------------------------------------

describe('M3 — ingestRuntimeSignal: signal.kind → RecoveryTrigger mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function buildCoordinator(db: Database) {
    const events = new EventBus();
    const emitSpy = vi.spyOn(events, 'emit');
    const coordinator = new RecoveryCoordinator(db, events, makeConfig());
    coordinator.setStateManager({ transition: () => Promise.resolve(true) });
    coordinator.start();
    return { coordinator, events, emitSpy };
  }

  const healthSignals: RuntimeSignal['kind'][] = ['probe_failed', 'post_deploy_regression'];
  const containerSignals: RuntimeSignal['kind'][] = [
    'container_died',
    'container_oom',
    'container_missing',
  ];

  it.each(healthSignals)(
    'signal kind "%s" routes through health_degraded evaluation (emits recovery:started)',
    async (kind) => {
      const db = makeDb();
      const { coordinator, emitSpy } = buildCoordinator(db);

      await coordinator.ingestRuntimeSignal({
        projectId: 'project-1',
        kind,
        source: 'probe-monitor',
        failureCount: 3,
        error: 'probe timeout',
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      // health_degraded path → handleHealthDegraded → recovery:started
      const startedCalls = emitSpy.mock.calls.filter(([event]) => event === 'recovery:started');
      expect(startedCalls).toHaveLength(1);
      expect(startedCalls[0][1]).toMatchObject({ projectId: 'project-1' });
    },
  );

  it.each(containerSignals)(
    'signal kind "%s" routes through container_failure evaluation (emits recovery:started)',
    async (kind) => {
      const db = makeDb();
      const { coordinator, emitSpy } = buildCoordinator(db);

      await coordinator.ingestRuntimeSignal({
        projectId: 'project-1',
        kind,
        source: 'docker-events',
        containerId: 'container-1',
      });

      await new Promise((resolve) => setTimeout(resolve, 0));

      // container_failure path → handleContainerFailure → recovery:started
      const startedCalls = emitSpy.mock.calls.filter(([event]) => event === 'recovery:started');
      expect(startedCalls).toHaveLength(1);
      expect(startedCalls[0][1]).toMatchObject({ projectId: 'project-1' });
    },
  );

  it('blocked health_degraded signal emits recovery:blocked (not recovery:started)', async () => {
    // Project has deploy lock → health_degraded should be blocked
    const db = makeDb({
      getProject: vi.fn(() => ({
        id: 'project-1',
        name: 'test-project',
        status: 'running',
        archived_at: null,
        container_id: 'container-1',
        deploy_lock_session: 'active-session',
        deploy_lock_at: new Date(Date.now() - 60_000).toISOString(), // 1 min ago — fresh
      })),
    });
    const { coordinator, emitSpy } = buildCoordinator(db);

    await coordinator.ingestRuntimeSignal({
      projectId: 'project-1',
      kind: 'probe_failed',
      source: 'probe-monitor',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const startedCalls = emitSpy.mock.calls.filter(([event]) => event === 'recovery:started');
    const blockedCalls = emitSpy.mock.calls.filter(([event]) => event === 'recovery:blocked');

    expect(startedCalls).toHaveLength(0);
    expect(blockedCalls).toHaveLength(1);
  });
});
