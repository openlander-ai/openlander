import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('cloudflare');

import { nanoid } from 'nanoid';

import type { CloudflareConfig } from '../config/index.js';
import type { Database, DomainMappingRow } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import { CloudflareNotFoundError } from '../errors.js';
import { containerName as projectContainerName } from './helpers.js';
import { buildTraefikLabels } from './traefik.js';

interface CloudflareApiError {
  code?: number;
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
    private config: CloudflareConfig,
    private readonly db: Database,
    private readonly events: EventBus,
  ) {}

  reloadConfig(config: CloudflareConfig): void {
    this.config = config;
  }

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
    const recordId = await this.upsertCnameRecord(zone.id, normalizedDomain);
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

    // DNS record deletion — best-effort (may already be deleted externally)
    if (mapping.cloudflare_zone_id && mapping.cloudflare_dns_record_id) {
      await this.deleteDnsRecord(mapping.cloudflare_zone_id, mapping.cloudflare_dns_record_id);
    }

    // DB cleanup must always succeed regardless of API failures above
    this.db.deleteDomainMapping(mapping.id);

    // Tunnel config + routing — best-effort (tunnel may have been deleted externally)
    try {
      await this.updateTunnelConfig();
      await this.syncProjectRouting(projectId);
    } catch (error) {
      log.warn(
        { err: error, projectId, domain },
        'Post-delete config sync failed — tunnel or routing may need manual cleanup',
      );
    }
  }

  listDomains(projectId: string): DomainMappingRow[] {
    return this.db.getDomainMappings(projectId);
  }

  async verifyDomain(domain: string): Promise<boolean> {
    const normalizedDomain = normalizeDomain(domain);

    let zone: CloudflareZone;
    try {
      zone = await this.findZoneForDomain(normalizedDomain);
    } catch (err) {
      log.debug({ err }, 'Domain verification failed — zone not found');
      return false;
    }

    const records = await this.getConflictingRecords(zone.id, normalizedDomain);
    const target = normalizeHost(`${this.config.tunnelId}.cfargotunnel.com`);

    return records.some(
      (record) => record.type.toUpperCase() === 'CNAME' && normalizeHost(record.content) === target,
    );
  }

  private async syncProjectRouting(projectId: string): Promise<void> {
    const project = this.db.getProject(projectId);
    // PR 4.5: canonical-first read of assigned_port with `??` fallback to
    // legacy `projects` column through migration 0012.
    const deployable = project ? this.db.getDeployableForProject(projectId) : undefined;
    // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
    const assignedPort = deployable?.assigned_port ?? project?.assigned_port;
    if (!project || !assignedPort) {
      this.traefikLabels.delete(projectId);
      return;
    }

    const domains = this.db.getDomainMappings(projectId).map((mapping) => mapping.domain);
    if (domains.length === 0) {
      this.traefikLabels.delete(projectId);
      this.db.updateProject(projectId, { visibility: 'internal', publicUrl: null });
      return;
    }

    const labels = this.buildCustomDomainLabels(project.name, assignedPort, domains);
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

    const routerName = projectContainerName(projectName);
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

    try {
      await this.cloudflareRequest(
        `accounts/${this.config.accountId}/cfd_tunnel/${this.config.tunnelId}/configurations`,
        {
          method: 'PUT',
          body: JSON.stringify({ config: { ingress } }),
        },
      );
    } catch (error) {
      // Tunnel may have been deleted externally via Cloudflare dashboard
      if (isCloudflare404(error)) {
        log.warn('Tunnel config update failed (404) — tunnel may have been deleted externally');
        return;
      }
      throw error;
    }
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

  private async upsertCnameRecord(zoneId: string, domain: string): Promise<string> {
    const existing = await this.getConflictingRecords(zoneId, domain);
    const tunnelTarget = `${this.config.tunnelId}.cfargotunnel.com`;
    const cnameBody = JSON.stringify({
      type: 'CNAME',
      name: domain,
      content: tunnelTarget,
      proxied: true,
      ttl: 1,
    });

    // Delete conflicting A/AAAA records, then create CNAME
    const nonCname = existing.filter((r) => r.type !== 'CNAME');
    for (const record of nonCname) {
      await this.deleteDnsRecord(zoneId, record.id);
    }

    // If existing CNAME found, try to patch it — fall through to POST if deleted externally
    const cname = existing.find((r) => r.type === 'CNAME');
    if (cname) {
      try {
        const updated = await this.cloudflareRequest<CloudflareDnsRecord>(
          `zones/${zoneId}/dns_records/${cname.id}`,
          { method: 'PATCH', body: cnameBody },
        );
        return updated.id;
      } catch (error) {
        if (isCloudflare404(error)) {
          log.debug(
            { zoneId, recordId: cname.id },
            'CNAME record deleted externally — creating new one',
          );
        } else {
          throw error;
        }
      }
    }

    // No existing record — create new CNAME
    const created = await this.cloudflareRequest<CloudflareDnsRecord>(
      `zones/${zoneId}/dns_records`,
      { method: 'POST', body: cnameBody },
    );
    return created.id;
  }

  private async getConflictingRecords(
    zoneId: string,
    domain: string,
  ): Promise<CloudflareDnsRecord[]> {
    try {
      return await this.cloudflareRequest<CloudflareDnsRecord[]>(
        `zones/${zoneId}/dns_records?name=${encodeURIComponent(domain)}`,
      );
    } catch (error) {
      // Zone may have been deleted externally
      if (isCloudflare404(error)) {
        log.debug({ zoneId, domain }, 'Zone not found when fetching DNS records — returning empty');
        return [];
      }
      throw error;
    }
  }

  private async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    try {
      await this.cloudflareRequest(`zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' });
    } catch (error) {
      // Record already deleted externally (e.g. via Cloudflare dashboard) — safe to ignore
      if (isCloudflare404(error)) {
        log.debug({ zoneId, recordId }, 'DNS record already deleted — skipping');
        return;
      }
      throw error;
    }
  }

  private async cloudflareRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${CLOUDFLARE_API_BASE}/${path}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        'Content-Type': 'application/json',
        ...((init?.headers ?? {}) as Record<string, string>),
      },
    });

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const text = await response.text();
        try {
          const errorBody = JSON.parse(text) as CloudflareApiResponse<unknown>;
          if (Array.isArray(errorBody.errors) && errorBody.errors.length > 0) {
            detail = errorBody.errors
              .map((e) => `${e.message} (code: ${String(e.code ?? 'unknown')})`)
              .join('; ');
          } else if (text.length < 500) {
            detail = text;
          }
        } catch (_err) {
          if (text.length < 500) detail = text;
        }
      } catch (_err) {
        // Could not read response body
      }
      log.error(
        { status: response.status, detail, path, method: init?.method ?? 'GET' },
        'Cloudflare API request failed',
      );
      throw new Error(`Cloudflare API request failed (${String(response.status)}): ${detail}`);
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
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^\*\./, '')
    .replace(/\.$/, '');
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

function isCloudflare404(error: unknown): boolean {
  return (
    error instanceof CloudflareNotFoundError ||
    (error instanceof Error && error.message.includes('(404)'))
  );
}
