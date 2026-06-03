import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CascadeDetector } from '../../src/monitor/ops-cascade.js';

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
    db: {
      listServices: vi.fn(() => [{ id: 'svc-postgres', name: 'postgres' }]),
      listServiceConnectionsByService: vi.fn((serviceId: string) => {
        if (serviceId === 'svc-postgres') {
          // Post-0012: canonical field names are service_id_provider / service_id_consumer.
          return [
            { service_id_provider: 'svc-postgres', service_id_consumer: 'proj-1' },
            { service_id_provider: 'svc-postgres', service_id_consumer: 'proj-2' },
            { service_id_provider: 'svc-postgres', service_id_consumer: 'proj-3' },
          ];
        }
        return [];
      }),
      getProject: vi.fn((id: string) => ({ id, name: `Project ${id}` })),
      getService: vi.fn(() => ({ id: 'svc-postgres', name: 'postgres' })),
    },
  } as any;
}

describe('CascadeDetector', () => {
  let mockCtx: ReturnType<typeof createMockCtx>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = createMockCtx();
  });

  describe('detectCascade', () => {
    it('detects cascade when multiple projects sharing a service fail', async () => {
      const detector = new CascadeDetector(mockCtx);
      await detector.recordFailure('proj-1');
      await detector.recordFailure('proj-2');
      await detector.recordFailure('proj-3');

      const result = await detector.detectCascade(['proj-1', 'proj-2', 'proj-3']);

      expect(result).not.toBeNull();
      expect(result!.rootServiceId).toBe('svc-postgres');
      expect(result!.rootServiceName).toBe('postgres');
      expect(result!.affectedProjectIds).toHaveLength(3);
      expect(result!.affectedProjectNames).toHaveLength(3);
    });

    it('returns null when fewer than 2 recent failures', async () => {
      const detector = new CascadeDetector(mockCtx);
      await detector.recordFailure('proj-1');

      const result = await detector.detectCascade(['proj-1']);
      expect(result).toBeNull();
    });

    it('returns null when no shared service among failed projects', async () => {
      mockCtx.db.listServiceConnectionsByService.mockReturnValue([]);

      const detector = new CascadeDetector(mockCtx);
      await detector.recordFailure('proj-1');
      await detector.recordFailure('proj-2');

      const result = await detector.detectCascade(['proj-1', 'proj-2']);
      expect(result).toBeNull();
    });

    it('returns null when failures are outside 30s correlation window', async () => {
      vi.useFakeTimers();
      try {
        const detector = new CascadeDetector(mockCtx);

        await detector.recordFailure('proj-1');
        vi.advanceTimersByTime(31_000);
        await detector.recordFailure('proj-2');

        const result = await detector.detectCascade(['proj-1', 'proj-2']);
        expect(result).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('only includes projects that share the failing service', async () => {
      mockCtx.db.listServiceConnectionsByService.mockImplementation((serviceId: string) => {
        if (serviceId === 'svc-postgres') {
          return [
            { service_id_provider: 'svc-postgres', service_id_consumer: 'proj-1' },
            { service_id_provider: 'svc-postgres', service_id_consumer: 'proj-2' },
          ];
        }
        return [];
      });

      const detector = new CascadeDetector(mockCtx);
      await detector.recordFailure('proj-1');
      await detector.recordFailure('proj-2');
      await detector.recordFailure('proj-4');

      const result = await detector.detectCascade(['proj-1', 'proj-2', 'proj-4']);

      expect(result).not.toBeNull();
      expect(result!.affectedProjectIds).toContain('proj-1');
      expect(result!.affectedProjectIds).toContain('proj-2');
      expect(result!.affectedProjectIds).not.toContain('proj-4');
    });
  });

  describe('buildCascadeAlert', () => {
    it('builds critical cascade_failure alert', () => {
      const detector = new CascadeDetector(mockCtx);

      const cascadeResult = {
        rootServiceId: 'svc-postgres',
        rootServiceName: 'postgres',
        affectedProjectIds: ['proj-1', 'proj-2', 'proj-3'],
        affectedProjectNames: ['App 1', 'App 2', 'App 3'],
      };

      const alert = detector.buildCascadeAlert(cascadeResult);

      expect(alert.severity).toBe('critical');
      expect(alert.event_type).toBe('cascade_failure');
      expect(alert.project.id).toBe('svc-postgres');
      expect(alert.project.name).toBe('postgres');
      expect(alert.title).toContain('3 projects');
      expect(alert.description).toContain('App 1');
      expect(alert.suggestion).toContain('postgres');
    });

    it('includes incident_id when provided', () => {
      const detector = new CascadeDetector(mockCtx);
      const cascadeResult = {
        rootServiceId: 'svc-redis',
        rootServiceName: 'redis',
        affectedProjectIds: ['proj-1', 'proj-2'],
        affectedProjectNames: ['App 1', 'App 2'],
      };

      const alert = detector.buildCascadeAlert(cascadeResult, 'inc-cascade-1');
      expect(alert.incident_id).toBe('inc-cascade-1');
    });

    it('defaults incident_id to null', () => {
      const detector = new CascadeDetector(mockCtx);
      const cascadeResult = {
        rootServiceId: 'svc-redis',
        rootServiceName: 'redis',
        affectedProjectIds: ['proj-1', 'proj-2'],
        affectedProjectNames: ['App 1', 'App 2'],
      };

      const alert = detector.buildCascadeAlert(cascadeResult);
      expect(alert.incident_id).toBeNull();
    });
  });

  describe('cleanupOldFailures', () => {
    it('removes failures older than 2x correlation window', async () => {
      vi.useFakeTimers();
      try {
        const detector = new CascadeDetector(mockCtx);

        await detector.recordFailure('proj-old');
        vi.advanceTimersByTime(61_000);
        await detector.recordFailure('proj-new');

        detector.cleanupOldFailures();

        const result = await detector.detectCascade(['proj-old', 'proj-new']);
        expect(result).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('recordFailure', () => {
    it('records failure without error', async () => {
      const detector = new CascadeDetector(mockCtx);
      await detector.recordFailure('proj-1');
      await detector.recordFailure('proj-2');
    });

    it('overwrites previous timestamp on repeated calls', async () => {
      const detector = new CascadeDetector(mockCtx);

      await detector.recordFailure('proj-1');
      await detector.recordFailure('proj-1');
      await detector.recordFailure('proj-2');

      const result = await detector.detectCascade(['proj-1', 'proj-2']);
      expect(result).not.toBeNull();
    });
  });
});
