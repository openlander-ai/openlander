import { createHmac } from 'node:crypto';

import { authHeaders, OPENLANDER_URL } from './config.js';

function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = { ...authHeaders(), ...(init?.headers as Record<string, string>) };
  return fetch(`${OPENLANDER_URL}${path}`, { ...init, headers });
}

function slugifyName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'quality-gate';
}

function repoNameFromUrl(repoUrl: string): string {
  const last = repoUrl.split('/').filter(Boolean).pop() ?? 'repo';
  return slugifyName(last);
}

export function uniqueProjectName(prefix: string): string {
  const base = slugifyName(prefix).slice(0, 36).replace(/-+$/g, '') || 'quality-gate';
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return `${base}-${suffix}`.slice(0, 63).replace(/-+$/g, '');
}

// ============================================================================
// Deploy
// ============================================================================

export async function deployGitProject(
  repoUrl: string,
  branch: string = 'main',
  environment?: string,
  options?: { allowFailure?: boolean; name?: string },
): Promise<{ projectId: string; success: boolean }> {
  const body = {
    source: 'git',
    repo_url: repoUrl,
    branch,
    name: options?.name ?? uniqueProjectName(repoNameFromUrl(repoUrl)),
    ...(environment && { environment }),
  };

  const res = await apiFetch('/api/projects/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    if (options?.allowFailure) {
      const data = (await res.json().catch(() => ({}))) as {
        projectId?: string;
        success?: boolean;
      };
      return {
        projectId: data.projectId || '',
        success: data.success ?? false,
      };
    }
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
    name: uniqueProjectName(name ?? slugifyName(imageUrl)),
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
  options?: { branch?: string; name?: string; envVars?: Record<string, string> },
): Promise<{ projectId: string; name: string; status: string }> {
  const res = await apiFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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

  const deployRes = await apiFetch('/api/services/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'git',
      repo_url: repoUrl,
      branch: options?.branch ?? 'main',
      project_id: project.id,
      env_vars: options?.envVars,
    }),
  });

  if (!deployRes.ok) {
    const text = await deployRes.text();
    throw new Error(`Deploy service failed (${deployRes.status}): ${text}`);
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

async function deleteDeployableServices(projectId: string): Promise<void> {
  const project = await getProject(projectId);
  const projectName = typeof project.name === 'string' ? project.name : projectId;
  const servicesRes = await apiFetch(`/api/projects/${projectId}/services`);
  if (!servicesRes.ok) return;

  const servicesPayload = (await servicesRes.json()) as
    | { services?: Array<{ id?: string; name?: string }> }
    | Array<{ id?: string; name?: string }>;
  const services = Array.isArray(servicesPayload)
    ? servicesPayload
    : (servicesPayload.services ?? []);

  for (const service of services) {
    if (!service.id || !service.name) continue;
    await apiFetch(`/api/projects/${projectId}/services/${service.id}/instance`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: `${projectName}/${service.name}` }),
    });
  }
}

