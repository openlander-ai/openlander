import type { SystemStats } from '../../types';
import { apiDelete, apiGet, apiPost, apiPostVoid } from './client';

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

// Cloudflare auto-DNS removed for v0.1.
// Backend routes (`/api/setup/cloudflare*`) stay dormant. Domain attach is now:
// user adds A/CNAME at their own DNS provider, then OpenLander registers the
// Traefik route. Restore auto-DNS in v0.2 when token UX is sorted.

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
  return apiDelete(`/api/secrets/${encodeURIComponent(key)}`);
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
  return apiPostVoid('/api/setup/github', { token });
}

export async function disconnectGithub(): Promise<void> {
  return apiDelete('/api/setup/github');
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

export type PlatformUpdatePhase =
  | 'preparing'
  | 'backing_up'
  | 'pulling'
  | 'restarting'
  | 'verifying'
  | 'completed'
  | 'rolling_back'
  | 'rolled_back'
  | 'failed';

export interface PlatformUpdateOperation {
  id: string;
  sourceVersion: string;
  targetVersion: string;
  phase: PlatformUpdatePhase;
  startedAt: string;
  updatedAt: string;
  message: string | null;
  errorCode: string | null;
  runnerContainerId: string | null;
}

export interface PlatformUpdateStatus {
  currentVersion: string;
  channel: 'stable' | 'rc' | 'development';
  updateAvailable: boolean;
  canUpdate: boolean;
  release: {
    version: string;
    tag: string;
    publishedAt: string;
    notes: string[];
    url: string;
    oneClickBlockReason: string | null;
  } | null;
  support: {
    mode: 'compose' | 'manual';
    reason: string | null;
    manualUpdateUrl: string;
  };
  checks: Array<{
    id: string;
    ok: boolean;
    message: string;
    availableBytes?: number;
    requiredBytes?: number;
  }>;
  operation: PlatformUpdateOperation | null;
  releaseCheckStale: boolean;
  releaseCheckedAt: string;
}

export async function getPlatformUpdateStatus(
  options: {
    refreshRelease?: boolean;
  } = {},
): Promise<PlatformUpdateStatus> {
  return apiGet<PlatformUpdateStatus>(
    options.refreshRelease ? '/api/system/update?refresh=true' : '/api/system/update',
  );
}

export async function startPlatformUpdate(
  targetVersion: string,
): Promise<{ updateId: string; operation: PlatformUpdateOperation }> {
  return apiPost<{ updateId: string; operation: PlatformUpdateOperation }>('/api/system/update', {
    targetVersion,
  });
}

export async function getServerStatus(): Promise<ServerStatus> {
  const res = await fetch('/api/server/status');
  return res.json();
}
