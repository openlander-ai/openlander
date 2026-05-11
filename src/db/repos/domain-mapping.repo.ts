import { and, desc, eq } from 'drizzle-orm';

import { RepoPersistenceError } from '../../errors.js';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { domainMappings, projects, services } from '../schema.drizzle.js';
import type { DomainMappingRow } from '../types.js';

type DomainMappingSelect = typeof domainMappings.$inferSelect;
type DomainMappingResultRow = DomainMappingRow & { project_name?: string | null };
type DomainMappingSelectable = DomainMappingSelect & {
  project_id?: string | null;
  project_name?: string | null;
};

interface DomainMappingCreateInput {
  id: string;
  serviceId: string;
  domain: string;
  cloudflareZoneId?: string;
  cloudflareDnsRecordId?: string;
  status?: DomainMappingRow['status'];
  pathPrefix?: string;
  stripPrefix?: boolean;
  upstreamPathPrefix?: string | null;
  targetPort?: number | null;
  tlsEnabled?: boolean | null;
  tlsResolver?: string | null;
}

interface DomainMappingUpdatePatch {
  domain?: string;
  status?: DomainMappingRow['status'];
  pathPrefix?: string;
  stripPrefix?: boolean;
  upstreamPathPrefix?: string | null;
  targetPort?: number | null;
  tlsEnabled?: boolean | null;
  tlsResolver?: string | null;
}

/**
 * Post-0012: domain_mappings is service-scoped. Callers still pass
 * `projectId` for vocabulary continuity; the repo translates to the
 * canonical deployable service id.
 */
function projectIdToServiceId(projectId: string): string {
  return projectId.endsWith('__svc') ? projectId : `${projectId}__svc`;
}

function serviceIdToProjectId(serviceId: string): string {
  return serviceId.endsWith('__svc') ? serviceId.replace(/__svc$/, '') : serviceId;
}

function toDomainMappingRow(row: DomainMappingSelectable): DomainMappingResultRow {
  const mapped: DomainMappingResultRow = {
    id: row.id,
    service_id: row.service_id,
    domain: row.domain,
    cloudflare_zone_id: row.cloudflare_zone_id,
    cloudflare_dns_record_id: row.cloudflare_dns_record_id,
    status: row.status ?? 'active',
    path_prefix: row.path_prefix,
    strip_prefix: row.strip_prefix,
    upstream_path_prefix: row.upstream_path_prefix ?? null,
    target_port: row.target_port ?? null,
    tls_enabled: row.tls_enabled,
    tls_resolver: row.tls_resolver ?? null,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? null,
    project_id: row.project_id ?? serviceIdToProjectId(row.service_id),
  };

  if (row.project_name !== undefined) {
    mapped.project_name = row.project_name;
  }

  return mapped;
}

export function normalizeDomainHost(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/g, '');
}

export function normalizeDomainPathPrefix(pathPrefix: string | null | undefined): string {
  const raw = pathPrefix?.trim() ?? '';
  if (raw.length === 0 || raw === '/') {
    return '/';
  }

  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, '/');
  return collapsed.replace(/\/+$/g, '') || '/';
}

function normalizeNullableDomainPathPrefix(pathPrefix: string | null | undefined): string | null {
  if (pathPrefix == null || pathPrefix.trim().length === 0) {
    return null;
  }
  return normalizeDomainPathPrefix(pathPrefix);
}

function nowIso(): string {
  return new Date().toISOString();
}

