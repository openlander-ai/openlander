import type { LanguageModel } from 'ai';
import { wrapLanguageModel } from 'ai';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';
import type { LLMProviderConfig } from '../config/index.js';
import { createModel } from './index.js';
import type { LLMProviderType } from './providers.js';
import { createModuleLogger } from '../lib/logger.js';
import { withTrackingMiddleware } from './tracking-middleware.js';
import type { EventBus } from '../events/index.js';
import { LlmCircuitBreaker, type LlmCircuitBreakerStatus } from './llm-circuit-breaker.js';
import { classifyLlmError } from './llm-error-types.js';
import { decrypt } from '../env/crypto.js';

const log = createModuleLogger('model-registry');

export interface LLMProviderEntry {
  provider: LLMProviderType;
  /** Legacy/plain runtime value. New saved provider configs should prefer encryptedApiKey. */
  apiKey?: string;
  encryptedApiKey?: string;
  apiKeyIv?: string;
  authToken?: string;
  defaultModel: string;
  /** OpenAI-compatible endpoint override. Only used by the OpenAI provider. */
  baseURL?: string;
  createdAt?: string;
}

export interface LLMRoute {
  providerId: string;
  model?: string;
}

export type AIModelFeature =
  | 'autoRecovery'
  | 'buildDebugger'
  | 'webAgent'
  | 'envDetection'
  | 'operationalMonitoring'
  | 'codingPlan'
  | 'secretScan'
  | 'rollbackSuggestion'
  | 'aiOpsBriefing';

export interface ModelRoutingConfig {
  providers: Record<string, LLMProviderEntry>;
  defaultRoute: LLMRoute;
  routes?: Partial<Record<AIModelFeature, LLMRoute>>;
}

const AI_MODEL_FEATURES: AIModelFeature[] = [
  'autoRecovery',
  'buildDebugger',
  'webAgent',
  'envDetection',
  'operationalMonitoring',
  'codingPlan',
  'secretScan',
  'rollbackSuggestion',
  'aiOpsBriefing',
];

export function isValidAIModelFeature(feature: string): feature is AIModelFeature {
  return AI_MODEL_FEATURES.includes(feature as AIModelFeature);
}

export function createModelRoutingConfigFromLegacy(
  legacyLlm: LLMProviderConfig,
): ModelRoutingConfig {
  const providerEntry: LLMProviderEntry = {
    provider: legacyLlm.provider,
    apiKey: legacyLlm.apiKey,
    authToken: legacyLlm.authToken,
    defaultModel: legacyLlm.model,
    ...(legacyLlm.baseURL ? { baseURL: legacyLlm.baseURL } : {}),
  };

  return {
    providers: {
      default: providerEntry,
    },
    defaultRoute: { providerId: 'default' },
  };
}

export class ModelRegistry {
  private config: ModelRoutingConfig;
  private version: number;
  private readonly modelCache = new Map<string, LanguageModel>();
  private readonly eventBus: EventBus;
  private readonly circuitBreaker: LlmCircuitBreaker;

  constructor(
    config: ModelRoutingConfig,
    eventBus: EventBus,
    circuitBreaker: LlmCircuitBreaker = new LlmCircuitBreaker(),
  ) {
    this.config = config;
    this.eventBus = eventBus;
    this.circuitBreaker = circuitBreaker;
    this.version = 0;
  }

  getModel(feature: AIModelFeature | 'default'): LanguageModel | null {
    const route =
      feature === 'default'
        ? this.config.defaultRoute
        : (this.config.routes?.[feature] ?? this.config.defaultRoute);

    const providerEntry = this.config.providers[route.providerId];
    if (!providerEntry) {
      log.warn(
        { providerId: route.providerId, feature },
        'ModelRegistry: provider not found for route',
      );
      return null;
    }

    if (!this.circuitBreaker.canCall(route.providerId)) {
      const status = this.circuitBreaker.getStatus(route.providerId);
      log.warn(
        { providerId: route.providerId, feature, status },
        'ModelRegistry: provider blocked by circuit breaker',
      );
      return null;
    }

    const modelName = route.model ?? providerEntry.defaultModel;
    const cacheKey = `${route.providerId}:${modelName}`;
    const cached = this.modelCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const modelConfig = {
      provider: providerEntry.provider,
      apiKey: resolveProviderApiKey(providerEntry),
      authToken: providerEntry.authToken,
      model: modelName,
      ...(providerEntry.baseURL ? { baseURL: providerEntry.baseURL } : {}),
    };
    const rawModel = createModel(modelConfig);

    if (!rawModel) {
      return null;
    }

    const trackedModel = withTrackingMiddleware(
      rawModel,
      this.eventBus,
      providerEntry.provider,
      modelName,
    );
    const model = wrapLanguageModel({
      model: trackedModel as LanguageModelV3,
      middleware: createCircuitBreakerMiddleware(this.circuitBreaker, route.providerId),
    }) as LanguageModel;
    this.modelCache.set(cacheKey, model);
    return model;
  }

