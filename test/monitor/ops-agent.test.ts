import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OpsEvent } from '../../src/monitor/ops-types.js';

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
    },
    docker: {},
    channelManager: { broadcastStructured: vi.fn(), listConnected: vi.fn(() => []) },
    config: { ops: {} },
  } as any;
}

describe('OpsAgent', () => {
  let mockCtx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = createMockCtx();
  });

  describe('start / stop', () => {
    it('subscribes to 7 event types on start', async () => {
      const agent = new OpsAgent(mockCtx);
      await agent.start();
      expect(eventBus.on).toHaveBeenCalledTimes(7);
      await agent.stop();
    });

    it('unsubscribes from all events on stop', async () => {
      const agent = new OpsAgent(mockCtx);
      await agent.start();
      await agent.stop();
      expect(mockUnsubscribe).toHaveBeenCalledTimes(7);
    });

    it('is idempotent — second start is no-op', async () => {
      const agent = new OpsAgent(mockCtx);
      await agent.start();
      await agent.start();
      expect(eventBus.on).toHaveBeenCalledTimes(7);
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
      expect(agent.getConfig().auto_restart).toBe(true);
    });

    it('reloads config at runtime preserving unset fields', () => {
      const agent = new OpsAgent(mockCtx);
      agent.reloadConfig({ auto_cleanup: false });
      expect(agent.getConfig().auto_cleanup).toBe(false);
      expect(agent.getConfig().enabled).toBe(true);
    });
  });
});
