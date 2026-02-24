import { nanoid } from 'nanoid';

import type { CloudflareConfig } from '../config/index.js';
import type { Database, DomainMappingRow } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import { buildTraefikLabels } from './traefik.js';

interface CloudflareApiError {
  message: string;
}

interface CloudflareApiResponse<T> {
  success: boolean;
  errors: CloudflareApiError[];
  result: T;
}

interface CloudflareZone {
  id: string;
  name: string;
}

interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

type TunnelIngressRule =
  | {
      hostname: string;
      service: string;
    }
  | {
      service: 'http_status:404';
    };

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareTunnelManager {
  private readonly traefikLabels = new Map<string, Record<string, string>>();

  constructor(
    private readonly config: CloudflareConfig,
    private readonly db: Database,
    private readonly events: EventBus,
  ) {}

  async createTunnel(projectId: string, domain: string): Promise<void> {
    const normalizedDomain = normalizeDomain(domain);
    const project = this.db.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const existingProjectMapping = this.db
      .getDomainMappings(projectId)
      .find((mapping) => mapping.domain.toLowerCase() === normalizedDomain);
    if (existingProjectMapping) {
      return;
    }

    const zone = await this.findZoneForDomain(normalizedDomain);
    const recordId = await this.createCnameRecord(zone.id, normalizedDomain);
    const mappingId = nanoid(12);

    this.db.createDomainMapping({
      id: mappingId,
      projectId,
      domain: normalizedDomain,
      cloudflareZoneId: zone.id,
      cloudflareDnsRecordId: recordId,
    });

    try {
      await this.updateTunnelConfig();
      await this.syncProjectRouting(projectId);
    } catch (error) {
      this.db.deleteDomainMapping(mappingId);
      await this.deleteDnsRecord(zone.id, recordId);
      throw error;
    }
  }

  async removeTunnel(projectId: string, domain: string): Promise<void> {
    const normalizedDomain = normalizeDomain(domain);
    const mapping = this.db
      .getDomainMappings(projectId)
      .find((entry) => entry.domain.toLowerCase() === normalizedDomain);

    if (!mapping) {
      return;
    }

    if (mapping.cloudflare_zone_id && mapping.cloudflare_dns_record_id) {
      await this.deleteDnsRecord(mapping.cloudflare_zone_id, mapping.cloudflare_dns_record_id);
    }

    this.db.deleteDomainMapping(mapping.id);
    await this.updateTunnelConfig();
    await this.syncProjectRouting(projectId);
  }

  listDomains(projectId: string): DomainMappingRow[] {
    return this.db.getDomainMappings(projectId);
  }

  async verifyDomain(domain: string): Promise<boolean> {
    const normalizedDomain = normalizeDomain(domain);

    let zone: CloudflareZone;
    try {
      zone = await this.findZoneForDomain(normalizedDomain);
    } catch {
      return false;
    }

    const records = await this.getDnsRecords(zone.id, normalizedDomain);
    const target = normalizeHost(`${this.config.tunnelId}.cfargotunnel.com`);

    return records.some(
      (record) => record.type.toUpperCase() === 'CNAME' && normalizeHost(record.content) === target,
    );
  }

  private async syncProjectRouting(projectId: string): Promise<void> {
    const project = this.db.getProject(projectId);
    if (!project || !project.assigned_port) {
      this.traefikLabels.delete(projectId);
      return;
    }

    const domains = this.db.getDomainMappings(projectId).map((mapping) => mapping.domain);
    if (domains.length === 0) {
      this.traefikLabels.delete(projectId);
      this.db.updateProject(projectId, { visibility: 'internal', publicUrl: null });
      return;
    }

    const labels = this.buildCustomDomainLabels(project.name, project.assigned_port, domains);
    this.traefikLabels.set(projectId, labels);

    const primaryUrl = `https://${domains[0] ?? 'unknown'}`;
    this.db.updateProject(projectId, { visibility: 'production', publicUrl: primaryUrl });
    await this.events.emit('tunnel:url', { projectId, url: primaryUrl });
  }

  private buildCustomDomainLabels(
    projectName: string,
    containerPort: number,
    domains: string[],
  ): Record<string, string> {
    const labels = buildTraefikLabels(projectName, containerPort, domains[0]);
    if (domains.length <= 1) {
      return labels;
    }

    const routerName = `ol-${projectName}`;
    labels[`traefik.http.routers.${routerName}.rule`] = domains
      .map((domain) => `Host(\`${domain}\`)`)
      .join(' || ');

    return labels;
  }

  private async updateTunnelConfig(): Promise<void> {
    const ingress: TunnelIngressRule[] = [];
    const mappings = this.db.listDomainMappings();

    for (const mapping of mappings) {
      ingress.push({
        hostname: mapping.domain,
        service: 'http://127.0.0.1:80',
      });
    }

    ingress.push({ service: 'http_status:404' });

    await this.cloudflareRequest(
      `accounts/${this.config.accountId}/tunnels/${this.config.tunnelId}/configurations`,
      {
        method: 'PUT',
        body: JSON.stringify({ config: { ingress } }),
      },
    );
  }

  private async findZoneForDomain(domain: string): Promise<CloudflareZone> {
    const labels = domain.split('.');

    for (let i = 0; i < labels.length - 1; i += 1) {
      const candidate = labels.slice(i).join('.');
      const zones = await this.cloudflareRequest<CloudflareZone[]>(
        `zones?name=${encodeURIComponent(candidate)}`,
      );
      const matched = zones.find((zone) => zone.name.toLowerCase() === candidate.toLowerCase());
      if (matched) {
        return matched;
      }
    }

    throw new Error(`Cloudflare zone not found for domain: ${domain}`);
  }

  private async createCnameRecord(zoneId: string, domain: string): Promise<string> {
    const record = await this.cloudflareRequest<CloudflareDnsRecord>(
      `zones/${zoneId}/dns_records`,
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'CNAME',
          name: domain,
          content: `${this.config.tunnelId}.cfargotunnel.com`,
          proxied: true,
          ttl: 1,
        }),
      },
    );

    return record.id;
  }

  private async getDnsRecords(zoneId: string, domain: string): Promise<CloudflareDnsRecord[]> {
    return this.cloudflareRequest<CloudflareDnsRecord[]>(
      `zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(domain)}`,
    );
  }

  private async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    await this.cloudflareRequest(`zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' });
  }

  private async cloudflareRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${CLOUDFLARE_API_BASE}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
        ...((init?.headers as Record<string, string> | undefined) ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(
        `Cloudflare API request failed (${String(response.status)}): ${response.statusText}`,
      );
    }

    const body = (await response.json()) as CloudflareApiResponse<T>;
    if (!body.success) {
      const details = body.errors.map((error) => error.message).join('; ');
      throw new Error(`Cloudflare API error: ${details || 'unknown error'}`);
    }

    return body.result;
  }
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}
