import type {
  Project,
  SystemStats,
  DeployResult,
  DeployLogSummary,
  DeployLogDetail,
} from '../types';
import type { BuildStreamEvent } from './event-types';

export interface BuildFixSuggestion {
  description: string;
  location?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface BuildDiagnosis {
  summary: string;
  rootCause: string;
  suggestedFixes: BuildFixSuggestion[];
  rawAnalysis: string;
}

export async function deployProject(
  repoUrl: string,
  branch?: string,
  name?: string,
): Promise<DeployResult> {
  const res = await fetch('/api/projects/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_url: repoUrl, branch, name }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to deploy project');
  }

  return res.json();
}

export async function listProjects(): Promise<Project[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) {
    throw new Error('Failed to fetch projects');
  }
  const data = await res.json();
  return data.projects;
}

export async function getProject(id: string): Promise<Project> {
  const res = await fetch(`/api/projects/${id}`);
  const data = (await res.json()) as Project & { previous_image_tag?: string | null };

  if (data.previous_image_tag === undefined) {
    return data;
  }

  return {
    ...data,
    previousImageTag: data.previous_image_tag,
  };
}

export interface PRPreview {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'building' | 'error';
  prNumber: number;
  url: string;
  publicUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function getProjectPreviews(projectId: string): Promise<PRPreview[]> {
  const res = await fetch(`/api/projects/${projectId}/previews`);
  if (!res.ok) throw new Error('Failed to fetch previews');
  const data = await res.json();
  return data.previews;
}

export async function deleteProjectPreview(projectId: string, previewId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/previews/${previewId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete preview');
}

export async function getProjectDeployments(id: string, limit = 50): Promise<DeployLogSummary[]> {
  const res = await fetch(`/api/projects/${id}/deployments?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch deployments');
  const data = await res.json();
  return data.deployments;
}

export async function getProjectTimeline(id: string): Promise<BuildStreamEvent[]> {
  const res = await fetch(`/api/projects/${id}/timeline`);
  if (!res.ok) {
    throw new Error('Failed to fetch timeline events');
  }
  const data = (await res.json()) as { events?: BuildStreamEvent[] };
  return data.events ?? [];
}

export async function getDeploymentDetail(
  projectId: string,
  deployId: string,
): Promise<DeployLogDetail> {
  const res = await fetch(`/api/projects/${projectId}/deployments/${deployId}`);
  if (!res.ok) throw new Error('Failed to fetch deployment detail');
  return res.json();
}

export async function stopProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}/stop`, { method: 'POST' });
}

export async function startProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}/start`, { method: 'POST' });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to start project');
  }
}

export async function redeployProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}/redeploy`, { method: 'POST' });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to redeploy project');
  }
  // SSE stream is consumed by the server-side build/stream endpoint via eventBus.
  // We don't need to read the SSE here — just fire the request and let the
  // timeline's NDJSON build stream pick up events.
  // Close the response body to avoid leaking connections.
  if (res.body) {
    const reader = res.body.getReader();
    void reader.cancel();
  }
}

export async function rollbackProject(id: string): Promise<DeployResult> {
  const res = await fetch(`/api/projects/${id}/rollback`, { method: 'POST' });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to rollback project');
  }

  return res.json();
}
export interface BlueGreenResult {
  success: boolean;
  message?: string;
  oldContainer?: string;
  newContainer?: string;
}

export async function blueGreenProject(
  id: string,
  healthCheckPath?: string,
): Promise<BlueGreenResult> {
  const res = await fetch(`/api/projects/${id}/blue-green`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ health_check_path: healthCheckPath }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to run blue-green deploy');
  }

  return res.json();
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}`, { method: 'DELETE' });
}

export async function getProjectLogs(id: string): Promise<string> {
  const res = await fetch(`/api/projects/${id}/logs`);
  return res.text();
}

export async function getProjectEnv(id: string): Promise<Record<string, string>> {
  const res = await fetch(`/api/projects/${id}/env`);
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to fetch env vars');
  }

  const data = (await res.json()) as { envVars: Record<string, string> } | Record<string, string>;

  if ('envVars' in data && typeof data.envVars === 'object' && data.envVars !== null) {
    return data.envVars;
  }

  return data as Record<string, string>;
}

export async function debugBuild(id: string): Promise<BuildDiagnosis> {
  const res = await fetch(`/api/projects/${id}/debug-build`, {
    method: 'POST',
  });

  if (!res.ok) {
    const text = await res.text();
    let message = 'Failed to run AI diagnosis';

    try {
      const payload = JSON.parse(text);
      if (typeof payload.message === 'string') {
        message = payload.message;
      } else if (typeof payload.error === 'string') {
        message = payload.error;
      }
    } catch {
      if (text.trim()) {
        message = text;
      }
    }

    throw new Error(message);
  }

  return res.json();
}

export async function updateProjectEnv(id: string, env: Record<string, string>): Promise<void> {
  const res = await fetch(`/api/projects/${id}/env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variables: env }),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to update env vars');
  }
}

export async function exposeProject(id: string): Promise<{ publicUrl: string }> {
  const res = await fetch(`/api/projects/${id}/expose`, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    let message = 'Failed to expose project';
    try {
      const payload = JSON.parse(text);
      if (typeof payload.message === 'string') {
        message = payload.message;
      } else if (typeof payload.error === 'string') {
        message = payload.error;
      }
    } catch {
      if (text.trim()) {
        message = text;
      }
    }
    throw new Error(message);
  }
  return res.json();
}

