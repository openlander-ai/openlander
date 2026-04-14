import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenLanderConfig } from '../../src/config/index.js';
import type { Database } from '../../src/db/index.js';
import type { RuntimeSignal } from '../../src/health/types.js';
import { EventBus } from '../../src/events/index.js';
import { RecoveryCoordinator, type OpsAgentRef } from '../../src/monitor/recovery-coordinator.js';

vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

interface MockProject {
  id: string;
  name: string;
  status: string;
  archived_at: string | null;
  container_id: string | null;
}

function createMockDb(projectOverrides?: Partial<MockProject>) {
  const project: MockProject = {
    id: 'proj-1',
    name: 'Demo Project',
    status: 'running',
    archived_at: null,
    container_id: 'container-123',
    ...projectOverrides,
  };

  const db = {
    getProject: vi.fn((projectId: string) => (projectId === project.id ? project : undefined)),
    updateProject: vi.fn((projectId: string, updates: { status?: string }) => {
      if (projectId === project.id && updates.status) {
        project.status = updates.status;
      }
    }),
    isCircuitBreakerOpen: vi.fn(() => false),
    getActiveOpsIncident: vi.fn<(projectId: string) => { id: string; project_id: string } | null>(
      () => null,
    ),
  };

  return { db, project };
}

function createMockConfig(enabled = true): OpenLanderConfig {
  return {
    ai: {
      autoRecovery: { enabled },
    },
  } as OpenLanderConfig;
}

