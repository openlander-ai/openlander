import { BaseRepository } from './base-repo.js';
import type { DomainMappingRow } from './types.js';

export interface CreateDomainMappingInput {
  id: string;
  projectId: string;
  domain: string;
  cloudflareZoneId?: string;
  cloudflareDnsRecordId?: string;
}

export class DomainMappingRepository extends BaseRepository {
  createDomainMapping(mapping: CreateDomainMappingInput): void {
    this.db
      .prepare(
        `INSERT INTO domain_mappings (id, project_id, domain, cloudflare_zone_id, cloudflare_dns_record_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        mapping.id,
        mapping.projectId,
        mapping.domain,
        mapping.cloudflareZoneId ?? null,
        mapping.cloudflareDnsRecordId ?? null,
      );
  }

  getDomainMappings(projectId: string): DomainMappingRow[] {
    return this.db
      .prepare('SELECT * FROM domain_mappings WHERE project_id = ?')
      .all(projectId) as DomainMappingRow[];
  }

  listDomainMappings(): DomainMappingRow[] {
    return this.db
      .prepare(
        `SELECT dm.*, p.name as project_name
         FROM domain_mappings dm
         JOIN projects p ON dm.project_id = p.id
         ORDER BY dm.created_at DESC`,
      )
      .all() as DomainMappingRow[];
  }

  deleteDomainMapping(id: string): void {
    this.db.prepare('DELETE FROM domain_mappings WHERE id = ?').run(id);
  }
}
