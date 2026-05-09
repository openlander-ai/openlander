import type { LanguageModel } from 'ai';
import type { ModelRegistry, AIModelFeature } from './model-registry.js';

export function createModelProxy(
  registry: ModelRegistry,
  feature: AIModelFeature | 'default',
): LanguageModel {
  let cachedVersion = -1;
  let cachedModel: LanguageModel | null = null;

  function resolveModel(): LanguageModel {
    const currentVersion = registry.getVersion();
    if (cachedVersion !== currentVersion || cachedModel === null) {
      cachedModel = registry.getModel(feature);
      cachedVersion = currentVersion;
    }

    if (cachedModel === null) {
      const circuitStatus = registry.getCircuitBreakerStatus(feature);
      if (circuitStatus && circuitStatus.state !== 'closed') {
        throw new Error(
          `LLM provider for feature "${feature}" is temporarily unavailable (${circuitStatus.state}).`,
        );
      }

      throw new Error(
        `LLM not configured for feature "${feature}". Add a provider in Settings → AI Model.`,
      );
    }

    return cachedModel;
  }

  const proxyTarget: Record<PropertyKey, never> = {};

  return new Proxy(proxyTarget, {
    get(_target, prop) {
      return Reflect.get(resolveModel() as object, prop) as unknown;
    },
  }) as unknown as LanguageModel;
}
