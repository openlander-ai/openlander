import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
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
 * Map a legacy managed-service `type` value (postgres/mysql/redis/mongo/minio)
 * to the unified `services.kind` enum. Plan §6.3 line 519: managed kinds
 * are a subset of the kind enum, so the legacy `type` column maps 1-to-1.
 *
 * Falls back to 'postgres' for unknown legacy types so the NOT NULL CHECK
 * constraint passes; calls into ServiceRepo always provide a real type.
 */
function legacyTypeToKind(type: string): ServiceKind {
  const known: ServiceKind[] = ['postgres', 'mysql', 'redis', 'mongo', 'minio'];
  return (known as string[]).includes(type) ? (type as ServiceKind) : 'postgres';
}

export class ServiceRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

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
    // Plan §6.3 / §6.5 backward-compat: managed services land under the
    // synthesized __orphan_managed group with kind derived from legacy type.
    this.db
      .insert(services)
      .values({
        id: service.id,
        project_id: '__orphan_managed',
        name: service.name,
        kind: legacyTypeToKind(service.type),
        // Legacy columns — kept until migration 0012 Phase C drops them.
        type: service.type,
        image: service.image,
        port: service.port,
        env_vars: service.envVars ?? null,
        // Canonical columns — PR 2.5 ensures these are populated at creation
        // so that post-0012 readers never fall back to the legacy columns.
        image_url: service.image,
        assigned_port: service.port,
        container_name: service.containerName,
        credentials: service.credentials ?? null,
      })
      .run();

    const created = this.getService(service.id);
    if (!created) throw new RepoPersistenceError('service', service.id);
    return created;
  }

  getService(id: string): ServiceRow | undefined {
    return this.db.select().from(services).where(eq(services.id, id)).get() as
      | ServiceRow
      | undefined;
  }

  /** @param _serverId - Reserved for future server-side filtering. Currently ignored. */
  listServices(_serverId?: string): ServiceRow[] {
    return this.db.select().from(services).orderBy(desc(services.updated_at)).all() as ServiceRow[];
  }

  /**
   * Filtered service query — used by REST + MCP handlers to scope to a
   * group (project_id) and/or include/exclude kinds. Plan §6.6 line 795.
   *
   * `kindIn`/`kindNotIn` are mutually exclusive; only one is honored at a
   * time (kindIn takes precedence). Pass empty arrays to skip the kind
   * filter entirely.
   */
  getServices(opts?: {
    project_id?: string;
    kindIn?: readonly ServiceKind[];
    kindNotIn?: readonly ServiceKind[];
  }): ServiceRow[] {
    const conditions = [];
    if (opts?.project_id) {
      conditions.push(eq(services.project_id, opts.project_id));
    }
    if (opts?.kindIn && opts.kindIn.length > 0) {
      conditions.push(inArray(services.kind, [...opts.kindIn]));
    } else if (opts?.kindNotIn && opts.kindNotIn.length > 0) {
      conditions.push(notInArray(services.kind, [...opts.kindNotIn]));
    }
    const query = this.db.select().from(services);
    const filtered = conditions.length > 0 ? query.where(and(...conditions)) : query;
    return filtered.orderBy(desc(services.updated_at)).all() as ServiceRow[];
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

  /**
   * Returns all services that are compose-children of the given parent service.
   * Used by PR 2+ pipeline rewire to replace parent_project_id child-fetch.
   */
  getComposeChildren(parentServiceId: string): ServiceRow[] {
    return this.db
      .select()
      .from(services)
      .where(eq(services.parent_service_id, parentServiceId))
      .orderBy(desc(services.updated_at))
      .all() as ServiceRow[];
  }

  /**
   * Returns all deployable (non-compose-child) services for a given project group.
   * Used by PR 2+ pipeline rewire to enumerate top-level deployables for a group.
   */
  getDeployablesByGroup(projectId: string): ServiceRow[] {
    return this.db
      .select()
      .from(services)
      .where(and(eq(services.project_id, projectId), sql`${services.kind} != 'compose-child'`))
      .orderBy(desc(services.updated_at))
      .all() as ServiceRow[];
  }
}
