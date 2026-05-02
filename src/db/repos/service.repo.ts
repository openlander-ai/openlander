import { and, desc, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { services, type ServiceKind } from '../schema.drizzle.js';
import type { ServiceRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

/**
 * Managed-only service kinds (per plan §6.3). Used by route handlers /
 * MCP dispatcher to disambiguate deployable vs managed services from the
 * unified `services` table.
 */
export const MANAGED_SERVICE_KINDS: readonly ServiceKind[] = [
  'postgres',
  'mysql',
  'redis',
  'mongo',
  'minio',
];

/**
 * Map a managed-service `kind` value (postgres/mysql/redis/mongo/minio) onto
 * itself; falls back to `'postgres'` for unknown inputs so the NOT NULL kind
 * CHECK passes. Wire callers that emit a free-form `type` string still
 * transit through this mapping when persisting.
 */
function normalizeKind(kind: string): ServiceKind {
  const known: ServiceKind[] = ['postgres', 'mysql', 'redis', 'mongo', 'minio'];
  return (known as string[]).includes(kind) ? (kind as ServiceKind) : 'postgres';
}

/**
 * Map a canonical service kind back to the legacy wire-format type string
 * used by all existing clients (frontend, AI agents, etc.).
 *
 * Contract: wire emission must use the legacy vocabulary so that:
 * - `postgres` → `postgresql`  (frontend ServiceDatabasesTab branches on this)
 * - `mongo`    → `mongodb`
 * - All other kinds pass through unchanged (already match legacy vocabulary).
 *
 * This ensures wire-format stability regardless of whether the legacy `type`
 * column is populated (post-migration rows created after 0012 may have NULL).
 */
export function kindToLegacyType(kind: string): string {
  switch (kind) {
    case 'postgres':
      return 'postgresql';
    case 'mongo':
      return 'mongodb';
    default:
      return kind;
  }
}

export class ServiceRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  /**
   * Create a managed service row under the synthesized __orphan_managed
   * group. Post-0012: legacy type/image/port/env_vars columns are gone;
   * canonical kind/image_url/assigned_port are the source of truth.
   */
  async createService(service: {
    id: string;
    name: string;
    /** Wire-format `type` string from MCP/REST; mapped to the canonical kind enum. */
    type: string;
    image: string;
    containerName: string;
    port: number;
    /** @deprecated 1.1 — credentials column removal pairs with secret refactor. */
    credentials?: string;
  }): Promise<ServiceRow> {
    const [created] = await this.db
      .insert(services)
      .values({
        id: service.id,
        project_id: '__orphan_managed',
        name: service.name,
        kind: normalizeKind(service.type),
        image_url: service.image,
        assigned_port: service.port,
        container_name: service.containerName,
        credentials: service.credentials ?? null,
      })
      .returning();

    const row = created ?? null;
    if (!row) throw new RepoPersistenceError('service', service.id);
    return row as ServiceRow;
  }

  async getService(id: string): Promise<ServiceRow | undefined> {
    const [row] = await this.db.select().from(services).where(eq(services.id, id)).limit(1);
    return (row ?? null) ? (row as ServiceRow) : undefined;
  }

  /** @param _serverId - Reserved for future server-side filtering. Currently ignored. */
  async listServices(_serverId?: string): Promise<ServiceRow[]> {
    void _serverId;
    const rows = await this.db.select().from(services).orderBy(desc(services.updated_at));
    return rows as ServiceRow[];
  }

  /**
   * Filtered service query — used by REST + MCP handlers to scope to a
   * group (project_id) and/or include/exclude kinds.
   */
  async getServices(opts?: {
    project_id?: string;
    kindIn?: readonly ServiceKind[];
    kindNotIn?: readonly ServiceKind[];
  }): Promise<ServiceRow[]> {
    const conditions: SQL[] = [];
    if (opts?.project_id) {
      conditions.push(eq(services.project_id, opts.project_id));
    }
    if (opts?.kindIn && opts.kindIn.length > 0) {
      conditions.push(inArray(services.kind, [...opts.kindIn]));
    } else if (opts?.kindNotIn && opts.kindNotIn.length > 0) {
      conditions.push(notInArray(services.kind, [...opts.kindNotIn]));
    }
    const rows =
      conditions.length > 0
        ? await this.db
            .select()
            .from(services)
            .where(and(...conditions))
            .orderBy(desc(services.updated_at))
        : await this.db.select().from(services).orderBy(desc(services.updated_at));
    return rows as ServiceRow[];
  }

  async updateService(
    id: string,
    updates: Partial<{
      status: ServiceRow['status'];
      containerId: string | null;
      imageUrl: string | null;
    }>,
  ): Promise<void> {
    const setValues: Partial<typeof services.$inferInsert> = {};

    if (updates.status !== undefined) {
      setValues.status = updates.status;
    }
    if (updates.containerId !== undefined) {
      setValues.container_id = updates.containerId;
    }
    if (updates.imageUrl !== undefined) {
      setValues.image_url = updates.imageUrl;
    }

    if (Object.keys(setValues).length === 0) return;

    await this.db
      .update(services)
      .set({ ...setValues, updated_at: sql`now()::text` })
      .where(eq(services.id, id));
  }

  async deleteService(id: string): Promise<void> {
    await this.db.delete(services).where(eq(services.id, id));
  }

  /**
   * Returns all services that are compose-children of the given parent service.
   */
  async getComposeChildren(parentServiceId: string): Promise<ServiceRow[]> {
    const rows = await this.db
      .select()
      .from(services)
      .where(eq(services.parent_service_id, parentServiceId))
      .orderBy(desc(services.updated_at));
    return rows as ServiceRow[];
  }

  /**
   * Returns all deployable (non-compose-child) services for a given project group.
   */
  async getDeployablesByGroup(projectId: string): Promise<ServiceRow[]> {
    const rows = await this.db
      .select()
      .from(services)
      .where(and(eq(services.project_id, projectId), sql`${services.kind} != 'compose-child'`))
      .orderBy(desc(services.updated_at));
    return rows as ServiceRow[];
  }
}
