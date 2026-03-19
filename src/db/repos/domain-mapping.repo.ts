import { desc, eq } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { domainMappings, projects } from '../schema.drizzle.js';
import type { DomainMappingRow } from '../types.js';

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
        project_id: mapping.projectId,
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
      .where(eq(domainMappings.project_id, projectId))
      .all() as DomainMappingRow[];
  }

  listDomainMappings(): DomainMappingRow[] {
    return this.db
      .select({
        id: domainMappings.id,
        project_id: domainMappings.project_id,
        domain: domainMappings.domain,
        cloudflare_zone_id: domainMappings.cloudflare_zone_id,
        cloudflare_dns_record_id: domainMappings.cloudflare_dns_record_id,
        status: domainMappings.status,
        created_at: domainMappings.created_at,
        project_name: projects.name,
      })
      .from(domainMappings)
      .innerJoin(projects, eq(domainMappings.project_id, projects.id))
      .orderBy(desc(domainMappings.created_at))
      .all() as DomainMappingRow[];
  }

  deleteDomainMapping(id: string): void {
    this.db.delete(domainMappings).where(eq(domainMappings.id, id)).run();
  }
}
