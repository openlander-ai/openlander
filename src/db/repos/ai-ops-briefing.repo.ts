import { and, desc, eq } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { aiOpsBriefings } from '../schema.drizzle.js';
import type {
  AiOpsBriefingRow,
  AiOpsBriefingStatus,
  AiOpsBriefingSeverity,
  AiOpsLlmSummaryStatus,
} from '../types.js';
import type { AiOpsEvidencePack, AiOpsSuggestedCall } from '../../monitor/ai-ops-briefing.js';
import { RepoPersistenceError } from '../../errors.js';

export interface AiOpsLlmSummaryUsageMetadata {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  text_tokens?: number;
  reasoning_tokens?: number;
}

export interface AiOpsLlmSummaryMetadata {
  status?: AiOpsLlmSummaryStatus | null;
  finishReason?: string | null;
  truncated?: boolean | null;
  error?: string | null;
  usage?: AiOpsLlmSummaryUsageMetadata | null;
}

export interface CreateAiOpsBriefingData {
  id?: string;
  projectId: string;
  serviceId?: string | null;
  dedupeKey?: string | null;
  fingerprint: string;
  classification: string;
  severity: AiOpsBriefingSeverity;
  title: string;
  deterministicSummary: string;
  llmSummary?: string | null;
  llmSummaryMetadata?: AiOpsLlmSummaryMetadata | null;
  suggestedCall?: AiOpsSuggestedCall | null;
  evidence: AiOpsEvidencePack;
}

function serializeUsageMetadata(
  usage: AiOpsLlmSummaryUsageMetadata | null | undefined,
): string | null {
  if (!usage) return null;
  if (Object.keys(usage).length === 0) return null;
  return JSON.stringify(usage);
}

export class AiOpsBriefingRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async create(data: CreateAiOpsBriefingData): Promise<AiOpsBriefingRow> {
    const id = data.id ?? crypto.randomUUID();
    const row =
      (
        await this.db
          .insert(aiOpsBriefings)
          .values({
            id,
            project_id: data.projectId,
            service_id: data.serviceId ?? null,
            dedupe_key: data.dedupeKey ?? null,
            fingerprint: data.fingerprint,
            classification: data.classification,
            severity: data.severity,
            title: data.title,
            deterministic_summary: data.deterministicSummary,
            llm_summary: data.llmSummary ?? null,
            llm_summary_status: data.llmSummaryMetadata?.status ?? null,
            llm_summary_finish_reason: data.llmSummaryMetadata?.finishReason ?? null,
            llm_summary_truncated: data.llmSummaryMetadata?.truncated ?? null,
            llm_summary_error: data.llmSummaryMetadata?.error ?? null,
            llm_summary_usage_json: serializeUsageMetadata(data.llmSummaryMetadata?.usage),
            suggested_call_json: data.suggestedCall ? JSON.stringify(data.suggestedCall) : null,
            evidence_json: JSON.stringify(data.evidence),
          })
          .returning()
      )[0] ?? null;

    if (!row) throw new RepoPersistenceError('ai ops briefing', id);
    return row;
  }

  async findById(id: string): Promise<AiOpsBriefingRow | null> {
    const row =
      (await this.db.select().from(aiOpsBriefings).where(eq(aiOpsBriefings.id, id)).limit(1))[0] ??
      null;
    return row;
  }

  async listByProject(
    projectId: string,
    opts?: { limit?: number; status?: AiOpsBriefingStatus },
  ): Promise<AiOpsBriefingRow[]> {
    const limit = opts?.limit ?? 20;
    const conditions = [eq(aiOpsBriefings.project_id, projectId)];
    if (opts?.status) {
      conditions.push(eq(aiOpsBriefings.status, opts.status));
    }

    return await this.db
      .select()
      .from(aiOpsBriefings)
      .where(and(...conditions))
      .orderBy(desc(aiOpsBriefings.created_at), desc(aiOpsBriefings.id))
      .limit(limit);
  }

  async listByService(
    serviceId: string,
    opts?: { limit?: number; status?: AiOpsBriefingStatus },
  ): Promise<AiOpsBriefingRow[]> {
    const limit = opts?.limit ?? 20;
    const conditions = [eq(aiOpsBriefings.service_id, serviceId)];
    if (opts?.status) {
      conditions.push(eq(aiOpsBriefings.status, opts.status));
    }

    return await this.db
      .select()
      .from(aiOpsBriefings)
      .where(and(...conditions))
      .orderBy(desc(aiOpsBriefings.created_at), desc(aiOpsBriefings.id))
      .limit(limit);
  }

  async updateLlmSummary(
    id: string,
    summary: string | null,
    metadata?: AiOpsLlmSummaryMetadata | null,
  ): Promise<void> {
    await this.db
      .update(aiOpsBriefings)
      .set({
        llm_summary: summary,
        ...(metadata
          ? {
              llm_summary_status: metadata.status ?? null,
              llm_summary_finish_reason: metadata.finishReason ?? null,
              llm_summary_truncated: metadata.truncated ?? null,
              llm_summary_error: metadata.error ?? null,
              llm_summary_usage_json: serializeUsageMetadata(metadata.usage),
            }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .where(eq(aiOpsBriefings.id, id));
  }
}
