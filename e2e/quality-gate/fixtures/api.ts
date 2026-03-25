import { createHmac } from 'node:crypto';

const BASE = 'http://localhost:10114';

// ============================================================================
// Deploy
// ============================================================================

export async function deployGitProject(
  repoUrl: string,
  branch?: string,
  environment?: string,
): Promise<{ projectId: string; success: boolean }> {
  const body = {
    source: 'git',
    repo_url: repoUrl,
    ...(branch && { branch }),
    ...(environment && { environment }),
  };

  const res = await fetch(`${BASE}/api/projects/deploy`, {
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

  const res = await fetch(`${BASE}/api/projects/deploy`, {
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

// ============================================================================
// Project CRUD
// ============================================================================

export async function getProject(projectId: string): Promise<any> {
  const res = await fetch(`${BASE}/api/projects/${projectId}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get project failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/projects/${projectId}`, { method: 'DELETE' });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete project failed (${res.status}): ${text}`);
  }
}

export async function listProjects(): Promise<any[]> {
  const res = await fetch(`${BASE}/api/projects`);

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
  const res = await fetch(`${BASE}/api/projects/${projectId}/redeploy`, {
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
  const res = await fetch(`${BASE}/api/projects/${projectId}/rollback`, {
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

  const res = await fetch(`${BASE}/api/projects/${projectId}/blue-green`, {
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
  const res = await fetch(`${BASE}/api/projects/${projectId}/env`, {
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
  const res = await fetch(`${BASE}/api/projects/${projectId}/webhooks`, {
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

  const res = await fetch(`${BASE}/api/webhooks/${projectId}/github`, {
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
  };

  if (mcpSessionId) {
    headers['mcp-session-id'] = mcpSessionId;
  }

  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP call failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { result?: any; error?: any };

  // Store session ID from response headers if present
  const sessionHeader = res.headers.get('mcp-session-id');
  if (sessionHeader) {
    mcpSessionId = sessionHeader;
  }

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
  const res = await fetch(`${BASE}/api/projects/${projectId}/timeline`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get timeline failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { events?: any[] };
  return data.events || [];
}
