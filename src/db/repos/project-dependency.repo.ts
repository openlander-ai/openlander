import { eq, or } from 'drizzle-orm';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import {
  projectDependencies,
  type ProjectDependencyRow,
  type NewProjectDependency,
} from '../schema.drizzle.js';
import { RepoPersistenceError } from '../../errors.js';

export class ProjectDependencyRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  create(data: Omit<NewProjectDependency, 'id' | 'created_at'>): ProjectDependencyRow {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .insert(projectDependencies)
      .values({
        id,
        source_project_id: data.source_project_id,
        target_project_id: data.target_project_id ?? null,
        target_service_id: data.target_service_id ?? null,
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
    return row as ProjectDependencyRow;
  }

  findByProject(projectId: string): ProjectDependencyRow[] {
    return this.db
      .select()
      .from(projectDependencies)
      .where(eq(projectDependencies.source_project_id, projectId))
      .all() as ProjectDependencyRow[];
  }

  findDependents(targetProjectId?: string, targetServiceId?: string): ProjectDependencyRow[] {
    if (targetProjectId) {
      return this.db
        .select()
        .from(projectDependencies)
        .where(eq(projectDependencies.target_project_id, targetProjectId))
        .all() as ProjectDependencyRow[];
    }
    if (targetServiceId) {
      return this.db
        .select()
        .from(projectDependencies)
        .where(eq(projectDependencies.target_service_id, targetServiceId))
        .all() as ProjectDependencyRow[];
    }
    return [];
  }

  findAll(): ProjectDependencyRow[] {
    return this.db.select().from(projectDependencies).all() as ProjectDependencyRow[];
  }

  delete(id: string): void {
    this.db.delete(projectDependencies).where(eq(projectDependencies.id, id)).run();
  }

  deleteByProject(projectId: string): void {
    this.db
      .delete(projectDependencies)
      .where(
        or(
          eq(projectDependencies.source_project_id, projectId),
          eq(projectDependencies.target_project_id, projectId),
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
          source_project_id: conn.project_id,
          target_project_id: null,
          target_service_id: conn.service_id,
          dependency_type: depType as ProjectDependencyRow['dependency_type'],
          source: 'auto',
          created_at: new Date().toISOString(),
        })
        .run();
    }
  }
}