export class DomainMappingRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async createDomainMapping(mapping: {
    id: string;
    projectId: string;
    domain: string;
    cloudflareZoneId?: string;
    cloudflareDnsRecordId?: string;
    pathPrefix?: string;
    stripPrefix?: boolean;
    upstreamPathPrefix?: string | null;
    targetPort?: number | null;
    tlsEnabled?: boolean;
    tlsResolver?: string | null;
  }): Promise<DomainMappingRow> {
    return this.createForServiceId({
      ...mapping,
      serviceId: projectIdToServiceId(mapping.projectId),
    });
  }

  async createForServiceId(mapping: DomainMappingCreateInput): Promise<DomainMappingRow> {
    const timestamp = nowIso();
    const [created] = await this.db
      .insert(domainMappings)
      .values({
        id: mapping.id,
        service_id: mapping.serviceId,
        domain: normalizeDomainHost(mapping.domain),
        cloudflare_zone_id: mapping.cloudflareZoneId ?? null,
        cloudflare_dns_record_id: mapping.cloudflareDnsRecordId ?? null,
        status: mapping.status ?? 'active',
        path_prefix: normalizeDomainPathPrefix(mapping.pathPrefix),
        strip_prefix: mapping.stripPrefix ?? false,
        upstream_path_prefix: normalizeNullableDomainPathPrefix(mapping.upstreamPathPrefix),
        target_port: mapping.targetPort ?? null,
        tls_enabled: mapping.tlsEnabled ?? null,
        tls_resolver: mapping.tlsResolver ?? null,
        updated_at: timestamp,
      })
      .returning();

    if (!created) {
      throw new RepoPersistenceError('domain mapping', mapping.id);
    }
    return toDomainMappingRow(created);
  }

  async getDomainMappings(projectId: string): Promise<DomainMappingRow[]> {
    return this.listByServiceId(projectIdToServiceId(projectId));
  }

  async listByServiceId(serviceId: string): Promise<DomainMappingRow[]> {
    const rows = await this.db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.service_id, serviceId));
    return rows.map(toDomainMappingRow);
  }

  async listDomainMappingsForService(serviceId: string): Promise<DomainMappingRow[]> {
    return this.listByServiceId(serviceId);
  }

  async findByHostAndPath(
    domain: string,
    pathPrefix: string | null | undefined = '/',
  ): Promise<DomainMappingRow | undefined> {
    const [row] = await this.db
      .select()
      .from(domainMappings)
      .where(
        and(
          eq(domainMappings.domain, normalizeDomainHost(domain)),
          eq(domainMappings.path_prefix, normalizeDomainPathPrefix(pathPrefix)),
        ),
      )
      .limit(1);
    return row ? toDomainMappingRow(row) : undefined;
  }

  async updateDomainMapping(
    id: string,
    patch: DomainMappingUpdatePatch,
  ): Promise<DomainMappingRow | undefined> {
    const setValues: Partial<typeof domainMappings.$inferInsert> = {};

    if (patch.domain !== undefined) {
      setValues.domain = normalizeDomainHost(patch.domain);
    }
    if (patch.status !== undefined) {
      setValues.status = patch.status;
    }
    if (patch.pathPrefix !== undefined) {
      setValues.path_prefix = normalizeDomainPathPrefix(patch.pathPrefix);
    }
    if (patch.stripPrefix !== undefined) {
      setValues.strip_prefix = patch.stripPrefix;
    }
    if (patch.upstreamPathPrefix !== undefined) {
      setValues.upstream_path_prefix = normalizeNullableDomainPathPrefix(patch.upstreamPathPrefix);
    }
    if (patch.targetPort !== undefined) {
      setValues.target_port = patch.targetPort;
    }
    if (patch.tlsEnabled !== undefined) {
      setValues.tls_enabled = patch.tlsEnabled;
    }
    if (patch.tlsResolver !== undefined) {
      setValues.tls_resolver = patch.tlsResolver;
    }

    const [updated] = await this.db
      .update(domainMappings)
      .set({ ...setValues, updated_at: nowIso() })
      .where(eq(domainMappings.id, id))
      .returning();

    return updated ? toDomainMappingRow(updated) : undefined;
  }

  /**
   * List domain mappings with project name resolved via services -> projects join.
   */
  async listDomainMappings(): Promise<DomainMappingResultRow[]> {
    const rows = await this.db
      .select({
        id: domainMappings.id,
        service_id: domainMappings.service_id,
        project_id: services.project_id,
        domain: domainMappings.domain,
        cloudflare_zone_id: domainMappings.cloudflare_zone_id,
        cloudflare_dns_record_id: domainMappings.cloudflare_dns_record_id,
        status: domainMappings.status,
        path_prefix: domainMappings.path_prefix,
        strip_prefix: domainMappings.strip_prefix,
        upstream_path_prefix: domainMappings.upstream_path_prefix,
        target_port: domainMappings.target_port,
        tls_enabled: domainMappings.tls_enabled,
        tls_resolver: domainMappings.tls_resolver,
        created_at: domainMappings.created_at,
        updated_at: domainMappings.updated_at,
        project_name: projects.name,
      })
      .from(domainMappings)
      .innerJoin(services, eq(domainMappings.service_id, services.id))
      .innerJoin(projects, eq(services.project_id, projects.id))
      .orderBy(desc(domainMappings.created_at));
    return rows.map(toDomainMappingRow);
  }

  async deleteDomainMapping(id: string): Promise<void> {
    await this.db.delete(domainMappings).where(eq(domainMappings.id, id));
  }

  async deleteByServiceIdAndDomain(serviceId: string, domain: string): Promise<void> {
    await this.db
      .delete(domainMappings)
      .where(and(eq(domainMappings.service_id, serviceId), eq(domainMappings.domain, domain)));
  }

  async deleteByServiceId(serviceId: string): Promise<void> {
    await this.db.delete(domainMappings).where(eq(domainMappings.service_id, serviceId));
  }
}
