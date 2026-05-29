/**
 * U-P0-4 검증 — 1.0 GA 차단 사유
 *
 * Deploy lock vs Recovery race condition:
 * RecoveryCoordinator.handleContainerFailure (및 handleHealthDegraded)가
 * eligibility gate(recovery-coordinator.ts:148-179)에서 deploy_lock_session을
 * 체크하지 않아 deploy 진행 중 container:die 이벤트 발생 시 recovery를
 * 잘못 시작하는 race condition을 검증한다.
 *
 * OpsRecovery.runRecoverySequence는 lock을 봄(ops-recovery.ts:219-229).
 * RecoveryCoordinator는 lock을 보지 않음 → race.
 *
 * Test A: 현재 코드에서 FAIL (버그 증거 — skip하지 않고 recovery 시작)
 * Test B: stale lock(31분 경과) → recovery 진행 → PASS (현재 코드에서도 통과,
 *         stale lock 처리 로직이 없으므로 lock을 무시하고 그냥 진행하기 때문)
 * Test C: deploy_lock 없음 → 정상 recovery → PASS (sanity)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import { EventBus } from '../../src/events/index.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import { RecoveryCoordinator } from '../../src/_ai-ops/recovery-coordinator.js';
import type { OpsAgentRef } from '../../src/_ai-ops/recovery-coordinator.js';

// Suppress logger output in test runs
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

// --- helpers ---

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

/**
 * Builds a project row with optional deploy lock fields.
 */
function makeProjectRow(
  overrides: {
    deploy_lock_session?: string | null;
    deploy_lock_at?: string | null;
    status?: string;
  } = {},
) {
  return {
    id: 'project-1',
    name: 'test-project',
    status: overrides.status ?? 'running',
    archived_at: null,
    container_id: 'container-1',
    deploy_lock_session: overrides.deploy_lock_session ?? null,
    deploy_lock_at: overrides.deploy_lock_at ?? null,
  };
}

function makeDb(projectRow: ReturnType<typeof makeProjectRow>): Database {
  return {
    getProject: vi.fn(() => projectRow),
    // PR 4.5: canonical-first reads need this helper.
    getDeployableForProject: vi.fn().mockReturnValue(undefined),
    updateProject: vi.fn(),
    isCircuitBreakerOpen: vi.fn(() => false),
  } as unknown as Database;
}

function makeOpsAgent(): OpsAgentRef {
  return { enqueue: vi.fn() };
}

/**
 * Builds a coordinator with real EventBus, PSM transition always succeeds,
 * and the OpsAgent spy available for assertion.
 */
function buildCoordinator(db: Database) {
  const events = new EventBus();
  const emitSpy = vi.spyOn(events, 'emit');

  const coordinator = new RecoveryCoordinator(db, events, makeConfig());

  // Always-succeed transition so stage C never throws
  coordinator.setStateManager({ transition: () => Promise.resolve(true) });

  const opsAgent = makeOpsAgent();
  coordinator.start({ opsAgent });

  return { coordinator, events, emitSpy, opsAgent };
}

// Convenience: ISO timestamp N minutes ago
function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60 * 1000).toISOString();
}

// --- tests ---

