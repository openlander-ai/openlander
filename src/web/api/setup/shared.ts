import type { LanguageModel, ToolSet } from 'ai';

import type { AppContext } from '../../../app.js';
import type { OpenLanderConfig } from '../../../config/index.js';
import type { LLMConfig } from '../../../llm/index.js';
import { mergeWithMcpTools } from '../../../mcp/client-manager.js';
import { FeatureDisabledError } from '../../../errors.js';
import { INTERNAL_AI_OPS_DISABLED_MESSAGE } from '../../../feature-flags.js';

export type LlmRuntimeConnectionState = 'online' | 'offline' | 'error';

export interface ResolvedDefaultLlmProvider {
  providerId: string;
  provider: OpenLanderConfig['llm']['provider'];
  model: string;
  apiKey: string;
  authToken?: string;
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
}

export interface LlmConnectivityTestResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export function resolveDefaultLlmProvider(
  _config: OpenLanderConfig,
): ResolvedDefaultLlmProvider | null {
  return null;
}

export function hasConfiguredDefaultLlmProvider(_config: OpenLanderConfig): boolean {
  return false;
}

export function getLlmRuntimeStatus(
  _config: OpenLanderConfig,
  _llmVerified: boolean,
): LlmRuntimeStatus {
  return { configured: false, provider: 'disabled', model: 'disabled', state: 'offline' };
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
  _input: LlmConnectivityTestInput,
): Promise<LlmConnectivityTestResult> {
  return Promise.resolve({ ok: false, error: INTERNAL_AI_OPS_DISABLED_MESSAGE });
}

export function syncLlmRuntime(ctx: AppContext): Promise<void> {
  ctx.modelRegistry.updateConfig({
    providers: {},
    defaultRoute: { providerId: '__none__' },
  });
  ctx.model = null;
  ctx.agentPool = null;
  ctx.agent = null;
  return Promise.resolve();
}

export async function reloadAgent(
  _ctx: AppContext,
  _options: {
    provider: OpenLanderConfig['llm']['provider'];
    apiKey: string;
    authToken?: string;
    model: string;
    language: 'en' | 'ko';
  },
): Promise<LanguageModel> {
  return Promise.reject(new FeatureDisabledError(INTERNAL_AI_OPS_DISABLED_MESSAGE));
}