  getCircuitBreakerStatus(feature: AIModelFeature | 'default'): LlmCircuitBreakerStatus | null {
    const route =
      feature === 'default'
        ? this.config.defaultRoute
        : (this.config.routes?.[feature] ?? this.config.defaultRoute);

    if (!this.config.providers[route.providerId]) {
      return null;
    }

    return this.circuitBreaker.getStatus(route.providerId);
  }

  getCircuitBreakerStatusByProvider(providerId: string): LlmCircuitBreakerStatus {
    return this.circuitBreaker.getStatus(providerId);
  }

  updateConfig(config: ModelRoutingConfig): void {
    this.config = config;
    this.version += 1;
    this.modelCache.clear();
  }

  getVersion(): number {
    return this.version;
  }
}

export function resolveProviderApiKey(providerEntry: LLMProviderEntry): string {
  if (providerEntry.encryptedApiKey && providerEntry.apiKeyIv) {
    return decrypt(providerEntry.encryptedApiKey, providerEntry.apiKeyIv);
  }

  return providerEntry.apiKey ?? '';
}

function createCircuitBreakerMiddleware(
  circuitBreaker: LlmCircuitBreaker,
  providerId: string,
): {
  specificationVersion: 'v3';
  wrapGenerate: (options: {
    doGenerate: () => PromiseLike<LanguageModelV3GenerateResult>;
    doStream: () => PromiseLike<LanguageModelV3StreamResult>;
    params: LanguageModelV3CallOptions;
    model: LanguageModelV3;
  }) => Promise<LanguageModelV3GenerateResult>;
  wrapStream: (options: {
    doGenerate: () => PromiseLike<LanguageModelV3GenerateResult>;
    doStream: () => PromiseLike<LanguageModelV3StreamResult>;
    params: LanguageModelV3CallOptions;
    model: LanguageModelV3;
  }) => Promise<LanguageModelV3StreamResult>;
} {
  return {
    specificationVersion: 'v3',
    wrapGenerate: async (options) => {
      try {
        const result = await options.doGenerate();
        circuitBreaker.recordSuccess(providerId);
        return result;
      } catch (error) {
        circuitBreaker.recordFailure(providerId, classifyLlmError(error));
        throw error;
      }
    },
    wrapStream: async (options) => {
      try {
        const result = await options.doStream();
        // Wrap the stream so we can observe both normal completion (flush →
        // recordSuccess) and cancellation (cancel → recordFailure).
        // We use a ReadableStream wrapper instead of TransformStream because the
        // TypeScript DOM lib's Transformer interface does not include `cancel`.
        const sourceReader = result.stream.getReader();
        const transformedStream = new ReadableStream<
          typeof result.stream extends ReadableStream<infer T> ? T : never
        >({
          async pull(controller) {
            const { done, value } = await sourceReader.read();
            if (done) {
              controller.close();
              circuitBreaker.recordSuccess(providerId);
            } else {
              controller.enqueue(value);
            }
          },
          cancel(reason) {
            // Stream was cancelled (e.g. user aborted). Do not record success —
            // treat as a transient failure so the circuit breaker can open if
            // a provider is repeatedly unreachable before the stream starts.
            void sourceReader.cancel(reason);
            circuitBreaker.recordFailure(providerId, classifyLlmError(reason));
          },
        });

        return {
          ...result,
          stream: transformedStream,
        };
      } catch (error) {
        circuitBreaker.recordFailure(providerId, classifyLlmError(error));
        throw error;
      }
    },
  };
}
