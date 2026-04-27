import type { ServiceHealth } from '../projectTopology';
import { apiGet, apiPost, apiPostVoid, apiDelete } from './client';

export interface ServiceTemplate {
  id: string;
  name: string;
  image: string;
  port: number;
  versions?: string[];
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
  summary?: {
    healthStatus: string | null;
    uptimeSeconds: number | null;
    restartCount: number | null;
  };
}

export async function getServices(): Promise<Service[]> {
  return apiGet<Service[]>('/api/services');
}

export async function getService(id: string): Promise<Service> {
  return apiGet<Service>(`/api/services/${id}`);
}

export async function getServiceTemplates(): Promise<ServiceTemplate[]> {
  return apiGet<ServiceTemplate[]>('/api/services/templates');
}

export async function createService(opts: {
  name: string;
  template?: string;
  version?: string;
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
  const res = await fetch(`/api/services/${id}/logs?lines=${lines}`);
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
  const res = await fetch(`/api/services/${id}/databases`);
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
  const res = await fetch(`/api/services/${id}/users`);
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

export async function fetchServiceMetrics(
  id: string,
  range: MetricsRange = '1h',
): Promise<ServiceMetrics> {
  return apiGet<ServiceMetrics>(`/api/services/${id}/metrics?range=${range}`);
}
