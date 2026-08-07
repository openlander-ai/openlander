import type {
  DeployLogDetail,
  DeployLogSummary,
  DeployResult,
  Environment,
  Project,
} from '../../types';
import { fetchWithAuth } from './auth.js';
import { apiDelete, apiPost, apiPostVoid, throwApiError } from './client';

interface BackendEnvironment {
  id: string;
  project_id: string;
  type: Environment['type'];
  branch: string | null;
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
    project_name: name,
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

  return apiPost<DeployResult>('/api/services/deploy', body);
}

export type DeployServiceInput =
  | {
      source: 'git';
      repoUrl: string;
      projectId?: string;
      projectName?: string;
      serviceName?: string;
      branch?: string | null;
      envVars?: Record<string, string>;
      dockerfilePath?: string;
      dockerTarget?: string;
      buildContext?: string;
      gitCredentialId?: string;
    }
  | {
      source: 'image';
      imageUrl: string;
      projectId?: string;
      projectName?: string;
      serviceName?: string;
      port?: number;
      imageCmd?: string | string[];
      envVars?: Record<string, string>;
    };

export interface DeployServiceResult extends DeployResult {
  serviceName?: string;
}

export async function deployService(input: DeployServiceInput): Promise<DeployServiceResult> {
  const body: Record<string, unknown> = {
    source: input.source,
    project_id: input.projectId,
    project_name: input.projectName,
    service_name: input.serviceName,
    env_vars: input.envVars,
  };

  if (input.source === 'git') {
    body.repo_url = input.repoUrl;
    body.branch = input.branch;
    body.dockerfile_path = input.dockerfilePath;
    body.docker_target = input.dockerTarget;
    body.build_context = input.buildContext;
    body.git_credential_id = input.gitCredentialId;
  } else {
    body.image_url = input.imageUrl;
    body.port = input.port;
    body.image_cmd = input.imageCmd;
  }

  return apiPost<DeployServiceResult>('/api/services/deploy', body);
}

// Redeploy an existing service using its stored config. For git sources
// this fetches the latest HEAD of the saved branch; for image sources it
// re-pulls the saved image reference. The service-detail Deploy button
// uses async mode so the UI can jump straight to the live log stream.
export async function redeployService(
  projectId: string,
  serviceId: string,
  options?: { async?: boolean },
): Promise<DeployResult> {
  const query = options?.async === true ? '?async=true' : '';
  return apiPost<DeployResult>(
    `/api/projects/${projectId}/services/${serviceId}/deploy${query}`,
    {},
  );
}

export async function createProject(
  name?: string,
): Promise<{ project: { id: string; name: string; status: Project['status'] } }> {
  return apiPost<{ project: { id: string; name: string; status: Project['status'] } }>(
    '/api/projects',
    { name },
  );
}

export async function createProjectGroup(displayName: string): Promise<{
  project: {
    id: string;
    name: string;
    displayName?: string;
    description?: string | null;
    tags?: string[];
    status: Project['status'];
  };
}> {
  return apiPost<{
    project: {
      id: string;
      name: string;
      displayName?: string;
      description?: string | null;
      tags?: string[];
      status: Project['status'];
    };
  }>('/api/projects', { displayName });
}

export async function listProjects(
  includeArchived = false,
): Promise<ProjectWithOptionalEnvironments[]> {
  const query = includeArchived ? '?include_archived=true' : '';
  const res = await fetch(`/api/projects${query}`);
  if (!res.ok) await throwApiError(res, 'Failed to fetch projects');
  const data = (await res.json()) as { projects: BackendProjectWithOptionalEnvironments[] };
  return data.projects.map((p) => ({
    ...p,
    environments: Array.isArray(p.environments) ? p.environments.map(mapEnvironment) : undefined,
  }));
}

export async function getProject(id: string): Promise<ProjectWithOptionalEnvironments> {
  const res = await fetch(`/api/projects/${id}`);
  if (!res.ok) await throwApiError(res, 'Failed to fetch project');
  const data = (await res.json()) as Project & {
    previous_image_tag?: string | null;
    created_at?: string;
    updated_at?: string;
    environments?: BackendEnvironment[];
  };

  const mappedEnvironments = Array.isArray(data.environments)
    ? data.environments.map(mapEnvironment)
    : data.environments;

  return {
    ...data,
    previousImageTag: data.previousImageTag ?? data.previous_image_tag,
    createdAt: data.createdAt ?? data.created_at ?? '',
    updatedAt: data.updatedAt ?? data.updated_at ?? '',
    environments: mappedEnvironments,
  };
}