export async function unexposeProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}/unexpose`, { method: 'POST' });
}

export async function shareProject(id: string, accessCode: string): Promise<{ publicUrl: string }> {
  const res = await fetch(`/api/projects/${id}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessCode }),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = 'Failed to share project';
    try {
      const payload = JSON.parse(text);
      if (typeof payload.message === 'string') {
        message = payload.message;
      } else if (typeof payload.error === 'string') {
        message = payload.error;
      }
    } catch {
      if (text.trim()) {
        message = text;
      }
    }
    throw new Error(message);
  }
  return res.json();
}

export async function unshareProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}/share`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to unshare project');
  }
}

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
): Promise<any> {
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

export async function configureCloudflare(config: {
  apiToken: string;
  accountId: string;
  tunnelId: string;
}): Promise<any> {
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

export async function startTraefik(): Promise<any> {
  const res = await fetch('/api/setup/traefik', { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start Traefik');
  return res.json();
}

export async function completeSetup(): Promise<any> {
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
): Promise<any> {
  const res = await fetch('/api/secrets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, description }),
  });
  if (!res.ok) throw new Error('Failed to save secret');
  return res.json();
}

export async function deleteGlobalSecret(key: string): Promise<any> {
  const res = await fetch(`/api/secrets/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete secret');
  return res.json();
}

// OAuth status check
export interface OAuthStatus {
  providers: Record<string, { connected: boolean; expiresAt: string | null }>;
}

export async function getOAuthStatus(): Promise<OAuthStatus> {
  const res = await fetch('/api/auth/status');
  if (!res.ok) throw new Error('Failed to fetch OAuth status');
  return res.json();
}

// Start OAuth flow
export async function startOAuthFlow(provider: string): Promise<{ url: string; state: string }> {
  const res = await fetch(`/api/auth/start/${provider}`);
  if (!res.ok) throw new Error('Failed to start OAuth flow');
  return res.json();
}

// Disconnect OAuth
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

// GitHub Device Flow
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

export interface WebhookConfig {
  id: string;
  source: 'github' | 'gitlab' | 'bitbucket';
  secret: string;
  branchFilter: string;
  enabled: boolean;
  webhookUrl: string;
  createdAt: string;
}

export async function getProjectWebhooks(projectId: string): Promise<WebhookConfig[]> {
  const res = await fetch(`/api/projects/${projectId}/webhooks`);
  if (!res.ok) throw new Error('Failed to fetch webhooks');
  const data = await res.json();
  return data.webhooks;
}

export async function setProjectWebhook(
  projectId: string,
  config: { source: string; branch_filter?: string; enabled?: boolean },
): Promise<WebhookConfig> {
  const res = await fetch(`/api/projects/${projectId}/webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to configure webhook');
  return res.json();
}

export async function deleteProjectWebhook(projectId: string, source: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/webhooks/${source}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete webhook');
}

export interface DomainMapping {
  domain: string;
  hostname?: string;
}

export async function getProjectDomains(projectId: string): Promise<DomainMapping[]> {
  const res = await fetch(`/api/projects/${projectId}/domains`);
  if (!res.ok) throw new Error('Failed to fetch domains');
  const data = await res.json();
  return data.domains;
}

export async function addProjectDomain(projectId: string, domain: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/domains`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: 'Failed to add domain' }));
    throw new Error(data.message || 'Failed to add domain');
  }
}

export async function removeProjectDomain(projectId: string, domain: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/domains/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: 'Failed to remove domain' }));
    throw new Error(data.message || 'Failed to remove domain');
  }
}

// --- Services ---

export interface ServiceTemplate {
  id: string;
  name: string;
  image: string;
  port: number;
}

export interface Service {
  id: string;
  name: string;
  type: string;
  image: string;
  status: 'running' | 'stopped' | 'error';
  container_id: string | null;
  container_name: string;
  port: number;
  env_vars: string | null;
  credentials: string | null;
  created_at: string;
  updated_at: string;
}

export async function getServices(): Promise<Service[]> {
  const res = await fetch('/api/services');
  if (!res.ok) throw new Error('Failed to fetch services');
  return res.json();
}

export async function getServiceTemplates(): Promise<ServiceTemplate[]> {
  const res = await fetch('/api/services/templates');
  if (!res.ok) throw new Error('Failed to fetch templates');
  return res.json();
}

export async function createService(opts: {
  name: string;
  template?: string;
  image?: string;
  port?: number;
  env_vars?: Array<{ key: string; value: string }>;
}): Promise<Service> {
  const res = await fetch('/api/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: 'Failed to create service' }));
    throw new Error(data.message || 'Failed to create service');
  }
  return res.json();
}

export async function removeService(id: string): Promise<void> {
  const res = await fetch(`/api/services/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to remove service');
}

export async function startService(id: string): Promise<void> {
  const res = await fetch(`/api/services/${id}/start`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start service');
}

export async function stopService(id: string): Promise<void> {
  const res = await fetch(`/api/services/${id}/stop`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to stop service');
}

export interface PostmortemData {
  projectId: string;
  projectName: string;
  markdown: string;
  generatedAt: string;
}

export async function getPostmortem(projectId: string): Promise<PostmortemData | null> {
  const res = await fetch(`/api/projects/${projectId}/postmortem/latest`);
  if (!res.ok) return null;
  return res.json();
}