describe('RecoveryCoordinator — U-P0-4: deploy lock vs recovery race', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test A
  // active deploy lock が存在する場合、container:die で recovery を開始してはならない。
  //
  // 現在の eligibility gate (checkEligibility) には deploy_lock_session チェックがない。
  // そのため recovery が開始されてしまう → このテストは FAIL → GA 차단 증거
  // -------------------------------------------------------------------------
  it('Test A: skips recovery (0 recovery:started, 0 OpsAgent enqueue) when project has active deploy_lock_session', async () => {
    const projectRow = makeProjectRow({
      deploy_lock_session: 'active-session-uuid-abc123',
      deploy_lock_at: minutesAgo(2), // 2 minutes ago — clearly active
    });
    const db = makeDb(projectRow);
    const { events, emitSpy, opsAgent } = buildCoordinator(db);

    await events.emit('container:die', {
      projectId: 'project-1',
      containerId: 'container-1',
      containerName: 'test-project',
      exitCode: 137,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const recoveryStartedCalls = emitSpy.mock.calls.filter(
      ([event]) => event === 'recovery:started',
    );
    const recoveryBlockedCalls = emitSpy.mock.calls.filter(
      ([event]) => event === 'recovery:blocked',
    );

    // EXPECTED: recovery:started = 0, OpsAgent.enqueue = 0
    // ACTUAL (current bug): recovery:started = 1, OpsAgent.enqueue = 1 (lock not checked)
    expect(recoveryStartedCalls).toHaveLength(0);
    expect((opsAgent.enqueue as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);

    // Ideally a recovery:blocked event is emitted to explain why recovery was skipped
    // This assertion is secondary — the primary check above is the GA blocker evidence
    if (recoveryBlockedCalls.length > 0) {
      expect(recoveryBlockedCalls[0][1]).toMatchObject({
        projectId: 'project-1',
        reason: expect.stringContaining('deploy'),
      });
    }
  });

  // -------------------------------------------------------------------------
  // Test A (health:degraded variant)
  // handleHealthDegraded も同様に deploy_lock を無視する。
  // -------------------------------------------------------------------------
  it('Test A (health:degraded variant): skips recovery when project has active deploy_lock_session', async () => {
    const projectRow = makeProjectRow({
      deploy_lock_session: 'active-session-uuid-abc123',
      deploy_lock_at: minutesAgo(1),
    });
    const db = makeDb(projectRow);
    const { events, emitSpy, opsAgent } = buildCoordinator(db);

    await events.emit('health:degraded', {
      projectId: 'project-1',
      consecutiveFailures: 3,
      lastError: 'health probe failed',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const recoveryStartedCalls = emitSpy.mock.calls.filter(
      ([event]) => event === 'recovery:started',
    );
    expect(recoveryStartedCalls).toHaveLength(0);
    expect((opsAgent.enqueue as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test B
  // stale lock (31분 이상 경과) 시에는 recovery를 진행해야 한다.
  //
  // 현재 코드는 deploy_lock_session 자체를 체크하지 않으므로
  // stale lock이든 active lock이든 관계없이 recovery를 진행한다.
  // 올바른 fix 후에도 stale lock에서는 recovery가 진행되어야 하므로
  // 이 테스트는 fix 전/후 모두 PASS해야 한다.
  // (fix 전: lock 체크 없으므로 통과 / fix 후: stale 판별 후 통과)
  // -------------------------------------------------------------------------
  it('Test B: proceeds with recovery when deploy_lock_at is stale (31+ minutes ago)', async () => {
    const projectRow = makeProjectRow({
      deploy_lock_session: 'stale-session-uuid-xyz',
      deploy_lock_at: minutesAgo(31), // 31 minutes ago — stale
    });
    const db = makeDb(projectRow);
    const { events, emitSpy } = buildCoordinator(db);

    await events.emit('container:die', {
      projectId: 'project-1',
      containerId: 'container-1',
      containerName: 'test-project',
      exitCode: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const recoveryStartedCalls = emitSpy.mock.calls.filter(
      ([event]) => event === 'recovery:started',
    );
    // Stale lock should not block recovery
    expect(recoveryStartedCalls).toHaveLength(1);
    expect(recoveryStartedCalls[0][1]).toMatchObject({
      projectId: 'project-1',
      trigger: 'container:die',
    });
  });

  // -------------------------------------------------------------------------
  // Test C — sanity / regression guard
  // deploy_lock_session 없음 → 정상 recovery 진행
  // -------------------------------------------------------------------------
  it('Test C (sanity): proceeds with normal recovery when no deploy_lock_session exists', async () => {
    const projectRow = makeProjectRow({
      deploy_lock_session: null,
      deploy_lock_at: null,
    });
    const db = makeDb(projectRow);
    const { events, emitSpy, opsAgent } = buildCoordinator(db);

    await events.emit('container:die', {
      projectId: 'project-1',
      containerId: 'container-1',
      containerName: 'test-project',
      exitCode: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const recoveryStartedCalls = emitSpy.mock.calls.filter(
      ([event]) => event === 'recovery:started',
    );
    expect(recoveryStartedCalls).toHaveLength(1);
    expect(recoveryStartedCalls[0][1]).toMatchObject({
      projectId: 'project-1',
      trigger: 'container:die',
    });
    // OpsAgent must also be enqueued on the normal path
    expect((opsAgent.enqueue as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});
