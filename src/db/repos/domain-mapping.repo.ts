import { desc, eq } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { domainMappings, projects, services } from '../schema.drizzle.js';
import type { DomainMappingRow } from '../types.js';

/**
 * Post-0012: domain_mappings is service-scoped. Callers still pass
 * `projectId` for vocabulary continuity; the repo translates to the
 * canonical deployable service id.
 */
function projectIdToServiceId(projectId: string): string {
  return projectId.endsWith('__svc') ? projectId : `${projectId}__svc`;
}

export class DomainMappingRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  createDomainMapping(mapping: {
    id: string;
    projectId: string;
    domain: string;
    cloudflareZoneId?: string;
    cloudflareDnsRecordId?: string;
  }): void {
    this.db
      .insert(domainMappings)
      .values({
        id: mapping.id,
        service_id: projectIdToServiceId(mapping.projectId),
        domain: mapping.domain,
        cloudflare_zone_id: mapping.cloudflareZoneId ?? null,
        cloudflare_dns_record_id: mapping.cloudflareDnsRecordId ?? null,
      })
      .run();
  }

  getDomainMappings(projectId: string): DomainMappingRow[] {
    return this.db
      .select()
      .from(domainMappings)
      .where(eq(domainMappings.service_id, projectIdToServiceId(projectId)))
      .all() as DomainMappingRow[];
  }

  /**
   * List domain mappings with project name resolved via services -> projects join.
   */
  listDomainMappings(): DomainMappingRow[] {
    return this.db
      .select({
        id: domainMappings.id,
        service_id: domainMappings.service_id,
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
      .orderBy(desc(domainMappings.created_at))
      .all() as DomainMappingRow[];
  }

  deleteDomainMapping(id: string): void {
    this.db.delete(domainMappings).where(eq(domainMappings.id, id)).run();
  }
}
