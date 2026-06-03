import { and, desc, eq, inArray, or } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { serviceConnections, services } from '../schema.drizzle.js';
import { projectIdToDeployableServiceId } from '../service-ids.js';
import type { ServiceConnectionRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

/**
 * Post-0012: service_connections uses consumer/provider model. Callers pass
 * `projectId` (the consumer group) and `serviceId` (the provider managed-service
 * id). Writes may pass a concrete consumer workload id when the group contains
 * an attached runtime workload; project-scoped reads resolve both the canonical
 * `<projectId>__svc` row and any consumer service whose `services.project_id`
 * points at the group.
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
   *   project_id = joined consumer service.project_id when available, otherwise
   *                consumer id with __svc suffix stripped
   *   service_id = provider id (no transform)
   */
  private hydrateDeprecated(
    row: ServiceConnectionRow,
    projectIdOverride?: string | null,
  ): ServiceConnectionRow {
    return {
      ...row,
      project_id: projectIdOverride ?? row.service_id_consumer.replace(/__svc$/, ''),
      service_id: row.service_id_provider,
    };
  }

  private consumerBelongsToProject(projectId: string) {
    return or(
      eq(serviceConnections.service_id_consumer, projectIdToDeployableServiceId(projectId)),
      eq(services.project_id, projectId),
    );
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
      .select({
        connection: serviceConnections,
        consumerProjectId: services.project_id,
      })
      .from(serviceConnections)
      .leftJoin(services, eq(serviceConnections.service_id_consumer, services.id))
      .where(eq(serviceConnections.id, id))
      .limit(1);
    const row = (selected?.connection ?? null) as ServiceConnectionRow | null;
    return row ? this.hydrateDeprecated(row, selected?.consumerProjectId) : undefined;
  }

  async getConnectionByProjectAndService(
    projectId: string,
    serviceId: string,
  ): Promise<ServiceConnectionRow | undefined> {
    const [selected] = await this.db
      .select({
        connection: serviceConnections,
      })
      .from(serviceConnections)
      .leftJoin(services, eq(serviceConnections.service_id_consumer, services.id))
      .where(
        and(
          eq(serviceConnections.service_id_provider, serviceId),
          this.consumerBelongsToProject(projectId),
        ),
      )
      .limit(1);
    const row = (selected?.connection ?? null) as ServiceConnectionRow | null;
    return row ? this.hydrateDeprecated(row, projectId) : undefined;
  }

  async listConnectionsByProject(
    projectId: string,
    environmentId?: string,
  ): Promise<ServiceConnectionRow[]> {
    const whereClause = environmentId
      ? and(
          this.consumerBelongsToProject(projectId),
          eq(serviceConnections.environment_id, environmentId),
        )
      : this.consumerBelongsToProject(projectId);
    const rows = (await this.db
      .select({
        connection: serviceConnections,
      })
      .from(serviceConnections)
      .leftJoin(services, eq(serviceConnections.service_id_consumer, services.id))
      .where(whereClause)
      .orderBy(desc(serviceConnections.created_at))) as Array<{ connection: ServiceConnectionRow }>;
    return rows.map((r) => this.hydrateDeprecated(r.connection, projectId));
  }

  /**
   * Returns connections referencing the given service id on either side
   * (consumer or provider). Pre-0012 the column was `service_id` (provider
   * only); the new shape symmetrically matches both endpoints.
   */
  async listConnectionsByService(serviceId: string): Promise<ServiceConnectionRow[]> {
    const rows = (await this.db
      .select({
        connection: serviceConnections,
        consumerProjectId: services.project_id,
      })
      .from(serviceConnections)
      .leftJoin(services, eq(serviceConnections.service_id_consumer, services.id))
      .where(
        or(
          eq(serviceConnections.service_id_consumer, serviceId),
          eq(serviceConnections.service_id_provider, serviceId),
        ),
      )
      .orderBy(desc(serviceConnections.created_at))) as Array<{
      connection: ServiceConnectionRow;
      consumerProjectId: string | null;
    }>;
    return rows.map((r) => this.hydrateDeprecated(r.connection, r.consumerProjectId));
  }

  async listConsumersForProvider(serviceId: string): Promise<ServiceConnectionRow[]> {
    const rows = (await this.db
      .select({
        connection: serviceConnections,
        consumerProjectId: services.project_id,
      })
      .from(serviceConnections)
      .leftJoin(services, eq(serviceConnections.service_id_consumer, services.id))
      .where(eq(serviceConnections.service_id_provider, serviceId))
      .orderBy(desc(serviceConnections.created_at))) as Array<{
      connection: ServiceConnectionRow;
      consumerProjectId: string | null;
    }>;
    return rows.map((r) => this.hydrateDeprecated(r.connection, r.consumerProjectId));
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
    const rows = await this.db
      .select({ id: serviceConnections.id })
      .from(serviceConnections)
      .leftJoin(services, eq(serviceConnections.service_id_consumer, services.id))
      .where(
        and(
          eq(serviceConnections.service_id_provider, serviceId),
          this.consumerBelongsToProject(projectId),
        ),
      );
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return;

    await this.db.delete(serviceConnections).where(inArray(serviceConnections.id, ids));
  }
}
