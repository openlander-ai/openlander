import type { LanguageModel, ToolSet } from 'ai';

import type { AppContext } from '../../../app.js';
import type { OpenLanderConfig } from '../../../config/index.js';
import { normalizeLlmConfig } from '../../../config/index.js';
import { Agent } from '../../../llm/agent.js';
import { AgentPool } from '../../../llm/agent-pool.js';
import { createModel, type LLMConfig } from '../../../llm/index.js';
import { createModelProxy } from '../../../llm/model-proxy.js';
import { buildContextSnapshot } from '../../../llm/prompts.js';
import { mergeWithMcpTools } from '../../../mcp/client-manager.js';
import { createTools } from '../../../tools/index.js';

export type LlmRuntimeConnectionState = 'online' | 'offline' | 'error';

export interface ResolvedDefaultLlmProvider {
  providerId: string;
  provider: OpenLanderConfig['llm']['provider'];
  model: string;
  apiKey: string;
  authToken?: string;
  ollamaEndpoint?: string;
}

export interface LlmRuntimeStatus {
  configured: boolean;
  provider: string;
  model: string;
  state: LlmRuntimeConnectionState;
}

export interface LlmConnectivityTestInput {
  provider: LLMConfig['provider'];
  model: string;
  apiKey?: string;
  authToken?: string;
  ollamaEndpoint?: string;
}

export interface LlmConnectivityTestResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export function resolveDefaultLlmProvider(
  config: OpenLanderConfig,
): ResolvedDefaultLlmProvider | null {
  const normalized = normalizeLlmConfig(config.llm);
  const route = normalized.defaultRoute;
  const entry = normalized.providers[route.providerId];
  if (!entry) {
    return null;
  }

  return {
    providerId: route.providerId,
    provider: entry.provider,
    model: route.model ?? entry.defaultModel,
    apiKey: entry.apiKey ?? '',
    authToken: entry.authToken,
    ollamaEndpoint: entry.ollamaEndpoint,
  };
}

export function hasConfiguredDefaultLlmProvider(config: OpenLanderConfig): boolean {
  const resolved = resolveDefaultLlmProvider(config);
  if (!resolved) {
    return false;
  }

  return resolved.provider === 'ollama' || !!(resolved.apiKey || resolved.authToken);
}

export function getLlmRuntimeStatus(
  config: OpenLanderConfig,
  llmVerified: boolean,
): LlmRuntimeStatus {
  const configured = hasConfiguredDefaultLlmProvider(config);
  const resolved = resolveDefaultLlmProvider(config);
  const provider = resolved?.provider ?? config.llm.provider;
  const model = resolved?.model ?? config.llm.model;

  const state: LlmRuntimeConnectionState = !configured
    ? 'offline'
    : llmVerified
      ? 'online'
      : 'error';

  return { configured, provider, model, state };
}

export async function mergeToolsIfMcpEnabled(
  ctx: AppContext,
  baseTools: ToolSet,
): Promise<ToolSet> {
  if (ctx.config.mcp.enabled && ctx.mcpClientManager.connectedCount > 0) {
    return mergeWithMcpTools(baseTools, ctx.mcpClientManager);
  }

  return baseTools;
}

export async function runLlmConnectivityTest(
  input: LlmConnectivityTestInput,
): Promise<LlmConnectivityTestResult> {
  try {
    const model = createModel({
      provider: input.provider,
      apiKey: input.apiKey ?? '',
      authToken: input.authToken,
      ollamaBaseUrl: input.ollamaEndpoint,
      model: input.model,
    });

    const { generateText } = await import('ai');
    const start = Date.now();
    await generateText({
      model,
      prompt: 'Respond with exactly: ok',
      maxOutputTokens: 5,
    });

    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function syncLlmRuntime(ctx: AppContext): Promise<void> {
  const normalized = normalizeLlmConfig(ctx.config.llm);

  const activeProvider = resolveDefaultLlmProvider(ctx.config);
  const hasConfiguredLlm = hasConfiguredDefaultLlmProvider(ctx.config);
  if (!activeProvider || !hasConfiguredLlm) {
    ctx.modelRegistry.updateConfig({
      providers: {},
      defaultRoute: { providerId: '__none__' },
    });
    ctx.model = null;
    ctx.agentPool = null;
    ctx.agent = null;
    return;
  }

  ctx.modelRegistry.updateConfig({
    providers: normalized.providers,
    defaultRoute: normalized.defaultRoute,
    routes: normalized.routes,
  });
  ctx.model = createModelProxy(ctx.modelRegistry, 'default');

  const tools = await mergeToolsIfMcpEnabled(ctx, createTools(ctx, ctx.questionBridge));
  const contextProvider = async (scope?: Parameters<typeof buildContextSnapshot>[2]) =>
    buildContextSnapshot(ctx.db, ctx.docker, scope);

  if (ctx.config.ai.webAgent.enabled) {
    const pool = new AgentPool(
      createModelProxy(ctx.modelRegistry, 'webAgent'),
      ctx.db,
      contextProvider,
      activeProvider.provider,
      ctx.config.language,
      ctx.approvalGate,
    );
    pool.setTools(tools);
    pool.setQuestionBridge(ctx.questionBridge);

    ctx.agentPool = pool;
    ctx.agent = pool.getRecoveryAgent();
    return;
  }

  ctx.agentPool = null;
  if (ctx.config.ai.autoRecovery.enabled) {
    const agent = new Agent(
      createModelProxy(ctx.modelRegistry, 'autoRecovery'),
      ctx.db,
      contextProvider,
      activeProvider.provider,
      ctx.config.language,
      'auto_recovery',
    );
    agent.setTools(tools);
    agent.setQuestionBridge(ctx.questionBridge);
    ctx.agent = agent;
    return;
  }

  ctx.agent = null;
}

export async function reloadAgent(
  ctx: AppContext,
  options: {
    provider: OpenLanderConfig['llm']['provider'];
    apiKey: string;
    authToken?: string;
    model: string;
    language: 'en' | 'ko';
  },
): Promise<LanguageModel> {
  const llmModel = createModel({
    provider: options.provider,
    apiKey: options.apiKey,
    authToken: options.authToken,
    model: options.model,
  });

  const agent = new Agent(
    llmModel,
    ctx.db,
    async () => buildContextSnapshot(ctx.db, ctx.docker),
    options.provider,
    options.language,
  );

  const tools = await mergeToolsIfMcpEnabled(ctx, createTools(ctx, ctx.questionBridge));
  agent.setTools(tools);
  agent.setQuestionBridge(ctx.questionBridge);

  ctx.agent = agent;

  const updatedLlm = normalizeLlmConfig({
    provider: options.provider,
    apiKey: options.apiKey,
    model: options.model,
    authToken: options.authToken ?? '',
    ollamaEndpoint: ctx.config.llm.ollamaEndpoint,
    providers: ctx.config.llm.providers,
    defaultRoute: ctx.config.llm.defaultRoute,
    routes: ctx.config.llm.routes,
  });
  ctx.modelRegistry.updateConfig({
    providers: updatedLlm.providers,
    defaultRoute: updatedLlm.defaultRoute,
    routes: updatedLlm.routes,
  });

  return llmModel;
}
