import { encrypt } from '../env/crypto.js';
import { OpenLanderError } from '../errors.js';
import type { LLMProviderEntry } from './model-registry.js';
import type { LLMProviderType } from './providers.js';

export interface AiOpsProviderInput {
  provider: Extract<LLMProviderType, 'openai' | 'anthropic' | 'gemini'>;
  apiKey: string;
  defaultModel: string;
  /** OpenAI-compatible endpoint override. Ignored for non-OpenAI providers. */
  baseURL?: string;
}

export const AI_OPS_BRIEFING_FEATURE = 'aiOpsBriefing' as const;

export function buildEncryptedAiOpsProviderEntry(input: AiOpsProviderInput): LLMProviderEntry {
  const trimmedApiKey = input.apiKey.trim();
  if (!trimmedApiKey) {
    throw new OpenLanderError('AI Ops provider API key is required.', 'AI_PROVIDER_INVALID', 400, {
      field: 'apiKey',
    });
  }

  const defaultModel = input.defaultModel.trim();
  if (!defaultModel) {
    throw new OpenLanderError(
      'AI Ops provider default model is required.',
      'AI_PROVIDER_INVALID',
      400,
      { field: 'defaultModel' },
    );
  }

  const encrypted = encrypt(trimmedApiKey);
  const baseURL = input.provider === 'openai' ? input.baseURL?.trim() : undefined;

  return {
    provider: input.provider,
    encryptedApiKey: encrypted.encrypted,
    apiKeyIv: encrypted.iv,
    defaultModel,
    baseURL: baseURL && baseURL.length > 0 ? baseURL : undefined,
    createdAt: new Date().toISOString(),
  };
}
