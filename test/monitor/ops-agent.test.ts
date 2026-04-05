import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OpsEvent } from '../../src/monitor/ops-types.js';
import { DEFAULT_RECOVERY_AUTOMATION } from '../../src/monitor/ops-types.js';

const mockUnsubscribe = vi.fn();
vi.mock('../../src/events/index.js', () => ({
  eventBus: {
    on: vi.fn(() => mockUnsubscribe),
    emit: vi.fn(),
  },
}));

vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { OpsAgent } = await import('../../src/monitor/ops-agent.js');
const { eventBus } = await import('../../src/events/index.js');

function createMockCtx() {
  return {
    db: {
      listProjects: vi.fn(() => []),
      getActiveOpsIncident: vi.fn(() => null),
      addOpsIncidentEvent: vi.fn(),
      findAllOpenCircuitBreakers: vi.fn(() => []),
      getCircuitBreakerState: vi.fn(() => null),
      resetCircuitBreaker: vi.fn(),
      getProjectOpsOverride: vi.fn(() => undefined),
      getActionRunsByApprovalStatus: vi.fn(() => []),
      updateActionRunStatus: vi.fn(),
    },
    docker: {},
    channelManager: { broadcastStructured: vi.fn(), listConnected: vi.fn(() => []) },
    config: { ops: {} },
    approvalGate: {
      approve: vi.fn(),
      reject: vi.fn(),
      dispose: vi.fn(),
    },
  } as any;
}

