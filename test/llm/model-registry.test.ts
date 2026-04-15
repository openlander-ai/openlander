import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ModelRegistry,
  createModelRoutingConfigFromLegacy,
  type ModelRoutingConfig,
} from '../../src/llm/model-registry.js';
import { createModel } from '../../src/llm/index.js';
import type { EventBus } from '../../src/events/index.js';

vi.mock('../../src/llm/index.js', () => ({
  createModel: vi.fn((config: { model?: string }) => ({
    modelId: config.model ?? 'unknown-model',
  })),
}));

function createMockEventBus(): EventBus {
  return { emit: vi.fn().mockResolvedValue(undefined) } as unknown as EventBus;
}

function createBaseConfig(): ModelRoutingConfig {
  return {
    providers: {
      primary: {
        provider: 'openai',
        apiKey: 'test-api-key',
        defaultModel: 'gpt-4o',
      },
    },
    defaultRoute: {
      providerId: 'primary',
    },
  };
}

describe('ModelRegistry', () => {
  let mockEventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEventBus = createMockEventBus();
  });

  it('resolves model from default route', () => {
    const registry = new ModelRegistry(createBaseConfig(), mockEventBus);

    const model = registry.getModel('default');

    expect(model).not.toBeNull();
    expect(model).toMatchObject({ modelId: 'gpt-4o' });
    expect(createModel).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'test-api-key',
      authToken: undefined,
      model: 'gpt-4o',
    });
  });

  it('uses feature-specific route override when configured', () => {
    const config = createBaseConfig();
    config.routes = {
      buildDebugger: {
        providerId: 'primary',
        model: 'gpt-4.1',
      },
    };
    const registry = new ModelRegistry(config, mockEventBus);

    const model = registry.getModel('buildDebugger');

    expect(model).not.toBeNull();
    expect(model).toMatchObject({ modelId: 'gpt-4.1' });
    expect(createModel).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'test-api-key',
      authToken: undefined,
      model: 'gpt-4.1',
    });
  });

  it('returns null when route provider does not exist', () => {
    const registry = new ModelRegistry(
      {
        providers: {},
        defaultRoute: { providerId: 'missing-provider' },
      },
      mockEventBus,
    );

    const model = registry.getModel('default');

    expect(model).toBeNull();
    expect(createModel).not.toHaveBeenCalled();
  });

  it('updateConfig increments version, clears cache, and rebuilds model', () => {
    const registry = new ModelRegistry(createBaseConfig(), mockEventBus);

    const firstModel = registry.getModel('default');
    expect(registry.getVersion()).toBe(0);

    registry.updateConfig({
      providers: {
        primary: {
          provider: 'openai',
          apiKey: 'test-api-key',
          defaultModel: 'gpt-4.1-mini',
        },
      },
      defaultRoute: {
        providerId: 'primary',
      },
    });

    const secondModel = registry.getModel('default');

    expect(registry.getVersion()).toBe(1);
    expect(secondModel).not.toBe(firstModel);
    expect(secondModel).toMatchObject({ modelId: 'gpt-4.1-mini' });
    expect(createModel).toHaveBeenCalledTimes(2);
  });

  it('reuses cached model instance for the same provider/model key', () => {
    const registry = new ModelRegistry(createBaseConfig(), mockEventBus);

    const first = registry.getModel('webAgent');
    const second = registry.getModel('webAgent');

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(createModel).toHaveBeenCalledTimes(1);
  });
});

describe('createModelRoutingConfigFromLegacy', () => {
  it('converts legacy LLMProviderConfig to default-only routing config', () => {
    const routing = createModelRoutingConfigFromLegacy({
      provider: 'anthropic',
      apiKey: 'legacy-api-key',
      model: 'claude-sonnet-4-20250514',
      authToken: 'legacy-auth-token',
    });

    expect(routing).toEqual({
      providers: {
        default: {
          provider: 'anthropic',
          apiKey: 'legacy-api-key',
          authToken: 'legacy-auth-token',
          defaultModel: 'claude-sonnet-4-20250514',
        },
      },
      defaultRoute: {
        providerId: 'default',
      },
    });
  });
});
