import { and, desc, eq } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { runtimeIncidents, services } from '../schema.drizzle.js';
import type { RuntimeIncidentRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

/**
 * Post-0012: runtime_incidents is service-scoped. Legacy project callers still
 * pass `projectId`; the repo translates it to the canonical deployable service
 * id. Service-scoped callers can pass `serviceId` directly, which is required
 * for Database/Cache/Storage resources whose ids are not derived from a Project.
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

  private hydrateDeprecated(
    row: RuntimeIncidentRow,
    serviceProjectId?: string | null,
  ): RuntimeIncidentRow {
    return { ...row, project_id: serviceProjectId ?? row.service_id.replace(/__svc$/, '') };
  }

  private async resolveExistingCanonicalServiceId(projectId: string): Promise<string> {
    const serviceId = projectIdToServiceId(projectId);
    const [service] = await this.db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);
    if (!service) {
      throw new RepoPersistenceError('service', serviceId);
    }
    return service.id;
  }

  async createIncident(opts: {
    projectId: string;
    serviceId?: string;
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
    const serviceId = opts.serviceId ?? (await this.resolveExistingCanonicalServiceId(opts.projectId));
    const row =
      (
        await this.db
          .insert(runtimeIncidents)
          .values({
            id,
            service_id: serviceId,
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
    return this.hydrateDeprecated(row, opts.serviceId ? opts.projectId : null);
  }

  async getIncident(id: string): Promise<RuntimeIncidentRow | undefined> {
    const selected =
      (
        await this.db
          .select({
            incident: runtimeIncidents,
            serviceProjectId: services.project_id,
          })
          .from(runtimeIncidents)
          .leftJoin(services, eq(runtimeIncidents.service_id, services.id))
          .where(eq(runtimeIncidents.id, id))
          .limit(1)
      )[0] ?? null;
    const row = (selected?.incident ?? null) as RuntimeIncidentRow | null;
    if (!row) return undefined;
    return this.hydrateDeprecated(row, selected?.serviceProjectId);
  }

  /** @param _serverId - Reserved for future server-side filtering. Currently ignored. */
  async listByProject(
    projectId: string,
    opts?: { resolved?: boolean },
    _serverId?: string,
  ): Promise<RuntimeIncidentRow[]> {
    const serviceId = projectIdToServiceId(projectId);
    if (opts?.resolved === undefined) {
      const rows = await this.db
        .select()
        .from(runtimeIncidents)
        .where(eq(runtimeIncidents.service_id, serviceId))
        .orderBy(desc(runtimeIncidents.created_at));
      return rows.map((row) => this.hydrateDeprecated(row as RuntimeIncidentRow, projectId));
    }

    const rows = await this.db
      .select()
      .from(runtimeIncidents)
      .where(
        and(
          eq(runtimeIncidents.service_id, serviceId),
          eq(runtimeIncidents.resolved, opts.resolved ? 1 : 0),
        ),
      )
      .orderBy(desc(runtimeIncidents.created_at));
    return rows.map((row) => this.hydrateDeprecated(row as RuntimeIncidentRow, projectId));
  }

  async listUnresolved(): Promise<RuntimeIncidentRow[]> {
    const rows = await this.db
      .select({
        incident: runtimeIncidents,
        serviceProjectId: services.project_id,
      })
      .from(runtimeIncidents)
      .leftJoin(services, eq(runtimeIncidents.service_id, services.id))
      .where(eq(runtimeIncidents.resolved, 0))
      .orderBy(desc(runtimeIncidents.created_at));
    return rows.map((selected) =>
      this.hydrateDeprecated(selected.incident as RuntimeIncidentRow, selected.serviceProjectId),
    );
  }

  /**
   * Cross-project recent-resolved query. Used by the v4 /api/activity feed
   * so the resolved-incident path doesn't have to load full per-project
   * histories and slice in memory.
   */
  async listRecentResolved(limit = 50): Promise<RuntimeIncidentRow[]> {
    const rows = await this.db
      .select({
        incident: runtimeIncidents,
        serviceProjectId: services.project_id,
      })
      .from(runtimeIncidents)
      .leftJoin(services, eq(runtimeIncidents.service_id, services.id))
      .where(eq(runtimeIncidents.resolved, 1))
      .orderBy(desc(runtimeIncidents.resolved_at))
      .limit(limit);
    return rows.map((selected) =>
      this.hydrateDeprecated(selected.incident as RuntimeIncidentRow, selected.serviceProjectId),
    );
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
