import { CloudflareApiError } from '../errors.js';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const MAX_PAGES = 20;

interface CloudflareApiEnvelope<T> {
  success?: unknown;
  result?: T;
  errors?: Array<{ code?: unknown; message?: unknown }>;
  result_info?: { page?: unknown; total_pages?: unknown };
}

export interface CloudflareAccount {
  id: string;
  name: string;
}

export interface CloudflareZone {
  id: string;
  name: string;
  status?: string;
  account?: { id?: string; name?: string };
}

export interface CloudflareTunnel {
  id: string;
  name: string;
  status?: string;
  token?: string;
}

export interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
}

export interface CloudflareTunnelIngressRule {
  hostname?: string;
  service: string;
  originRequest?: Record<string, unknown>;
}

function errorDetail<T>(body: CloudflareApiEnvelope<T>, status: number): string {
  const details = (body.errors ?? [])
    .map((entry) => (typeof entry.message === 'string' ? entry.message : null))
    .filter((entry): entry is string => entry !== null)
    .join('; ');
  return details || `HTTP ${String(status)}`;
}

function appendQuery(path: string, key: string, value: string): string {
  const url = new URL(path, `${CLOUDFLARE_API_BASE}/`);
  url.searchParams.set(key, value);
  return `${url.pathname.replace(/^\/client\/v4\//, '')}${url.search}`;
}

export class CloudflareApiClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async listAccounts(): Promise<CloudflareAccount[]> {
    return this.listPaginated<CloudflareAccount>('accounts?per_page=50', 'list_accounts');
  }

  async listZones(accountId: string): Promise<CloudflareZone[]> {
    const query = new URLSearchParams({
      'account.id': accountId,
      status: 'active',
      per_page: '50',
    });
    return this.listPaginated<CloudflareZone>(`zones?${query.toString()}`, 'list_zones');
  }

  async listTunnels(accountId: string, name?: string): Promise<CloudflareTunnel[]> {
    const query = new URLSearchParams({ is_deleted: 'false', per_page: '50' });
    if (name) query.set('name', name);
    return this.listPaginated<CloudflareTunnel>(
      `accounts/${encodeURIComponent(accountId)}/cfd_tunnel?${query.toString()}`,
      'list_tunnels',
    );
  }

  createTunnel(accountId: string, name: string): Promise<CloudflareTunnel> {
    return this.request<CloudflareTunnel>(
      `accounts/${encodeURIComponent(accountId)}/cfd_tunnel`,
      'create_tunnel',
      {
        method: 'POST',
        body: JSON.stringify({ name, config_src: 'cloudflare' }),
      },
    );
  }

  getTunnelToken(accountId: string, tunnelId: string): Promise<string> {
    return this.request<string>(
      `accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/token`,
      'get_tunnel_token',
    );
  }

  async updateTunnelConfiguration(
    accountId: string,
    tunnelId: string,
    ingress: readonly CloudflareTunnelIngressRule[],
  ): Promise<void> {
    await this.request(
      `accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`,
      'update_tunnel_configuration',
      {
        method: 'PUT',
        body: JSON.stringify({ config: { ingress } }),
      },
    );
  }

  async deleteTunnel(accountId: string, tunnelId: string): Promise<void> {
    await this.request(
      `accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}`,
      'delete_tunnel',
      { method: 'DELETE' },
    );
  }

  async cleanupTunnelConnections(accountId: string, tunnelId: string): Promise<void> {
    await this.request(
      `accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/connections`,
      'cleanup_tunnel_connections',
      { method: 'DELETE' },
    );
  }

  listDnsRecords(zoneId: string, hostname: string): Promise<CloudflareDnsRecord[]> {
    const query = new URLSearchParams({ name: hostname, per_page: '100' });
    return this.listPaginated<CloudflareDnsRecord>(
      `zones/${encodeURIComponent(zoneId)}/dns_records?${query.toString()}`,
      'list_dns_records',
    );
  }

  createTunnelDnsRecord(
    zoneId: string,
    hostname: string,
    tunnelId: string,
  ): Promise<CloudflareDnsRecord> {
    return this.request<CloudflareDnsRecord>(
      `zones/${encodeURIComponent(zoneId)}/dns_records`,
      'create_dns_record',
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'CNAME',
          name: hostname,
          content: `${tunnelId}.cfargotunnel.com`,
          proxied: true,
          ttl: 1,
        }),
      },
    );
  }

  async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    await this.request(
      `zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
      'delete_dns_record',
      { method: 'DELETE' },
    );
  }

  private async listPaginated<T>(path: string, operation: string): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    while (page <= MAX_PAGES) {
      const pagePath = appendQuery(path, 'page', String(page));
      const envelope = await this.requestEnvelope<T[]>(pagePath, operation);
      results.push(...(envelope.result ?? []));
      const totalPages =
        typeof envelope.result_info?.total_pages === 'number'
          ? envelope.result_info.total_pages
          : page;
      if (page >= totalPages) return results;
      page += 1;
    }
    return results;
  }

  private async request<T>(path: string, operation: string, init?: RequestInit): Promise<T> {
    const envelope = await this.requestEnvelope<T>(path, operation, init);
    if (envelope.result === undefined) {
      throw new CloudflareApiError(502, 'Missing result', operation);
    }
    return envelope.result;
  }

  private async requestEnvelope<T>(
    path: string,
    operation: string,
    init?: RequestInit,
  ): Promise<CloudflareApiEnvelope<T>> {
    let response: Response;
    try {
      response = await this.fetcher(`${CLOUDFLARE_API_BASE}/${path}`, {
        ...init,
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          ...((init?.headers ?? {}) as Record<string, string>),
        },
      });
    } catch (error) {
      throw new CloudflareApiError(
        0,
        error instanceof Error ? error.message : 'Network request failed',
        operation,
      );
    }

    const text = await response.text();
    let body: CloudflareApiEnvelope<T> = {};
    try {
      body = JSON.parse(text) as CloudflareApiEnvelope<T>;
    } catch {
      if (response.ok) throw new CloudflareApiError(response.status, 'Invalid JSON', operation);
    }
    if (!response.ok || body.success !== true) {
      throw new CloudflareApiError(response.status, errorDetail(body, response.status), operation);
    }
    return body;
  }
}
