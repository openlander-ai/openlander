/**
 * Event Contract Preservation Tests
 *
 * This test suite locks the payload shapes for 10 key monitoring events.
 * Any future change that breaks these tests is a contract violation.
 *
 * These events are critical to the health check refactor and recovery system.
 * Changing payload shapes requires updating both this test AND all subscribers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../../src/events/index.js';
import type { EventPayload } from '../../src/events/index.js';

describe('Event Contract Preservation', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  afterEach(() => {
    bus.clear();
  });

  // ============================================================================
  // Event 1: health:degraded
  // Subscribers: RecoveryCoordinator
  // ============================================================================

  describe('health:degraded', () => {
    it('payload has required fields: projectId, consecutiveFailures, lastError', async () => {
      const received: unknown[] = [];
      bus.on('health:degraded', (p) => {
        received.push(p);
      });

      const payload: EventPayload['health:degraded'] = {
        projectId: 'proj-123',
        consecutiveFailures: 3,
        lastError: 'Connection timeout',
      };

      await bus.emit('health:degraded', payload);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        projectId: 'proj-123',
        consecutiveFailures: 3,
        lastError: 'Connection timeout',
      });
    });

    it('lastError can be null', async () => {
      const received: unknown[] = [];
      bus.on('health:degraded', (p) => {
        received.push(p);
      });

      const payload: EventPayload['health:degraded'] = {
        projectId: 'proj-456',
        consecutiveFailures: 1,
        lastError: null,
      };

      await bus.emit('health:degraded', payload);

      expect(received[0]).toMatchObject({
        projectId: 'proj-456',
        consecutiveFailures: 1,
        lastError: null,
      });
    });
  });

  // ============================================================================
  // Event 2: monitor:healthcheck
  // Subscribers: RollbackWatcher
  // ============================================================================

  describe('monitor:healthcheck', () => {
    it('payload has required fields: projectId, healthy, responseTimeMs', async () => {
      const received: unknown[] = [];
      bus.on('monitor:healthcheck', (p) => {
        received.push(p);
      });

      const payload: EventPayload['monitor:healthcheck'] = {
        projectId: 'proj-789',
        healthy: true,
        responseTimeMs: 245,
      };

      await bus.emit('monitor:healthcheck', payload);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        projectId: 'proj-789',
        healthy: true,
        responseTimeMs: 245,
      });
    });

    it('healthy can be false', async () => {
      const received: unknown[] = [];
      bus.on('monitor:healthcheck', (p) => {
        received.push(p);
      });

      const payload: EventPayload['monitor:healthcheck'] = {
        projectId: 'proj-999',
        healthy: false,
        responseTimeMs: 5000,
      };

      await bus.emit('monitor:healthcheck', payload);

      expect(received[0]).toMatchObject({
        projectId: 'proj-999',
        healthy: false,
        responseTimeMs: 5000,
      });
    });
  });

  // ============================================================================
  // Event 3: container:die
  // Subscribers: RecoveryCoordinator, AlertManager
  // ============================================================================

  describe('container:die', () => {
    it('payload has required fields: projectId, containerId, containerName, exitCode', async () => {
      const received: unknown[] = [];
      bus.on('container:die', (p) => {
        received.push(p);
      });

      const payload: EventPayload['container:die'] = {
        projectId: 'proj-die-1',
        containerId: 'abc123def456',
        containerName: 'ol-myapp',
        exitCode: 1,
      };

      await bus.emit('container:die', payload);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        projectId: 'proj-die-1',
        containerId: 'abc123def456',
        containerName: 'ol-myapp',
        exitCode: 1,
      });
    });

    it('exitCode can be 0 (clean exit)', async () => {
      const received: unknown[] = [];
      bus.on('container:die', (p) => {
        received.push(p);
      });

      const payload: EventPayload['container:die'] = {
        projectId: 'proj-die-2',
        containerId: 'xyz789',
        containerName: 'ol-worker',
        exitCode: 0,
      };

      await bus.emit('container:die', payload);

      expect(received[0]).toMatchObject({
        exitCode: 0,
      });
    });

    it('exitCode can be negative (signal)', async () => {
      const received: unknown[] = [];
      bus.on('container:die', (p) => {
        received.push(p);
      });

      const payload: EventPayload['container:die'] = {
        projectId: 'proj-die-3',
        containerId: 'sig999',
        containerName: 'ol-service',
        exitCode: -15, // SIGTERM
      };

      await bus.emit('container:die', payload);

      expect(received[0]).toMatchObject({
        exitCode: -15,
      });
    });
  });

  // ============================================================================
  // Event 4: container:oom
  // Subscribers: RecoveryCoordinator, AlertManager
  // ============================================================================

  describe('container:oom', () => {
    it('payload has required fields: projectId, containerId, containerName', async () => {
      const received: unknown[] = [];
      bus.on('container:oom', (p) => {
        received.push(p);
      });

      const payload: EventPayload['container:oom'] = {
        projectId: 'proj-oom-1',
        containerId: 'mem123',
        containerName: 'ol-memory-hog',
      };

      await bus.emit('container:oom', payload);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        projectId: 'proj-oom-1',
        containerId: 'mem123',
        containerName: 'ol-memory-hog',
      });
    });
  });

  // ============================================================================
  // Event 5: container:missing
  // Subscribers: RecoveryCoordinator
  // ============================================================================

  describe('container:missing', () => {
    it('payload has required fields: projectId, projectName, containerId, suggestion', async () => {
      const received: unknown[] = [];
      bus.on('container:missing', (p) => {
        received.push(p);
      });

      const payload: EventPayload['container:missing'] = {
        projectId: 'proj-missing-1',
        projectName: 'My App',
        containerId: 'missing-abc',
        suggestion: 'Container was removed. Redeploy to recreate.',
      };

      await bus.emit('container:missing', payload);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        projectId: 'proj-missing-1',
        projectName: 'My App',
        containerId: 'missing-abc',
        suggestion: 'Container was removed. Redeploy to recreate.',
      });
    });
  });

  // ============================================================================
  // Event 6: alert:new
  // Subscribers: AlertManager, WebSocket broadcast
  // ============================================================================

  describe('alert:new', () => {
    it('payload has required field: alert (Alert object)', async () => {
      const received: unknown[] = [];
      bus.on('alert:new', (p) => {
        received.push(p);
      });

      const payload: EventPayload['alert:new'] = {
        alert: {
          id: 'alert-123',
          type: 'resource-saturation',
          severity: 'critical',
          message: 'Container out of memory',
          details: {
            containerId: 'mem-xyz',
            containerName: 'ol-app',
          },
          suggestion: 'Increase container memory limit',
          createdAt: new Date('2026-04-15T10:00:00Z'),
          dismissed: false,
        },
      };

      await bus.emit('alert:new', payload);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        alert: expect.objectContaining({
          id: 'alert-123',
          type: 'resource-saturation',
          severity: 'critical',
        }),
      });
    });
  });

  // ============================================================================
  // Event 7: alert:resolved
  // Subscribers: AlertManager, WebSocket broadcast
  // ============================================================================

  describe('alert:resolved', () => {
    it('payload has required fields: alertId, type', async () => {
      const received: unknown[] = [];
      bus.on('alert:resolved', (p) => {
        received.push(p);
      });

      const payload: EventPayload['alert:resolved'] = {
        alertId: 'alert-456',
        type: 'container-crash',
      };

      await bus.emit('alert:resolved', payload);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        alertId: 'alert-456',
        type: 'container-crash',
      });
    });
  });

  // ============================================================================
  // Event 8: recovery:started
  // Subscribers: RecoveryCoordinator, ActivityLogger, WebSocket broadcast
  // ============================================================================

  describe('recovery:started', () => {
    it('payload has required fields: projectId, trigger, correlationId', async () => {
      const received: unknown[] = [];
      bus.on('recovery:started', (p) => {
        received.push(p);
      });

      const payload: EventPayload['recovery:started'] = {
        projectId: 'proj-recovery-1',
        trigger: 'health:degraded',
        correlationId: 'corr-abc123',
      };

      await bus.emit('recovery:started', payload);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        projectId: 'proj-recovery-1',
        trigger: 'health:degraded',
        correlationId: 'corr-abc123',
      });
    });

    it('correlationId is optional', async () => {
      const received: unknown[] = [];
      bus.on('recovery:started', (p) => {
        received.push(p);
      });

      const payload: EventPayload['recovery:started'] = {
        projectId: 'proj-recovery-2',
        trigger: 'container:die',
      };

      await bus.emit('recovery:started', payload);

      expect(received[0]).toMatchObject({
        projectId: 'proj-recovery-2',
        trigger: 'container:die',
      });
    });
  });

  // ============================================================================
  // Event 9: recovery:success
  // Subscribers: RecoveryCoordinator, ActivityLogger, WebSocket broadcast
  // ============================================================================

  describe('recovery:success', () => {
    it('payload has required fields: projectId, attempt, durationMs', async () => {
      const received: unknown[] = [];
      bus.on('recovery:success', (p) => {
        received.push(p);
      });

      const payload: EventPayload['recovery:success'] = {
        projectId: 'proj-success-1',
        attempt: 1,
        durationMs: 12345,
      };

      await bus.emit('recovery:success', payload);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        projectId: 'proj-success-1',
        attempt: 1,
        durationMs: 12345,
      });
    });

    it('optional fields: lastError, source, tokenCount, costUsd, correlationId', async () => {
      const received: unknown[] = [];
      bus.on('recovery:success', (p) => {
        received.push(p);
      });

      const payload: EventPayload['recovery:success'] = {
        projectId: 'proj-success-2',
        attempt: 2,
        durationMs: 8900,
        lastError: 'Previous attempt failed with timeout',
        source: 'dashboard',
        tokenCount: 1500,
        costUsd: 0.045,
        correlationId: 'corr-xyz789',
      };

      await bus.emit('recovery:success', payload);

      expect(received[0]).toMatchObject({
        projectId: 'proj-success-2',
        attempt: 2,
        durationMs: 8900,
        lastError: 'Previous attempt failed with timeout',
        source: 'dashboard',
        tokenCount: 1500,
        costUsd: 0.045,
        correlationId: 'corr-xyz789',
      });
    });

    it('costUsd can be null', async () => {
      const received: unknown[] = [];
      bus.on('recovery:success', (p) => {
        received.push(p);
      });

      const payload: EventPayload['recovery:success'] = {
        projectId: 'proj-success-3',
        attempt: 1,
        durationMs: 5000,
        costUsd: null,
      };

      await bus.emit('recovery:success', payload);

      expect(received[0]).toMatchObject({
        costUsd: null,
      });
    });
  });

  // ============================================================================
  // Event 10: recovery:failed
  // Subscribers: RecoveryCoordinator, ActivityLogger, WebSocket broadcast
  // ============================================================================

  describe('recovery:failed', () => {
    it('payload has required fields: projectId, error, attempt', async () => {
      const received: unknown[] = [];
      bus.on('recovery:failed', (p) => {
        received.push(p);
      });

      const payload: EventPayload['recovery:failed'] = {
        projectId: 'proj-failed-1',
        error: 'Build failed: npm install timeout',
        attempt: 1,
      };

      await bus.emit('recovery:failed', payload);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        projectId: 'proj-failed-1',
        error: 'Build failed: npm install timeout',
        attempt: 1,
      });
    });

    it('optional fields: source, correlationId', async () => {
      const received: unknown[] = [];
      bus.on('recovery:failed', (p) => {
        received.push(p);
      });

      const payload: EventPayload['recovery:failed'] = {
        projectId: 'proj-failed-2',
        error: 'Docker build OOM',
        attempt: 2,
        source: 'mcp',
        correlationId: 'corr-fail123',
      };

      await bus.emit('recovery:failed', payload);

      expect(received[0]).toMatchObject({
        projectId: 'proj-failed-2',
        error: 'Docker build OOM',
        attempt: 2,
        source: 'mcp',
        correlationId: 'corr-fail123',
      });
    });
  });

  // ============================================================================
  // Integration: Multiple subscribers on same event
  // ============================================================================

  describe('Multiple subscribers on same event', () => {
    it('all subscribers receive the same payload', async () => {
      const received1: unknown[] = [];
      const received2: unknown[] = [];
      const received3: unknown[] = [];

      bus.on('health:degraded', (p) => {
        received1.push(p);
      });
      bus.on('health:degraded', (p) => {
        received2.push(p);
      });
      bus.on('health:degraded', (p) => {
        received3.push(p);
      });

      const payload: EventPayload['health:degraded'] = {
        projectId: 'proj-multi',
        consecutiveFailures: 5,
        lastError: 'Service unreachable',
      };

      await bus.emit('health:degraded', payload);

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
      expect(received3).toHaveLength(1);

      expect(received1[0]).toEqual(received2[0]);
      expect(received2[0]).toEqual(received3[0]);
    });
  });

  // ============================================================================
  // Integration: Unsubscribe behavior
  // ============================================================================

  describe('Unsubscribe behavior', () => {
    it('unsubscribe function removes listener', async () => {
      const received: unknown[] = [];
      const unsubscribe = bus.on('container:die', (p) => {
        received.push(p);
      });

      const payload: EventPayload['container:die'] = {
        projectId: 'proj-unsub',
        containerId: 'cont-123',
        containerName: 'ol-app',
        exitCode: 1,
      };

      await bus.emit('container:die', payload);
      expect(received).toHaveLength(1);

      unsubscribe();

      await bus.emit('container:die', payload);
      expect(received).toHaveLength(1); // Still 1, not 2
    });
  });

  // ============================================================================
  // Type safety: Compile-time assertions
  // ============================================================================

  describe('Type safety', () => {
    it('health:degraded payload satisfies EventPayload type', () => {
      const payload: EventPayload['health:degraded'] = {
        projectId: 'proj-type-1',
        consecutiveFailures: 2,
        lastError: null,
      };

      // This test passes if TypeScript compilation succeeds
      expect(payload.projectId).toBe('proj-type-1');
      expect(payload.consecutiveFailures).toBe(2);
      expect(payload.lastError).toBeNull();
    });

    it('monitor:healthcheck payload satisfies EventPayload type', () => {
      const payload: EventPayload['monitor:healthcheck'] = {
        projectId: 'proj-type-2',
        healthy: true,
        responseTimeMs: 100,
      };

      expect(payload.projectId).toBe('proj-type-2');
      expect(payload.healthy).toBe(true);
      expect(payload.responseTimeMs).toBe(100);
    });

    it('container:die payload satisfies EventPayload type', () => {
      const payload: EventPayload['container:die'] = {
        projectId: 'proj-type-3',
        containerId: 'cont-abc',
        containerName: 'ol-service',
        exitCode: 137,
      };

      expect(payload.projectId).toBe('proj-type-3');
      expect(payload.containerId).toBe('cont-abc');
      expect(payload.containerName).toBe('ol-service');
      expect(payload.exitCode).toBe(137);
    });

    it('recovery:success payload satisfies EventPayload type', () => {
      const payload: EventPayload['recovery:success'] = {
        projectId: 'proj-type-4',
        attempt: 1,
        durationMs: 5000,
        costUsd: 0.05,
      };

      expect(payload.projectId).toBe('proj-type-4');
      expect(payload.attempt).toBe(1);
      expect(payload.durationMs).toBe(5000);
      expect(payload.costUsd).toBe(0.05);
    });
  });
});
