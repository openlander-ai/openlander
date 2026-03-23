import type { SystemStats } from '../../types';

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
  const res = await fetch('/api/system/stats');
  return res.json();
}

export interface SetupStatus {
  ready: boolean;
  language?: 'en' | 'ko';
  docker: { ok: boolean; state?: string; groupFixed?: boolean; message: string };
  traefik: { ok: boolean; message: string };
  llm: { ok: boolean; provider: string; model: string; message: string };
  github?: { ok: boolean; username?: string; message?: string };
}

export async function setLanguage(language: string): Promise<void> {
  const res = await fetch('/api/setup/language', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  });
  if (!res.ok) throw new Error('Failed to set language');
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const res = await fetch('/api/setup/status');
  if (!res.ok) throw new Error('Failed to fetch setup status');
  return res.json();
}

export async function configureLLM(
  provider: string,
  apiKey = '',
  model?: string,
  authToken?: string,
): Promise<unknown> {
  const body: {
    provider: string;
    api_key?: string;
    auth_token?: string;
    model?: string;
  } = { provider };

  if (apiKey) {
    body.api_key = apiKey;
  }
  if (authToken) {
    body.auth_token = authToken;
  }
  if (model) {
    body.model = model;
  }

  const res = await fetch('/api/setup/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to configure LLM');
  return res.json();
}

export async function testLLMConnection(
  provider?: string,
  apiKey?: string,
): Promise<{ ok: boolean; latencyMs?: number; provider?: string; model?: string; error?: string }> {
  const body: Record<string, string> = {};
  if (provider) body.provider = provider;
  if (apiKey) body.api_key = apiKey;

  const res = await fetch('/api/setup/llm/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function deleteLLMConfig(): Promise<{ status: string; message: string }> {
  const res = await fetch('/api/setup/llm', { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to remove LLM configuration');
  return res.json();
}

export async function configureCloudflare(config: {
  apiToken: string;
  accountId: string;
  tunnelId: string;
}): Promise<unknown> {
  const res = await fetch('/api/setup/cloudflare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_token: config.apiToken,
      account_id: config.accountId,
      tunnel_id: config.tunnelId,
    }),
  });
  if (!res.ok) throw new Error('Failed to configure Cloudflare');
  return res.json();
}

export async function connectCloudflare(
  apiToken: string,
): Promise<{ accountId: string; accountName: string; tunnels: { id: string; name: string }[] }> {
  const res = await fetch('/api/setup/cloudflare/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_token: apiToken }),
  });

  if (!res.ok) {
    const error = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message || 'Failed to connect Cloudflare');
  }

  return res.json();
}

export async function getCloudflareStatus(): Promise<{ configured: boolean; accountId?: string }> {
  const res = await fetch('/api/setup/cloudflare');
  if (!res.ok) throw new Error('Failed to fetch Cloudflare status');
  return res.json();
}

export async function startTraefik(): Promise<unknown> {
  const res = await fetch('/api/setup/traefik', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start Traefik');
  return res.json();
}

export async function completeSetup(): Promise<unknown> {
  const res = await fetch('/api/setup/complete', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to complete setup');
  return res.json();
}

export interface GlobalSecret {
  key: string;
  maskedValue: string;
  description: string | null;
}

export async function getGlobalSecrets(): Promise<{ secrets: GlobalSecret[] }> {
  const res = await fetch('/api/secrets');
  if (!res.ok) throw new Error('Failed to fetch secrets');
  return res.json();
}

export async function setGlobalSecret(
  key: string,
  value: string,
  description?: string,
): Promise<unknown> {
  const res = await fetch('/api/secrets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, description }),
  });
  if (!res.ok) throw new Error('Failed to save secret');
  return res.json();
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
  const res = await fetch('/api/auth/status');
  if (!res.ok) throw new Error('Failed to fetch OAuth status');
  return res.json();
}

export async function startOAuthFlow(provider: string): Promise<{ url: string; state: string }> {
  const res = await fetch(`/api/auth/start/${provider}`);
  if (!res.ok) throw new Error('Failed to start OAuth flow');
  return res.json();
}

export async function disconnectOAuth(provider: string): Promise<void> {
  const res = await fetch(`/api/auth/disconnect/${provider}`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to disconnect');
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
  const res = await fetch('/api/setup/github/device-code', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start GitHub auth');
  return res.json();
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
