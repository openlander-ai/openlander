import type {
  DeployLogDetail,
  DeployLogSummary,
  DeployResult,
  Environment,
  Project,
} from '../../types';
import type { BuildStreamEvent } from '../event-types';

interface BackendEnvironment {
  id: string;
  project_id: string;
  type: Environment['type'];
  branch: string;
  status: Environment['status'];
  assigned_port: number | null;
  container_id: string | null;
  image_tag: string | null;
  previous_image_tag: string | null;
  public_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnvironmentEnvVarMeta {
  value: string;
  source: 'global' | 'project' | 'production' | 'environment';
  isOverride?: boolean;
}

export interface EnvironmentEnvVarsResponse {
  environment: Environment;
  envVars: Record<string, string>;
  inheritance: Record<string, EnvironmentEnvVarMeta>;
}

export type ProjectWithOptionalEnvironments = Project & { environments?: Environment[] };
type BackendProjectWithOptionalEnvironments = Project & { environments?: BackendEnvironment[] };

function mapEnvironment(environment: BackendEnvironment): Environment {
  return {
    id: environment.id,
    projectId: environment.project_id,
    type: environment.type,
    branch: environment.branch,
    status: environment.status,
    assignedPort: environment.assigned_port,
    containerId: environment.container_id,
    imageTag: environment.image_tag,
    previousImageTag: environment.previous_image_tag,
    publicUrl: environment.public_url,
    createdAt: environment.created_at,
    updatedAt: environment.updated_at,
  };
}

export async function deployProject(
  repoUrl: string,
  branch?: string,
  name?: string,
  envVars?: Record<string, string>,
  environment?: string,
): Promise<DeployResult> {
  const res = await fetch('/api/projects/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_url: repoUrl, branch, name, env_vars: envVars, environment }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to deploy project');
  }

  return res.json();
}

export async function createProject(
  repoUrl: string,
  branch?: string,
  name?: string,
): Promise<{ project: { id: string; name: string; status: Project['status'] } }> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_url: repoUrl, branch, name }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to create project');
  }

  return res.json();
}

export async function listProjects(): Promise<ProjectWithOptionalEnvironments[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) {
    throw new Error('Failed to fetch projects');
  }
  const data = (await res.json()) as { projects: BackendProjectWithOptionalEnvironments[] };
  return data.projects.map((p) => ({
    ...p,
    environments: Array.isArray(p.environments) ? p.environments.map(mapEnvironment) : undefined,
  }));
}

export async function getProject(id: string): Promise<ProjectWithOptionalEnvironments> {
  const res = await fetch(`/api/projects/${id}`);
  const data = (await res.json()) as Project & {
    previous_image_tag?: string | null;
    environments?: BackendEnvironment[];
  };

  const mappedEnvironments = Array.isArray(data.environments)
    ? data.environments.map(mapEnvironment)
    : data.environments;

  if (data.previous_image_tag === undefined) {
    return {
      ...data,
      environments: mappedEnvironments,
    };
  }

  return {
    ...data,
    previousImageTag: data.previous_image_tag,
    environments: mappedEnvironments,
  };
}

export async function createEnvironment(
  projectId: string,
  type: Environment['type'],
  branch?: string,
): Promise<Environment> {
  const res = await fetch(`/api/projects/${projectId}/environments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, branch }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to create environment');
  }

  const data = (await res.json()) as { environment: BackendEnvironment };
  return mapEnvironment(data.environment);
}

export async function getEnvironments(projectId: string): Promise<Environment[]> {
  const res = await fetch(`/api/projects/${projectId}/environments`);
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to fetch environments');
  }

  const data = (await res.json()) as { environments: BackendEnvironment[] };
  return data.environments.map(mapEnvironment);
}

export async function getEnvironmentEnvVars(
  projectId: string,
  envId: string,
): Promise<EnvironmentEnvVarsResponse> {
  const res = await fetch(`/api/projects/${projectId}/environments/${envId}/env`);
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to fetch environment variables');
  }

  const data = (await res.json()) as {
    environment: BackendEnvironment;
    envVars: Record<string, string>;
    inheritance: Record<string, EnvironmentEnvVarMeta>;
  };

  return {
    environment: mapEnvironment(data.environment),
    envVars: data.envVars,
    inheritance: data.inheritance,
  };
}

export async function updateEnvironmentEnvVars(
  projectId: string,
  envId: string,
  env: Record<string, string>,
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/environments/${envId}/env`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variables: env }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to update environment variables');
  }
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