export async function deleteProject(projectId: string): Promise<void> {
  let res = await apiFetch(`/api/projects/${projectId}/purge?confirm=true`, { method: 'DELETE' });
  if (res.status === 409) {
    await deleteDeployableServices(projectId);
    res = await apiFetch(`/api/projects/${projectId}/purge?confirm=true`, { method: 'DELETE' });
  }

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

export function runtimeProjectIdFromServiceId(serviceId: string): string {
  return serviceId.endsWith('__svc') ? serviceId.slice(0, -'__svc'.length) : serviceId;
}

export async function getFirstDeployableService(projectId: string): Promise<{
  id: string;
  name?: string;
  status?: string;
  assigned_port?: number | null;
  port?: number | null;
}> {
  const servicesRes = await apiFetch(`/api/projects/${projectId}/services`);
  if (!servicesRes.ok) {
    const text = await servicesRes.text();
    throw new Error(`List project services failed (${servicesRes.status}): ${text}`);
  }
  const servicesPayload = (await servicesRes.json()) as
    | {
        services?: Array<{
          id?: string;
          name?: string;
          status?: string;
          assigned_port?: number | null;
          port?: number | null;
        }>;
      }
    | Array<{
        id?: string;
        name?: string;
        status?: string;
        assigned_port?: number | null;
        port?: number | null;
      }>;
  const services = Array.isArray(servicesPayload)
    ? servicesPayload
    : (servicesPayload.services ?? []);
  const service = services.find((candidate) => typeof candidate.id === 'string');
  if (!service?.id) {
    throw new Error(`Project ${projectId} has no deployable services`);
  }
  return { ...service, id: service.id };
}

async function getFirstDeployableServiceId(projectId: string): Promise<string> {
  return (await getFirstDeployableService(projectId)).id;
}

export async function redeployService(projectId: string): Promise<any> {
  const serviceId = await getFirstDeployableServiceId(projectId);

  const res = await apiFetch(`/api/projects/${projectId}/services/${serviceId}/deploy`, {
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

export async function rollbackService(projectId: string, _deployId: string): Promise<any> {
  const serviceId = await getFirstDeployableServiceId(projectId);
  const res = await apiFetch(`/api/projects/${projectId}/services/${serviceId}/rollback`, {
    method: 'POST',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Rollback failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function blueGreenDeploy(projectId: string, healthCheckPath?: string): Promise<any> {
  const serviceId = await getFirstDeployableServiceId(projectId);
  const body = healthCheckPath ? { health_check_path: healthCheckPath } : {};

  const res = await apiFetch(
    `/api/projects/${projectId}/services/${serviceId}/deploy?strategy=blue-green`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

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
  if (method === 'initialize') {
    mcpSessionId = null;
  }

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

export async function waitForServiceStatus(
  projectId: string,
  status: string,
  timeoutMs: number = 120_000,
): Promise<Awaited<ReturnType<typeof getFirstDeployableService>>> {
  const startTime = Date.now();
  const pollIntervalMs = 3000;

  while (true) {
    const elapsed = Date.now() - startTime;
    const service = await getFirstDeployableService(projectId);

    if (service.status === status) {
      return service;
    }

    if (elapsed > timeoutMs) {
      throw new Error(
        `Timeout waiting for service status "${status}" (elapsed: ${elapsed}ms, current: ${service.status ?? 'unknown'})`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

function collectProjectUrlCandidates(project: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === 'string' && /^https?:\/\//.test(value)) {
      candidates.push(value);
    }
  };

  add(project['url']);
  add(project['publicUrl']);
  add(project['public_url']);

  const urls = project['urls'];
  if (Array.isArray(urls)) {
    for (const item of urls) {
      if (typeof item === 'string') {
        add(item);
      } else if (item && typeof item === 'object') {
        add((item as { url?: unknown }).url);
      }
    }
  }

  return [...new Set(candidates)];
}

export function resolveProjectAccessibleUrl(project: Record<string, unknown>): string {
  const assignedPort = project['assigned_port'] ?? project['port'];
  if (typeof assignedPort === 'number' && assignedPort > 0) {
    return `http://127.0.0.1:${String(assignedPort)}`;
  }

  const url = collectProjectUrlCandidates(project)[0];
  if (url) return url;

  const name = project['name'];
  if (typeof name === 'string' && name.length > 0) {
    return `http://${name}.localhost`;
  }

  throw new Error(
    `Project has no accessible assigned_port/url fields: ${JSON.stringify({
      id: project['id'],
      name: project['name'],
      assigned_port: project['assigned_port'],
      port: project['port'],
      url: project['url'],
      urls: project['urls'],
      publicUrl: project['publicUrl'],
      public_url: project['public_url'],
    })}`,
  );
}

export async function resolveComposeChildAccessibleUrl(
  parentProject: Record<string, unknown>,
  serviceName: string,
): Promise<string> {
  const parentName = parentProject['name'];
  if (typeof parentName !== 'string' || parentName.length === 0) {
    throw new Error(`Compose parent project has no name: ${JSON.stringify(parentProject)}`);
  }

  const childName = `${parentName}/${serviceName}`;
  const childProject = (await listProjects()).find((project) => project.name === childName);
  if (!childProject) {
    throw new Error(`Compose child project not found: ${childName}`);
  }

  return resolveProjectAccessibleUrl(childProject);
}

export async function resolveServiceAccessibleUrl(projectId: string): Promise<string> {
  const project = (await getProject(projectId)) as Record<string, unknown>;
  return resolveProjectAccessibleUrl(project);
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
  const deployments = data.deployments || [];
  if (deployments.length > 0) {
    return deployments;
  }

  const serviceId = await getFirstDeployableServiceId(projectId).catch(() => undefined);
  if (!serviceId) {
    return deployments;
  }

  const serviceRes = await apiFetch(`/api/projects/${projectId}/services/${serviceId}/deployments`);
  if (!serviceRes.ok) {
    return deployments;
  }
  const serviceData = (await serviceRes.json()) as { deployments?: any[] };
  return serviceData.deployments || [];
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
