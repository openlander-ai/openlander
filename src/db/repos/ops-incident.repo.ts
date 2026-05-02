import { and, desc, eq, gte, inArray, like, lte, or, type SQL } from 'drizzle-orm';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { opsIncidents } from '../schema.drizzle.js';
import type { OpsIncidentRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

function escapeLikePattern(text: string): string {
  return text.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export class OpsIncidentRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async create(data: {
    id: string;
    project_id: string;
    severity: string;
    status?: string;
    root_cause?: string;
  }): Promise<OpsIncidentRow> {
    const created =
      (
        await this.db
          .insert(opsIncidents)
          .values({
            id: data.id,
            project_id: data.project_id,
            severity: data.severity as OpsIncidentRow['severity'],
            status: (data.status ?? 'open') as OpsIncidentRow['status'],
            root_cause: data.root_cause,
            created_at: Date.now(),
          })
          .returning()
      )[0] ?? null;

    if (!created) throw new RepoPersistenceError('ops incident', data.id);
    return created;
  }

  async findById(id: string): Promise<OpsIncidentRow | undefined> {
    const row =
      (await this.db.select().from(opsIncidents).where(eq(opsIncidents.id, id)).limit(1))[0] ??
      null;
    return row ?? undefined;
  }

  async findByProjectId(projectId: string, limit?: number): Promise<OpsIncidentRow[]> {
    const baseQuery = this.db
      .select()
      .from(opsIncidents)
      .where(eq(opsIncidents.project_id, projectId))
      .orderBy(desc(opsIncidents.created_at));

    return limit ? await baseQuery.limit(limit) : await baseQuery;
  }

  async findActive(projectId: string): Promise<OpsIncidentRow | undefined> {
    const row =
      (
        await this.db
          .select()
          .from(opsIncidents)
          .where(
            and(
              eq(opsIncidents.project_id, projectId),
              inArray(opsIncidents.status, ['open', 'active']),
            ),
          )
          .orderBy(desc(opsIncidents.created_at))
          .limit(1)
      )[0] ?? null;
    return row ?? undefined;
  }

  async findAllActive(): Promise<OpsIncidentRow[]> {
    return await this.db
      .select()
      .from(opsIncidents)
      .where(inArray(opsIncidents.status, ['open', 'active']))
      .orderBy(desc(opsIncidents.created_at));
  }

  async findByDateRange(from: number, to: number, searchText?: string): Promise<OpsIncidentRow[]> {
    const conditions: SQL[] = [
      gte(opsIncidents.created_at, from),
      lte(opsIncidents.created_at, to),
    ];
    if (searchText) {
      const escaped = escapeLikePattern(searchText);
      const searchCondition = or(
        like(opsIncidents.root_cause, `%${escaped}%`),
        like(opsIncidents.diagnosis, `%${escaped}%`),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    return await this.db
      .select()
      .from(opsIncidents)
      .where(and(...conditions))
      .orderBy(desc(opsIncidents.created_at));
  }

  async findBySearch(searchText: string, limit?: number): Promise<OpsIncidentRow[]> {
    const escaped = escapeLikePattern(searchText);
    const baseQuery = this.db
      .select()
      .from(opsIncidents)
      .where(
        or(
          like(opsIncidents.root_cause, `%${escaped}%`),
          like(opsIncidents.diagnosis, `%${escaped}%`),
        ),
      )
      .orderBy(desc(opsIncidents.created_at));

    return limit ? await baseQuery.limit(limit) : await baseQuery;
  }

  async updateStatus(
    id: string,
    status: string,
    extra?: { resolved_at?: number; escalated_at?: number },
  ): Promise<void> {
    const setValues: Partial<typeof opsIncidents.$inferInsert> = {
      status: status as OpsIncidentRow['status'],
    };
    if (extra?.resolved_at !== undefined) {
      setValues.resolved_at = extra.resolved_at;
    }
    if (extra?.escalated_at !== undefined) {
      setValues.escalated_at = extra.escalated_at;
    }

    await this.db.update(opsIncidents).set(setValues).where(eq(opsIncidents.id, id));
  }

  async update(
    id: string,
    data: Partial<{
      root_cause: string;
      diagnosis: string;
      actions_taken: string;
      status: string;
    }>,
  ): Promise<void> {
    const setValues: Partial<typeof opsIncidents.$inferInsert> = {};
    if (data.root_cause !== undefined) {
      setValues.root_cause = data.root_cause;
    }
    if (data.diagnosis !== undefined) {
      setValues.diagnosis = data.diagnosis;
    }
    if (data.actions_taken !== undefined) {
      setValues.actions_taken = data.actions_taken;
    }
    if (data.status !== undefined) {
      setValues.status = data.status as OpsIncidentRow['status'];
    }

    if (Object.keys(setValues).length === 0) return;

    await this.db.update(opsIncidents).set(setValues).where(eq(opsIncidents.id, id));
  }
}
