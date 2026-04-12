import { and, desc, eq } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { runtimeIncidents } from '../schema.drizzle.js';
import type { RuntimeIncidentRow } from '../types.js';

export class RuntimeIncidentRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  createIncident(opts: {
    projectId: string;
    environmentId?: string | null;
    category: string;
    exitCode?: number | null;
    errorSnippet?: string | null;
    containerImage?: string | null;
    containerUptimeMs?: number | null;
    restartCount?: number | null;
    diagnosis?: string | null;
  }): RuntimeIncidentRow {
    const id = crypto.randomUUID();

    this.db
      .insert(runtimeIncidents)
      .values({
        id,
        project_id: opts.projectId,
        environment_id: opts.environmentId ?? null,
        category: opts.category,
        exit_code: opts.exitCode ?? null,
        error_snippet: opts.errorSnippet ?? null,
        container_image: opts.containerImage ?? null,
        container_uptime_ms: opts.containerUptimeMs ?? null,
        restart_count: opts.restartCount ?? null,
        diagnosis: opts.diagnosis ?? null,
      })
      .run();

    const created = this.getIncident(id);
    if (!created) throw new Error(`Failed to create runtime incident ${id}`);
    return created;
  }

  getIncident(id: string): RuntimeIncidentRow | undefined {
    return this.db.select().from(runtimeIncidents).where(eq(runtimeIncidents.id, id)).get() as
      | RuntimeIncidentRow
      | undefined;
  }

  listByProject(projectId: string, opts?: { resolved?: boolean }): RuntimeIncidentRow[] {
    if (opts?.resolved === undefined) {
      return this.db
        .select()
        .from(runtimeIncidents)
        .where(eq(runtimeIncidents.project_id, projectId))
        .orderBy(desc(runtimeIncidents.created_at))
        .all() as RuntimeIncidentRow[];
    }

    return this.db
      .select()
      .from(runtimeIncidents)
      .where(
        and(
          eq(runtimeIncidents.project_id, projectId),
          eq(runtimeIncidents.resolved, opts.resolved ? 1 : 0),
        ),
      )
      .orderBy(desc(runtimeIncidents.created_at))
      .all() as RuntimeIncidentRow[];
  }

  listUnresolved(): RuntimeIncidentRow[] {
    return this.db
      .select()
      .from(runtimeIncidents)
      .where(eq(runtimeIncidents.resolved, 0))
      .orderBy(desc(runtimeIncidents.created_at))
      .all() as RuntimeIncidentRow[];
  }

  resolveIncident(id: string): void {
    this.db
      .update(runtimeIncidents)
      .set({
        resolved: 1,
        resolved_at: new Date().toISOString(),
      })
      .where(eq(runtimeIncidents.id, id))
      .run();
  }

  updateDiagnosis(id: string, diagnosis: string): void {
    this.db
      .update(runtimeIncidents)
      .set({
        diagnosis,
      })
      .where(eq(runtimeIncidents.id, id))
      .run();
  }
}