export async function getProjectDeployments(
  id: string,
  limit = 50,
  environmentId?: string,
): Promise<DeployLogSummary[]> {
  const query = new URLSearchParams({ limit: limit.toString() });
  if (environmentId) {
    query.set('environmentId', environmentId);
  }
  const res = await fetch(`/api/projects/${id}/deployments?${query.toString()}`);
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

export async function stopProject(id: string, environment?: string): Promise<void> {
  const url = environment
    ? `/api/projects/${id}/stop?environment=${environment}`
    : `/api/projects/${id}/stop`;
  await fetch(url, { method: 'POST' });
}

export async function startProject(id: string, environment?: string): Promise<void> {
  const url = environment
    ? `/api/projects/${id}/start?environment=${environment}`
    : `/api/projects/${id}/start`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to start project');
  }
}

export async function redeployProject(
  id: string,
  envVars?: Record<string, string>,
  environment?: string,
): Promise<void> {
  const url = environment
    ? `/api/projects/${id}/redeploy?environment=${environment}`
    : `/api/projects/${id}/redeploy`;
  const res = await fetch(url, {
    method: 'POST',
    headers: envVars ? { 'Content-Type': 'application/json' } : undefined,
    body: envVars ? JSON.stringify({ env_vars: envVars }) : undefined,
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to redeploy project');
  }
  if (res.body) {
    const reader = res.body.getReader();
    void reader.cancel();
  }
}

export async function rollbackProject(id: string, environment?: string): Promise<DeployResult> {
  const url = environment
    ? `/api/projects/${id}/rollback?environment=${environment}`
    : `/api/projects/${id}/rollback`;
  const res = await fetch(url, { method: 'POST' });

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
  environment?: string,
): Promise<BlueGreenResult> {
  const url = environment
    ? `/api/projects/${id}/blue-green?environment=${environment}`
    : `/api/projects/${id}/blue-green`;
  const res = await fetch(url, {
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

export async function deleteEnvironment(projectId: string, envId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/environments/${envId}`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to delete environment');
  }
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

export async function generateEnvExample(id: string, environment?: string): Promise<string> {
  const query = environment ? `?environment=${encodeURIComponent(environment)}` : '';
  const res = await fetch(`/api/projects/${id}/env-example${query}`);
  if (!res.ok) {
    const error = await res.text();
    let message = 'Failed to generate .env.example';
    try {
      const payload = JSON.parse(error);
      if (payload.message) message = payload.message;
    } catch {
      if (error.trim()) message = error;
    }
    throw new Error(message);
  }
  return res.text();
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

export interface EnvVarInfo {
  key: string;
  files: Array<{ path: string; line: number }>;
  optional?: boolean;
}

export interface EnvScanResult {
  vars: EnvVarInfo[];
  hasEnvExample: boolean;
  language: string;
}

export interface ProjectEnvScanResult {
  vars: EnvVarInfo[];
  newVars: EnvVarInfo[];
  existingVars: string[];
  hasEnvExample: boolean;
}

export async function scanEnvVars(repoUrl: string, branch?: string): Promise<EnvScanResult> {
  const res = await fetch('/api/env/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_url: repoUrl, branch }),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to scan env vars');
  }
  return res.json();
}

export async function scanProjectEnvVars(
  projectId: string,
  environment?: string,
): Promise<ProjectEnvScanResult> {
  const res = await fetch(`/api/projects/${projectId}/env/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ environment }),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to scan project env vars');
  }
  return res.json();
}
