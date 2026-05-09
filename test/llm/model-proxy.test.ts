import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import type { AIModelFeature, ModelRegistry } from '../../src/llm/model-registry.js';
import { createModelProxy } from '../../src/llm/model-proxy.js';

type MinimalLanguageModelShape = {
  specificationVersion: 'v1' | 'v2';
  provider: string;
  modelId: string;
  defaultObjectGenerationMode: string;
  doGenerate: (options: unknown) => Promise<unknown>;
  doStream: (options: unknown) => Promise<unknown>;
};

type MockModelBundle = {
  model: LanguageModel;
  doGenerateMock: ReturnType<typeof vi.fn>;
  doStreamMock: ReturnType<typeof vi.fn>;
};

class MockRegistry {
  private version = 0;
  private model: LanguageModel | null;
  private circuitStatus: { state: 'closed' | 'open' | 'half_open'; failureCount: number } | null =
    null;
  readonly getModelMock = vi.fn((_feature: AIModelFeature | 'default') => this.model);
  readonly getCircuitBreakerStatusMock = vi.fn(() => this.circuitStatus);

  constructor(model: LanguageModel | null) {
    this.model = model;
  }

  getVersion(): number {
    return this.version;
  }

  getModel(feature: AIModelFeature | 'default'): LanguageModel | null {
    return this.getModelMock(feature);
  }

  getCircuitBreakerStatus(): {
    state: 'closed' | 'open' | 'half_open';
    failureCount: number;
  } | null {
    return this.getCircuitBreakerStatusMock();
  }

  setModel(model: LanguageModel | null): void {
    this.model = model;
    this.version += 1;
  }

  setCircuitStatus(
    status: {
      state: 'closed' | 'open' | 'half_open';
      failureCount: number;
    } | null,
  ): void {
    this.circuitStatus = status;
  }
}

function createMockModel(modelId: string): MockModelBundle {
  const doGenerateMock = vi.fn(async () => ({
    content: [],
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    rawCall: { rawPrompt: null, rawSettings: {} },
    warnings: [],
  }));

  const doStreamMock = vi.fn(async () => ({
    stream: new ReadableStream(),
    rawCall: { rawPrompt: null, rawSettings: {} },
    warnings: [],
  }));

  const model: MinimalLanguageModelShape = {
    specificationVersion: 'v2',
    provider: 'test-provider',
    modelId,
    defaultObjectGenerationMode: 'json',
    doGenerate: doGenerateMock,
    doStream: doStreamMock,
  };

  return {
    model: model as unknown as LanguageModel,
    doGenerateMock,
    doStreamMock,
  };
}

describe('createModelProxy', () => {
  it('delegates property reads to the current model', () => {
    const firstModel = createMockModel('gpt-first');
    const registry = new MockRegistry(firstModel.model);

    const proxy = createModelProxy(
      registry as unknown as ModelRegistry,
      'default',
    ) as unknown as MinimalLanguageModelShape;

    expect(proxy.modelId).toBe('gpt-first');
  });

  it('switches to the new live model after registry version update', () => {
    const firstModel = createMockModel('gpt-first');
    const secondModel = createMockModel('gpt-second');
    const registry = new MockRegistry(firstModel.model);

    const proxy = createModelProxy(
      registry as unknown as ModelRegistry,
      'default',
    ) as unknown as MinimalLanguageModelShape;

    expect(proxy.modelId).toBe('gpt-first');

    registry.setModel(secondModel.model);

    expect(proxy.modelId).toBe('gpt-second');
  });

  it('hits registry.getModel only once per version', () => {
    const firstModel = createMockModel('gpt-first');
    const secondModel = createMockModel('gpt-second');
    const registry = new MockRegistry(firstModel.model);

    const proxy = createModelProxy(
      registry as unknown as ModelRegistry,
      'buildDebugger',
    ) as unknown as MinimalLanguageModelShape;

    void proxy.modelId;
    void proxy.provider;
    void proxy.defaultObjectGenerationMode;

    expect(registry.getModelMock).toHaveBeenCalledTimes(1);
    expect(registry.getModelMock).toHaveBeenCalledWith('buildDebugger');

    registry.setModel(secondModel.model);

    void proxy.modelId;
    void proxy.provider;

    expect(registry.getModelMock).toHaveBeenCalledTimes(2);
  });

  it('throws descriptive error when model is null', () => {
    const registry = new MockRegistry(null);
    const proxy = createModelProxy(
      registry as unknown as ModelRegistry,
      'webAgent',
    ) as unknown as MinimalLanguageModelShape;

    expect(() => proxy.modelId).toThrow(
      'LLM not configured for feature "webAgent". Add a provider in Settings → AI Model.',
    );
  });

  it('throws circuit breaker error when provider is temporarily blocked', () => {
    const registry = new MockRegistry(null);
    registry.setCircuitStatus({ state: 'open', failureCount: 3 });
    const proxy = createModelProxy(
      registry as unknown as ModelRegistry,
      'webAgent',
    ) as unknown as MinimalLanguageModelShape;

    expect(() => proxy.modelId).toThrow(
      'LLM provider for feature "webAgent" is temporarily unavailable (open).',
    );
  });

  it('delegates doGenerate and doStream methods', async () => {
    const model = createMockModel('gpt-first');
    const registry = new MockRegistry(model.model);
    const proxy = createModelProxy(
      registry as unknown as ModelRegistry,
      'default',
    ) as unknown as MinimalLanguageModelShape;

    const generateOptions = { prompt: [] };
    const streamOptions = { prompt: [] };

    await proxy.doGenerate(generateOptions);
    await proxy.doStream(streamOptions);

    expect(model.doGenerateMock).toHaveBeenCalledTimes(1);
    expect(model.doGenerateMock).toHaveBeenCalledWith(generateOptions);
    expect(model.doStreamMock).toHaveBeenCalledTimes(1);
    expect(model.doStreamMock).toHaveBeenCalledWith(streamOptions);
  });
});
