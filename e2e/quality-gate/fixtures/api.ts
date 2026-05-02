import { createHmac } from 'node:crypto';

const BASE = 'http://localhost:10114';

function authHeaders(): Record<string, string> {
  if (process.env.OPENLANDER_API_TOKEN) {
    return { Authorization: `Bearer ${process.env.OPENLANDER_API_TOKEN}` };
  }
  if (process.env.OPENLANDER_SESSION) {
    return { Cookie: `ol_session=${process.env.OPENLANDER_SESSION}` };
  }
  return {};
}

function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = { ...authHeaders(), ...(init?.headers as Record<string, string>) };
  return fetch(`${BASE}${path}`, { ...init, headers });
}

// ============================================================================
// Deploy
// ============================================================================

export async function deployGitProject(
  repoUrl: string,
  branch: string = 'main',
  environment?: string,
): Promise<{ projectId: string; success: boolean }> {
  const body = {
    source: 'git',
    repo_url: repoUrl,
    branch,
    ...(environment && { environment }),
  };

  const res = await apiFetch('/api/projects/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Deploy failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { projectId?: string; success?: boolean };
  return {
    projectId: data.projectId || '',
    success: data.success ?? false,
  };
}

export async function deployImageProject(
  imageUrl: string,
  port?: number,
  name?: string,
): Promise<{ projectId: string; success: boolean }> {
  const body = {
    source: 'image',
    image_url: imageUrl,
    ...(port && { port }),
    ...(name && { name }),
  };

  const res = await apiFetch('/api/projects/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Deploy failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { projectId?: string; success?: boolean };
  return {
    projectId: data.projectId || '',
    success: data.success ?? false,
  };
}

export async function createGitProject(
  repoUrl: string,
  options?: { branch?: string; name?: string },
): Promise<{ projectId: string; name: string; status: string }> {
  const res = await apiFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repo_url: repoUrl,
      branch: options?.branch ?? 'main',
      ...(options?.name ? { name: options.name } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create project failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    project?: { id?: string; name?: string; status?: string };
  };
  const project = data.project;
  if (!project?.id || !project.name || !project.status) {
    throw new Error(`Create project returned invalid payload: ${JSON.stringify(data)}`);
  }

  return {
    projectId: project.id,
    name: project.name,
    status: project.status,
  };
}

// ============================================================================
// Project CRUD
// ============================================================================

export async function getProject(projectId: string): Promise<any> {
  const res = await apiFetch(`/api/projects/${projectId}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get project failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${projectId}`, { method: 'DELETE' });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete project failed (${res.status}): ${text}`);
  }
}

export async function listProjects(): Promise<any[]> {
  const res = await apiFetch(`/api/projects`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`List projects failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { projects?: any[] };
  return data.projects || [];
}

// ============================================================================
// Lifecycle
// ============================================================================

export async function redeployProject(projectId: string): Promise<any> {
  const res = await apiFetch(`/api/projects/${projectId}/redeploy`, {
    method: 'POST',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Redeploy failed (${res.status}): ${text}`);
  }

  // Consume stream if present
  if (res.body) {
    const reader = res.body.getReader();
    void reader.cancel();
  }

  return { success: true };
}

export async function rollbackProject(projectId: string, deployId: string): Promise<any> {
  const res = await apiFetch(`/api/projects/${projectId}/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deployment_id: deployId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Rollback failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function blueGreenDeploy(projectId: string, healthCheckPath?: string): Promise<any> {
  const body = healthCheckPath ? { health_check_path: healthCheckPath } : {};

  const res = await apiFetch(`/api/projects/${projectId}/blue-green`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Blue-green deploy failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ============================================================================
// Config
// ============================================================================

export async function setEnvVars(projectId: string, vars: Record<string, string>): Promise<void> {
  const res = await apiFetch(`/api/projects/${projectId}/env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variables: vars }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Set env vars failed (${res.status}): ${text}`);
  }
}

export async function configureWebhook(
  projectId: string,
): Promise<{ secret: string; webhookId: string }> {
  const res = await apiFetch(`/api/projects/${projectId}/webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'github', enabled: true }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Configure webhook failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { secret?: string; id?: string };
  return {
    secret: data.secret || '',
    webhookId: data.id || '',
  };
}

// ============================================================================
// Webhook
// ============================================================================

export async function postWebhook(projectId: string, payload: any, secret: string): Promise<any> {
  const payloadStr = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(payloadStr).digest('hex');

  const res = await apiFetch(`/api/webhooks/${projectId}/github`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    body: payloadStr,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webhook failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ============================================================================
// MCP
// ============================================================================

let mcpSessionId: string | null = null;

export async function mcpCall(method: string, params?: any): Promise<any> {
  const payload = {
    jsonrpc: '2.0',
    id: Math.random().toString(36).slice(2),
    method,
    ...(params && { params }),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };

  if (mcpSessionId) {
    headers['mcp-session-id'] = mcpSessionId;
  }

  const res = await apiFetch('/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP call failed (${res.status}): ${text}`);
  }

  const sessionHeader = res.headers.get('mcp-session-id');
  if (sessionHeader) {
    mcpSessionId = sessionHeader;
  }

  const contentType = res.headers.get('content-type') ?? '';

  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) continue;
      try {
        const data = JSON.parse(jsonStr) as { result?: any; error?: any };
        if (data.error) throw new Error(`MCP error: ${JSON.stringify(data.error)}`);
        if (data.result !== undefined) return data.result;
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
    throw new Error('No JSON-RPC result found in SSE response');
  }

  const data = (await res.json()) as { result?: any; error?: any };

  if (data.error) {
    throw new Error(`MCP error: ${JSON.stringify(data.error)}`);
  }

  return data.result;
}

// ============================================================================
// Polling
// ============================================================================

export async function waitForStatus(
  projectId: string,
  status: string,
  timeoutMs: number = 120_000,
): Promise<any> {
  const startTime = Date.now();
  const pollIntervalMs = 3000;

  while (true) {
    const elapsed = Date.now() - startTime;

    if (elapsed > timeoutMs) {
      const lastProject = await getProject(projectId);
      throw new Error(
        `Timeout waiting for status "${status}" (elapsed: ${elapsed}ms, current: ${lastProject.status})`,
      );
    }

    const project = await getProject(projectId);

    if (project.status === status) {
      return project;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

// ============================================================================
// Timeline
// ============================================================================

export async function getTimeline(projectId: string): Promise<any[]> {
  const res = await apiFetch(`/api/projects/${projectId}/timeline`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get timeline failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { events?: any[] };
  return data.events || [];
}

// ============================================================================
// Deployments
// ============================================================================

export async function getDeployments(projectId: string): Promise<any[]> {
  const res = await apiFetch(`/api/projects/${projectId}/deployments`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get deployments failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { deployments?: any[] };
  return data.deployments || [];
}

// ============================================================================
// OpsAgent
// ============================================================================

export async function getOpsHealth(): Promise<{
  status: string;
  queue: number;
  running: boolean;
}> {
  const res = await apiFetch('/api/ops/health');
  if (!res.ok) throw new Error(`getOpsHealth failed: ${res.status}`);
  return res.json() as Promise<{ status: string; queue: number; running: boolean }>;
}

export async function getOpsIncidents(projectId?: string): Promise<{ incidents: unknown[] }> {
  const params = projectId ? `?projectId=${projectId}` : '';
  const res = await apiFetch(`/api/ops/incidents${params}`);
  if (!res.ok) throw new Error(`getOpsIncidents failed: ${res.status}`);
  return res.json() as Promise<{ incidents: unknown[] }>;
}

export async function getOpsConfig(): Promise<{ config: Record<string, unknown> }> {
  const res = await apiFetch('/api/ops/config');
  if (!res.ok) throw new Error(`getOpsConfig failed: ${res.status}`);
  return res.json() as Promise<{ config: Record<string, unknown> }>;
}

export async function getCircuitBreakerState(
  projectId: string,
): Promise<{ state: Record<string, unknown> | null }> {
  const res = await apiFetch(`/api/ops/circuit-breaker/${projectId}`);
  if (!res.ok) throw new Error(`getCircuitBreakerState failed: ${res.status}`);
  return res.json() as Promise<{ state: Record<string, unknown> | null }>;
}

export async function resetCircuitBreaker(projectId: string): Promise<{ reset: boolean }> {
  const res = await apiFetch(`/api/ops/circuit-breaker/${projectId}/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`resetCircuitBreaker failed: ${res.status}`);
  return res.json() as Promise<{ reset: boolean }>;
}

export async function triggerDigest(): Promise<{ triggered: boolean }> {
  const res = await apiFetch('/api/ops/digest/trigger', { method: 'POST' });
  if (!res.ok) throw new Error(`triggerDigest failed: ${res.status}`);
  return res.json() as Promise<{ triggered: boolean }>;
}
