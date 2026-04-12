import { describe, it, expect, vi } from 'vitest';

import { EventBus } from '../../src/events/index.js';

describe('EventBus capture hook', () => {
  it('capture hook receives all emitted events', async () => {
    const bus = new EventBus();
    const captureHook = vi.fn();

    bus.setCaptureHook(captureHook);

    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'https://github.com/test/a' });
    await bus.emit('deploy:failed', {
      projectId: 'p1',
      step: 'build',
      error: 'Build failed',
    });

    expect(captureHook).toHaveBeenCalledTimes(2);
    expect(captureHook).toHaveBeenNthCalledWith(1, 'deploy:start', {
      projectId: 'p1',
      repoUrl: 'https://github.com/test/a',
    });
    expect(captureHook).toHaveBeenNthCalledWith(2, 'deploy:failed', {
      projectId: 'p1',
      step: 'build',
      error: 'Build failed',
    });
  });

  it('capture hook error does not break emit flow', async () => {
    const bus = new EventBus();
    const captureHook = vi.fn(() => {
      throw new Error('capture hook error');
    });
    const normalHandler = vi.fn();

    bus.setCaptureHook(captureHook);
    bus.on('deploy:start', normalHandler);

    // Suppress console.error during test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'test' });

    expect(captureHook).toHaveBeenCalledOnce();
    expect(normalHandler).toHaveBeenCalledOnce(); // Still called despite capture hook error

    consoleSpy.mockRestore();
  });

  it('no capture hook by default (no regression)', async () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('deploy:start', handler);

    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'test' });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('removeCaptureHook stops capturing', async () => {
    const bus = new EventBus();
    const captureHook = vi.fn();

    bus.setCaptureHook(captureHook);
    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'test' });

    expect(captureHook).toHaveBeenCalledOnce();

    bus.removeCaptureHook();
    await bus.emit('deploy:failed', { projectId: 'p1', step: 'build', error: 'error' });

    expect(captureHook).toHaveBeenCalledOnce(); // Still only 1 call
  });

  it('capture hook fires even when no handlers registered', async () => {
    const bus = new EventBus();
    const captureHook = vi.fn();

    bus.setCaptureHook(captureHook);

    // Emit event with no registered handlers
    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'test' });

    expect(captureHook).toHaveBeenCalledOnce();
    expect(captureHook).toHaveBeenCalledWith('deploy:start', {
      projectId: 'p1',
      repoUrl: 'test',
    });
  });
});
