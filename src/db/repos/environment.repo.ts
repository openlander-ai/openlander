import { asc, eq, sql } from 'drizzle-orm';
import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { buildSetValues } from '../helpers.js';
import { environments } from '../schema.drizzle.js';
import type { EnvironmentRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

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
        project_id: environment.projectId,
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
    return this.db.select().from(environments).where(eq(environments.id, id)).get() as
      | EnvironmentRow
      | undefined;
  }

  getEnvironmentsByProject(projectId: string): EnvironmentRow[] {
    return this.db
      .select()
      .from(environments)
      .where(eq(environments.project_id, projectId))
      .orderBy(asc(environments.created_at))
      .all() as EnvironmentRow[];
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
