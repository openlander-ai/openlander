import type { SystemStats } from '../../types';
import { apiGet, apiPost, apiPostVoid } from './client';

export interface NetworkIp {
  address: string;
  interface: string;
  type: 'lan' | 'vpn';
}

export async function getLanIp(): Promise<string | null> {
  const res = await fetch('/api/system/lan-ip');
  if (!res.ok) return null;
  const data = await res.json();
  return data.ip ?? null;
}

export async function getAllIps(): Promise<NetworkIp[]> {
  const res = await fetch('/api/system/lan-ip');
  if (!res.ok) return [];
  const data = await res.json();
  return data.allIps ?? [];
}

export async function getSystemStats(): Promise<SystemStats> {
  return apiGet<SystemStats>('/api/system/stats');
}

export interface SetupStatus {
  ready: boolean;
  hasPassword?: boolean;
  language?: 'en' | 'ko';
  docker: { ok: boolean; state?: string; groupFixed?: boolean; message: string };
  traefik: { ok: boolean; message: string };
  llm: {
    ok: boolean;
    disabled?: boolean;
    provider: string | null;
    model: string | null;
    message: string;
  };
  github?: { ok: boolean; username?: string; message?: string };
}

export async function setLanguage(language: string): Promise<void> {
  return apiPostVoid('/api/setup/language', { language });
}

export async function getSetupStatus(): Promise<SetupStatus> {
  return apiGet<SetupStatus>('/api/setup/status');
}

// Cloudflare auto-DNS removed for v0.1 — see docs/design/v0.1/source-notes/v0.1-spec.md.
// Backend routes (`/api/setup/cloudflare*`, MCP `map_domain` tunnel path) stay
// dormant. Domain attach is now: user adds A/CNAME at their own DNS provider,
// then OpenLander registers the Traefik route. Restore in v0.2 when token UX
// is sorted.

export async function startTraefik(): Promise<unknown> {
  return apiPost<unknown>('/api/setup/traefik');
}

export async function completeSetup(): Promise<unknown> {
  return apiPost<unknown>('/api/setup/complete');
}

export interface GlobalSecret {
  key: string;
  maskedValue: string;
  description: string | null;
}

export async function getGlobalSecrets(): Promise<{ secrets: GlobalSecret[] }> {
  return apiGet<{ secrets: GlobalSecret[] }>('/api/secrets');
}

export async function setGlobalSecret(
  key: string,
  value: string,
  description?: string,
): Promise<unknown> {
  return apiPost<unknown>('/api/secrets', { key, value, description });
}

export async function deleteGlobalSecret(key: string): Promise<unknown> {
  const res = await fetch(`/api/secrets/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete secret');
  return res.json();
}

export interface OAuthStatus {
  providers: Record<string, { connected: boolean; expiresAt: string | null }>;
}

export async function getOAuthStatus(): Promise<OAuthStatus> {
  return apiGet<OAuthStatus>('/api/auth/status');
}

export async function startOAuthFlow(provider: string): Promise<{ url: string; state: string }> {
  return apiGet<{ url: string; state: string }>(`/api/auth/start/${provider}`);
}

export async function disconnectOAuth(provider: string): Promise<void> {
  return apiPostVoid(`/api/auth/disconnect/${provider}`);
}

export async function connectGithub(token: string): Promise<void> {
  const res = await fetch('/api/setup/github', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to connect GitHub');
  }
}

export async function disconnectGithub(): Promise<void> {
  const res = await fetch('/api/setup/github', { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to disconnect GitHub');
  }
}

export async function startGithubDeviceFlow(): Promise<{
  user_code: string;
  verification_uri: string;
  device_code: string;
  interval: number;
  expires_in: number;
}> {
  return apiPost<{
    user_code: string;
    verification_uri: string;
    device_code: string;
    interval: number;
    expires_in: number;
  }>('/api/setup/github/device-code');
}

export async function pollGithubDeviceFlow(
  deviceCode: string,
  interval: number,
): Promise<{
  status: 'pending' | 'slow_down' | 'complete' | 'expired' | 'denied' | 'error';
  username?: string;
  interval?: number;
  message?: string;
}> {
  const res = await fetch('/api/setup/github/poll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_code: deviceCode, interval }),
  });
  return res.json();
}

export interface ServerStatus {
  containers: { total: number; managed: number; external: number };
  portsInUse: number;
  proxy: { type: string; status: string; version?: string };
  externalContainers: { name: string; image: string; ports: number[] }[];
}

export async function getServerStatus(): Promise<ServerStatus> {
  const res = await fetch('/api/server/status');
  return res.json();
}
