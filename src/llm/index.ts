/**
 * LLM provider abstraction.
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

import { GeminiProvider } from './gemini.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { OpenRouterProvider } from './openrouter.js';
import { OllamaProvider } from './ollama.js';
import { LLMNotConfiguredError } from '../errors.js';

export interface LLMConfig {
  provider: 'gemini' | 'openrouter' | 'anthropic' | 'openai' | 'ollama';
  apiKey: string;
  model?: string;
  /** Ollama base URL (default: http://localhost:11434) */
  ollamaBaseUrl?: string;
  /** OAuth access token (used instead of apiKey when OAuth is configured) */
  authToken?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
}

/**
 * Unified LLM client interface.
 * Each provider implements this interface.
 */
export interface LLMClient {
  chat(messages: ChatMessage[]): Promise<LLMResponse>;
}

/**
 * Create an LLM client based on provider config.
 */
export function createLLMClient(config: LLMConfig): LLMClient {
  const apiKey = config.authToken ?? config.apiKey;

  // Ollama doesn't need an API key
  if (config.provider !== 'ollama' && !apiKey) {
    throw new LLMNotConfiguredError();
  }

  switch (config.provider) {
    case 'gemini':
      return new GeminiProvider(apiKey, config.model ?? 'gemini-2.0-flash');
    case 'anthropic':
      return new AnthropicProvider(apiKey, config.model ?? 'claude-sonnet-4-20250514');
    case 'openai':
      return new OpenAIProvider(apiKey, config.model ?? 'gpt-4o');
    case 'openrouter':
      return new OpenRouterProvider(apiKey, config.model ?? 'google/gemini-2.0-flash-exp:free');
    case 'ollama':
      return new OllamaProvider(config.model ?? 'llama3.2', config.ollamaBaseUrl);
    default:
      throw new Error(`Unknown LLM provider: ${String(config.provider)}`);
  }
}
