import { generateText, type LanguageModel } from 'ai';

import type { Database } from '../db/index.js';
import type { AiOpsBriefingRow } from '../db/types.js';
import type { ModelRegistry } from '../llm/model-registry.js';
import { AI_OPS_BRIEFING_FEATURE } from '../llm/provider-config.js';
import { withTracking } from '../llm/tracking-middleware.js';
import { createModuleLogger } from '../lib/logger.js';
import { redactAiOpsEvidence } from './ai-ops-evidence-redaction.js';
import {
  buildDeterministicAiOpsBriefing,
  type BuildAiOpsBriefingInput,
  type DeterministicAiOpsBriefing,
} from './ai-ops-briefing.js';

const log = createModuleLogger('ai-ops-llm-summary');

const MAX_PROMPT_EVIDENCE_CHARS = 6_000;
const MAX_SUMMARY_CHARS = 1_500;

const SYSTEM_PROMPT = `You summarize OpenLander AI Ops briefings for MCP agents and operators.

Rules:
- Summarize only the evidence provided.
- Do not invent MCP actions, resources, symptoms, or root causes.
- Do not claim that anything was fixed, remediated, restarted, redeployed, or rolled back.
- Do not change severity, classification, or the suggested call.
- Keep the answer short, concrete, and action-oriented.
- If evidence is insufficient, say what is known and what to inspect next.`;

export type AiOpsLlmSummaryStatus = 'llm' | 'fallback' | 'skipped';

export interface AiOpsLlmSummaryResult {
  status: AiOpsLlmSummaryStatus;
  summary: string;
  error?: string;
}

export interface SummarizeAiOpsBriefingOptions {
  db: Pick<Database, 'updateAiOpsBriefingLlmSummary'>;
  modelRegistry: Pick<ModelRegistry, 'getModel'>;
  briefing: AiOpsBriefingRow;
  model?: LanguageModel | null;
}

export interface CreateAiOpsBriefingWithLlmOptions {
  db: Pick<Database, 'createAiOpsBriefing' | 'updateAiOpsBriefingLlmSummary'>;
  input: BuildAiOpsBriefingInput;
  modelRegistry?: Pick<ModelRegistry, 'getModel'> | null;
  enableLlmSummary?: boolean;
}

export interface CreateAiOpsBriefingWithLlmResult {
  deterministic: DeterministicAiOpsBriefing;
  briefing: AiOpsBriefingRow;
  summary: AiOpsLlmSummaryResult;
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function compactJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized.length <= MAX_PROMPT_EVIDENCE_CHARS) return serialized;
  return `${serialized.slice(0, MAX_PROMPT_EVIDENCE_CHARS)}\n... [truncated]`;
}

function sanitizeSummary(value: string): string {
  return value.replace(/\s+\n/g, '\n').trim().slice(0, MAX_SUMMARY_CHARS);
}

function fallbackSummary(briefing: AiOpsBriefingRow): string {
  const suggestedCall = parseJson(briefing.suggested_call_json) as {
    tool?: string;
    action?: string;
  } | null;
  const next =
    suggestedCall?.tool && suggestedCall.action
      ? ` Suggested next MCP call: ${suggestedCall.tool}.${suggestedCall.action}.`
      : '';

  return `${briefing.title}. ${briefing.deterministic_summary}${next}`;
}

function buildPrompt(briefing: AiOpsBriefingRow): string {
  const evidence = redactAiOpsEvidence(parseJson(briefing.evidence_json));
  const suggestedCall = parseJson(briefing.suggested_call_json);

  return `Briefing:
- title: ${briefing.title}
- classification: ${briefing.classification}
- severity: ${briefing.severity}
- deterministic_summary: ${briefing.deterministic_summary}
- suggested_call_json: ${JSON.stringify(suggestedCall)}

Evidence:
${compactJson(evidence)}

Write a concise briefing summary.`;
}

export async function summarizeAiOpsBriefingWithLlm(
  options: SummarizeAiOpsBriefingOptions,
): Promise<AiOpsLlmSummaryResult> {
  const model = options.model ?? options.modelRegistry.getModel(AI_OPS_BRIEFING_FEATURE);
  const fallback = fallbackSummary(options.briefing);

  if (!model) {
    return {
      status: 'skipped',
      summary: fallback,
      error: 'AI Ops briefing model is not configured.',
    };
  }

  try {
    const response = await withTracking(
      {
        projectId: options.briefing.project_id,
        serviceId: options.briefing.service_id ?? undefined,
        feature: 'ai_ops_briefing',
        briefingId: options.briefing.id,
        actionType: 'ai_ops_briefing',
        source: 'monitor',
      },
      () =>
        generateText({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildPrompt(options.briefing) },
          ],
          maxOutputTokens: 260,
        }),
    );

    const summary = sanitizeSummary(response.text);
    if (!summary) {
      return {
        status: 'fallback',
        summary: fallback,
        error: 'AI Ops briefing model returned an empty summary.',
      };
    }

    await options.db.updateAiOpsBriefingLlmSummary(options.briefing.id, summary);
    return { status: 'llm', summary };
  } catch (error) {
    log.warn(
      { err: error, briefingId: options.briefing.id },
      'AI Ops briefing LLM summary failed; using deterministic fallback',
    );
    return {
      status: 'fallback',
      summary: fallback,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function createAiOpsBriefingWithOptionalLlm(
  options: CreateAiOpsBriefingWithLlmOptions,
): Promise<CreateAiOpsBriefingWithLlmResult> {
  const deterministic = buildDeterministicAiOpsBriefing(options.input);
  const created = await options.db.createAiOpsBriefing({
    projectId: deterministic.projectId,
    serviceId: deterministic.serviceId,
    dedupeKey: deterministic.dedupeKey,
    fingerprint: deterministic.fingerprint,
    classification: deterministic.classification,
    severity: deterministic.severity,
    title: deterministic.title,
    deterministicSummary: deterministic.deterministicSummary,
    suggestedCall: deterministic.suggestedCall,
    evidence: deterministic.evidence,
  });

  if (options.enableLlmSummary !== true || !options.modelRegistry) {
    return {
      deterministic,
      briefing: created,
      summary: { status: 'skipped', summary: fallbackSummary(created) },
    };
  }

  const summary = await summarizeAiOpsBriefingWithLlm({
    db: options.db,
    modelRegistry: options.modelRegistry,
    briefing: created,
  });

  return {
    deterministic,
    briefing:
      summary.status === 'llm'
        ? {
            ...created,
            llm_summary: summary.summary,
          }
        : created,
    summary,
  };
}