export async function updateProject(
  id: string,
  data: {
    displayName?: string;
    description?: string | null;
    tags?: string[];
    imageUrl?: string;
    imageCmd?: string;
    containerPort?: number;
  },
): Promise<ProjectWithOptionalEnvironments> {
  const res = await fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: data.displayName,
      description: data.description,
      tags: data.tags,
      image_url: data.imageUrl,
      image_cmd: data.imageCmd,
      container_port: data.containerPort,
    }),
  });

  if (!res.ok) await throwApiError(res, 'Failed to update project');

  return res.json();
}

export async function getEnvironments(projectId: string): Promise<Environment[]> {
  const res = await fetch(`/api/projects/${projectId}/environments`);
  if (!res.ok) await throwApiError(res, 'Failed to fetch environments');

  const data = (await res.json()) as { environments: BackendEnvironment[] };
  return data.environments.map(mapEnvironment);
}

export async function getEnvironmentEnvVars(
  projectId: string,
  envId: string,
): Promise<EnvironmentEnvVarsResponse> {
  const res = await fetch(`/api/projects/${projectId}/environments/${envId}/env`);
  if (!res.ok) await throwApiError(res, 'Failed to fetch environment variables');

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
  return apiPostVoid(`/api/projects/${projectId}/environments/${envId}/env`, {
    variables: env,
  });
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
  if (!res.ok) await throwApiError(res, 'Failed to fetch previews');
  const data = await res.json();
  return data.previews;
}

export async function deleteProjectPreview(projectId: string, previewId: string): Promise<void> {
  return apiDelete(`/api/projects/${projectId}/previews/${previewId}`);
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
  if (!res.ok) await throwApiError(res, 'Failed to fetch deployments');
  const data = await res.json();
  return data.deployments;
}

export async function getServiceDeployments(
  projectId: string,
  serviceId: string,
  limit = 50,
  environmentId?: string,
): Promise<DeployLogSummary[]> {
  const query = new URLSearchParams({ limit: limit.toString() });
  if (environmentId) {
    query.set('environmentId', environmentId);
  }
  const res = await fetch(
    `/api/projects/${projectId}/services/${serviceId}/deployments?${query.toString()}`,
  );
  if (!res.ok) await throwApiError(res, 'Failed to fetch service deployments');
  const data = await res.json();
  return data.deployments;
}

/** A DeployLogSummary plus the project + service it belongs to. The
 *  global feed (Home / dashboards) needs to render which project a
 *  deploy was for, so the aggregate /api/deployments/recent endpoint
 *  ships these flat alongside each row. */
export interface RecentDeployment extends DeployLogSummary {
  projectId: string;
  projectName: string;
  serviceId: string;
  serviceName: string;
}

/** Fetches env vars for a single Application/Compose workload. Wraps
 *  /api/projects/:p/services/:s/env. The wire shape matches the
 *  legacy /projects/:id/env (project, envVars). */
export async function getServiceEnvVars(
  projectId: string,
  serviceId: string,
): Promise<Record<string, string>> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(serviceId)}/env`,
  );
  if (!res.ok) await throwApiError(res, 'Failed to fetch env vars');
  const data = (await res.json()) as { envVars?: Record<string, string> };
  return data.envVars ?? {};
}

export interface UpdateServiceEnvVarsResponse {
  status: 'updated' | 'unchanged';
  project: string;
  service: string;
  keys: string[];
  needsRedeploy: boolean;
}

export async function updateServiceEnvVars(
  projectId: string,
  serviceId: string,
  env: Record<string, string>,
): Promise<UpdateServiceEnvVarsResponse> {
  return apiPost<UpdateServiceEnvVarsResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(serviceId)}/env`,
    { variables: env },
  );
}

export async function deleteServiceEnvVar(
  projectId: string,
  serviceId: string,
  key: string,
): Promise<{ status: 'deleted' | 'not_found'; needsRedeploy: boolean }> {
  const encodedProjectId = encodeURIComponent(projectId);
  const encodedServiceId = encodeURIComponent(serviceId);
  const encodedKey = encodeURIComponent(key);
  const res = await fetchWithAuth(
    `/api/projects/${encodedProjectId}/services/${encodedServiceId}/env/${encodedKey}`,
    { method: 'DELETE' },
  );
  if (!res.ok) await throwApiError(res, 'Failed to delete env var');
  return res.json() as Promise<{ status: 'deleted' | 'not_found'; needsRedeploy: boolean }>;
}

