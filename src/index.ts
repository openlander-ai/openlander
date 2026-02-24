/**
 * OpenLander — AI agent that deploys your app from a chat.
 *
 * This is the library entry point.
 * CLI entry point is at src/cli/index.ts.
 */

export { createServer } from './web/server.js';
export { createAppContext, shutdownAppContext } from './app.js';
export type { AppContext } from './app.js';
export type { ProjectConfig, DeployResult } from './pipeline/deploy.js';
export type { OpenLanderConfig } from './config/index.js';
export { loadConfig, saveConfig, updateConfig } from './config/index.js';
export { Database } from './db/index.js';
export { EventBus, eventBus } from './events/index.js';

// v0.2: LLM providers
export { GeminiProvider } from './llm/gemini.js';
export { AnthropicProvider } from './llm/anthropic.js';
export { OpenAIProvider } from './llm/openai.js';
export { OpenRouterProvider } from './llm/openrouter.js';
export { OllamaProvider } from './llm/ollama.js';
export { createLLMClient } from './llm/index.js';
export type { LLMClient, LLMConfig, ChatMessage, LLMResponse } from './llm/index.js';
