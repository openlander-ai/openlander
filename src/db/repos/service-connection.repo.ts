import { and, desc, eq, or } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { serviceConnections } from '../schema.drizzle.js';
import { projectIdToDeployableServiceId } from '../service-ids.js';
import type { ServiceConnectionRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

/**
 * Post-0012: service_connections uses consumer/provider model. Callers
 * historically pass `projectId` (the consumer group) and `serviceId` (the
 * provider managed-service id); the repo maps:
 *   - projectId  -> service_id_consumer = projectIdToDeployableServiceId(projectId)
 *   - serviceId  -> service_id_provider (no transform)
 */
export class ServiceConnectionRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
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

  async createConnection(opts: {
    projectId: string;
    serviceId: string;
    environmentId?: string;
  }): Promise<ServiceConnectionRow> {
    const consumerId = projectIdToDeployableServiceId(opts.projectId);
    const [created] = await this.db
      .insert(serviceConnections)
      .values({
        service_id_consumer: consumerId,
        service_id_provider: opts.serviceId,
        environment_id: opts.environmentId ?? null,
      })
      .returning();

    const row = (created ?? null) as ServiceConnectionRow | null;
    if (!row) {
      throw new RepoPersistenceError('service connection', `${opts.projectId}:${opts.serviceId}`);
    }
    return this.hydrateDeprecated(row);
  }

  /**
   * Conflict-safe create: inserts a consumer/provider connection row, or does
   * nothing if one already exists for the (consumer, provider) pair. Uses the
   * service_connections_consumer_provider_idx unique index. Idempotent — safe to
   * call when provisioning the same approved plan twice.
   *
   * `consumerServiceId` lets the caller pass the resolved consumer workload's
   * real id (a concrete services.id) when it is not the derived `<projectId>__svc`
   * — e.g. a workload attached into the group keeps its own runtime __svc id. When
   * omitted, the consumer falls back to the canonical `<projectId>__svc` derivation
   * (the common deploy-into-own-project case).
   */
  async upsertConnection(opts: {
    projectId: string;
    serviceId: string;
    consumerServiceId?: string;
    environmentId?: string;
  }): Promise<void> {
    const consumerId = opts.consumerServiceId ?? projectIdToDeployableServiceId(opts.projectId);
    await this.db
      .insert(serviceConnections)
      .values({
        service_id_consumer: consumerId,
        service_id_provider: opts.serviceId,
        environment_id: opts.environmentId ?? null,
      })
      .onConflictDoNothing({
        target: [serviceConnections.service_id_consumer, serviceConnections.service_id_provider],
      });
  }

  async getConnection(id: string): Promise<ServiceConnectionRow | undefined> {
    const [selected] = await this.db
      .select()
      .from(serviceConnections)
      .where(eq(serviceConnections.id, id))
      .limit(1);
    const row = (selected ?? null) as ServiceConnectionRow | null;
    return row ? this.hydrateDeprecated(row) : undefined;
  }

  async getConnectionByProjectAndService(
    projectId: string,
    serviceId: string,
  ): Promise<ServiceConnectionRow | undefined> {
    const [selected] = await this.db
      .select()
      .from(serviceConnections)
      .where(
        and(
          eq(serviceConnections.service_id_consumer, projectIdToDeployableServiceId(projectId)),
          eq(serviceConnections.service_id_provider, serviceId),
        ),
      )
      .limit(1);
    const row = (selected ?? null) as ServiceConnectionRow | null;
    return row ? this.hydrateDeprecated(row) : undefined;
  }

  async listConnectionsByProject(
    projectId: string,
    environmentId?: string,
  ): Promise<ServiceConnectionRow[]> {
    const whereClause = environmentId
      ? and(
          eq(serviceConnections.service_id_consumer, projectIdToDeployableServiceId(projectId)),
          eq(serviceConnections.environment_id, environmentId),
        )
      : eq(serviceConnections.service_id_consumer, projectIdToDeployableServiceId(projectId));
    const rows = (await this.db
      .select()
      .from(serviceConnections)
      .where(whereClause)
      .orderBy(desc(serviceConnections.created_at))) as ServiceConnectionRow[];
    return rows.map((r) => this.hydrateDeprecated(r));
  }

  /**
   * Returns connections referencing the given service id on either side
   * (consumer or provider). Pre-0012 the column was `service_id` (provider
   * only); the new shape symmetrically matches both endpoints.
   */
  async listConnectionsByService(serviceId: string): Promise<ServiceConnectionRow[]> {
    const rows = (await this.db
      .select()
      .from(serviceConnections)
      .where(
        or(
          eq(serviceConnections.service_id_consumer, serviceId),
          eq(serviceConnections.service_id_provider, serviceId),
        ),
      )
      .orderBy(desc(serviceConnections.created_at))) as ServiceConnectionRow[];
    return rows.map((r) => this.hydrateDeprecated(r));
  }

  async listConsumersForProvider(serviceId: string): Promise<ServiceConnectionRow[]> {
    const rows = (await this.db
      .select()
      .from(serviceConnections)
      .where(eq(serviceConnections.service_id_provider, serviceId))
      .orderBy(desc(serviceConnections.created_at))) as ServiceConnectionRow[];
    return rows.map((r) => this.hydrateDeprecated(r));
  }

  async updateConnection(
    id: string,
    updates: Partial<{
      environmentId: string | null;
      autoInjectedEnvKeys: string | null;
    }>,
  ): Promise<void> {
    const setValues: Partial<typeof serviceConnections.$inferInsert> = {};

    if (updates.environmentId !== undefined) {
      setValues.environment_id = updates.environmentId;
    }
    if (updates.autoInjectedEnvKeys !== undefined) {
      setValues.auto_injected_env_keys = updates.autoInjectedEnvKeys;
    }

    if (Object.keys(setValues).length === 0) return;

    await this.db.update(serviceConnections).set(setValues).where(eq(serviceConnections.id, id));
  }

  async deleteConnection(id: string): Promise<void> {
    await this.db.delete(serviceConnections).where(eq(serviceConnections.id, id));
  }

  async deleteConnectionByProjectAndService(projectId: string, serviceId: string): Promise<void> {
    await this.db
      .delete(serviceConnections)
      .where(
        and(
          eq(serviceConnections.service_id_consumer, projectIdToDeployableServiceId(projectId)),
          eq(serviceConnections.service_id_provider, serviceId),
        ),
      );
  }
}
