import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpsAlerting } from '../../src/monitor/ops-alerting.js';
import type { OpsAlert } from '../../src/monitor/ops-types.js';

vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createMockCtx() {
  return {
    channelManager: {
      broadcastStructured: vi.fn(() => Promise.resolve()),
      listConnected: vi.fn(() => []),
    },
    db: {
      addOpsIncidentEvent: vi.fn(),
    },
  } as any;
}

describe('OpsAlerting', () => {
  let mockCtx: ReturnType<typeof createMockCtx>;
  let alerting: OpsAlerting;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = createMockCtx();
    alerting = new OpsAlerting(mockCtx, { thresholds: { alert_dedup_minutes: 15 } } as any);
  });

  describe('buildContextualAlert', () => {
    it('builds alert with all required fields and defaults', () => {
      const alert = alerting.buildContextualAlert({
        severity: 'critical',
        projectId: 'proj-1',
        projectName: 'My App',
        eventType: 'container_crash',
        title: 'Container crashed',
        description: 'Container exited with code 1',
      });

      expect(alert.severity).toBe('critical');
      expect(alert.project).toEqual({ id: 'proj-1', name: 'My App' });
      expect(alert.event_type).toBe('container_crash');
      expect(alert.title).toBe('Container crashed');
      expect(alert.description).toBe('Container exited with code 1');
      expect(alert.context).toEqual({});
      expect(alert.suggestion).toBeNull();
      expect(alert.actions_taken).toEqual([]);
      expect(alert.incident_id).toBeNull();
      expect(alert.timestamp).toBeTypeOf('number');
    });

    it('includes optional fields when provided', () => {
      const alert = alerting.buildContextualAlert({
        severity: 'warning',
        projectId: 'proj-2',
        projectName: 'App 2',
        eventType: 'health_degraded',
        title: 'Health degraded',
        description: 'Health check failing',
        context: { attempts: 3 },
        suggestion: 'Check service logs',
        actionsTaken: ['restarted container'],
        incidentId: 'inc-123',
      });

      expect(alert.context).toEqual({ attempts: 3 });
      expect(alert.suggestion).toBe('Check service logs');
      expect(alert.actions_taken).toEqual(['restarted container']);
      expect(alert.incident_id).toBe('inc-123');
    });
  });

  describe('sendAlert', () => {
    it('broadcasts alert via channelManager', async () => {
      const alert = alerting.buildContextualAlert({
        severity: 'critical',
        projectId: 'proj-1',
        projectName: 'My App',
        eventType: 'container_crash',
        title: 'Container crashed',
        description: 'Container exited unexpectedly',
      });

      await alerting.sendAlert(alert);
      expect(mockCtx.channelManager.broadcastStructured).toHaveBeenCalledWith(alert);
    });

    it('logs alert as incident event when incident_id is present', async () => {
      const alert = alerting.buildContextualAlert({
        severity: 'critical',
        projectId: 'proj-1',
        projectName: 'My App',
        eventType: 'container_crash',
        title: 'Crash alert',
        description: 'Crash desc',
        incidentId: 'inc-abc',
      });

      await alerting.sendAlert(alert);

      expect(mockCtx.db.addOpsIncidentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          incident_id: 'inc-abc',
          event_type: 'alert_sent',
        }),
      );
    });

    it('skips incident event logging when no incident_id', async () => {
      const alert = alerting.buildContextualAlert({
        severity: 'info',
        projectId: 'proj-1',
        projectName: 'My App',
        eventType: 'test_event',
        title: 'Test',
        description: 'Test desc',
      });

      await alerting.sendAlert(alert);
      expect(mockCtx.db.addOpsIncidentEvent).not.toHaveBeenCalled();
    });
  });

  describe('deduplication', () => {
    it('suppresses duplicate alerts within dedup window', async () => {
      const alert = alerting.buildContextualAlert({
        severity: 'warning',
        projectId: 'proj-1',
        projectName: 'My App',
        eventType: 'health_degraded',
        title: 'Health degraded',
        description: 'Health check failing',
      });

      await alerting.sendAlert(alert);
      await alerting.sendAlert(alert);

      expect(mockCtx.channelManager.broadcastStructured).toHaveBeenCalledTimes(1);
    });

    it('allows different event types for same project', async () => {
      const alert1 = alerting.buildContextualAlert({
        severity: 'warning',
        projectId: 'proj-1',
        projectName: 'My App',
        eventType: 'health_degraded',
        title: 'Health degraded',
        description: 'Failing',
      });
      const alert2 = alerting.buildContextualAlert({
        severity: 'critical',
        projectId: 'proj-1',
        projectName: 'My App',
        eventType: 'container_crash',
        title: 'Crash',
        description: 'Crashed',
      });

      await alerting.sendAlert(alert1);
      await alerting.sendAlert(alert2);

      expect(mockCtx.channelManager.broadcastStructured).toHaveBeenCalledTimes(2);
    });

    it('allows same event type for different projects', async () => {
      const alert1 = alerting.buildContextualAlert({
        severity: 'warning',
        projectId: 'proj-1',
        projectName: 'App 1',
        eventType: 'health_degraded',
        title: 'Health degraded',
        description: 'Failing',
      });
      const alert2 = alerting.buildContextualAlert({
        severity: 'warning',
        projectId: 'proj-2',
        projectName: 'App 2',
        eventType: 'health_degraded',
        title: 'Health degraded',
        description: 'Failing',
      });

      await alerting.sendAlert(alert1);
      await alerting.sendAlert(alert2);

      expect(mockCtx.channelManager.broadcastStructured).toHaveBeenCalledTimes(2);
    });

    it('allows alert when dedup window is 0 minutes', async () => {
      const zeroDedupAlerting = new OpsAlerting(mockCtx, {
        thresholds: { alert_dedup_minutes: 0 },
      } as any);
      const alert = zeroDedupAlerting.buildContextualAlert({
        severity: 'info',
        projectId: 'proj-2',
        projectName: 'App 2',
        eventType: 'test',
        title: 'Test',
        description: 'Test',
      });

      await zeroDedupAlerting.sendAlert(alert);
      await zeroDedupAlerting.sendAlert(alert);

      expect(mockCtx.channelManager.broadcastStructured).toHaveBeenCalledTimes(2);
    });

    it('isDuplicate returns false for unseen alerts', () => {
      const alert: OpsAlert = {
        severity: 'warning',
        project: { id: 'proj-1', name: 'App 1' },
        event_type: 'test',
        title: 'Test',
        description: 'Test',
        context: {},
        suggestion: null,
        actions_taken: [],
        incident_id: null,
        timestamp: Date.now(),
      };

      expect(alerting.isDuplicate(alert)).toBe(false);
    });

    it('clearDedupCache allows previously-suppressed alerts', async () => {
      const alert = alerting.buildContextualAlert({
        severity: 'warning',
        projectId: 'proj-1',
        projectName: 'My App',
        eventType: 'health_degraded',
        title: 'Health degraded',
        description: 'Failing',
      });

      await alerting.sendAlert(alert);
      expect(mockCtx.channelManager.broadcastStructured).toHaveBeenCalledTimes(1);

      alerting.clearDedupCache();

      await alerting.sendAlert(alert);
      expect(mockCtx.channelManager.broadcastStructured).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateConfig', () => {
    it('updates dedup window at runtime', async () => {
      const alert = alerting.buildContextualAlert({
        severity: 'info',
        projectId: 'proj-1',
        projectName: 'App',
        eventType: 'test',
        title: 'Test',
        description: 'Test',
      });

      await alerting.sendAlert(alert);
      alerting.updateConfig({ thresholds: { alert_dedup_minutes: 0 } } as any);
      await alerting.sendAlert(alert);

      expect(mockCtx.channelManager.broadcastStructured).toHaveBeenCalledTimes(2);
    });
  });
});
