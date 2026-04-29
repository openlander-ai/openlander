import { eq, or } from 'drizzle-orm';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import {
  projectDependencies,
  type ProjectDependencyRow,
  type NewProjectDependency,
} from '../schema.drizzle.js';
import { RepoPersistenceError } from '../../errors.js';

/**
 * Post-0012: project_dependencies is service-scoped. Callers historically
 * pass project ids; the repo translates to canonical service ids
 * (`${id}__svc`) on insert/lookup.
 */
function projectIdToServiceId(projectId: string): string {
  return projectId.endsWith('__svc') ? projectId : `${projectId}__svc`;
}

// Extend the row type with back-compat deprecated fields.
type ProjectDependencyRowHydrated = ProjectDependencyRow & {
  source_project_id?: string | null;
  target_project_id?: string | null;
};

export class ProjectDependencyRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  /**
   * Back-compat: derive deprecated `source_project_id`/`target_project_id`
   * from canonical service IDs (strip __svc suffix).
   */
  private hydrateDeprecated(row: ProjectDependencyRow): ProjectDependencyRowHydrated {
    return {
      ...row,
      // Only derive project_id when the service id follows the ${projectId}__svc
      // convention. Managed service ids (e.g. 'svc-redis') have no __svc suffix
      // and should produce null for the deprecated project_id field.
      source_project_id: row.source_service_id.endsWith('__svc')
        ? row.source_service_id.replace(/__svc$/, '')
        : null,
      target_project_id: row.target_service_id?.endsWith('__svc')
        ? row.target_service_id.replace(/__svc$/, '')
        : null,
    };
  }

  /**
   * Insert a dependency row. Accepts either the legacy `source_project_id`
   * /`target_project_id`/`target_service_id` shape (translated to canonical
   * service ids here) or the post-0012 `source_service_id`/`target_service_id`
   * shape directly.
   */
  create(
    data: Omit<NewProjectDependency, 'id' | 'created_at' | 'source_service_id'> & {
      source_service_id?: string;
      source_project_id?: string;
      target_project_id?: string | null;
    },
  ): ProjectDependencyRowHydrated {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const sourceServiceId =
      data.source_service_id ??
      (data.source_project_id ? projectIdToServiceId(data.source_project_id) : '');
    const targetServiceId =
      data.target_service_id ??
      (data.target_project_id ? projectIdToServiceId(data.target_project_id) : null);
    this.db
      .insert(projectDependencies)
      .values({
        id,
        source_service_id: sourceServiceId,
        target_service_id: targetServiceId,
        dependency_type: data.dependency_type ?? 'custom',
        source: data.source ?? 'manual',
        created_at: now,
      })
      .run();
    const row = this.db
      .select()
      .from(projectDependencies)
      .where(eq(projectDependencies.id, id))
      .get();
    if (!row) throw new RepoPersistenceError('project dependency', id);
    return this.hydrateDeprecated(row);
  }

  findByProject(projectId: string): ProjectDependencyRowHydrated[] {
    const rows = this.db
      .select()
      .from(projectDependencies)
      .where(eq(projectDependencies.source_service_id, projectIdToServiceId(projectId)))
      .all() as ProjectDependencyRow[];
    return rows.map((r) => this.hydrateDeprecated(r));
  }

  findDependents(
    targetProjectId?: string,
    targetServiceId?: string,
  ): ProjectDependencyRowHydrated[] {
    if (targetProjectId) {
      const rows = this.db
        .select()
        .from(projectDependencies)
        .where(eq(projectDependencies.target_service_id, projectIdToServiceId(targetProjectId)))
        .all() as ProjectDependencyRow[];
      return rows.map((r) => this.hydrateDeprecated(r));
    }
    if (targetServiceId) {
      const rows = this.db
        .select()
        .from(projectDependencies)
        .where(eq(projectDependencies.target_service_id, targetServiceId))
        .all() as ProjectDependencyRow[];
      return rows.map((r) => this.hydrateDeprecated(r));
    }
    return [];
  }

  findAll(): ProjectDependencyRowHydrated[] {
    const rows = this.db.select().from(projectDependencies).all() as ProjectDependencyRow[];
    return rows.map((r) => this.hydrateDeprecated(r));
  }

  delete(id: string): void {
    this.db.delete(projectDependencies).where(eq(projectDependencies.id, id)).run();
  }

  deleteByProject(projectId: string): void {
    const serviceId = projectIdToServiceId(projectId);
    this.db
      .delete(projectDependencies)
      .where(
        or(
          eq(projectDependencies.source_service_id, serviceId),
          eq(projectDependencies.target_service_id, serviceId),
        ),
      )
      .run();
  }

  syncFromServiceConnections(
    serviceConnections: Array<{
      project_id: string;
      service_id: string;
      service_type?: string;
    }>,
  ): void {
    this.db.delete(projectDependencies).where(eq(projectDependencies.source, 'auto')).run();
    for (const conn of serviceConnections) {
      const id = crypto.randomUUID();
      const depType =
        conn.service_type === 'postgres' || conn.service_type === 'mysql'
          ? 'database'
          : conn.service_type === 'redis'
            ? 'cache'
            : 'custom';
      this.db
        .insert(projectDependencies)
        .values({
          id,
          source_service_id: projectIdToServiceId(conn.project_id),
          target_service_id: conn.service_id,
          dependency_type: depType as ProjectDependencyRow['dependency_type'],
          source: 'auto',
          created_at: new Date().toISOString(),
        })
        .run();
    }
  }
}
