/**
 * U-P0-2 검증 — 1.0 GA 차단 사유
 *
 * RecoveryCoordinator partial-failure 가시화:
 * PSM transition 실패 또는 db.getProject 실패 시
 * recovery:started 이벤트가 잘못 emit되는 버그를 검증한다.
 *
 * 현재 구현(recovery-coordinator.ts:400-418)은 Stage C(PSM transition)를
 * try/catch로 isolate하고 실패해도 Stage D(recovery:started emit)를 실행한다.
 * 이는 status='running'인 채로 recovery:started가 흐르는 부정합 상태를 야기한다.
 *
 * Test A, B: 현재 코드에서 FAIL (버그 증거)
 * Test C: 현재 코드에서 PASS (sanity regression guard)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import { EventBus } from '../../src/events/index.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import { RecoveryCoordinator } from '../../src/_ai-ops/recovery-coordinator.js';
import type { OpsAgentRef } from '../../src/_ai-ops/recovery-coordinator.js';

// logger mock — suppress noise in test output
vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// consumeMcpDeploy은 deploy:failed 핸들러에서만 사용되므로 false 고정
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
    ...overrides,
  } as unknown as Database;
}

function makeOpsAgent(): OpsAgentRef {
  return { enqueue: vi.fn() };
}

/**
 * Builds a RecoveryCoordinator with a real EventBus so we can spy on emit.
 * Returns coordinator + eventBus so tests can assert on emitted events.
 */
function buildCoordinator(db: Database, stateManagerTransition?: () => Promise<boolean>) {
  const events = new EventBus();
  const emitSpy = vi.spyOn(events, 'emit');

  const coordinator = new RecoveryCoordinator(db, events, makeConfig());

  if (stateManagerTransition !== undefined) {
    coordinator.setStateManager({ transition: stateManagerTransition });
  }

  const opsAgent = makeOpsAgent();
  coordinator.start({ opsAgent });

  return { coordinator, events, emitSpy, opsAgent };
}

// --- tests ---

describe('RecoveryCoordinator — U-P0-2: partial-failure visibility on container:die', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test A
  // PSM transition が false を返す（invalid transition）場合、
  // recovery:started が emit されてはいけない（または partial-failure が emit される）。
  //
  // 現在の実装は Stage C の catch で warn を出すだけで Stage D を続行するため
  // このテストは FAIL する → GA 차단 증거
  // -------------------------------------------------------------------------
  it('Test A: does not emit recovery:started when PSM transition returns false (invalid transition)', async () => {
    // transition returns false = rejected (e.g. status:building -> recovering is invalid)
    const db = makeDb({
      getProject: vi.fn(() => ({
        id: 'project-1',
        name: 'test-project',
        status: 'running',
        archived_at: null,
        container_id: 'container-1',
        deploy_lock_session: null,
        deploy_lock_at: null,
      })),
    });

    // transitionProjectStatus will call stateManager.transition → returns false
    // then checks project.status === nextStatus → 'running' !== 'recovering' → throws
    // but the outer try/catch in transitionProjectStatus catches it and re-throws,
    // and the Stage C inner catch swallows it and continues to Stage D.
    const { events, emitSpy } = buildCoordinator(db, () => Promise.resolve(false));

    await events.emit('container:die', {
      projectId: 'project-1',
      containerId: 'container-1',
      containerName: 'test-project',
      exitCode: 1,
    });

    // Allow all async handlers to settle
    await new Promise((resolve) => setTimeout(resolve, 0));

    const recoveryStartedCalls = emitSpy.mock.calls.filter(
      ([event]) => event === 'recovery:started',
    );

    // EXPECTED (correct behavior): recovery:started must NOT be emitted when transition failed
    // ACTUAL (current bug): recovery:started IS emitted despite transition failure
    expect(recoveryStartedCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test B
  // db.getProject が throw する場合、checkEligibility が project_not_found を返し
  // recovery:blocked が emit され、recovery:started は emit されない。
  //
  // checkEligibility は getProjectSnapshot 経由で db.getProject を呼ぶ。
  // getProject が throw すると checkEligibility 自体が throw → 外側 try/catch が catch
  // → recovery:started は 0 回になるはずだが、実装次第で挙動が変わる可能性がある。
  // -------------------------------------------------------------------------
  it('Test B: does not emit recovery:started when db.getProject throws (BUSY / DB error)', async () => {
    const db = makeDb({
      getProject: vi.fn(() => {
        throw new Error('SQLITE_BUSY: database is locked');
      }),
    });

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
    expect(recoveryStartedCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test C — sanity / regression guard
  // 정상 경로: PSM transition 성공 → recovery:started 정확히 1회 emit
  // -------------------------------------------------------------------------
  it('Test C (sanity): emits recovery:started exactly once when all stages succeed', async () => {
    const db = makeDb();
    // transition returns true = succeeded
    const { events, emitSpy } = buildCoordinator(db, () => Promise.resolve(true));

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
  });

  // -------------------------------------------------------------------------
  // Supplemental: health:degraded path mirrors the same bug
  // -------------------------------------------------------------------------
  it('Test A (health:degraded variant): does not emit recovery:started when PSM transition returns false', async () => {
    const db = makeDb();
    const { events, emitSpy } = buildCoordinator(db, () => Promise.resolve(false));

    await events.emit('health:degraded', {
      projectId: 'project-1',
      consecutiveFailures: 3,
      lastError: 'probe timeout',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const recoveryStartedCalls = emitSpy.mock.calls.filter(
      ([event]) => event === 'recovery:started',
    );
    // EXPECTED: 0 — status never transitioned so recovery:started should not fire
    // ACTUAL (bug): 1 — Stage D fires despite Stage C failure
    expect(recoveryStartedCalls).toHaveLength(0);
  });
});