describe('RecoveryCoordinator', () => {
  let events: EventBus;

  beforeEach(() => {
    events = new EventBus();
    vi.useFakeTimers({ now: new Date('2026-04-06T10:00:00.000Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns eligible when all 7 gate conditions pass', () => {
    const { db } = createMockDb();
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
    );

    expect(coordinator.checkEligibility('proj-1')).toEqual({ eligible: true });
  });

  it('allows recovery for project in error status', () => {
    const { db } = createMockDb({ status: 'error' });
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
    );

    expect(coordinator.checkEligibility('proj-1')).toEqual({ eligible: true });
  });

  it('blocks suppressed projects and expires suppression window', () => {
    const { db } = createMockDb();
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
    );

    coordinator.suppressProject('proj-1', 5_000);
    expect(coordinator.checkEligibility('proj-1')).toEqual({
      eligible: false,
      reason: 'operator_suppressed',
    });

    vi.advanceTimersByTime(5_001);

    expect(coordinator.isOperatorSuppressed('proj-1')).toBe(false);
    expect(coordinator.checkEligibility('proj-1')).toEqual({ eligible: true });
  });

  it('enforces the rolling global LLM budget window', () => {
    const { db } = createMockDb();
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
      { maxLlmCallsPerHour: 2 },
    );

    coordinator.recordLlmCall();
    coordinator.recordLlmCall();

    expect(coordinator.isGlobalBudgetExceeded()).toBe(true);
    expect(coordinator.checkEligibility('proj-1')).toEqual({
      eligible: false,
      reason: 'global_budget_exceeded',
    });

    vi.advanceTimersByTime(3_600_001);

    expect(coordinator.isGlobalBudgetExceeded()).toBe(false);
  });

  it('starts recovery on health:degraded and enqueues OpsAgent event when eligible', async () => {
    const { db, project } = createMockDb();
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
    );
    const opsAgent: OpsAgentRef = { enqueue: vi.fn() };
    const started = vi.fn();

    events.on('recovery:started', started);
    coordinator.start({ opsAgent });

    await events.emit('health:degraded', {
      projectId: project.id,
      consecutiveFailures: 3,
      lastError: 'connection refused',
    });

    expect(db.updateProject).toHaveBeenCalledWith(project.id, { status: 'recovering' });
    expect(started).toHaveBeenCalledWith({
      projectId: project.id,
      trigger: 'health:degraded',
    });
    expect(opsAgent.enqueue).toHaveBeenCalledWith({
      type: 'deploy:crash',
      payload: {
        projectId: project.id,
        projectName: project.name,
        containerId: project.container_id,
      },
      timestamp: Date.now(),
    });
  });

  it('emits recovery:blocked when health:degraded fails the eligibility gate', async () => {
    const { db } = createMockDb();
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(false),
    );
    const blocked = vi.fn();

    events.on('recovery:blocked', blocked);
    coordinator.start();

    await events.emit('health:degraded', {
      projectId: 'proj-1',
      consecutiveFailures: 4,
      lastError: 'timeout',
    });

    expect(blocked).toHaveBeenCalledWith({
      projectId: 'proj-1',
      reason: 'ai_disabled',
    });
    expect(db.updateProject).not.toHaveBeenCalled();
  });

  it('emits recovery:blocked for supplementary container events when gate fails', async () => {
    const { db } = createMockDb({ status: 'stopped' });
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
    );
    const blocked = vi.fn();

    events.on('recovery:blocked', blocked);
    coordinator.start();

    await events.emit('container:die', {
      projectId: 'proj-1',
      containerId: 'container-123',
      containerName: 'demo',
      exitCode: 137,
    });

    expect(blocked).toHaveBeenCalledWith({
      projectId: 'proj-1',
      reason: 'status_stopped',
    });
  });

  it('routes eligible container failures through OpsAgent like health:degraded', async () => {
    const { db, project } = createMockDb();
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
    );
    const opsAgent: OpsAgentRef = { enqueue: vi.fn() };
    const started = vi.fn();

    events.on('recovery:started', started);
    coordinator.start({ opsAgent });

    await events.emit('container:oom', {
      projectId: project.id,
      containerId: 'container-oom',
      containerName: 'demo',
    });

    expect(db.updateProject).toHaveBeenCalledWith(project.id, { status: 'recovering' });
    expect(opsAgent.enqueue).toHaveBeenCalledWith({
      type: 'deploy:crash',
      payload: {
        projectId: project.id,
        projectName: project.name,
        containerId: 'container-oom',
      },
      timestamp: Date.now(),
    });
    expect(started).toHaveBeenCalledWith({
      projectId: project.id,
      trigger: 'container:oom',
    });
  });

  it('routes eligible deploy failures to the deployment recovery executor', async () => {
    const { db, project } = createMockDb();
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
    );
    const deploymentRecovery = vi.fn(async () => undefined);

    coordinator.setDeploymentRecovery(deploymentRecovery);
    coordinator.start();

    await events.emit('deploy:failed', {
      projectId: project.id,
      step: 'build',
      error: 'build failed',
      buildLog: 'full build log',
    });

    expect(deploymentRecovery).toHaveBeenCalledWith(
      project.id,
      'build failed',
      'build',
      'full build log',
    );
  });

  it('restores project status on recovery success and exhaustion only while recovering', async () => {
    const { db, project } = createMockDb({ status: 'recovering' });
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
    );

    coordinator.start();

    await events.emit('recovery:success', {
      projectId: project.id,
      attempt: 1,
      durationMs: 500,
    });
    expect(project.status).toBe('running');

    project.status = 'recovering';
    await events.emit('recovery:exhausted', {
      projectId: project.id,
      totalAttempts: 3,
      lastError: 'still failing',
    });
    expect(project.status).toBe('error');
  });

  it('unsubscribes listeners on stop', async () => {
    const { db } = createMockDb();
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
    );

    coordinator.start();
    coordinator.stop();

    await events.emit('health:degraded', {
      projectId: 'proj-1',
      consecutiveFailures: 2,
      lastError: 'timeout',
    });

    expect(db.updateProject).not.toHaveBeenCalled();
  });

  it('allows recovery even when incident is active (dedup handled by RecoveryPipeline.activeRecoveries)', async () => {
    const { db, project } = createMockDb();
    db.getActiveOpsIncident.mockReturnValue(null);

    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
    );
    const opsAgent: OpsAgentRef = { enqueue: vi.fn() };

    coordinator.start({ opsAgent });

    await events.emit('container:oom', {
      projectId: 'proj-1',
      containerId: 'c1',
      containerName: 'demo',
    });
    expect(opsAgent.enqueue).toHaveBeenCalledTimes(1);

    project.status = 'error';
    db.getActiveOpsIncident.mockReturnValue({ id: 'inc-1', project_id: 'proj-1' });

    await events.emit('container:oom', {
      projectId: 'proj-1',
      containerId: 'c2',
      containerName: 'demo',
    });
    expect(opsAgent.enqueue).toHaveBeenCalledTimes(2);
  });

  it('still sets status to recovering when opsAgent.enqueue throws', async () => {
    const { db, project } = createMockDb();
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
    );
    const opsAgent: OpsAgentRef = {
      enqueue: vi.fn(() => {
        throw new Error('enqueue exploded');
      }),
    };
    const started = vi.fn();

    events.on('recovery:started', started);
    coordinator.start({ opsAgent });

    await events.emit('container:die', {
      projectId: project.id,
      containerId: 'container-123',
      containerName: 'demo',
      exitCode: 1,
    });

    expect(db.updateProject).toHaveBeenCalledWith(project.id, { status: 'recovering' });
    expect(started).toHaveBeenCalledWith({
      projectId: project.id,
      trigger: 'container:die',
    });
  });

  it('defensively restores error status to running on recovery:success', async () => {
    const { db, project } = createMockDb({ status: 'error' });
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
    );

    coordinator.start();

    await events.emit('recovery:success', {
      projectId: project.id,
      attempt: 1,
      durationMs: 500,
    });

    expect(project.status).toBe('running');
  });

  it('does not defensively restore error status when recovery:exhausted fires', async () => {
    const { db, project } = createMockDb({ status: 'error' });
    const coordinator = new RecoveryCoordinator(
      db as unknown as Database,
      events,
      createMockConfig(),
    );

    coordinator.start();

    await events.emit('recovery:exhausted', {
      projectId: project.id,
      totalAttempts: 3,
      lastError: 'still failing',
    });

    expect(project.status).toBe('error');
    expect(db.updateProject).not.toHaveBeenCalled();
  });

  describe('ingestRuntimeSignal', () => {
    it('emits recovery:started for an eligible probe_failed signal', async () => {
      const { db } = createMockDb();
      const coordinator = new RecoveryCoordinator(
        db as unknown as Database,
        events,
        createMockConfig(),
      );
      const started = vi.fn();

      events.on('recovery:started', started);

      await coordinator.ingestRuntimeSignal({
        projectId: 'proj-1',
        kind: 'probe_failed',
        source: 'probe-monitor',
        error: 'connection refused',
        failureCount: 3,
      });

      expect(db.updateProject).toHaveBeenCalledWith('proj-1', { status: 'recovering' });
      expect(started).toHaveBeenCalledWith({
        projectId: 'proj-1',
        trigger: 'health:degraded',
        correlationId: 'proj-1',
      });
    });

    it('emits recovery:blocked for an ineligible runtime signal', async () => {
      const { db } = createMockDb();
      const coordinator = new RecoveryCoordinator(
        db as unknown as Database,
        events,
        createMockConfig(false),
      );
      const blocked = vi.fn();

      events.on('recovery:blocked', blocked);

      await coordinator.ingestRuntimeSignal({
        projectId: 'proj-1',
        kind: 'probe_failed',
        source: 'probe-monitor',
        error: 'timeout',
      });

      expect(blocked).toHaveBeenCalledWith({
        projectId: 'proj-1',
        reason: 'ai_disabled',
      });
      expect(db.updateProject).not.toHaveBeenCalled();
    });

    it('skips duplicate runtime signals for the same project while one is in flight', async () => {
      const { db } = createMockDb();
      const coordinator = new RecoveryCoordinator(
        db as unknown as Database,
        events,
        createMockConfig(),
      );
      let resolveStarted: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        resolveStarted = resolve;
      });
      const started = vi.fn(async () => {
        await gate;
      });
      const signal: RuntimeSignal = {
        projectId: 'proj-1',
        kind: 'probe_failed',
        source: 'probe-monitor',
        error: 'timeout',
      };

      events.on('recovery:started', started);

      const firstIngest = coordinator.ingestRuntimeSignal(signal);
      await Promise.resolve();
      await coordinator.ingestRuntimeSignal(signal);

      expect(started).toHaveBeenCalledTimes(1);

      resolveStarted?.();
      await firstIngest;
    });

    it('routes post_deploy_regression through the health degradation flow', async () => {
      const { db } = createMockDb();
      const coordinator = new RecoveryCoordinator(
        db as unknown as Database,
        events,
        createMockConfig(),
      );
      const started = vi.fn();

      events.on('recovery:started', started);

      await coordinator.ingestRuntimeSignal({
        projectId: 'proj-1',
        kind: 'post_deploy_regression',
        source: 'rollback-watcher',
        error: 'smoke test failed',
      });

      expect(started).toHaveBeenCalledWith({
        projectId: 'proj-1',
        trigger: 'health:degraded',
        correlationId: 'proj-1',
      });
    });

    it('routes container_died through the container failure flow', async () => {
      const { db } = createMockDb();
      const coordinator = new RecoveryCoordinator(
        db as unknown as Database,
        events,
        createMockConfig(),
      );
      const started = vi.fn();

      events.on('recovery:started', started);

      await coordinator.ingestRuntimeSignal({
        projectId: 'proj-1',
        kind: 'container_died',
        source: 'docker-events',
        containerId: 'container-123',
      });

      expect(db.updateProject).toHaveBeenCalledWith('proj-1', { status: 'recovering' });
      expect(started).toHaveBeenCalledWith({
        projectId: 'proj-1',
        trigger: 'container:die',
        correlationId: 'proj-1',
      });
    });
  });
});
