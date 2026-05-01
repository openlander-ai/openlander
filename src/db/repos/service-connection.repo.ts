import { and, desc, eq, or } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { serviceConnections, services } from '../schema.drizzle.js';
import type { ServiceConnectionRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

/**
 * Post-0012: service_connections uses consumer/provider model. Callers
 * historically pass `projectId` (the consumer group) and `serviceId` (the
 * provider managed-service id); the repo maps:
 *   - projectId  -> service_id_consumer = `${projectId}__svc`
 *   - serviceId  -> service_id_provider (no transform)
 */
function projectIdToServiceId(projectId: string): string {
  return projectId.endsWith('__svc') ? projectId : `${projectId}__svc`;
}

export class ServiceConnectionRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  /**
   * Back-compat hydration: derive deprecated `project_id` and `service_id`
   * from the canonical consumer/provider fields so existing callers continue
   * to work through 1.0.
   *   project_id = consumer id with __svc suffix stripped
   *   service_id = provider id (no transform)
   */
  private hydrateDeprecated(row: ServiceConnectionRow): ServiceConnectionRow {
    return {
      ...row,
      project_id: row.service_id_consumer.replace(/__svc$/, ''),
      service_id: row.service_id_provider,
    };
  }

  createConnection(opts: {
    projectId: string;
    serviceId: string;
    environmentId?: string;
  }): ServiceConnectionRow {
    const consumerId = projectIdToServiceId(opts.projectId);
    this.db
      .insert(serviceConnections)
      .values({
        service_id_consumer: consumerId,
        service_id_provider: opts.serviceId,
        environment_id: opts.environmentId ?? null,
      })
      .run();

    const created = this.getConnectionByProjectAndService(opts.projectId, opts.serviceId);
    if (!created)
      throw new RepoPersistenceError('service connection', `${opts.projectId}:${opts.serviceId}`);
    return created;
  }

  getConnection(id: string): ServiceConnectionRow | undefined {
    const row = this.db
      .select()
      .from(serviceConnections)
      .where(eq(serviceConnections.id, id))
      .get() as ServiceConnectionRow | undefined;
    return row ? this.hydrateDeprecated(row) : undefined;
  }

  getConnectionByProjectAndService(
    projectId: string,
    serviceId: string,
  ): ServiceConnectionRow | undefined {
    const row = this.db
      .select()
      .from(serviceConnections)
      .where(
        and(
          eq(serviceConnections.service_id_consumer, projectIdToServiceId(projectId)),
          eq(serviceConnections.service_id_provider, serviceId),
        ),
      )
      .get() as ServiceConnectionRow | undefined;
    return row ? this.hydrateDeprecated(row) : undefined;
  }

  listConnectionsByProject(projectId: string, environmentId?: string): ServiceConnectionRow[] {
    const conditions = [
      eq(serviceConnections.service_id_consumer, projectIdToServiceId(projectId)),
    ];
    if (environmentId) {
      conditions.push(eq(serviceConnections.environment_id, environmentId));
    }
    const rows = this.db
      .select()
      .from(serviceConnections)
      .where(and(...conditions))
      .orderBy(desc(serviceConnections.created_at))
      .all() as ServiceConnectionRow[];
    return rows.map((r) => this.hydrateDeprecated(r));
  }

  /**
   * Returns connections referencing the given service id on either side
   * (consumer or provider). Pre-0012 the column was `service_id` (provider
   * only); the new shape symmetrically matches both endpoints.
   */
  listConnectionsByService(serviceId: string): ServiceConnectionRow[] {
    const rows = this.db
      .select()
      .from(serviceConnections)
      .where(
        or(
          eq(serviceConnections.service_id_consumer, serviceId),
          eq(serviceConnections.service_id_provider, serviceId),
        ),
      )
      .orderBy(desc(serviceConnections.created_at))
      .all() as ServiceConnectionRow[];
    return rows.map((r) => this.hydrateDeprecated(r));
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
          eq(serviceConnections.service_id_consumer, projectIdToServiceId(projectId)),
          eq(serviceConnections.service_id_provider, serviceId),
        ),
      )
      .run();
    // Reference `services` to silence unused-import in build paths that
    // tree-shake the consumer/provider join; safe no-op.
    void services;
  }
}
