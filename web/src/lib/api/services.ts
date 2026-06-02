import type { ServiceHealth } from '../projectTopology';
import { apiGet, apiPost, apiPostVoid, apiPatch, apiDelete } from './client';
import { fetchWithAuth } from './auth';

export interface ServiceTemplate {
  id: string;
  name: string;
  image: string;
  port: number;
  versions?: string[];
}

/**
 * Service — covers BOTH deployables and managed services in 1.0-rc.2's
 * additive schema (P1). The `kind` discriminator is the canonical way to
 * tell them apart post-fullsplit; legacy callers may still inspect `type`
 * (preserved on the wire for backward-compat through 1.x).
 *
 * `kind` values:
 *   - Deployables: 'git' | 'image' | 'compose' | 'compose-child'
 *   - Managed:     'postgres' | 'mysql' | 'redis' | 'mongo' | 'minio'
 *
 * Fields like `status`, `container_id`, `port` remain populated on the row
 * so today's UI keeps rendering during the additive-schema transition.
 */
export interface Service {
  id: string;
  name: string;
  type: string;
  /** rc.2 P1 additive field — canonical service-kind discriminator. */
  kind?: string;
  image: string;
  status: 'running' | 'stopped' | 'error';
  container_id: string | null;
  container_name: string;
  port: number | null;
  env_vars: string | null;
  credentials: string | null;
  scope?: 'project' | 'global';
  attached_project_id?: string | null;
  project_id?: string | null;
  created_at: string;
  updated_at: string;
  summary?: {
    healthStatus: string | null;
    uptimeSeconds: number | null;
    restartCount: number | null;
  };
}

export interface ProjectManagedService {
  id: string;
  name: string;
  type: string;
  status: 'running' | 'stopped' | 'error';
  port: number | null;
  containerName: string | null;
  autoInjectedEnvKeys?: string[];
}

// ─── 1.0-rc.2: infrastructure-service namespace ───────────────────────────
//
// Per ralplan-data-model-full-migration §6.8: managed-service helpers
// split into a dedicated namespace so the deployable-vocab `getService(id)`
// (which will live under `/api/projects/:p/services/:s` once P2 lands the
// canonical handler) doesn't collide with managed-service callers.

export const managedServices = {
  /** Get a managed service by id. */
  get: (id: string): Promise<Service> => apiGet<Service>(`/api/services/${id}`),
  /** List managed services attached to a group via service_connections. */
  listForGroup: (groupId: string): Promise<ProjectManagedService[]> =>
    apiGet<ProjectManagedService[]>(`/api/projects/${groupId}/managed-services`),
  logs: (id: string, lines?: number): Promise<string> => getServiceLogs(id, lines),
  connectedProjects: (id: string): Promise<ConnectedProject[]> => getConnectedProjects(id),
  start: (id: string): Promise<void> => startService(id),
  stop: (id: string): Promise<void> => stopService(id),
  remove: (id: string): Promise<void> => removeService(id),
} as const;

/**
 * 1.0-rc.2 canonical: list deployable services for a group.
 *
 * `/api/projects/:p/services` is the canonical deployable list endpoint
 * (P2 returns rows where `kind NOT IN (managed kinds)`). Used by the new
 * `useGroupServices(groupId)` hook that powers ProjectView's Services tab.
 *
 * The `ConnectedService` shape from `lib/api/projects.ts` (managed-services
 * via `service_connections`) is preserved unchanged at
 * `/api/projects/:p/managed-services` and accessed via
 * `managedServices.listForGroup(groupId)` above.
 */
