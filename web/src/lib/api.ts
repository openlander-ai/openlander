import type { Project, SystemStats, DeployResult, ChatStreamEvent } from '../types';

/**
 * Deploy a project via agent-mediated SSE stream.
 * Consumes SSE events and resolves when projectId is extracted from tool_result.
 *
 * @param onEvent - Optional callback for SSE events (for UI updates during deploy)
 * @returns DeployResult with projectId on success
 */
export async function deployProject(
  repoUrl: string,
  branch?: string,
  name?: string,
  onEvent?: (event: ChatStreamEvent) => void,
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

  // Check if response is SSE stream (agent-mediated) or JSON (direct fallback)
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    // Direct pipeline response (LLM not configured)
    return res.json();
  }

  // SSE stream: consume events and extract projectId from tool_result
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let projectId: string | undefined;
  let deployError: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr) as ChatStreamEvent;
          onEvent?.(event);

          // Extract projectId from deploy_project tool_result
          if (
            event.type === 'tool_result' &&
            event.toolName === 'deploy_project' &&
            event.success
          ) {
            const result = event.result as Record<string, unknown> | undefined;
            if (result?.projectId) {
              projectId = String(result.projectId);
            }
          }

          // Handle fallback event (direct deploy)
          if ((event as Record<string, unknown>).type === 'fallback') {
            const fallback = event as unknown as DeployResult;
            return fallback;
          }

          // Handle error
          if (event.type === 'error') {
            deployError = event.error;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (projectId) {
    return { success: true, projectId };
  }

  if (deployError) {
    return { success: false, error: deployError };
  }

  return { success: false, error: 'Deploy completed but no projectId received' };
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

export async function stopProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}/stop`, { method: 'POST' });
}

export async function redeployProject(
  id: string,
  onEvent?: (event: ChatStreamEvent) => void,
): Promise<DeployResult> {
  const res = await fetch(`/api/projects/${id}/redeploy`, { method: 'POST' });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to redeploy project');
  }

  // Check if response is SSE stream (agent-mediated) or JSON (direct fallback)
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    // Direct pipeline response (LLM not configured)
    return res.json();
  }

  // SSE stream: consume events
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let deployError: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr) as ChatStreamEvent;
          onEvent?.(event);

          if ((event as Record<string, unknown>).type === 'fallback') {
            return event as unknown as DeployResult;
          }

          if (event.type === 'error') {
            deployError = event.error;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (deployError) {
    return { success: false, error: deployError };
  }

  // Redeploy doesn't need to extract projectId (already on the project page)
  return { success: true, projectId: id };
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
  return res.json();
}

export async function updateProjectEnv(id: string, env: Record<string, string>): Promise<void> {
  await fetch(`/api/projects/${id}/env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(env),
  });
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

export async function getSystemStats(): Promise<SystemStats> {
  const res = await fetch('/api/system/stats');
  return res.json();
}

export interface SetupStatus {
  ready: boolean;
  docker: { ok: boolean; state?: string; groupFixed?: boolean; message: string };
  traefik: { ok: boolean; message: string };
  llm: { ok: boolean; provider: string; model: string; message: string };
  github?: { ok: boolean; username?: string; message?: string };
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const res = await fetch('/api/setup/status');
  if (!res.ok) throw new Error('Failed to fetch setup status');
  return res.json();
}

export async function configureLLM(provider: string, apiKey: string, model?: string): Promise<any> {
  const res = await fetch('/api/setup/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, api_key: apiKey, model }),
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
