import { desc, eq } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { domainMappings, projects, services } from '../schema.drizzle.js';
import type { DomainMappingRow } from '../types.js';

type DomainMappingSelect = typeof domainMappings.$inferSelect;
type DomainMappingResultRow = DomainMappingRow & { project_name?: string | null };
type DomainMappingSelectable = DomainMappingSelect & {
  project_id?: string | null;
  project_name?: string | null;
};

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
    created_at: row.created_at ?? '',
    project_id: row.project_id ?? serviceIdToProjectId(row.service_id),
  };

  if (row.project_name !== undefined) {
    mapped.project_name = row.project_name;
  }

  return mapped;
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
  }): Promise<void> {
    await this.db.insert(domainMappings).values({
      id: mapping.id,
      service_id: projectIdToServiceId(mapping.projectId),
      domain: mapping.domain,
      cloudflare_zone_id: mapping.cloudflareZoneId ?? null,
      cloudflare_dns_record_id: mapping.cloudflareDnsRecordId ?? null,
    });
  }

  async getDomainMappings(projectId: string): Promise<DomainMappingRow[]> {
    const rows = await this.db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.service_id, projectIdToServiceId(projectId)));
    return rows.map(toDomainMappingRow);
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
        created_at: domainMappings.created_at,
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
}
