/**
 * LLM provider abstraction — Vercel AI SDK.
 *
 * BYOK (Bring Your Own Key) — supports:
 * - Google Gemini (free tier available)
 * - OpenAI
 * - Anthropic Claude
 * - xAI (Grok)
 * - DeepSeek
 * - Mistral AI
 * - Z.ai / Zhipu (GLM models)
 *
 * The agent uses function calling / tool use to invoke
 * the deployment pipeline. The LLM never executes commands directly.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createMistral } from '@ai-sdk/mistral';
import { createZhipu } from 'zhipu-ai-provider';
import type { LanguageModel } from 'ai';
import { LLMNotConfiguredError } from '../errors.js';
import type { LLMProviderType } from './providers.js';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface LLMConfig {
  provider: LLMProviderType;
  apiKey: string;
  model?: string;
  /** OAuth access token (used instead of apiKey when OAuth is configured) */
  authToken?: string;
  /** OpenAI-compatible endpoint override. Only used by the OpenAI provider. */
  baseURL?: string;
}

// ---------------------------------------------------------------------------
// Shared message type — used by Agent, Debugger, AutoDetector for history
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ---------------------------------------------------------------------------
// AI SDK model factory
// ---------------------------------------------------------------------------

/**
 * Create an AI SDK LanguageModel based on provider config.
 *
 * This is the new primary API. Returns a standard AI SDK LanguageModel
 * for use with generateText/streamText.
 */
export function createModel(config: LLMConfig): LanguageModel {
  const apiKey = config.authToken ?? config.apiKey;

  if (!apiKey) {
    throw new LLMNotConfiguredError();
  }

  switch (config.provider) {
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey })(config.model ?? 'gemini-2.5-flash');
    case 'anthropic':
      return createAnthropic({ apiKey })(config.model ?? 'claude-sonnet-4-20250514');
    case 'openai':
      return createOpenAI({ apiKey, baseURL: config.baseURL })(config.model ?? 'gpt-4o');
    case 'xai':
      return createXai({ apiKey })(config.model ?? 'grok-3-mini-fast');
    case 'deepseek':
      return createDeepSeek({ apiKey })(config.model ?? 'deepseek-chat');
    case 'mistral':
      return createMistral({ apiKey })(config.model ?? 'mistral-large-latest');
    case 'zai':
      return createZhipu({ apiKey })(config.model ?? 'glm-4.7');
    case 'zai-coding':
      return createZhipu({ apiKey, baseURL: 'https://api.z.ai/api/coding/paas/v4' })(
        config.model ?? 'glm-4.7',
      );
    default:
      throw new Error(`Unknown LLM provider: ${String(config.provider)}`);
  }
}

// Re-export AI SDK types for consumers
export type { LanguageModel } from 'ai';
