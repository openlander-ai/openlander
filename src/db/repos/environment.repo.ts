import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { buildSetValues } from '../helpers.js';
import { environments } from '../schema.drizzle.js';
import type { EnvironmentRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

/**
 * Post-0012: environments are service-scoped. Callers still pass `projectId`
 * for vocabulary continuity; the repo translates to the canonical service id.
 */
function projectIdToServiceId(projectId: string): string {
  return projectId.endsWith('__svc') ? projectId : `${projectId}__svc`;
}

export class EnvironmentRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  createEnvironment(environment: {
    id: string;
    projectId: string;
    type: EnvironmentRow['type'];
    branch: string;
    status?: EnvironmentRow['status'];
    assignedPort?: number | null;
    containerId?: string | null;
    imageTag?: string | null;
    previousImageTag?: string | null;
    publicUrl?: string | null;
  }): EnvironmentRow {
    this.db
      .insert(environments)
      .values({
        id: environment.id,
        service_id: projectIdToServiceId(environment.projectId),
        type: environment.type,
        branch: environment.branch,
        status: environment.status ?? 'idle',
        assigned_port: environment.assignedPort ?? null,
        container_id: environment.containerId ?? null,
        image_tag: environment.imageTag ?? null,
        previous_image_tag: environment.previousImageTag ?? null,
        public_url: environment.publicUrl ?? null,
      })
      .run();

    const created = this.getEnvironment(environment.id);
    if (!created) throw new RepoPersistenceError('environment', environment.id);
    return created;
  }

  getEnvironment(id: string): EnvironmentRow | undefined {
    const row = this.db.select().from(environments).where(eq(environments.id, id)).get() as
      | EnvironmentRow
      | undefined;
    if (!row) return undefined;
    // Back-compat: hydrate deprecated project_id from service_id (strip __svc).
    return { ...row, project_id: row.service_id.replace(/__svc$/, '') };
  }

  getEnvironmentsByProject(projectId: string): EnvironmentRow[] {
    const rows = this.db
      .select()
      .from(environments)
      .where(eq(environments.service_id, projectIdToServiceId(projectId)))
      .orderBy(asc(environments.created_at))
      .all() as EnvironmentRow[];
    // Back-compat: hydrate deprecated project_id from projectId parameter so
    // callers that read env.project_id continue to work through 1.0.
    return rows.map((r) => ({ ...r, project_id: projectId }));
  }

  getEnvironmentsByProjectIds(projectIds: string[]): Map<string, EnvironmentRow[]> {
    if (projectIds.length === 0) {
      return new Map();
    }

    const uniqueProjectIds = [...new Set(projectIds)];
    const projectIdByServiceId = new Map(
      uniqueProjectIds.map((projectId) => [projectIdToServiceId(projectId), projectId]),
    );
    const rows = this.db
      .select()
      .from(environments)
      .where(inArray(environments.service_id, [...projectIdByServiceId.keys()]))
      .orderBy(asc(environments.created_at))
      .all() as EnvironmentRow[];

    const byProjectId = new Map<string, EnvironmentRow[]>(
      uniqueProjectIds.map((projectId) => [projectId, []]),
    );
    for (const row of rows) {
      const projectId = projectIdByServiceId.get(row.service_id);
      if (!projectId) continue;
      byProjectId.get(projectId)?.push({ ...row, project_id: projectId });
    }

    return byProjectId;
  }

  updateEnvironment(
    id: string,
    updates: Partial<{
      branch: string;
      status: EnvironmentRow['status'];
      assignedPort: number | null;
      containerId: string | null;
      imageTag: string | null;
      previousImageTag: string | null;
      publicUrl: string | null;
      containerPort: number | null;
    }>,
  ): void {
    const setValues = buildSetValues(updates, {
      branch: 'branch',
      status: 'status',
      assignedPort: 'assigned_port',
      containerId: 'container_id',
      imageTag: 'image_tag',
      previousImageTag: 'previous_image_tag',
      publicUrl: 'public_url',
      containerPort: 'container_port',
    });

    if (Object.keys(setValues).length === 0) return;

    this.db
      .update(environments)
      .set({ ...setValues, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(environments.id, id))
      .run();
  }

  deleteEnvironment(id: string): void {
    this.db.delete(environments).where(eq(environments.id, id)).run();
  }
}
