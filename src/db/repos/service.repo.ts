import { desc, eq, sql } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { services } from '../schema.drizzle.js';
import type { ServiceRow } from '../types.js';

export class ServiceRepo {
  constructor(
    private readonly db: DrizzleClient,
    _sqlite: SqliteDatabase,
  ) {}

  createService(service: {
    id: string;
    name: string;
    type: string;
    image: string;
    containerName: string;
    port: number;
    envVars?: string;
    credentials?: string;
  }): ServiceRow {
    this.db
      .insert(services)
      .values({
        id: service.id,
        name: service.name,
        type: service.type,
        image: service.image,
        container_name: service.containerName,
        port: service.port,
        env_vars: service.envVars ?? null,
        credentials: service.credentials ?? null,
      })
      .run();

    const created = this.getService(service.id);
    if (!created) throw new Error(`Failed to create service ${service.id}`);
    return created;
  }

  getService(id: string): ServiceRow | undefined {
    return this.db.select().from(services).where(eq(services.id, id)).get() as
      | ServiceRow
      | undefined;
  }

  listServices(): ServiceRow[] {
    return this.db.select().from(services).orderBy(desc(services.updated_at)).all() as ServiceRow[];
  }

  updateService(
    id: string,
    updates: Partial<{
      status: ServiceRow['status'];
      containerId: string | null;
    }>,
  ): void {
    const setValues: Partial<typeof services.$inferInsert> = {};

    if (updates.status !== undefined) {
      setValues.status = updates.status;
    }
    if (updates.containerId !== undefined) {
      setValues.container_id = updates.containerId;
    }

    if (Object.keys(setValues).length === 0) return;

    this.db
      .update(services)
      .set({ ...setValues, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(services.id, id))
      .run();
  }

  deleteService(id: string): void {
    this.db.delete(services).where(eq(services.id, id)).run();
  }
}
