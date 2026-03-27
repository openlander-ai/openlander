import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { aiUsageLog } from '../schema.drizzle.js';
import type { AiUsageLogRow } from '../types.js';

export class AiUsageLogRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  /**
   * Create a new AI usage log entry.
   * Generates UUID and sets created_at timestamp.
   */
  create(data: Omit<AiUsageLogRow, 'id' | 'created_at'>): string {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.db
      .insert(aiUsageLog)
      .values({
        id,
        project_id: data.project_id ?? null,
        session_id: data.session_id ?? null,
        action_type: data.action_type,
        model_name: data.model_name,
        provider: data.provider,
        input_tokens: data.input_tokens,
        output_tokens: data.output_tokens,
        total_tokens: data.total_tokens,
        cost_usd: data.cost_usd ?? null,
        tools_called: data.tools_called,
        result: data.result,
        duration_ms: data.duration_ms,
        user_id: data.user_id ?? null,
        tenant_id: data.tenant_id ?? null,
        source: data.source ?? null,
        created_at: createdAt,
      })
      .run();

    return id;
  }

  /**
   * Find all AI usage logs for a project.
   */
  findByProjectId(projectId: string): AiUsageLogRow[] {
    return this.db
      .select()
      .from(aiUsageLog)
      .where(eq(aiUsageLog.project_id, projectId))
      .orderBy(desc(aiUsageLog.created_at))
      .all() as AiUsageLogRow[];
  }

  /**
   * Find AI usage logs within a date range.
   */
  findByDateRange(from: Date, to: Date): AiUsageLogRow[] {
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    return this.db
      .select()
      .from(aiUsageLog)
      .where(and(gte(aiUsageLog.created_at, fromIso), lte(aiUsageLog.created_at, toIso)))
      .orderBy(desc(aiUsageLog.created_at))
      .all() as AiUsageLogRow[];
  }

  /**
   * Get token usage summary.
   * If projectId is provided, returns summary for that project.
   * Otherwise returns global summary.
   */
  getTokenSummary(projectId?: string): {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number | null;
  } {
    const whereClause = projectId ? eq(aiUsageLog.project_id, projectId) : undefined;

    const result = this.db
      .select({
        totalInputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.input_tokens}), 0)`,
        totalOutputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.output_tokens}), 0)`,
        totalCostUsd: sql<number | null>`SUM(${aiUsageLog.cost_usd})`,
      })
      .from(aiUsageLog)
      .where(whereClause)
      .get() as
      | {
          totalInputTokens: number;
          totalOutputTokens: number;
          totalCostUsd: number | null;
        }
      | undefined;

    return {
      totalInputTokens: result?.totalInputTokens ?? 0,
      totalOutputTokens: result?.totalOutputTokens ?? 0,
      totalCostUsd: result?.totalCostUsd ?? null,
    };
  }
}