/** Fetches the N most recent deploy_logs across all projects in a
 *  single round-trip. Replaces the per-project fan-out previously
 *  performed by Home.tsx. */
export async function getRecentDeployments(limit = 20): Promise<RecentDeployment[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`/api/deployments/recent?${query.toString()}`);
  if (!res.ok) await throwApiError(res, 'Failed to fetch recent deployments');
  const data = (await res.json()) as { deployments: RecentDeployment[] };
  return data.deployments;
}

export interface ConnectedService {
  id: string;
  name: string;
  type: string;
  status: 'running' | 'stopped' | 'error';
  port: number | null;
  containerName: string | null;
  autoInjectedEnvKeys?: string[];
}

export async function getProjectConnectedServices(
  id: string,
  environmentId?: string,
): Promise<ConnectedService[]> {
  const params = environmentId ? `?environmentId=${environmentId}` : '';
  const res = await fetch(`/api/projects/${id}/managed-services${params}`);
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
  return apiPost<{
    id: string;
    service: ConnectedService;
    createdAt: string;
    autoInjectedEnvKeys?: string[];
  }>(`/api/projects/${projectId}/services/${serviceId}`);
}

export async function disconnectProjectService(
  projectId: string,
  serviceId: string,
): Promise<void> {
  return apiDelete(`/api/projects/${projectId}/services/${serviceId}`);
}

/**
 * Fetch the persisted deploy_logs row for a given (project, deploy).
 *
 * Returns `null` (not throw) on a 404 because the persisted row only
 * materializes at deploy completion — for an in-flight build the
 * caller should fall back to the live SSE/cancel surface instead of
 * treating it as a hard error. Other failures (5xx, network) still
 * throw so they don't get masked by the in-flight fast-path.
 */
export async function getDeploymentDetail(
  projectId: string,
  deployId: string,
): Promise<DeployLogDetail | null> {
  const res = await fetchWithAuth(`/api/projects/${projectId}/deployments/${deployId}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    await throwApiError(res, `GET /api/projects/${projectId}/deployments/${deployId} failed`);
  }
  return res.json() as Promise<DeployLogDetail>;
}

export interface CancelDeploymentResponse {
  cancelled: true;
  projectId: string;
  outcome: 'cancelled';
}

/**
 * POST `/api/deployments/:id/cancel` — backend contract from PR #259.
 *
 * Resolves the same `:id` shape as the SSE stream (the `:id` may be a
 * `deploy_logs.id`, a `services.id`, or a `projects.id`). The response
 * always echoes the resolved project id and `outcome: 'cancelled'`.
 *
 * Errors retain the HTTP status and stable backend code so callers can
 * localize the message without discarding diagnostic context. Specific status mapping:
 *
 *   - 404: deployment id resolves to nothing
 *   - 409: `DEPLOYMENT_NOT_ACTIVE` (already terminal, or no live build)
 */
export async function cancelDeployment(deployId: string): Promise<CancelDeploymentResponse> {
  const res = await fetchWithAuth(`/api/deployments/${deployId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) await throwApiError(res, 'Failed to cancel deployment');
  return res.json() as Promise<CancelDeploymentResponse>;
}

export async function deleteProject(id: string): Promise<void> {
  return apiDelete(`/api/projects/${id}`);
}

export async function archiveProject(id: string): Promise<void> {
  return apiPostVoid(`/api/projects/${id}/archive`);
}

export async function unarchiveProject(id: string): Promise<void> {
  return apiPostVoid(`/api/projects/${id}/unarchive`);
}

export async function purgeProject(id: string): Promise<void> {
  return apiDelete(`/api/projects/${id}/purge?confirm=true`);
}

export async function getProjectLogs(id: string): Promise<string> {
  const res = await fetch(`/api/projects/${id}/logs`);
  if (!res.ok) return '';
  return res.text();
}

export type PublicAccessStatus = 'private' | 'provisioning' | 'public' | 'unpublishing' | 'error';
export type PublicAccessProvider = 'protected_share' | 'cloudflare';

export interface ProjectPublicAccess {
  project_id: string;
  service_id: string | null;
  status: PublicAccessStatus;
  public_url: string | null;
  hostname: string | null;
  provider?: PublicAccessProvider;
  access_code_configured?: boolean;
  access_code?: string;
  error: { code: string | null; message: string | null } | null;
}

export async function getProjectPublicAccess(id: string): Promise<ProjectPublicAccess> {
  const res = await fetchWithAuth(`/api/projects/${id}/public-access`);
  if (!res.ok) await throwApiError(res, 'Failed to load public access');
  return res.json();
}

export async function exposeProject(id: string): Promise<ProjectPublicAccess> {
  const res = await fetchWithAuth(`/api/projects/${id}/expose`, { method: 'POST' });
  if (!res.ok) await throwApiError(res, 'Failed to expose project');
  return res.json();
}

export async function unexposeProject(id: string): Promise<ProjectPublicAccess> {
  return apiPost<ProjectPublicAccess>(`/api/projects/${id}/unexpose`);
}

export async function getServicePublicAccess(
  projectId: string,
  serviceId: string,
  provider: PublicAccessProvider = 'protected_share',
): Promise<ProjectPublicAccess> {
  const providerQuery = provider === 'cloudflare' ? '?provider=cloudflare' : '';
  const res = await fetchWithAuth(
    `/api/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(serviceId)}/public-access${providerQuery}`,
  );
  if (!res.ok) await throwApiError(res, 'Failed to load public access');
  return res.json();
}

export async function exposeService(
  projectId: string,
  serviceId: string,
  options?: { provider?: PublicAccessProvider; rotateAccessCode?: boolean },
): Promise<ProjectPublicAccess> {
  const res = await fetchWithAuth(
    `/api/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(serviceId)}/expose`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: options?.provider ?? 'protected_share',
        rotate_access_code: options?.rotateAccessCode === true,
      }),
    },
  );
  if (!res.ok) await throwApiError(res, 'Failed to expose service');
  return res.json();
}

