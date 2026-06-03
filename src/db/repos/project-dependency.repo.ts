import { and, eq, or } from 'drizzle-orm';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
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
    private readonly client: PostgresClient,
  ) {
    void this.client;
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
  async create(
    data: Omit<NewProjectDependency, 'id' | 'created_at' | 'source_service_id'> & {
      source_service_id?: string;
      source_project_id?: string;
      target_project_id?: string | null;
    },
  ): Promise<ProjectDependencyRowHydrated> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const sourceServiceId =
      data.source_service_id ??
      (data.source_project_id ? projectIdToServiceId(data.source_project_id) : '');
    const targetServiceId =
      data.target_service_id ??
      (data.target_project_id ? projectIdToServiceId(data.target_project_id) : null);
    const row =
      (
        await this.db
          .insert(projectDependencies)
          .values({
            id,
            source_service_id: sourceServiceId,
            target_service_id: targetServiceId,
            dependency_type: data.dependency_type ?? 'custom',
            source: data.source ?? 'manual',
            created_at: now,
          })
          .returning()
      )[0] ?? null;

    if (!row) throw new RepoPersistenceError('project dependency', id);
    return this.hydrateDeprecated(row);
  }

  async findByProject(projectId: string): Promise<ProjectDependencyRowHydrated[]> {
    const rows = await this.db
      .select()
      .from(projectDependencies)
      .where(eq(projectDependencies.source_service_id, projectIdToServiceId(projectId)));
    return rows.map((r) => this.hydrateDeprecated(r));
  }

  async findBySourceAndTargetService(
    sourceServiceId: string,
    targetServiceId: string,
  ): Promise<ProjectDependencyRowHydrated[]> {
    const rows = await this.db
      .select()
      .from(projectDependencies)
      .where(
        and(
          eq(projectDependencies.source_service_id, sourceServiceId),
          eq(projectDependencies.target_service_id, targetServiceId),
        ),
      );
    return rows.map((r) => this.hydrateDeprecated(r));
  }

  async findDependents(
    targetProjectId?: string,
    targetServiceId?: string,
  ): Promise<ProjectDependencyRowHydrated[]> {
    if (targetProjectId) {
      const rows = await this.db
        .select()
        .from(projectDependencies)
        .where(eq(projectDependencies.target_service_id, projectIdToServiceId(targetProjectId)));
      return rows.map((r) => this.hydrateDeprecated(r));
    }
    if (targetServiceId) {
      const rows = await this.db
        .select()
        .from(projectDependencies)
        .where(eq(projectDependencies.target_service_id, targetServiceId));
      return rows.map((r) => this.hydrateDeprecated(r));
    }
    return [];
  }

  async findAll(): Promise<ProjectDependencyRowHydrated[]> {
    const rows = await this.db.select().from(projectDependencies);
    return rows.map((r) => this.hydrateDeprecated(r));
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(projectDependencies).where(eq(projectDependencies.id, id));
  }

  async deleteByProject(projectId: string): Promise<void> {
    const serviceId = projectIdToServiceId(projectId);
    await this.db
      .delete(projectDependencies)
      .where(
        or(
          eq(projectDependencies.source_service_id, serviceId),
          eq(projectDependencies.target_service_id, serviceId),
        ),
      );
  }

  async deleteByService(serviceId: string): Promise<void> {
    await this.db
      .delete(projectDependencies)
      .where(
        or(
          eq(projectDependencies.source_service_id, serviceId),
          eq(projectDependencies.target_service_id, serviceId),
        ),
      );
  }

  async syncFromServiceConnections(
    serviceConnections: Array<{
      project_id: string;
      service_id: string;
      service_type?: string;
    }>,
  ): Promise<void> {
    await this.db.delete(projectDependencies).where(eq(projectDependencies.source, 'auto'));
    for (const conn of serviceConnections) {
      const id = crypto.randomUUID();
      const depType =
        conn.service_type === 'postgres' || conn.service_type === 'mysql'
          ? 'database'
          : conn.service_type === 'redis'
            ? 'cache'
            : 'custom';
      await this.db.insert(projectDependencies).values({
        id,
        source_service_id: projectIdToServiceId(conn.project_id),
        target_service_id: conn.service_id,
        dependency_type: depType as ProjectDependencyRow['dependency_type'],
        source: 'auto',
        created_at: new Date().toISOString(),
      });
    }
  }
}
