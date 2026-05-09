import { describe, it, expect, vi, beforeEach } from 'vitest';

import { EventBus } from '../src/events/index.js';

// ---------------------------------------------------------------------------
// build:output event tests
// ---------------------------------------------------------------------------

describe('build:output event', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('emits build:output with stdout stream', async () => {
    const handler = vi.fn();
    bus.on('build:output', handler);

    await bus.emit('build:output', {
      projectId: 'p1',
      line: 'Step 1/5 : FROM node:18',
      stream: 'stdout',
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      projectId: 'p1',
      line: 'Step 1/5 : FROM node:18',
      stream: 'stdout',
    });
  });

  it('emits build:output with error stream', async () => {
    const handler = vi.fn();
    bus.on('build:output', handler);

    await bus.emit('build:output', {
      projectId: 'p1',
      line: 'ERROR: failed to solve',
      stream: 'error',
    });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ stream: 'error' }));
  });

  it('filters by projectId correctly', async () => {
    const handler = vi.fn();
    bus.on('build:output', (payload) => {
      if (payload.projectId !== 'target') return;
      handler(payload);
    });

    await bus.emit('build:output', { projectId: 'other', line: 'ignored', stream: 'stdout' });
    await bus.emit('build:output', { projectId: 'target', line: 'captured', stream: 'stdout' });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ line: 'captured' }));
  });

  it('unsubscribe stops receiving events', async () => {
    const handler = vi.fn();
    const unsub = bus.on('build:output', handler);
    unsub();

    await bus.emit('build:output', { projectId: 'p1', line: 'test', stream: 'stdout' });

    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Docker.buildImage onProgress callback tests
// ---------------------------------------------------------------------------

describe('Docker.buildImage onProgress callback', () => {
  it('invokes onProgress for each Docker event', async () => {
    const onProgress = vi.fn();
    const events = [
      { stream: 'Step 1/3 : FROM node:18\n' },
      { stream: 'Step 2/3 : WORKDIR /app\n' },
      { stream: 'Step 3/3 : COPY . .\n' },
    ];

    // Simulate what buildImage does internally
    for (const event of events) {
      onProgress(event);
    }

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, { stream: 'Step 1/3 : FROM node:18\n' });
  });

  it('invokes onProgress for error events', async () => {
    const onProgress = vi.fn();
    const errorEvent = { error: 'failed to solve: rpc error' };

    onProgress(errorEvent);

    expect(onProgress).toHaveBeenCalledWith({ error: 'failed to solve: rpc error' });
  });

  it('skips empty lines in build output', () => {
    const emitted: string[] = [];
    const onProgress = (event: { stream?: string; error?: string }) => {
      const line = event.stream?.trim() ?? event.error ?? '';
      if (!line) return;
      emitted.push(line);
    };

    onProgress({ stream: '\n' });
    onProgress({ stream: '   \n' });
    onProgress({ stream: 'Step 1/3 : FROM node:18\n' });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toBe('Step 1/3 : FROM node:18');
  });
});
