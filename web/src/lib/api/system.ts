import type { SystemStats } from '../../types';
import { apiGet, apiPost, apiPostVoid, apiPut } from './client';

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
  llm: { ok: boolean; provider: string; model: string; message: string };
  github?: { ok: boolean; username?: string; message?: string };
}

export async function setLanguage(language: string): Promise<void> {
  return apiPostVoid('/api/setup/language', { language });
}

export async function getSetupStatus(): Promise<SetupStatus> {
  return apiGet<SetupStatus>('/api/setup/status');
}

export interface ProviderInfo {
  id: string;
  provider: string;
  defaultModel: string;
  hasApiKey: boolean;
  apiKeyPreview: string;
  createdAt?: string;
  health?: {
    ok: boolean;
    latencyMs?: number;
    checkedAt?: string;
  };
  circuitBreaker?: {
    state: 'closed' | 'open' | 'half_open';
    failures: number;
    lastFailureTime?: number;
    nextRetryTime?: number;
  };
}

export interface ProvidersResponse {
  providers: ProviderInfo[];
}

export async function getProviders(): Promise<ProvidersResponse> {
  return apiGet<ProvidersResponse>('/api/setup/providers');
}

export async function addProvider(data: {
  id: string;
  provider: string;
  apiKey?: string;
  defaultModel: string;
}): Promise<{ status: string; id: string }> {
  const res = await fetch('/api/setup/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? 'Failed to add provider');
  }
  return res.json();
}

export async function deleteProvider(id: string): Promise<{ status: string }> {
  const res = await fetch(`/api/setup/providers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? 'Failed to delete provider');
  }
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

  return apiPost<unknown>('/api/setup/llm', body);
}

export interface TestLlmConnectionParams {
  providerId?: string;
  provider?: string;
  apiKey?: string;
  authToken?: string;
  model?: string;
}

export async function testLLMConnection(params: TestLlmConnectionParams = {}): Promise<{
  ok: boolean;
  latencyMs?: number;
  providerId?: string;
  provider?: string;
  model?: string;
  error?: string;
}> {
  const body: Record<string, string> = {};
  if (params.providerId) body.provider_id = params.providerId;
  if (params.provider) body.provider = params.provider;
  if (params.apiKey) body.api_key = params.apiKey;
  if (params.authToken) body.auth_token = params.authToken;
  if (params.model) body.model = params.model;

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
  return apiPost<unknown>('/api/setup/cloudflare', {
    api_token: config.apiToken,
    account_id: config.accountId,
    tunnel_id: config.tunnelId,
  });
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
  return apiGet<{ configured: boolean; accountId?: string }>('/api/setup/cloudflare');
}

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

export interface AiFeatureState {
  enabled: boolean;
  available: boolean;
  providerId?: string;
  model?: string;
}

export interface AiFeaturesResponse {
  features: {
    autoRecovery: AiFeatureState;
    buildDebugger: AiFeatureState;
    webAgent: AiFeatureState;
    envDetection: AiFeatureState;
    secretScan: AiFeatureState;
    rollbackSuggestion: AiFeatureState;
    operationalMonitoring: AiFeatureState;
    codingPlan: AiFeatureState;
  };
}

export async function getAiFeatures(): Promise<AiFeaturesResponse> {
  return apiGet<AiFeaturesResponse>('/api/setup/ai-features');
}

export async function updateAiFeatures(
  updates: Partial<
    Record<
      keyof AiFeaturesResponse['features'],
      { enabled: boolean; providerId?: string; model?: string }
    >
  >,
): Promise<AiFeaturesResponse> {
  return apiPut<AiFeaturesResponse>('/api/setup/ai-features', updates);
}
