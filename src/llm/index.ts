/**
 * LLM provider abstraction — Vercel AI SDK.
 *
 * BYOK (Bring Your Own Key) — supports:
 * - Google Gemini (free tier available)
 * - OpenRouter (free models, no credit card)
 * - Anthropic Claude
 * - OpenAI
 * - Ollama (local, no API key)
 *
 * The agent uses function calling / tool use to invoke
 * the deployment pipeline. The LLM never executes commands directly.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOllama } from 'ollama-ai-provider-v2';
import type { LanguageModel } from 'ai';
import { LLMNotConfiguredError } from '../errors.js';

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface LLMConfig {
  provider: 'gemini' | 'openrouter' | 'anthropic' | 'openai' | 'ollama';
  apiKey: string;
  model?: string;
  /** Ollama base URL (default: http://localhost:11434) */
  ollamaBaseUrl?: string;
  /** OAuth access token (used instead of apiKey when OAuth is configured) */
  authToken?: string;
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

  // Ollama doesn't need an API key
  if (config.provider !== 'ollama' && !apiKey) {
    throw new LLMNotConfiguredError();
  }

  switch (config.provider) {
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey })(config.model ?? 'gemini-2.0-flash');
    case 'anthropic':
      return createAnthropic({ apiKey })(config.model ?? 'claude-sonnet-4-20250514');
    case 'openai':
      return createOpenAI({ apiKey })(config.model ?? 'gpt-4o');
    case 'openrouter':
      return createOpenRouter({ apiKey })(config.model ?? 'openrouter/free');
    case 'ollama':
      return createOllama({ baseURL: config.ollamaBaseUrl ?? 'http://localhost:11434' })(
        config.model ?? 'llama3.2',
      );
    default:
      throw new Error(`Unknown LLM provider: ${String(config.provider)}`);
  }
}

// Re-export AI SDK types for consumers
export type { LanguageModel } from 'ai';
