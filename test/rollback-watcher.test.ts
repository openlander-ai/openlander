import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RollbackWatcher } from '../src/monitor/rollback-watcher.js';
import { EventBus } from '../src/events/index.js';
import type { Database } from '../src/db/index.js';

function createMockDb(overrides?: {
  previous_image_tag?: string | null;
  name?: string;
  returnNull?: boolean;
}): Database {
  return {
    getProject: vi.fn().mockReturnValue(
      overrides?.returnNull
        ? null
        : {
            name: overrides?.name ?? 'test-project',
            previous_image_tag:
              'previous_image_tag' in (overrides ?? {})
                ? overrides?.previous_image_tag
                : 'old-image:v1',
          },
    ),
  } as unknown as Database;
}

describe('RollbackWatcher', () => {
  let events: EventBus;
  let db: Database;
  let watcher: RollbackWatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    events = new EventBus();
    db = createMockDb();
    watcher = new RollbackWatcher(events, db);
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
  });

  it('start() subscribes to deploy:success and monitor:healthcheck', () => {
    expect(events.listenerCount('deploy:success')).toBe(0);
    expect(events.listenerCount('monitor:healthcheck')).toBe(0);

    watcher.start();

    expect(events.listenerCount('deploy:success')).toBe(1);
    expect(events.listenerCount('monitor:healthcheck')).toBe(1);
  });

  it('does not start watching without previous_image_tag', async () => {
    const localEvents = new EventBus();
    const localDb = createMockDb({ previous_image_tag: null });
    const localWatcher = new RollbackWatcher(localEvents, localDb);
    localWatcher.start();

    const rollbackHandler = vi.fn();
    localEvents.on('rollback:suggested', rollbackHandler);

    await localEvents.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://test.localhost',
      totalDurationMs: 1000,
    });

    // Send 3 unhealthy checks — should NOT trigger rollback since no watch was started
    for (let i = 0; i < 3; i++) {
      await localEvents.emit('monitor:healthcheck', {
        projectId: 'p1',
        healthy: false,
        responseTimeMs: 100,
      });
    }

    expect(rollbackHandler).not.toHaveBeenCalled();
    localWatcher.stop();
  });

  it('does not start watching if project not found', async () => {
    const localEvents = new EventBus();
    const localDb = createMockDb({ returnNull: true });
    const localWatcher = new RollbackWatcher(localEvents, localDb);
    localWatcher.start();

    const rollbackHandler = vi.fn();
    localEvents.on('rollback:suggested', rollbackHandler);

    await localEvents.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://test.localhost',
      totalDurationMs: 1000,
    });

    for (let i = 0; i < 3; i++) {
      await localEvents.emit('monitor:healthcheck', {
        projectId: 'p1',
        healthy: false,
        responseTimeMs: 100,
      });
    }

    expect(rollbackHandler).not.toHaveBeenCalled();
    localWatcher.stop();
  });

  it('healthy health checks reset consecutive failure counter', async () => {
    watcher.start();

    const rollbackHandler = vi.fn();
    events.on('rollback:suggested', rollbackHandler);

    await events.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://test.localhost',
      totalDurationMs: 1000,
    });

    // 2 failures, then 1 healthy reset, then 2 more failures — should NOT reach threshold of 3
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: true,
      responseTimeMs: 50,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });

    expect(rollbackHandler).not.toHaveBeenCalled();
  });

  it('emits rollback:suggested after 3 consecutive failures', async () => {
    watcher.start();

    const rollbackHandler = vi.fn();
    events.on('rollback:suggested', rollbackHandler);

    await events.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://test.localhost',
      totalDurationMs: 1000,
    });

    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });

    expect(rollbackHandler).toHaveBeenCalledOnce();
    expect(rollbackHandler).toHaveBeenCalledWith({
      projectId: 'p1',
      projectName: 'test-project',
      consecutiveFailures: 3,
      previousImageTag: 'old-image:v1',
    });
  });

  it('stops watching a project after emitting rollback:suggested', async () => {
    watcher.start();

    const rollbackHandler = vi.fn();
    events.on('rollback:suggested', rollbackHandler);

    await events.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://test.localhost',
      totalDurationMs: 1000,
    });

    // Trigger rollback
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    expect(rollbackHandler).toHaveBeenCalledOnce();

    // Further health checks should NOT trigger another rollback
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });

    expect(rollbackHandler).toHaveBeenCalledOnce(); // Still just 1
  });

  it('watch duration timeout stops watching after 60 seconds', async () => {
    watcher.start();

    const rollbackHandler = vi.fn();
    events.on('rollback:suggested', rollbackHandler);

    await events.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://test.localhost',
      totalDurationMs: 1000,
    });

    // Advance past watch duration
    vi.advanceTimersByTime(60_001);

    // Health checks after timeout should be ignored
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });

    expect(rollbackHandler).not.toHaveBeenCalled();
  });

  it('stop() unsubscribes from all events', () => {
    watcher.start();
    expect(events.listenerCount('deploy:success')).toBe(1);
    expect(events.listenerCount('monitor:healthcheck')).toBe(1);

    watcher.stop();

    expect(events.listenerCount('deploy:success')).toBe(0);
    expect(events.listenerCount('monitor:healthcheck')).toBe(0);
  });

  it('stop() clears all active watchers and timers', async () => {
    watcher.start();

    const rollbackHandler = vi.fn();
    events.on('rollback:suggested', rollbackHandler);

    await events.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://test.localhost',
      totalDurationMs: 1000,
    });

    // 2 failures (not yet threshold)
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });

    watcher.stop();

    // Re-subscribe to events to verify stop cleared watchers
    // Even with a new watcher.start(), old state should be gone
    watcher = new RollbackWatcher(events, db);
    watcher.start();

    // 1 more failure should NOT trigger rollback because old watcher was stopped
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });

    expect(rollbackHandler).not.toHaveBeenCalled();
  });

  it('stop() can be called multiple times safely', () => {
    watcher.start();
    watcher.stop();
    watcher.stop();

    expect(events.listenerCount('deploy:success')).toBe(0);
    expect(events.listenerCount('monitor:healthcheck')).toBe(0);
  });

  it('ignores health checks for projects not being watched', async () => {
    watcher.start();

    const rollbackHandler = vi.fn();
    events.on('rollback:suggested', rollbackHandler);

    // No deploy:success emitted, so no project is being watched
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });

    expect(rollbackHandler).not.toHaveBeenCalled();
  });

  it('watches multiple projects independently', async () => {
    watcher.start();

    const rollbackHandler = vi.fn();
    events.on('rollback:suggested', rollbackHandler);

    // Deploy two projects
    await events.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://p1.localhost',
      totalDurationMs: 1000,
    });
    await events.emit('deploy:success', {
      projectId: 'p2',
      url: 'http://p2.localhost',
      totalDurationMs: 1000,
    });

    // p1 fails 3 times → triggers rollback
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: false,
      responseTimeMs: 100,
    });

    // p2 fails only 2 times → no rollback
    await events.emit('monitor:healthcheck', {
      projectId: 'p2',
      healthy: false,
      responseTimeMs: 100,
    });
    await events.emit('monitor:healthcheck', {
      projectId: 'p2',
      healthy: false,
      responseTimeMs: 100,
    });

    expect(rollbackHandler).toHaveBeenCalledOnce();
    expect(rollbackHandler).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }));
  });
});
