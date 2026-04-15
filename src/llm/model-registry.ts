import type { LanguageModel } from 'ai';
import type { LLMProviderConfig } from '../config/index.js';
import { createModel } from './index.js';
import type { LLMProviderType } from './providers.js';
import { createModuleLogger } from '../lib/logger.js';
import { withTrackingMiddleware } from './tracking-middleware.js';
import type { EventBus } from '../events/index.js';

const log = createModuleLogger('model-registry');

export interface LLMProviderEntry {
  provider: LLMProviderType;
  apiKey?: string;
  authToken?: string;
  defaultModel: string;
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
  | 'rollbackSuggestion';

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
];

export function isValidAIModelFeature(feature: string): feature is AIModelFeature {
  return AI_MODEL_FEATURES.includes(feature as AIModelFeature);
}

export function createModelRoutingConfigFromLegacy(
  legacyLlm: LLMProviderConfig,
): ModelRoutingConfig {
  return {
    providers: {
      default: {
        provider: legacyLlm.provider,
        apiKey: legacyLlm.apiKey,
        authToken: legacyLlm.authToken,
        defaultModel: legacyLlm.model,
      },
    },
    defaultRoute: { providerId: 'default' },
  };
}

export class ModelRegistry {
  private config: ModelRoutingConfig;
  private version: number;
  private readonly modelCache = new Map<string, LanguageModel>();
  private readonly eventBus: EventBus;

  constructor(config: ModelRoutingConfig, eventBus: EventBus) {
    this.config = config;
    this.eventBus = eventBus;
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

    const modelName = route.model ?? providerEntry.defaultModel;
    const cacheKey = `${route.providerId}:${modelName}`;
    const cached = this.modelCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const rawModel = createModel({
      provider: providerEntry.provider,
      apiKey: providerEntry.apiKey ?? '',
      authToken: providerEntry.authToken,
      model: modelName,
    });

    if (!rawModel) {
      return null;
    }

    const model = withTrackingMiddleware(
      rawModel,
      this.eventBus,
      providerEntry.provider,
      modelName,
    );
    this.modelCache.set(cacheKey, model);
    return model;
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
