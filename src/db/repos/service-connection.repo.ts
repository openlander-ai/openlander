import { and, desc, eq } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { serviceConnections } from '../schema.drizzle.js';
import type { ServiceConnectionRow } from '../types.js';

export class ServiceConnectionRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  createConnection(opts: {
    projectId: string;
    serviceId: string;
    environmentId?: string;
  }): ServiceConnectionRow {
    this.db
      .insert(serviceConnections)
      .values({
        project_id: opts.projectId,
        service_id: opts.serviceId,
        environment_id: opts.environmentId ?? null,
      })
      .run();

    const created = this.getConnectionByProjectAndService(opts.projectId, opts.serviceId);
    if (!created) throw new Error(`Failed to create service connection`);
    return created;
  }

  getConnection(id: string): ServiceConnectionRow | undefined {
    return this.db.select().from(serviceConnections).where(eq(serviceConnections.id, id)).get() as
      | ServiceConnectionRow
      | undefined;
  }

  getConnectionByProjectAndService(
    projectId: string,
    serviceId: string,
  ): ServiceConnectionRow | undefined {
    return this.db
      .select()
      .from(serviceConnections)
      .where(
        and(
          eq(serviceConnections.project_id, projectId),
          eq(serviceConnections.service_id, serviceId),
        ),
      )
      .get() as ServiceConnectionRow | undefined;
  }

  listConnectionsByProject(projectId: string): ServiceConnectionRow[] {
    return this.db
      .select()
      .from(serviceConnections)
      .where(eq(serviceConnections.project_id, projectId))
      .orderBy(desc(serviceConnections.created_at))
      .all() as ServiceConnectionRow[];
  }

  listConnectionsByService(serviceId: string): ServiceConnectionRow[] {
    return this.db
      .select()
      .from(serviceConnections)
      .where(eq(serviceConnections.service_id, serviceId))
      .orderBy(desc(serviceConnections.created_at))
      .all() as ServiceConnectionRow[];
  }

  updateConnection(
    id: string,
    updates: Partial<{
      environmentId: string | null;
      autoInjectedEnvKeys: string | null;
    }>,
  ): void {
    const setValues: Partial<typeof serviceConnections.$inferInsert> = {};

    if (updates.environmentId !== undefined) {
      setValues.environment_id = updates.environmentId;
    }
    if (updates.autoInjectedEnvKeys !== undefined) {
      setValues.auto_injected_env_keys = updates.autoInjectedEnvKeys;
    }

    if (Object.keys(setValues).length === 0) return;

    this.db.update(serviceConnections).set(setValues).where(eq(serviceConnections.id, id)).run();
  }

  deleteConnection(id: string): void {
    this.db.delete(serviceConnections).where(eq(serviceConnections.id, id)).run();
  }

  deleteConnectionByProjectAndService(projectId: string, serviceId: string): void {
    this.db
      .delete(serviceConnections)
      .where(
        and(
          eq(serviceConnections.project_id, projectId),
          eq(serviceConnections.service_id, serviceId),
        ),
      )
      .run();
  }
}
