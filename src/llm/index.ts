/**
 * LLM provider abstraction.
 *
 * BYOK (Bring Your Own Key) — supports:
 * - Google Gemini (free tier available)
 * - OpenRouter (free models, no credit card)
 * - Anthropic Claude
 * - OpenAI
 * - Ollama (v0.3+)
 *
 * The agent uses function calling / tool use to invoke
 * the deployment pipeline. The LLM never executes commands directly.
 */

import { GeminiProvider } from './gemini.js';
import { LLMNotConfiguredError } from '../errors.js';

export interface LLMConfig {
  provider: 'gemini' | 'openrouter' | 'anthropic' | 'openai' | 'ollama';
  apiKey: string;
  model?: string;
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
  if (!config.apiKey) {
    throw new LLMNotConfiguredError();
  }

  switch (config.provider) {
    case 'gemini':
      return new GeminiProvider(config.apiKey, config.model ?? 'gemini-2.0-flash');
    case 'openrouter':
      // OpenRouter is OpenAI-compatible — will be implemented in v0.2
      // For now, can use Gemini as default
      return new GeminiProvider(config.apiKey, config.model);
    case 'anthropic':
      // TODO: implement Anthropic provider (v0.2)
      throw new Error('Anthropic provider not yet implemented. Use Gemini or OpenRouter.');
    case 'openai':
      // TODO: implement OpenAI provider (v0.2)
      throw new Error('OpenAI provider not yet implemented. Use Gemini or OpenRouter.');
    case 'ollama':
      // TODO: implement Ollama provider (v0.3)
      throw new Error('Ollama provider not yet implemented (planned for v0.3).');
    default:
      throw new Error(`Unknown LLM provider: ${String(config.provider)}`);
  }
}
