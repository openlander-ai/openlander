import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { aiUsageLog } from '../schema.drizzle.js';
import type { AiUsageLogRow } from '../types.js';

interface AiUsageLogFilterOptions {
  projectId?: string;
  from?: Date;
  to?: Date;
}

export class AiUsageLogRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {}

  /**
   * Create a new AI usage log entry.
   * Generates UUID and sets created_at timestamp.
   */
  create(data: Omit<AiUsageLogRow, 'id' | 'created_at'>): string {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // Raw better-sqlite3 prepare instead of Drizzle .insert().values() —
    // observed on dogfood mini PM2 logs: the Drizzle path was throwing
    // "TypeError: You cannot specify named parameters in two different
    // objects" from better-sqlite3 session.ts:132 on every ai:usage event.
    // The collision came from the way Drizzle bundles defaults with explicit
    // values. Positional binding sidesteps it entirely and the wire shape
    // is identical.
    this.sqlite
      .prepare(
        `INSERT INTO ai_usage_log (
          id, project_id, session_id, action_type, model_name, provider,
          input_tokens, output_tokens, total_tokens, cost_usd, tools_called,
          result, error_message, error_type, duration_ms, user_id, tenant_id,
          source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        data.project_id ?? null,
        data.session_id ?? null,
        data.action_type,
        data.model_name,
        data.provider,
        data.input_tokens,
        data.output_tokens,
        data.total_tokens,
        data.cost_usd ?? null,
        data.tools_called,
        data.result,
        data.error_message ?? null,
        data.error_type ?? null,
        data.duration_ms,
        data.user_id ?? null,
        data.tenant_id ?? null,
        data.source ?? null,
        createdAt,
      );

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
      .all();
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
      .all();
  }

  findRecent(opts: { limit: number } & AiUsageLogFilterOptions): AiUsageLogRow[] {
    const whereClause = this.buildWhereClause(opts);

    return this.db
      .select()
      .from(aiUsageLog)
      .where(whereClause)
      .orderBy(desc(aiUsageLog.created_at))
      .limit(opts.limit)
      .all();
  }

  countAll(opts?: AiUsageLogFilterOptions): number {
    const whereClause = this.buildWhereClause(opts);
    const row = this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(aiUsageLog)
      .where(whereClause)
      .get();

    return row?.count ?? 0;
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
      .get();

    return {
      totalInputTokens: result?.totalInputTokens ?? 0,
      totalOutputTokens: result?.totalOutputTokens ?? 0,
      totalCostUsd: result?.totalCostUsd ?? null,
    };
  }

  getTokenSummaryFiltered(opts?: AiUsageLogFilterOptions): {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number | null;
  } {
    const whereClause = this.buildWhereClause(opts);

    const result = this.db
      .select({
        totalInputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.input_tokens}), 0)`,
        totalOutputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.output_tokens}), 0)`,
        totalCostUsd: sql<number | null>`SUM(${aiUsageLog.cost_usd})`,
      })
      .from(aiUsageLog)
      .where(whereClause)
      .get();

    return {
      totalInputTokens: result?.totalInputTokens ?? 0,
      totalOutputTokens: result?.totalOutputTokens ?? 0,
      totalCostUsd: result?.totalCostUsd ?? null,
    };
  }

  private buildWhereClause(opts?: AiUsageLogFilterOptions) {
    const conditions: Array<ReturnType<typeof eq>> = [];

    if (opts?.projectId) {
      conditions.push(eq(aiUsageLog.project_id, opts.projectId));
    }

    if (opts?.from) {
      conditions.push(gte(aiUsageLog.created_at, opts.from.toISOString()));
    }

    if (opts?.to) {
      conditions.push(lte(aiUsageLog.created_at, opts.to.toISOString()));
    }

    if (conditions.length === 0) {
      return undefined;
    }

    if (conditions.length === 1) {
      return conditions[0];
    }

    return and(...conditions);
  }
}
