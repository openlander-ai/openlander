import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IncidentManager } from '../../src/monitor/ops-incidents.js';
import type { OpsIncidentRow } from '../../src/db/types.js';

vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function createMockIncident(overrides?: Partial<OpsIncidentRow>): OpsIncidentRow {
  return {
    id: 'inc-20260401-abc12',
    project_id: 'proj-1',
    severity: 'critical',
    status: 'open',
    created_at: Date.now(),
    resolved_at: null,
    escalated_at: null,
    root_cause: null,
    diagnosis: null,
    actions_taken: null,
    ...overrides,
  };
}

function createMockCtx() {
  const mockIncident = createMockIncident();
  return {
    db: {
      getActiveOpsIncident: vi.fn(() => null),
      createOpsIncident: vi.fn(() => mockIncident),
      addOpsIncidentEvent: vi.fn(),
      updateOpsIncidentStatus: vi.fn(),
      getOpsIncident: vi.fn(() => mockIncident),
      listOpsIncidentEvents: vi.fn(() => []),
    },
  } as any;
}

describe('IncidentManager', () => {
  let mockCtx: ReturnType<typeof createMockCtx>;
  let manager: IncidentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = createMockCtx();
    manager = new IncidentManager(mockCtx);
  });

  describe('openIncident', () => {
    it('creates new incident when none active', () => {
      mockCtx.db.getActiveOpsIncident.mockReturnValue(null);

      const incident = manager.openIncident('proj-1', { type: 'container_crash' });

      expect(mockCtx.db.createOpsIncident).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'proj-1',
          status: 'open',
        }),
      );
      expect(incident.id).toBe('inc-20260401-abc12');
    });

    it('returns existing active incident without creating new one', () => {
      const existingIncident = createMockIncident({ id: 'inc-existing' });
      mockCtx.db.getActiveOpsIncident.mockReturnValue(existingIncident);

      const incident = manager.openIncident('proj-1', { type: 'container_crash' });

      expect(mockCtx.db.createOpsIncident).not.toHaveBeenCalled();
      expect(incident.id).toBe('inc-existing');
    });

    it('adds detected event to newly created incident', () => {
      mockCtx.db.getActiveOpsIncident.mockReturnValue(null);

      manager.openIncident('proj-1', { type: 'container_crash' });

      expect(mockCtx.db.addOpsIncidentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          incident_id: 'inc-20260401-abc12',
          event_type: 'detected',
          description: expect.stringContaining('container_crash'),
        }),
      );
    });

    it('adds recurring event to existing incident', () => {
      const existingIncident = createMockIncident({ id: 'inc-existing' });
      mockCtx.db.getActiveOpsIncident.mockReturnValue(existingIncident);

      manager.openIncident('proj-1', {
        type: 'container_crash',
        details: 'exit code 137',
      });

      expect(mockCtx.db.addOpsIncidentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          incident_id: 'inc-existing',
          event_type: 'detected',
          description: expect.stringContaining('Recurring event'),
        }),
      );
    });

    it('infers critical severity for crash/missing/exhausted', () => {
      mockCtx.db.getActiveOpsIncident.mockReturnValue(null);
      manager.openIncident('proj-1', { type: 'container_crash' });
      expect(mockCtx.db.createOpsIncident).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'critical' }),
      );
    });

    it('infers warning severity for fail/degrad/inactive', () => {
      mockCtx.db.getActiveOpsIncident.mockReturnValue(null);
      manager.openIncident('proj-1', { type: 'deploy_failed' });
      expect(mockCtx.db.createOpsIncident).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'warning' }),
      );
    });

    it('infers info severity for unknown trigger types', () => {
      mockCtx.db.getActiveOpsIncident.mockReturnValue(null);
      manager.openIncident('proj-1', { type: 'something_else' });
      expect(mockCtx.db.createOpsIncident).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'info' }),
      );
    });
  });

  describe('resolveIncident', () => {
    it('updates status to resolved with timestamp', () => {
      manager.resolveIncident('inc-20260401-abc12', 'Auto-recovered');

      expect(mockCtx.db.updateOpsIncidentStatus).toHaveBeenCalledWith(
        'inc-20260401-abc12',
        'resolved',
        expect.objectContaining({ resolved_at: expect.any(Number) }),
      );
    });

    it('adds recovered event with resolution message', () => {
      manager.resolveIncident('inc-20260401-abc12', 'Fixed by rollback');

      expect(mockCtx.db.addOpsIncidentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          incident_id: 'inc-20260401-abc12',
          event_type: 'recovered',
          description: 'Fixed by rollback',
        }),
      );
    });

    it('uses default message when no resolution provided', () => {
      manager.resolveIncident('inc-20260401-abc12');

      expect(mockCtx.db.addOpsIncidentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'recovered',
          description: 'Incident resolved',
        }),
      );
    });
  });

  describe('escalateIncident', () => {
    it('updates status to escalated with timestamp', () => {
      manager.escalateIncident('inc-20260401-abc12', 'Recovery exhausted');

      expect(mockCtx.db.updateOpsIncidentStatus).toHaveBeenCalledWith(
        'inc-20260401-abc12',
        'escalated',
        expect.objectContaining({ escalated_at: expect.any(Number) }),
      );
    });

    it('adds escalated event with reason', () => {
      manager.escalateIncident('inc-20260401-abc12', 'Max retries reached');

      expect(mockCtx.db.addOpsIncidentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          incident_id: 'inc-20260401-abc12',
          event_type: 'escalated',
          description: 'Max retries reached',
        }),
      );
    });
  });

  describe('getActiveIncident', () => {
    it('returns null when no active incident exists', () => {
      mockCtx.db.getActiveOpsIncident.mockReturnValue(null);
      expect(manager.getActiveIncident('proj-1')).toBeNull();
    });

    it('returns the active incident', () => {
      const incident = createMockIncident();
      mockCtx.db.getActiveOpsIncident.mockReturnValue(incident);
      expect(manager.getActiveIncident('proj-1')).toEqual(incident);
    });
  });

  describe('getIncidentWithTimeline', () => {
    it('returns incident with its events', () => {
      const mockEvents = [
        {
          id: 'evt-1',
          incident_id: 'inc-20260401-abc12',
          event_type: 'detected',
          description: 'Crash detected',
          metadata: null,
          created_at: Date.now(),
        },
      ];
      mockCtx.db.listOpsIncidentEvents.mockReturnValue(mockEvents);

      const result = manager.getIncidentWithTimeline('inc-20260401-abc12');

      expect(result).not.toBeNull();
      expect(result!.incident.id).toBe('inc-20260401-abc12');
      expect(result!.events).toHaveLength(1);
    });

    it('returns null for nonexistent incident', () => {
      mockCtx.db.getOpsIncident.mockReturnValue(null);
      expect(manager.getIncidentWithTimeline('nonexistent')).toBeNull();
    });
  });

  describe('addEvent', () => {
    it('persists event with metadata as JSON', () => {
      manager.addEvent('inc-123', 'action_taken', 'Restarted container', { attempt: 1 });

      expect(mockCtx.db.addOpsIncidentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          incident_id: 'inc-123',
          event_type: 'action_taken',
          description: 'Restarted container',
          metadata: JSON.stringify({ attempt: 1 }),
        }),
      );
    });

    it('passes undefined metadata when not provided', () => {
      manager.addEvent('inc-123', 'diagnosed', 'OOM detected');

      expect(mockCtx.db.addOpsIncidentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          incident_id: 'inc-123',
          event_type: 'diagnosed',
          description: 'OOM detected',
          metadata: undefined,
        }),
      );
    });
  });
});
