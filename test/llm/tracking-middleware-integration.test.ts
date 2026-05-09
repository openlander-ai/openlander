import { describe, it, expect, vi } from 'vitest';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { EventBus } from '../../src/events/index.js';
import { AiUsageListener } from '../../src/monitor/ai-usage-listener.js';
import { ModelRegistry } from '../../src/llm/model-registry.js';
import type { Database } from '../../src/db/index.js';

vi.mock('../../src/llm/index.js', () => ({
  createModel: vi.fn(() => ({
    specificationVersion: 'v3',
    provider: 'test-provider',
    modelId: 'test-model',
    doGenerate: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { promptTokens: 10, completionTokens: 5 },
      warnings: [],
    }),
    doStream: vi.fn(),
  })),
}));

describe('tracking-middleware integration', () => {
  it('ModelRegistry → wrapped model → EventBus → listener → DB persist', async () => {
    const createAiUsageLog = vi.fn().mockReturnValue('usage-log-1');
    const mockDb = { createAiUsageLog } as unknown as Database;

    const bus = new EventBus();
    const listener = new AiUsageListener(mockDb, bus);
    listener.start();

    const registry = new ModelRegistry(
      {
        providers: {
          test: {
            provider: 'openai',
            apiKey: 'test-key',
            defaultModel: 'gpt-4o',
          },
        },
        defaultRoute: { providerId: 'test' },
      },
      bus,
    );

    const model = registry.getModel('default');
    expect(model).not.toBeNull();

    // Call doGenerate directly on the wrapped model to trigger middleware
    const wrappedModel = model as unknown as LanguageModelV3;
    await wrappedModel.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    });

    // Drain pending microtasks (AiUsageListener uses queueMicrotask for persistence)
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(createAiUsageLog).toHaveBeenCalledOnce();
    const logEntry = createAiUsageLog.mock.calls[0]![0] as Record<string, unknown>;
    expect(logEntry.model_name).toBe('gpt-4o');
    expect(logEntry.provider).toBe('openai');
    expect(logEntry.input_tokens).toBe(10);
    expect(logEntry.output_tokens).toBe(5);
    expect(logEntry.total_tokens).toBe(15);
    expect(logEntry.result).toBe('success');

    listener.stop();
  });
});