export async function unexposeService(
  projectId: string,
  serviceId: string,
  provider: PublicAccessProvider = 'protected_share',
): Promise<ProjectPublicAccess> {
  return apiPost<ProjectPublicAccess>(
    `/api/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(serviceId)}/unexpose`,
    { provider },
  );
}

// Domain routing API moved to `./domains.ts` for the v0.1 manual-DNS +
// service-scoped CRUD model. See domains.ts for the new contract.

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
  return apiPost<EnvScanResult>('/api/env/scan', { repo_url: repoUrl, branch });
}

export async function scanProjectEnvVars(
  projectId: string,
  environment?: string,
): Promise<ProjectEnvScanResult> {
  return apiPost<ProjectEnvScanResult>(`/api/projects/${projectId}/env/scan`, {
    environment,
  });
}

export interface ResourceLimitsResponse {
  profile: 'micro' | 'small' | 'medium' | 'large' | 'custom' | null;
  memory: {
    limitBytes: number;
    reservationBytes: number;
    swapBytes: number;
  } | null;
  cpu: {
    shares: number;
  } | null;
  warnings?: string[];
}

export interface UpdateResourceLimitsRequest {
  profile: 'micro' | 'small' | 'medium' | 'large' | 'custom';
  memoryMb?: number;
}

export async function getProjectResources(projectId: string): Promise<ResourceLimitsResponse> {
  const res = await fetchWithAuth(`/api/projects/${projectId}/resources`);
  if (!res.ok) await throwApiError(res, 'Failed to fetch project resources');
  return res.json();
}

export async function getServiceResources(
  projectId: string,
  serviceId: string,
): Promise<ResourceLimitsResponse> {
  const res = await fetchWithAuth(`/api/projects/${projectId}/services/${serviceId}/resources`);
  if (!res.ok) await throwApiError(res, 'Failed to fetch service resources');
  return res.json();
}

export async function updateProjectResources(
  projectId: string,
  data: UpdateResourceLimitsRequest,
): Promise<ResourceLimitsResponse> {
  const res = await fetchWithAuth(`/api/projects/${projectId}/resources`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) await throwApiError(res, 'Failed to update project resources');
  return res.json();
}

export async function updateServiceResources(
  projectId: string,
  serviceId: string,
  data: UpdateResourceLimitsRequest,
): Promise<ResourceLimitsResponse> {
  const res = await fetchWithAuth(`/api/projects/${projectId}/services/${serviceId}/resources`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) await throwApiError(res, 'Failed to update service resources');
  return res.json();
}
