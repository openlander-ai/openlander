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
  url?: string;
  urls?: Array<{ url: string; type: 'lan' | 'vpn'; ip: string }>;
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

export interface ActionRun {
  id: string;
  project_id: string;
  status: 'running' | 'succeeded' | 'failed';
  approval_status: 'pending' | 'approved' | 'rejected' | null;
  approval_tool: string | null;
  approval_requested_at: string | null;
  approval_resolved_at: string | null;
  error_message: string | null;
  recovery_strategy: 'recipe' | 'llm' | 'memory' | 'unknown' | null;
  plan: string | null;
  steps_json: string | null;
  current_step: number | null;
  total_steps: number | null;
  trigger_source: 'web_agent' | 'auto_recovery' | 'monitor' | 'mcp' | null;
  created_at: string;
  updated_at: string | null;
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
    url: environment.url,
    urls: environment.urls,
    createdAt: environment.created_at,
    updatedAt: environment.updated_at,
  };
}

export async function deployProject(
  repoUrl?: string,
  branch?: string,
  name?: string,
  envVars?: Record<string, string>,
  source?: 'git' | 'image',
  imageUrl?: string,
  imageCmd?: string | string[],
  port?: number,
): Promise<DeployResult> {
  const body: Record<string, unknown> = {
    branch,
    name,
    env_vars: envVars,
  };

  if (source === 'image') {
    body.source = 'image';
    body.image_url = imageUrl;
    body.image_cmd = imageCmd;
    body.port = port;
  } else {
    body.source = 'git';
    body.repo_url = repoUrl;
  }

  const res = await fetch('/api/projects/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

export async function listProjects(
  includeArchived = false,
): Promise<ProjectWithOptionalEnvironments[]> {
  const query = includeArchived ? '?include_archived=true' : '';
  const res = await fetch(`/api/projects${query}`);
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || 'Failed to fetch project');
  }
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

export async function updateProject(
  id: string,
  data: { imageUrl?: string; imageCmd?: string; containerPort?: number },
): Promise<ProjectWithOptionalEnvironments> {
  const res = await fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: data.imageUrl,
      image_cmd: data.imageCmd,
      container_port: data.containerPort,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to update project');
  }

  return res.json();
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

export async function fetchPendingApprovals(): Promise<ActionRun[]> {
  const res = await fetch('/api/action-runs?approval_status=pending');
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to fetch pending approvals');
  }

  const data = (await res.json()) as { actionRuns?: ActionRun[] };
  return Array.isArray(data.actionRuns) ? data.actionRuns : [];
}

export async function approveActionRun(actionRunId: string): Promise<void> {
  const res = await fetch(`/api/action-runs/${actionRunId}/approve`, {
    method: 'POST',
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to approve action run');
  }
}

export async function rejectActionRun(actionRunId: string): Promise<void> {
  const res = await fetch(`/api/action-runs/${actionRunId}/reject`, {
    method: 'POST',
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to reject action run');
  }
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

export interface ConnectedService {
  id: string;
  name: string;
  type: string;
  status: 'running' | 'stopped' | 'error';
  port: number;
  containerName: string;
  autoInjectedEnvKeys?: string[];
}

export async function getProjectConnectedServices(
  id: string,
  environmentId?: string,
): Promise<ConnectedService[]> {
  const params = environmentId ? `?environmentId=${environmentId}` : '';
  const res = await fetch(`/api/projects/${id}/services${params}`);
  if (!res.ok) return [];
  return res.json();
}

export async function connectProjectService(
  projectId: string,
  serviceId: string,
): Promise<{
  id: string;
  service: ConnectedService;
  createdAt: string;
  autoInjectedEnvKeys?: string[];
}> {
  const res = await fetch(`/api/projects/${projectId}/services/${serviceId}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to connect service');
  }
  return res.json();
}

export async function disconnectProjectService(
  projectId: string,
  serviceId: string,
): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/services/${serviceId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to disconnect service');
  }
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

export async function redeployProject(id: string, envVars?: Record<string, string>): Promise<void> {
  const res = await fetch(`/api/projects/${id}/redeploy`, {
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

export async function rollbackProject(id: string, deploymentId?: string): Promise<DeployResult> {
  const res = await fetch(`/api/projects/${id}/rollback`, {
    method: 'POST',
    headers: deploymentId ? { 'Content-Type': 'application/json' } : undefined,
    body: deploymentId ? JSON.stringify({ deployment_id: deploymentId }) : undefined,
  });

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
  const res = await fetch(`/api/projects/${id}/redeploy?strategy=blue-green`, {
    method: 'POST',
    headers: healthCheckPath ? { 'Content-Type': 'application/json' } : undefined,
    body: healthCheckPath ? JSON.stringify({ health_check_path: healthCheckPath }) : undefined,
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

export async function archiveProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}/archive`, { method: 'POST' });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to archive project');
  }
}

export async function unarchiveProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}/unarchive`, { method: 'POST' });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to unarchive project');
  }
}

export async function purgeProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}/purge?confirm=true`, { method: 'DELETE' });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || 'Failed to purge project');
  }
}

export async function getProjectLogs(id: string): Promise<string> {
  const res = await fetch(`/api/projects/${id}/logs`);
  if (!res.ok) return '';
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

export async function generateEnvExample(id: string): Promise<string> {
  const res = await fetch(`/api/projects/${id}/env-example`);
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
  serviceHints?: string[];
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
