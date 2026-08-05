import { apiGet, apiPost } from './client';

export interface CloudflareAccountOption {
  id: string;
  name: string;
}

export interface CloudflareZoneOption {
  id: string;
  name: string;
  status: string;
}

export interface CloudflareConnection {
  configured: boolean;
  oauthAvailable: boolean;
  status: 'disconnected' | 'connected' | 'error';
  account?: { id: string; name: string | null };
  zone?: { id: string; name: string };
  tunnel?: { id: string; name: string };
  connector?: { status: 'running' | 'stopped' | 'unavailable' };
  error?: { code: string | null; message: string | null };
}

export interface CloudflareOAuthStart {
  auth_url: string;
  state: string;
  callback_origin: string;
  expires_in_seconds: number;
}

export function getCloudflareConnection(): Promise<CloudflareConnection> {
  return apiGet('/api/setup/cloudflare');
}

export function startCloudflareOAuth(): Promise<CloudflareOAuthStart> {
  return apiPost('/api/setup/cloudflare/oauth/start');
}

export function completeCloudflareOAuth(code: string, state: string) {
  return apiPost<{ status: 'authorized'; accounts: CloudflareAccountOption[] }>(
    '/api/setup/cloudflare/oauth/complete',
    { code, state },
  );
}

export async function listCloudflareZones(accountId: string): Promise<CloudflareZoneOption[]> {
  const result = await apiGet<{ zones: CloudflareZoneOption[] }>(
    `/api/setup/cloudflare/zones?account_id=${encodeURIComponent(accountId)}`,
  );
  return result.zones;
}

export function connectCloudflare(accountId: string, zoneId: string) {
  return apiPost<CloudflareConnection>('/api/setup/cloudflare/connect', {
    account_id: accountId,
    zone_id: zoneId,
  });
}

export function disconnectCloudflare(): Promise<CloudflareConnection> {
  return apiPost('/api/setup/cloudflare/disconnect');
}