export interface GroupService {
  id: string;
  name: string;
  /** Canonical kind discriminator (rc.2). */
  kind: string;
  image: string | null;
  status: 'running' | 'stopped' | 'error' | 'building' | 'idle';
  port: number | null;
  url: string | null;
  archivedAt?: string | null;
  health: ServiceHealth | null;
  source?: string | null;
  repoUrl?: string | null;
  branch?: string | null;
  deployedBranch?: string | null;
  dockerfilePath?: string | null;
  dockerTarget?: string | null;
  buildContext?: string | null;
  buildMethod?: string | null;
  imageUrl?: string | null;
  imageCmd?: string[] | null;
  containerPort?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

interface BackendGroupService {
  id: string;
  name: string;
  kind: string;
  image?: string | null;
  image_tag?: string | null;
  status?: GroupService['status'] | null;
  assigned_port?: number | null;
  port?: number | null;
  url?: string | null;
  archived_at?: string | null;
  archivedAt?: string | null;
  health?: ServiceHealth | null;
  source?: string | null;
  repoUrl?: string | null;
  branch?: string | null;
  deployedBranch?: string | null;
  dockerfilePath?: string | null;
  dockerTarget?: string | null;
  buildContext?: string | null;
  buildMethod?: string | null;
  imageUrl?: string | null;
  imageCmd?: string[] | null;
  containerPort?: number | null;
  container_port?: number | null;
  created_at?: string;
  updated_at?: string;
}

function normalizeGroupService(raw: BackendGroupService): GroupService {
  return {
    id: raw.id,
    name: raw.name,
    kind: raw.kind,
    image: raw.image ?? raw.imageUrl ?? raw.image_tag ?? null,
    status: raw.status ?? 'idle',
    port: raw.port ?? raw.assigned_port ?? null,
    url: raw.url ?? null,
    archivedAt: raw.archivedAt ?? raw.archived_at ?? null,
    health: raw.health ?? null,
    source: raw.source ?? null,
    repoUrl: raw.repoUrl ?? null,
    branch: raw.branch ?? null,
    deployedBranch: raw.deployedBranch ?? null,
    dockerfilePath: raw.dockerfilePath ?? null,
    dockerTarget: raw.dockerTarget ?? null,
    buildContext: raw.buildContext ?? null,
    buildMethod: raw.buildMethod ?? null,
    imageUrl: raw.imageUrl ?? null,
    imageCmd: raw.imageCmd ?? null,
    containerPort: raw.containerPort ?? raw.container_port ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export interface UpdateGroupServiceInput {
  source?: string | null;
  repoUrl?: string | null;
  branch?: string | null;
  dockerfilePath?: string | null;
  dockerTarget?: string | null;
  buildContext?: string | null;
  buildMethod?: string | null;
  imageUrl?: string | null;
  imageCmd?: string | string[] | null;
  containerPort?: number | null;
}

export async function listGroupServices(
  groupId: string,
  options: { includeArchived?: boolean } = {},
): Promise<GroupService[]> {
  // P2 returns either a bare array or a `{ services }` envelope depending
  // on the route's serializer. Accept both shapes to stay forward-compat.
  const query = options.includeArchived ? '?include_archived=true' : '';
  const data = await apiGet<BackendGroupService[] | { services: BackendGroupService[] }>(
    `/api/projects/${groupId}/services${query}`,
  );
  const services = Array.isArray(data) ? data : (data.services ?? []);
  return services.map(normalizeGroupService);
}

export async function getGroupService(groupId: string, serviceId: string): Promise<GroupService> {
  const data = await apiGet<{ service?: BackendGroupService | null }>(
    `/api/projects/${groupId}/services/${serviceId}`,
  );
  if (!data.service) {
    throw new Error('Service not found');
  }
  return normalizeGroupService(data.service);
}

export async function updateGroupService(
  groupId: string,
  serviceId: string,
  input: UpdateGroupServiceInput,
): Promise<GroupService> {
  const data = await apiPatch<{ service: BackendGroupService }>(
    `/api/projects/${groupId}/services/${serviceId}`,
    input,
  );
  return normalizeGroupService(data.service);
}

export interface DeleteGroupServiceResult {
  status: 'deleted';
  project: string;
  service: string;
  serviceId: string;
  containerRemoved: boolean;
  removedDomains: string[];
  volumes: {
    deleted: string[];
    preserved: boolean;
    skippedReason: string | null;
  };
}

export async function deleteGroupService(
  groupId: string,
  serviceId: string,
  input: { confirmation: string; deleteVolumes?: boolean },
): Promise<DeleteGroupServiceResult> {
  const res = await fetchWithAuth(`/api/projects/${groupId}/services/${serviceId}/instance`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const error = await res.text().catch(() => '');
    throw new Error(error || 'Failed to delete service');
  }
  return res.json();
}

export interface ArchiveGroupServiceResult {
  project: string;
  service: string;
  runtimeProject: Record<string, unknown> | null;
}

export function archiveGroupService(
  groupId: string,
  serviceId: string,
): Promise<ArchiveGroupServiceResult> {
  return apiPost<ArchiveGroupServiceResult>(
    `/api/projects/${groupId}/services/${serviceId}/archive`,
  );
}

export function unarchiveGroupService(
  groupId: string,
  serviceId: string,
): Promise<ArchiveGroupServiceResult> {
  return apiPost<ArchiveGroupServiceResult>(
    `/api/projects/${groupId}/services/${serviceId}/unarchive`,
  );
}

export async function getServiceTemplates(): Promise<ServiceTemplate[]> {
  return apiGet<ServiceTemplate[]>('/api/services/templates');
}

export async function createService(opts: {
  name: string;
  project_id?: string;
  target_project_id?: string;
  project_name?: string;
  template?: string;
  version?: string;
  image?: string;
  port?: number;
  env_vars?: Array<{ key: string; value: string }>;
}): Promise<Service> {
  const res = await fetchWithAuth('/api/services', {
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
  return apiDelete(`/api/services/${id}`);
}

export async function startService(id: string): Promise<void> {
  return apiPostVoid(`/api/services/${id}/start`);
}

export async function stopService(id: string): Promise<void> {
  return apiPostVoid(`/api/services/${id}/stop`);
}

export interface ServiceStats {
  status: 'running' | 'stopped' | 'error';
  diskUsageBytes: number | null;
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  activeConnections: number | null;
  maxConnections: number | null;
}

export interface ConnectedProject {
  id: string;
  name: string;
}

export async function getServiceStats(id: string): Promise<ServiceStats> {
  return apiGet<ServiceStats>(`/api/services/${id}/stats`);
}

export async function getConnectedProjects(id: string): Promise<ConnectedProject[]> {
  return apiGet<ConnectedProject[]>(`/api/services/${id}/connected-projects`);
}

export async function getServiceLogs(id: string, lines: number = 100): Promise<string> {
  const res = await fetchWithAuth(`/api/services/${id}/logs?lines=${lines}`);
  if (!res.ok) throw new Error('Failed to fetch service logs');
  const data = await res.json();
  return data.logs;
}

export interface ServiceDatabase {
  name: string;
  sizeBytes: number | null;
}

export interface ServiceUser {
  name: string;
}

export async function getServiceDatabases(id: string): Promise<ServiceDatabase[]> {
  const res = await fetchWithAuth(`/api/services/${id}/databases`);
  if (!res.ok) throw new Error('Failed to fetch service databases');
  const data = await res.json();
  return data.databases;
}

export async function createServiceDatabase(
  id: string,
  name: string,
): Promise<{ connectionString: string }> {
  return apiPost<{ connectionString: string }>(`/api/services/${id}/databases`, { name });
}

export async function getServiceUsers(id: string): Promise<ServiceUser[]> {
  const res = await fetchWithAuth(`/api/services/${id}/users`);
  if (!res.ok) throw new Error('Failed to fetch service users');
  const data = await res.json();
  return data.users;
}

export async function createServiceUser(
  id: string,
  username: string,
  password?: string,
  database?: string,
): Promise<{ connectionString: string }> {
  return apiPost<{ connectionString: string }>(`/api/services/${id}/users`, {
    username,
    password,
    database,
  });
}

// ─── PR6: Round 4 health + metrics endpoints ──────────────────────────────

export type MetricsRange = '15m' | '1h' | '6h' | '24h' | '7d';

export interface ServiceMetrics {
  /** Per-datapoint CPU percent (60 datapoints over the requested range) */
  cpu: number[];
  /** Per-datapoint memory in MB */
  memory: number[];
  /** Per-datapoint requests-per-second */
  requestsPerSec: number[];
  /** Per-datapoint error rate as a percent (e.g. 0.4 means 0.4%) */
  errorRate: number[];
  /** Aggregate p95 latency in milliseconds for the requested range */
  p95LatencyMs: number;
  /** Aggregate total request count for the requested range */
  totalRequests: number;
}

export async function fetchServiceHealth(id: string): Promise<ServiceHealth> {
  const data = await apiGet<{ health: ServiceHealth }>(`/api/services/${id}/health`);
  return data.health;
}

/**
 * Fetches metrics. Returns null when the backend responds 204 No Content
 * (service has no history yet — Principle 4: no synthetic fallback in the
 * fetch layer; the consumer decides how to render the empty state).
 */
export async function fetchServiceMetrics(
  id: string,
  range: MetricsRange = '1h',
): Promise<ServiceMetrics | null> {
  const { fetchWithAuth } = await import('./auth');
  const res = await fetchWithAuth(`/api/services/${id}/metrics?range=${range}`);
  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `GET /api/services/${id}/metrics failed (${res.status})`);
  }
  return res.json() as Promise<ServiceMetrics>;
}