describe('OpsAgent', () => {
  let mockCtx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = createMockCtx();
  });

  describe('start / stop', () => {
    it('subscribes to 10 event types on start', async () => {
      const agent = new OpsAgent(mockCtx);
      await agent.start();
      expect(eventBus.on).toHaveBeenCalledTimes(10);
      await agent.stop();
    });

    it('unsubscribes from all events on stop', async () => {
      const agent = new OpsAgent(mockCtx);
      await agent.start();
      await agent.stop();
      expect(mockUnsubscribe).toHaveBeenCalledTimes(10);
    });

    it('disposes approval gate on stop', async () => {
      const agent = new OpsAgent(mockCtx);
      await agent.start();
      await agent.stop();
      expect(mockCtx.approvalGate.dispose).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — second start is no-op', async () => {
      const agent = new OpsAgent(mockCtx);
      await agent.start();
      await agent.start();
      expect(eventBus.on).toHaveBeenCalledTimes(10);
      await agent.stop();
    });

    it('marks interrupted incidents on boot reconciliation', async () => {
      const mockIncident = {
        id: 'inc-test-1',
        project_id: 'proj-1',
        severity: 'critical',
        status: 'open',
      };
      mockCtx.db.listProjects.mockReturnValue([{ id: 'proj-1', name: 'Test' }]);
      mockCtx.db.getActiveOpsIncident.mockReturnValue(mockIncident);

      const agent = new OpsAgent(mockCtx);
      await agent.start();

      expect(mockCtx.db.addOpsIncidentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          incident_id: 'inc-test-1',
          event_type: 'interrupted',
          description: 'Incident interrupted by server restart',
        }),
      );

      await agent.stop();
    });

    it('resets stale circuit breakers older than 24h on boot', async () => {
      const staleProjectId = 'proj-stale';
      mockCtx.db.findAllOpenCircuitBreakers.mockReturnValue([staleProjectId]);
      mockCtx.db.getCircuitBreakerState.mockReturnValue({
        project_id: staleProjectId,
        state: 'open',
        opened_at: Date.now() - 100_000_000,
      });

      const agent = new OpsAgent(mockCtx);
      await agent.start();

      expect(mockCtx.db.resetCircuitBreaker).toHaveBeenCalledWith(staleProjectId);

      await agent.stop();
    });
  });

  describe('enqueue', () => {
    it('accepts events when running', async () => {
      const agent = new OpsAgent(mockCtx);
      await agent.start();

      const event: OpsEvent = {
        type: 'deploy:crash',
        payload: { projectId: 'proj-1' },
        timestamp: Date.now(),
      };
      agent.enqueue(event);

      await agent.stop();
    });

    it('silently ignores events when not running', () => {
      const agent = new OpsAgent(mockCtx);
      const event: OpsEvent = {
        type: 'deploy:crash',
        payload: { projectId: 'proj-1' },
        timestamp: Date.now(),
      };
      agent.enqueue(event);
    });
  });

  describe('rate limiting', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('allows first 3 LLM calls per project', () => {
      const agent = new OpsAgent(mockCtx);

      expect(agent.isLlmRateLimited('proj-1')).toBe(false);
      agent.recordLlmCall('proj-1');

      expect(agent.isLlmRateLimited('proj-1')).toBe(false);
      agent.recordLlmCall('proj-1');

      expect(agent.isLlmRateLimited('proj-1')).toBe(false);
      agent.recordLlmCall('proj-1');

      expect(agent.isLlmRateLimited('proj-1')).toBe(true);
    });

    it('rate limits independently per project', () => {
      const agent = new OpsAgent(mockCtx);

      agent.recordLlmCall('proj-1');
      agent.recordLlmCall('proj-1');
      agent.recordLlmCall('proj-1');
      expect(agent.isLlmRateLimited('proj-1')).toBe(true);

      expect(agent.isLlmRateLimited('proj-2')).toBe(false);
    });

    it('enforces global limit of 20 calls/hour across all projects', () => {
      const agent = new OpsAgent(mockCtx);

      for (let i = 0; i < 20; i++) {
        agent.recordLlmCall(`proj-${String(i)}`);
      }

      expect(agent.isLlmRateLimited('proj-new')).toBe(true);
    });

    it('resets per-project limit after 1 hour', () => {
      const agent = new OpsAgent(mockCtx);

      agent.recordLlmCall('proj-1');
      agent.recordLlmCall('proj-1');
      agent.recordLlmCall('proj-1');
      expect(agent.isLlmRateLimited('proj-1')).toBe(true);

      vi.advanceTimersByTime(3_600_001);

      expect(agent.isLlmRateLimited('proj-1')).toBe(false);
    });
  });

  describe('config', () => {
    it('returns default config', () => {
      const agent = new OpsAgent(mockCtx);
      const config = agent.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.thresholds.alert_dedup_minutes).toBe(15);
    });

    it('merges partial config overrides from constructor', () => {
      const agent = new OpsAgent(mockCtx, { enabled: false });
      expect(agent.getConfig().enabled).toBe(false);
      expect(agent.getConfig().recovery.enabled).toBe(true);
    });

    it('reloads config at runtime preserving unset fields', () => {
      const agent = new OpsAgent(mockCtx);
      agent.reloadConfig({ auto_cleanup: false });
      expect(agent.getConfig().auto_cleanup).toBe(false);
      expect(agent.getConfig().enabled).toBe(true);
    });

    it('migrates legacy auto_restart=true in reloadConfig', () => {
      const agent = new OpsAgent(mockCtx);
      agent.reloadConfig({ auto_restart: true } as any);
      expect(agent.getConfig().recovery.enabled).toBe(true);
    });

    it('migrates legacy auto_restart=false in reloadConfig', () => {
      const agent = new OpsAgent(mockCtx);
      agent.reloadConfig({ auto_restart: false } as any);
      expect(agent.getConfig().recovery.enabled).toBe(false);
    });

    it('accepts new recovery config format in reloadConfig', () => {
      const agent = new OpsAgent(mockCtx);
      agent.reloadConfig({
        recovery: {
          enabled: false,
          automation: DEFAULT_RECOVERY_AUTOMATION,
        },
      });
      expect(agent.getConfig().recovery.enabled).toBe(false);
    });
  });

  describe('recovery wiring', () => {
    it('applies project-level recovery automation override', async () => {
      mockCtx.db.getProjectOpsOverride.mockReturnValue({
        automation: { restart: 'confirm' },
      });

      const agent = new OpsAgent(mockCtx);
      const recoveryExecute = vi.fn(async () => 'skipped');

      (agent as any).cascade = {
        recordFailure: vi.fn(),
        detectCascade: vi.fn(async () => null),
        buildCascadeAlert: vi.fn(),
      };
      (agent as any).incidents = {
        openIncident: vi.fn(() => ({ id: 'inc-1' })),
        resolveIncident: vi.fn(),
        escalateIncident: vi.fn(),
      };
      (agent as any).alerting = {
        buildContextualAlert: vi.fn(() => ({ type: 'alert' })),
        sendAlert: vi.fn(async () => undefined),
      };
      (agent as any).recovery = {
        execute: recoveryExecute,
      };

      await (agent as any).handleCrashEvent({
        type: 'container:die',
        payload: {
          projectId: 'proj-1',
          projectName: 'Project 1',
          containerId: 'ctr-1',
        },
        timestamp: Date.now(),
      });

      expect(recoveryExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          automationPolicy: expect.objectContaining({
            restart: 'confirm',
            diagnosis: DEFAULT_RECOVERY_AUTOMATION.diagnosis,
            apply_fixes: DEFAULT_RECOVERY_AUTOMATION.apply_fixes,
            rollback: DEFAULT_RECOVERY_AUTOMATION.rollback,
          }),
        }),
      );
    });

    it('fails pending approvals during boot reconciliation after restart', async () => {
      mockCtx.db.getActionRunsByApprovalStatus.mockReturnValue([{ id: 'run-pending-1' }]);

      const agent = new OpsAgent(mockCtx);
      await agent.start();

      expect(mockCtx.db.updateActionRunStatus).toHaveBeenCalledWith(
        'run-pending-1',
        'failed',
        'Server restart interrupted approval',
      );

      await agent.stop();
    });

    it('handles recovery:approval-resolved by approving/rejecting through approvalGate', async () => {
      const agent = new OpsAgent(mockCtx);
      await agent.start();

      const approvalResolvedCall = vi
        .mocked(eventBus.on)
        .mock.calls.find((call) => call[0] === 'recovery:approval-resolved');
      const handler = approvalResolvedCall?.[1] as
        | ((payload: { actionRunId: string; approved: boolean }) => void)
        | undefined;

      expect(handler).toBeDefined();
      handler?.({ actionRunId: 'run-approve', approved: true });
      handler?.({ actionRunId: 'run-reject', approved: false });

      expect(mockCtx.approvalGate.approve).toHaveBeenCalledWith('run-approve');
      expect(mockCtx.approvalGate.reject).toHaveBeenCalledWith('run-reject');

      await agent.stop();
    });
  });
});
