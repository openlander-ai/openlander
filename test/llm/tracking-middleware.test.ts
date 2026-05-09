import { describe, expect, it, vi, beforeEach } from 'vitest';
import { withTracking, createTrackingMiddleware } from '../../src/llm/tracking-middleware.js';

function createMockEventBus() {
  return { emit: vi.fn().mockResolvedValue(undefined) };
}

type WrapGenerateFn = (opts: { doGenerate: () => Promise<unknown> }) => Promise<unknown>;
type WrapStreamFn = (opts: {
  doStream: () => Promise<unknown>;
}) => Promise<{ stream: ReadableStream }>;

async function drainStream(stream: ReadableStream): Promise<unknown[]> {
  const reader = stream.getReader();
  const collected: unknown[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    collected.push(value);
  }
  return collected;
}

describe('withTracking', () => {
  it('runs function and returns its result', async () => {
    const result = await withTracking({ projectId: 'p1' }, async () => 'hello');
    expect(result).toBe('hello');
  });

  it('propagates context to nested async calls', async () => {
    const eventBus = createMockEventBus();
    const middleware = createTrackingMiddleware(
      eventBus as never,
      'anthropic',
      'claude-sonnet-4-6',
    );

    await withTracking(
      { projectId: 'proj-nested', sessionId: 'sess-1', actionType: 'web_agent', source: 'web' },
      async () => {
        const wrapGenerate = middleware.wrapGenerate as unknown as WrapGenerateFn;
        await wrapGenerate({
          doGenerate: async () => ({
            usage: { promptTokens: 10, completionTokens: 5 },
          }),
        });
      },
    );

    expect(eventBus.emit).toHaveBeenCalledOnce();
    const payload = eventBus.emit.mock.calls[0]![1];
    expect(payload.projectId).toBe('proj-nested');
    expect(payload.sessionId).toBe('sess-1');
    expect(payload.actionType).toBe('web_agent');
    expect(payload.source).toBe('web');
  });

  it('propagates errors from the wrapped function', async () => {
    await expect(
      withTracking({}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});

describe('createTrackingMiddleware', () => {
  let eventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    eventBus = createMockEventBus();
  });

  it('has specificationVersion v3', () => {
    const mw = createTrackingMiddleware(eventBus as never, 'openai', 'gpt-4o');
    expect((mw as Record<string, unknown>).specificationVersion).toBe('v3');
  });

  describe('wrapGenerate', () => {
    it('emits ai:usage event on success with correct fields', async () => {
      const mw = createTrackingMiddleware(eventBus as never, 'anthropic', 'claude-sonnet-4-6');
      const wrapGenerate = mw.wrapGenerate as unknown as WrapGenerateFn;

      const fakeResult = {
        usage: { promptTokens: 100, completionTokens: 50 },
        text: 'response',
      };

      const result = await wrapGenerate({ doGenerate: async () => fakeResult });

      expect(result).toBe(fakeResult);
      expect(eventBus.emit).toHaveBeenCalledOnce();

      const [eventName, payload] = eventBus.emit.mock.calls[0]!;
      expect(eventName).toBe('ai:usage');
      expect(payload.modelName).toBe('claude-sonnet-4-6');
      expect(payload.provider).toBe('anthropic');
      expect(payload.inputTokens).toBe(100);
      expect(payload.outputTokens).toBe(50);
      expect(payload.totalTokens).toBe(150);
      expect(payload.result).toBe('success');
      expect(typeof payload.durationMs).toBe('number');
      expect(payload.durationMs).toBeGreaterThanOrEqual(0);
      expect(payload.costUsd).not.toBeNull();
      expect(typeof payload.costUsd).toBe('number');
    });

    it('emits ai:usage event with result=failure and re-throws on error', async () => {
      const mw = createTrackingMiddleware(eventBus as never, 'openai', 'gpt-4o');
      const wrapGenerate = mw.wrapGenerate as unknown as WrapGenerateFn;

      await expect(
        wrapGenerate({
          doGenerate: async () => {
            throw new Error('API rate limit');
          },
        }),
      ).rejects.toThrow('API rate limit');

      expect(eventBus.emit).toHaveBeenCalledOnce();
      const payload = eventBus.emit.mock.calls[0]![1];
      expect(payload.result).toBe('failure');
      expect(payload.inputTokens).toBe(0);
      expect(payload.outputTokens).toBe(0);
      expect(payload.totalTokens).toBe(0);
      expect(payload.costUsd).toBeNull();
    });

    it('uses context from withTracking if available', async () => {
      const mw = createTrackingMiddleware(eventBus as never, 'anthropic', 'claude-sonnet-4-6');
      const wrapGenerate = mw.wrapGenerate as unknown as WrapGenerateFn;

      await withTracking(
        {
          projectId: 'proj-abc',
          sessionId: 'sess-xyz',
          actionType: 'auto_recovery',
          source: 'auto-recovery',
          toolsCalled: ['get_logs', 'restart_service'],
        },
        async () => {
          await wrapGenerate({
            doGenerate: async () => ({
              usage: { promptTokens: 200, completionTokens: 100 },
            }),
          });
        },
      );

      const payload = eventBus.emit.mock.calls[0]![1];
      expect(payload.projectId).toBe('proj-abc');
      expect(payload.sessionId).toBe('sess-xyz');
      expect(payload.actionType).toBe('auto_recovery');
      expect(payload.source).toBe('auto-recovery');
      expect(payload.toolsCalled).toEqual(['get_logs', 'restart_service']);
    });

    it('uses system defaults when no context', async () => {
      const mw = createTrackingMiddleware(eventBus as never, 'openai', 'gpt-4o');
      const wrapGenerate = mw.wrapGenerate as unknown as WrapGenerateFn;

      await wrapGenerate({
        doGenerate: async () => ({
          usage: { promptTokens: 50, completionTokens: 25 },
        }),
      });

      const payload = eventBus.emit.mock.calls[0]![1];
      expect(payload.projectId).toBeUndefined();
      expect(payload.sessionId).toBeUndefined();
      expect(payload.actionType).toBe('system');
      expect(payload.source).toBe('auto');
      expect(payload.toolsCalled).toBeUndefined();
    });
  });

  describe('wrapStream', () => {
    it('emits ai:usage event after stream completes', async () => {
      const mw = createTrackingMiddleware(eventBus as never, 'anthropic', 'claude-sonnet-4-6');
      const wrapStream = mw.wrapStream as unknown as WrapStreamFn;

      const chunks = [
        { type: 'text-delta', textDelta: 'Hello' },
        { type: 'text-delta', textDelta: ' world' },
        { type: 'finish', usage: { promptTokens: 300, completionTokens: 150 } },
      ];

      const sourceStream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      const result = await wrapStream({
        doStream: async () => ({ stream: sourceStream, rawCall: {} }),
      });

      const collected = await drainStream(result.stream);

      expect(collected).toHaveLength(3);
      expect(eventBus.emit).toHaveBeenCalledOnce();

      const [eventName, payload] = eventBus.emit.mock.calls[0]!;
      expect(eventName).toBe('ai:usage');
      expect(payload.result).toBe('success');
      expect(payload.inputTokens).toBe(300);
      expect(payload.outputTokens).toBe(150);
      expect(payload.totalTokens).toBe(450);
      expect(payload.modelName).toBe('claude-sonnet-4-6');
      expect(payload.provider).toBe('anthropic');
      expect(typeof payload.durationMs).toBe('number');
    });

    it('emits ai:usage with failure on doStream error', async () => {
      const mw = createTrackingMiddleware(eventBus as never, 'openai', 'gpt-4o');
      const wrapStream = mw.wrapStream as unknown as WrapStreamFn;

      await expect(
        wrapStream({
          doStream: async () => {
            throw new Error('stream init failed');
          },
        }),
      ).rejects.toThrow('stream init failed');

      expect(eventBus.emit).toHaveBeenCalledOnce();
      const payload = eventBus.emit.mock.calls[0]![1];
      expect(payload.result).toBe('failure');
      expect(payload.inputTokens).toBe(0);
      expect(payload.outputTokens).toBe(0);
    });

    it('uses context from withTracking in stream', async () => {
      const mw = createTrackingMiddleware(eventBus as never, 'anthropic', 'claude-sonnet-4-6');
      const wrapStream = mw.wrapStream as unknown as WrapStreamFn;

      await withTracking(
        { projectId: 'proj-stream', actionType: 'build_debugger', source: 'mcp' },
        async () => {
          const sourceStream = new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: 'finish',
                usage: { promptTokens: 50, completionTokens: 20 },
              });
              controller.close();
            },
          });

          const result = await wrapStream({
            doStream: async () => ({ stream: sourceStream }),
          });

          await drainStream(result.stream);
        },
      );

      const payload = eventBus.emit.mock.calls[0]![1];
      expect(payload.projectId).toBe('proj-stream');
      expect(payload.actionType).toBe('build_debugger');
      expect(payload.source).toBe('mcp');
    });

    it('emits usage only once even with multiple finish chunks', async () => {
      const mw = createTrackingMiddleware(eventBus as never, 'openai', 'gpt-4o');
      const wrapStream = mw.wrapStream as unknown as WrapStreamFn;

      const sourceStream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'finish',
            usage: { promptTokens: 10, completionTokens: 5 },
          });
          controller.enqueue({
            type: 'finish',
            usage: { promptTokens: 999, completionTokens: 999 },
          });
          controller.close();
        },
      });

      const result = await wrapStream({
        doStream: async () => ({ stream: sourceStream }),
      });

      await drainStream(result.stream);

      expect(eventBus.emit).toHaveBeenCalledOnce();
    });

    it('emits failure usage when stream is cancelled mid-consumption', async () => {
      const mw = createTrackingMiddleware(eventBus as never, 'anthropic', 'claude-sonnet-4-6');
      const wrapStream = mw.wrapStream as unknown as WrapStreamFn;

      const sourceStream = new ReadableStream({
        pull(controller) {
          controller.enqueue({ type: 'text-delta', textDelta: 'data' });
        },
      });

      const result = await wrapStream({
        doStream: async () => ({ stream: sourceStream }),
      });

      const reader = result.stream.getReader();
      await reader.read();
      await reader.cancel('user abort');

      expect(eventBus.emit).toHaveBeenCalledOnce();
      const payload = eventBus.emit.mock.calls[0]![1];
      expect(payload.result).toBe('failure');
      expect(payload.inputTokens).toBe(0);
      expect(payload.outputTokens).toBe(0);
    });
  });
});
