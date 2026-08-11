import { CloudflareApiError, CloudflareUnreachableError } from '../errors.js';
import { createModuleLogger } from '../lib/logger.js';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const MAX_PAGES = 20;
const REQUEST_TIMEOUT_MS = 20_000;
const NETWORK_RETRY_DELAYS_MS = [250, 750] as const;
const RETRY_SAFE_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE']);
const log = createModuleLogger('cloudflare-api');

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

function networkFailureReason(error: unknown): string {
  if (error && typeof error === 'object') {
    const cause = 'cause' in error ? error.cause : undefined;
    if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') {
      return cause.code;
    }
    if ('code' in error && typeof error.code === 'string') return error.code;
    if ('name' in error && typeof error.name === 'string') return error.name;
  }
  return 'NETWORK_ERROR';
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
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

  async getDnsRecord(zoneId: string, recordId: string): Promise<CloudflareDnsRecord | null> {
    try {
      return await this.request<CloudflareDnsRecord>(
        `zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
        'get_dns_record',
      );
    } catch (error) {
      if (error instanceof CloudflareApiError && error.details?.['status'] === 404) {
        return null;
      }
      throw error;
    }
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
    const url = `${CLOUDFLARE_API_BASE}/${path}`;
    const method = init?.method?.toUpperCase() ?? 'GET';
    const retrySafe = RETRY_SAFE_METHODS.has(method);
    let response: Response | undefined;

    for (let attempt = 0; attempt <= NETWORK_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        response = await this.fetcher(url, {
          ...init,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            ...((init?.headers ?? {}) as Record<string, string>),
          },
        });
        break;
      } catch (error) {
        const retryDelayMs = retrySafe ? NETWORK_RETRY_DELAYS_MS[attempt] : undefined;
        if (retryDelayMs === undefined) {
          throw new CloudflareUnreachableError(operation, networkFailureReason(error));
        }
        log.warn(
          { err: error, operation, method, attempt: attempt + 1, retryDelayMs },
          'Cloudflare API network error; retrying',
        );
        await sleep(retryDelayMs);
      }
    }

    if (!response) throw new CloudflareUnreachableError(operation, 'NETWORK_ERROR');

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
