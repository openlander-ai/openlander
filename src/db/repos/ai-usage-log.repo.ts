import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { aiUsageLog } from '../schema.drizzle.js';
import type { AiUsageLogRow } from '../types.js';

interface AiUsageLogFilterOptions {
  projectId?: string;
  from?: Date;
  to?: Date;
}

type NewAiUsageLogData = Omit<
  AiUsageLogRow,
  'id' | 'created_at' | 'service_id' | 'feature' | 'briefing_id'
> &
  Partial<Pick<AiUsageLogRow, 'service_id' | 'feature' | 'briefing_id'>>;

export class AiUsageLogRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  /**
   * Create a new AI usage log entry.
   * Generates UUID and sets created_at timestamp.
   */
  async create(data: NewAiUsageLogData): Promise<string> {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await this.db.insert(aiUsageLog).values({
      id,
      project_id: data.project_id ?? null,
      service_id: data.service_id ?? null,
      feature: data.feature ?? null,
      briefing_id: data.briefing_id ?? null,
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
      error_message: data.error_message ?? null,
      error_type: data.error_type ?? null,
      duration_ms: data.duration_ms,
      user_id: data.user_id ?? null,
      tenant_id: data.tenant_id ?? null,
      source: data.source ?? null,
      created_at: createdAt,
    });

    return id;
  }

  /**
   * Find all AI usage logs for a project.
   */
  async findByProjectId(projectId: string): Promise<AiUsageLogRow[]> {
    return await this.db
      .select()
      .from(aiUsageLog)
      .where(eq(aiUsageLog.project_id, projectId))
      .orderBy(desc(aiUsageLog.created_at));
  }

  /**
   * Find AI usage logs within a date range.
   */
  async findByDateRange(from: Date, to: Date): Promise<AiUsageLogRow[]> {
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    return await this.db
      .select()
      .from(aiUsageLog)
      .where(and(gte(aiUsageLog.created_at, fromIso), lte(aiUsageLog.created_at, toIso)))
      .orderBy(desc(aiUsageLog.created_at));
  }

  async findRecent(opts: { limit: number } & AiUsageLogFilterOptions): Promise<AiUsageLogRow[]> {
    const whereClause = this.buildWhereClause(opts);

    if (whereClause) {
      return await this.db
        .select()
        .from(aiUsageLog)
        .where(whereClause)
        .orderBy(desc(aiUsageLog.created_at))
        .limit(opts.limit);
    }

    return await this.db
      .select()
      .from(aiUsageLog)
      .orderBy(desc(aiUsageLog.created_at))
      .limit(opts.limit);
  }

  async countAll(opts?: AiUsageLogFilterOptions): Promise<number> {
    const whereClause = this.buildWhereClause(opts);
    const row =
      (whereClause
        ? await this.db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(aiUsageLog)
            .where(whereClause)
            .limit(1)
        : await this.db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(aiUsageLog)
            .limit(1))[0] ?? null;

    return row?.count ?? 0;
  }

  /**
   * Get token usage summary.
   * If projectId is provided, returns summary for that project.
   * Otherwise returns global summary.
   */
  async getTokenSummary(projectId?: string): Promise<{
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number | null;
  }> {
    const row =
      (projectId
        ? await this.db
            .select({
              totalInputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.input_tokens}), 0)::int`,
              totalOutputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.output_tokens}), 0)::int`,
              totalCostUsd: sql<number | null>`SUM(${aiUsageLog.cost_usd})`,
            })
            .from(aiUsageLog)
            .where(eq(aiUsageLog.project_id, projectId))
            .limit(1)
        : await this.db
            .select({
              totalInputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.input_tokens}), 0)::int`,
              totalOutputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.output_tokens}), 0)::int`,
              totalCostUsd: sql<number | null>`SUM(${aiUsageLog.cost_usd})`,
            })
            .from(aiUsageLog)
            .limit(1))[0] ?? null;

    return {
      totalInputTokens: row?.totalInputTokens ?? 0,
      totalOutputTokens: row?.totalOutputTokens ?? 0,
      totalCostUsd: row?.totalCostUsd ?? null,
    };
  }

  async getTokenSummaryFiltered(opts?: AiUsageLogFilterOptions): Promise<{
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number | null;
  }> {
    const whereClause = this.buildWhereClause(opts);
    const row =
      (whereClause
        ? await this.db
            .select({
              totalInputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.input_tokens}), 0)::int`,
              totalOutputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.output_tokens}), 0)::int`,
              totalCostUsd: sql<number | null>`SUM(${aiUsageLog.cost_usd})`,
            })
            .from(aiUsageLog)
            .where(whereClause)
            .limit(1)
        : await this.db
            .select({
              totalInputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.input_tokens}), 0)::int`,
              totalOutputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.output_tokens}), 0)::int`,
              totalCostUsd: sql<number | null>`SUM(${aiUsageLog.cost_usd})`,
            })
            .from(aiUsageLog)
            .limit(1))[0] ?? null;

    return {
      totalInputTokens: row?.totalInputTokens ?? 0,
      totalOutputTokens: row?.totalOutputTokens ?? 0,
      totalCostUsd: row?.totalCostUsd ?? null,
    };
  }

  private buildWhereClause(opts?: AiUsageLogFilterOptions): SQL | undefined {
    const conditions: SQL[] = [];

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
