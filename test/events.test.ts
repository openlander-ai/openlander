import { describe, it, expect, vi } from 'vitest';

import { EventBus } from '../src/events/index.js';

describe('EventBus', () => {
  it('emits and receives events', async () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('deploy:start', handler);
    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'https://github.com/test/a' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ projectId: 'p1', repoUrl: 'https://github.com/test/a' });
  });

  it('supports multiple handlers', async () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('deploy:success', handler1);
    bus.on('deploy:success', handler2);

    await bus.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://test.localhost',
      totalDurationMs: 1000,
    });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('unsubscribe removes handler', async () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const unsubscribe = bus.on('deploy:start', handler);
    unsubscribe();

    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'test' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('once fires only once', async () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.once('container:stop', handler);

    await bus.emit('container:stop', { projectId: 'p1', containerId: 'c1' });
    await bus.emit('container:stop', { projectId: 'p1', containerId: 'c1' });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('clear removes all handlers for an event', async () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('deploy:start', handler);
    bus.clear('deploy:start');

    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'test' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('clear() without args removes all handlers', async () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('deploy:start', handler1);
    bus.on('deploy:success', handler2);
    bus.clear();

    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'test' });
    await bus.emit('deploy:success', { projectId: 'p1', url: 'test', totalDurationMs: 0 });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('listenerCount returns correct count', () => {
    const bus = new EventBus();

    expect(bus.listenerCount('deploy:start')).toBe(0);

    bus.on('deploy:start', () => {});
    bus.on('deploy:start', () => {});

    expect(bus.listenerCount('deploy:start')).toBe(2);
  });

  it('handler errors are caught and do not break other handlers', async () => {
    const bus = new EventBus();
    const errorHandler = vi.fn(() => {
      throw new Error('test error');
    });
    const goodHandler = vi.fn();

    // Suppress console.error during test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    bus.on('deploy:start', errorHandler);
    bus.on('deploy:start', goodHandler);

    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'test' });

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(goodHandler).toHaveBeenCalledOnce(); // Still called despite first handler error

    consoleSpy.mockRestore();
  });
});
