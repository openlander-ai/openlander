import type {
  Project,
  SystemStats,
  DeployResult,
  DeployLogSummary,
  DeployLogDetail,
} from '../types';

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
  return res.json();
}

export async function getProjectDeployments(id: string, limit = 50): Promise<DeployLogSummary[]> {
  const res = await fetch(`/api/projects/${id}/deployments?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch deployments');
  const data = await res.json();
  return data.deployments;
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
    throw new Error('Failed to expose project');
  }
  return res.json();
}

export async function unexposeProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}/unexpose`, { method: 'POST' });
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
