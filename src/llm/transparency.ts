import type { Database } from '../db/index.js';
import type { AiUsageLogRow } from '../db/types.js';

export const PRICING_TABLE: Record<string, [number, number]> = {
  'gemini-1.5-flash': [0, 0],
  'gemini-1.5-flash-8b': [0, 0],
  'gemini-2.0-flash': [0.1, 0.4],
  'gemini-2.0-flash-lite': [0.075, 0.3],
  'gemini-2.5-pro': [1.25, 10.0],
  'gemini-2.5-flash': [0.3, 2.5],
  'gemini-2.5-flash-lite': [0.1, 0.4],
  'gemini-1.5-pro': [3.5, 10.5],
  'claude-haiku-4-5': [1.0, 5.0],
  'claude-sonnet-4-5': [3.0, 15.0],
  'claude-sonnet-4-6': [3.0, 15.0],
  'claude-sonnet-4-20250514': [3.0, 15.0],
  'claude-opus-4-5': [15.0, 75.0],
  'claude-opus-4-6': [5.0, 25.0],
  'claude-3-5-sonnet-20241022': [3.0, 15.0],
  'claude-3-5-haiku-20241022': [0.8, 4.0],
  'claude-3-haiku-20240307': [0.25, 1.25],
  'gpt-4o': [2.5, 10.0],
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4-turbo': [10.0, 30.0],
  'gpt-4.1': [2.0, 8.0],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1-nano': [0.1, 0.4],
  'gpt-3.5-turbo': [0.5, 1.5],
  'o3-mini': [1.1, 4.4],
  'o4-mini': [1.1, 4.4],
  'openrouter/free': [0, 0],
  'llama3.2': [0, 0],
  'llama3.1': [0, 0],
  ollama: [0, 0],
};

interface UsageShape {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface UsageNormalized {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function normalizeModelName(model: string): string {
  return model.trim().toLowerCase();
}

function resolvePricing(model: string): [number, number] | null {
  const normalizedModel = normalizeModelName(model);

  const exact = PRICING_TABLE[normalizedModel];
  if (exact) {
    return exact;
  }

  for (const [key, pricing] of Object.entries(PRICING_TABLE)) {
    if (normalizedModel.includes(key) || key.includes(normalizedModel)) {
      return pricing;
    }
  }

  return null;
}

function normalizeSource(source?: string): AiUsageLogRow['source'] {
  if (source === 'web' || source === 'mcp' || source === 'auto-recovery' || source === 'monitor') {
    return source;
  }
  return null;
}

export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (provider.toLowerCase() === 'ollama') {
    return 0;
  }

  const pricing = resolvePricing(model);
  if (!pricing) {
    return null;
  }

  const [inputCost, outputCost] = pricing;
  return (inputTokens / 1_000_000) * inputCost + (outputTokens / 1_000_000) * outputCost;
}

export function extractUsageFromResult(usage: UsageShape | undefined | null): UsageNormalized {
  if (!usage) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  const inputTokens = usage.promptTokens ?? usage.inputTokens ?? 0;
  const outputTokens = usage.completionTokens ?? usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;

  return { inputTokens, outputTokens, totalTokens };
}

export function logAiUsage(
  db: Database,
  params: {
    projectId?: string;
    sessionId?: string;
    actionType: 'web_agent' | 'auto_recovery' | 'build_debugger' | 'monitor_alert';
    modelName: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    toolsCalled?: string[];
    result: 'success' | 'failure' | 'partial';
    durationMs: number;
    source?: string;
  },
): string {
  const costUsd = calculateCost(
    params.provider,
    params.modelName,
    params.inputTokens,
    params.outputTokens,
  );

  const id = db.createAiUsageLog({
    project_id: params.projectId ?? null,
    session_id: params.sessionId ?? null,
    action_type: params.actionType,
    model_name: params.modelName,
    provider: params.provider,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    total_tokens: params.totalTokens,
    cost_usd: costUsd,
    tools_called: JSON.stringify(params.toolsCalled ?? []),
    result: params.result,
    duration_ms: params.durationMs,
    user_id: null,
    tenant_id: null,
    source: normalizeSource(params.source),
  });

  return id;
}
