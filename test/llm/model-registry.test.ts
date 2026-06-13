import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ModelRegistry,
  createModelRoutingConfigFromLegacy,
  isValidAIModelFeature,
  type ModelRoutingConfig,
} from '../../src/llm/model-registry.js';
import { createModel } from '../../src/llm/index.js';
import type { EventBus } from '../../src/events/index.js';
import { LlmCircuitBreaker } from '../../src/llm/llm-circuit-breaker.js';
import { LlmErrorType } from '../../src/llm/llm-error-types.js';
import { buildEncryptedAiOpsProviderEntry } from '../../src/llm/provider-config.js';
import { _resetCachedKey } from '../../src/env/crypto.js';
import { normalizeLlmConfig, type LLMProviderConfig } from '../../src/config/index.js';

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
  const previousMasterKey = process.env['OPENLANDER_MASTER_KEY'];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['OPENLANDER_MASTER_KEY'] = '0'.repeat(64);
    _resetCachedKey();
    mockEventBus = createMockEventBus();
  });

  afterEach(() => {
    if (previousMasterKey === undefined) {
      delete process.env['OPENLANDER_MASTER_KEY'];
    } else {
      process.env['OPENLANDER_MASTER_KEY'] = previousMasterKey;
    }
    _resetCachedKey();
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

  it('resolves the AI Ops briefing model profile with encrypted OpenAI-compatible keys', () => {
    const encryptedProvider = buildEncryptedAiOpsProviderEntry({
      provider: 'openai',
      apiKey: 'sk-ai-ops',
      defaultModel: 'gpt-4.1-mini',
      baseURL: 'https://openrouter.ai/api/v1',
    });
    const registry = new ModelRegistry(
      {
        providers: {
          aiops: encryptedProvider,
        },
        defaultRoute: { providerId: 'aiops' },
        routes: {
          aiOpsBriefing: {
            providerId: 'aiops',
            model: 'gpt-4.1-mini',
          },
        },
      },
      mockEventBus,
    );

    const model = registry.getModel('aiOpsBriefing');

    expect(model).not.toBeNull();
    expect(model).toMatchObject({ modelId: 'gpt-4.1-mini' });
    expect(createModel).toHaveBeenCalledWith({
      provider: 'openai',
      apiKey: 'sk-ai-ops',
      authToken: undefined,
      model: 'gpt-4.1-mini',
      baseURL: 'https://openrouter.ai/api/v1',
    });
  });

  it('does not synthesize an active AI Ops model for a fresh install without credentials', () => {
    const freshInstall: LLMProviderConfig = {
      provider: 'gemini',
      apiKey: '',
      authToken: '',
      model: 'gemini-2.5-flash',
    };
    const registry = new ModelRegistry(normalizeLlmConfig(freshInstall), mockEventBus);

    const model = registry.getModel('aiOpsBriefing');

    expect(model).toBeNull();
    expect(createModel).not.toHaveBeenCalled();
  });

  it('resolves a persisted AI Ops route even when the default route is disabled', () => {
    const persisted: LLMProviderConfig = {
      provider: 'gemini',
      apiKey: '',
      authToken: '',
      model: 'gemini-2.5-flash',
      providers: {
        aiops: {
          provider: 'gemini',
          apiKey: 'gemini-key',
          defaultModel: 'gemini-2.5-flash',
        },
      },
      defaultRoute: { providerId: '__none__' },
      routes: {
        aiOpsBriefing: {
          providerId: 'aiops',
          model: 'gemini-2.5-flash',
        },
      },
    };
    const registry = new ModelRegistry(normalizeLlmConfig(persisted), mockEventBus);

    const model = registry.getModel('aiOpsBriefing');

    expect(model).not.toBeNull();
    expect(model).toMatchObject({ modelId: 'gemini-2.5-flash' });
    expect(createModel).toHaveBeenCalledWith({
      provider: 'gemini',
      apiKey: 'gemini-key',
      authToken: undefined,
      model: 'gemini-2.5-flash',
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

  it('returns null when provider circuit is open', () => {
    const breaker = new LlmCircuitBreaker();
    breaker.recordFailure('primary', LlmErrorType.PROVIDER_ERROR);
    breaker.recordFailure('primary', LlmErrorType.PROVIDER_ERROR);
    breaker.recordFailure('primary', LlmErrorType.PROVIDER_ERROR);
    const registry = new ModelRegistry(createBaseConfig(), mockEventBus, breaker);

    const model = registry.getModel('default');

    expect(model).toBeNull();
    expect(createModel).not.toHaveBeenCalled();
  });
});

describe('isValidAIModelFeature', () => {
  it('accepts aiOpsBriefing as the v0.2 briefing model profile', () => {
    expect(isValidAIModelFeature('aiOpsBriefing')).toBe(true);
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
