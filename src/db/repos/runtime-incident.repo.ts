import { and, desc, eq } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { runtimeIncidents } from '../schema.drizzle.js';
import type { RuntimeIncidentRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

/**
 * Post-0012: runtime_incidents is service-scoped. Callers still pass
 * `projectId` for vocabulary continuity; the repo translates to the
 * canonical deployable service id.
 */
function projectIdToServiceId(projectId: string): string {
  return projectId.endsWith('__svc') ? projectId : `${projectId}__svc`;
}

export class RuntimeIncidentRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async createIncident(opts: {
    projectId: string;
    environmentId?: string | null;
    category: string;
    exitCode?: number | null;
    errorSnippet?: string | null;
    containerImage?: string | null;
    containerUptimeMs?: number | null;
    restartCount?: number | null;
    diagnosis?: string | null;
  }): Promise<RuntimeIncidentRow> {
    const id = crypto.randomUUID();
    const row =
      (
        await this.db
          .insert(runtimeIncidents)
          .values({
            id,
            service_id: projectIdToServiceId(opts.projectId),
            environment_id: opts.environmentId ?? null,
            category: opts.category,
            exit_code: opts.exitCode ?? null,
            error_snippet: opts.errorSnippet ?? null,
            container_image: opts.containerImage ?? null,
            container_uptime_ms: opts.containerUptimeMs ?? null,
            restart_count: opts.restartCount ?? null,
            diagnosis: opts.diagnosis ?? null,
          })
          .returning()
      )[0] ?? null;

    if (!row) throw new RepoPersistenceError('runtime incident', id);
    return { ...row, project_id: row.service_id.replace(/__svc$/, '') };
  }

  async getIncident(id: string): Promise<RuntimeIncidentRow | undefined> {
    const row =
      (
        await this.db.select().from(runtimeIncidents).where(eq(runtimeIncidents.id, id)).limit(1)
      )[0] ?? null;
    if (!row) return undefined;
    // Back-compat: hydrate deprecated project_id from service_id (strip __svc).
    return { ...row, project_id: row.service_id.replace(/__svc$/, '') };
  }

  /** @param _serverId - Reserved for future server-side filtering. Currently ignored. */
  async listByProject(
    projectId: string,
    opts?: { resolved?: boolean },
    _serverId?: string,
  ): Promise<RuntimeIncidentRow[]> {
    const serviceId = projectIdToServiceId(projectId);
    if (opts?.resolved === undefined) {
      return await this.db
        .select()
        .from(runtimeIncidents)
        .where(eq(runtimeIncidents.service_id, serviceId))
        .orderBy(desc(runtimeIncidents.created_at));
    }

    return await this.db
      .select()
      .from(runtimeIncidents)
      .where(
        and(
          eq(runtimeIncidents.service_id, serviceId),
          eq(runtimeIncidents.resolved, opts.resolved ? 1 : 0),
        ),
      )
      .orderBy(desc(runtimeIncidents.created_at));
  }

  async listUnresolved(): Promise<RuntimeIncidentRow[]> {
    return await this.db
      .select()
      .from(runtimeIncidents)
      .where(eq(runtimeIncidents.resolved, 0))
      .orderBy(desc(runtimeIncidents.created_at));
  }

  /**
   * Cross-project recent-resolved query. Used by the v4 /api/activity feed
   * so the resolved-incident path doesn't have to load full per-project
   * histories and slice in memory.
   */
  async listRecentResolved(limit = 50): Promise<RuntimeIncidentRow[]> {
    return await this.db
      .select()
      .from(runtimeIncidents)
      .where(eq(runtimeIncidents.resolved, 1))
      .orderBy(desc(runtimeIncidents.resolved_at))
      .limit(limit);
  }

  async resolveIncident(id: string): Promise<void> {
    await this.db
      .update(runtimeIncidents)
      .set({
        resolved: 1,
        resolved_at: new Date().toISOString(),
      })
      .where(eq(runtimeIncidents.id, id));
  }

  async updateDiagnosis(id: string, diagnosis: string): Promise<void> {
    await this.db
      .update(runtimeIncidents)
      .set({
        diagnosis,
      })
      .where(eq(runtimeIncidents.id, id));
  }
}
