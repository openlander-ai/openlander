import { and, desc, eq, gte, inArray, like, lte, or } from 'drizzle-orm';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { pickDefined } from '../helpers.js';
import { opsIncidents } from '../schema.drizzle.js';
import type { OpsIncidentRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

function escapeLikePattern(text: string): string {
  return text.replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export class OpsIncidentRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  create(data: {
    id: string;
    project_id: string;
    severity: string;
    status?: string;
    root_cause?: string;
  }): OpsIncidentRow {
    this.db
      .insert(opsIncidents)
      .values({
        id: data.id,
        project_id: data.project_id,
        severity: data.severity as 'critical' | 'warning' | 'info',
        status: (data.status ?? 'open') as 'open' | 'active' | 'resolved' | 'escalated',
        root_cause: data.root_cause,
        created_at: Date.now(),
      })
      .run();

    const created = this.findById(data.id);
    if (!created) throw new RepoPersistenceError('ops incident', data.id);
    return created;
  }

  findById(id: string): OpsIncidentRow | undefined {
    return this.db.select().from(opsIncidents).where(eq(opsIncidents.id, id)).get();
  }

  findByProjectId(projectId: string, limit?: number): OpsIncidentRow[] {
    const baseQuery = this.db
      .select()
      .from(opsIncidents)
      .where(eq(opsIncidents.project_id, projectId))
      .orderBy(desc(opsIncidents.created_at));

    if (limit) {
      return baseQuery.limit(limit).all();
    }

    return baseQuery.all();
  }

  findActive(projectId: string): OpsIncidentRow | undefined {
    return this.db
      .select()
      .from(opsIncidents)
      .where(
        and(
          eq(opsIncidents.project_id, projectId),
          inArray(opsIncidents.status, ['open', 'active']),
        ),
      )
      .orderBy(desc(opsIncidents.created_at))
      .get();
  }

  findAllActive(): OpsIncidentRow[] {
    return this.db
      .select()
      .from(opsIncidents)
      .where(inArray(opsIncidents.status, ['open', 'active']))
      .orderBy(desc(opsIncidents.created_at))
      .all();
  }

  findByDateRange(from: number, to: number, searchText?: string): OpsIncidentRow[] {
    const conditions = [gte(opsIncidents.created_at, from), lte(opsIncidents.created_at, to)];
    if (searchText) {
      const escaped = escapeLikePattern(searchText);
      const searchCondition = or(
        like(opsIncidents.root_cause, `%${escaped}%`),
        like(opsIncidents.diagnosis, `%${escaped}%`),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    return this.db
      .select()
      .from(opsIncidents)
      .where(and(...conditions))
      .orderBy(desc(opsIncidents.created_at))
      .all();
  }

  findBySearch(searchText: string, limit?: number): OpsIncidentRow[] {
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

    if (limit) {
      return baseQuery.limit(limit).all();
    }

    return baseQuery.all();
  }

  updateStatus(
    id: string,
    status: string,
    extra?: { resolved_at?: number; escalated_at?: number },
  ): void {
    const setValues: Record<string, unknown> = {
      status: status,
    };
    if (extra?.resolved_at !== undefined) {
      setValues.resolved_at = extra.resolved_at;
    }
    if (extra?.escalated_at !== undefined) {
      setValues.escalated_at = extra.escalated_at;
    }

    this.db.update(opsIncidents).set(setValues).where(eq(opsIncidents.id, id)).run();
  }

  update(
    id: string,
    data: Partial<{
      root_cause: string;
      diagnosis: string;
      actions_taken: string;
      status: string;
    }>,
  ): void {
    const setValues: Record<string, unknown> = pickDefined(
      data,
      'root_cause',
      'diagnosis',
      'actions_taken',
    );
    if (data.status !== undefined) {
      setValues.status = data.status;
    }

    if (Object.keys(setValues).length === 0) return;

    this.db.update(opsIncidents).set(setValues).where(eq(opsIncidents.id, id)).run();
  }
}
