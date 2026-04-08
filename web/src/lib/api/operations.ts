import { fetchWithAuth } from './auth.js';

export interface OpsConfig {
  enabled: boolean;
  recovery: {
    enabled: boolean;
    automation: Record<string, string>;
  };
  auto_cleanup: boolean;
  drift_detection: boolean;
  thresholds: {
    disk_cleanup_percent: number;
    recovery_max_per_day: number;
    alert_dedup_minutes: number;
    digest_time: string;
  };
  channels: {
    email?: {
      host: string;
      port: number;
      secure: boolean;
      auth: { user: string; pass: string };
      from: string;
      to: string[];
    };
  };
}

export async function fetchOpsConfig(): Promise<{ config: OpsConfig }> {
  const res = await fetchWithAuth('/api/ops/config');
  if (!res.ok) {
    throw new Error('Failed to fetch operations config');
  }
  return res.json();
}

export async function updateOpsConfig(config: Partial<OpsConfig>): Promise<{ config: OpsConfig }> {
  const res = await fetchWithAuth('/api/ops/config', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error('Failed to update operations config');
  }
  return res.json();
}

export async function triggerTestEmail(): Promise<void> {
  const res = await fetchWithAuth('/api/ops/digest/trigger', {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error('Failed to send test email');
  }
}

export interface OpsIncidentEvent {
  id: string;
  incident_id: string;
  type: string;
  event_type?: string;
  message: string | null;
  description?: string;
  metadata?: string | null;
  created_at: string | number;
}

export interface OpsIncident {
  id: string;
  project_id: string;
  title?: string;
  status: string;
  severity: string;
  root_cause?: string | null;
  diagnosis?: string | null;
  actions_taken?: string | null;
  created_at: string | number;
  updated_at?: string | number;
  resolved_at?: string | number | null;
  escalated_at?: string | number | null;
  events?: OpsIncidentEvent[];
  triggerType?: string;
  trigger_type?: string;
  triggerDetails?: string;
  trigger_details?: string;
  project?: {
    name: string;
  };
}

export interface CircuitBreakerState {
  state: string;
  failure_count?: number;
  last_failure_at?: string;
  next_retry_at?: string;
}

export async function fetchOpsIncidents(
  projectId?: string,
  status?: string,
): Promise<{ incidents: OpsIncident[] }> {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (status) params.set('status', status);
  const response = await fetchWithAuth(`/api/ops/incidents?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to fetch incidents');
  return response.json();
}

export async function fetchOpsIncident(
  id: string,
): Promise<{ incident: OpsIncident; events: OpsIncidentEvent[] }> {
  const response = await fetchWithAuth(`/api/ops/incidents/${id}`);
  if (!response.ok) throw new Error('Failed to fetch incident');
  return response.json();
}

export async function fetchCircuitBreakerState(projectId: string): Promise<CircuitBreakerState> {
  const response = await fetchWithAuth(`/api/ops/circuit-breaker/${projectId}`);
  if (!response.ok) throw new Error('Failed to fetch circuit breaker state');
  const data = (await response.json()) as {
    state: (CircuitBreakerState & { project_id?: string }) | null;
  };
  return data.state ?? { state: 'closed' };
}

export async function resetCircuitBreaker(projectId: string): Promise<{ reset: boolean }> {
  const response = await fetchWithAuth(`/api/ops/circuit-breaker/${projectId}/reset`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to reset circuit breaker');
  return response.json() as Promise<{ reset: boolean }>;
}

export async function fetchIncidentEvents(
  incidentId: string,
): Promise<{ events: OpsIncidentEvent[] }> {
  const response = await fetchWithAuth(`/api/ops/incidents/${incidentId}/events`);
  if (!response.ok) return { events: [] };
  return response.json() as Promise<{ events: OpsIncidentEvent[] }>;
}

// === Operations Center types ===

export interface ActivityItem {
  id: string;
  timestamp: string;
  type:
    | 'incident'
    | 'recovery'
    | 'approval'
    | 'circuit_breaker'
    | 'cleanup'
    | 'alert'
    | 'ai_diagnosis'
    | 'ai:invoked'
    | 'ai:completed'
    | 'recovery:blocked'
    | 'recovery:stopped'
    | 'recovery:started';
  severity: 'critical' | 'warning' | 'info';
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  status:
    | 'active'
    | 'resolved'
    | 'pending'
    | 'failed'
    | 'ai-running'
    | 'ai-completed'
    | 'recovery-blocked'
    | 'recovery-stopped'
    | 'recovering';
  incidentId?: string;
  actionRunId?: string;
  correlationId?: string;
  cascadeGroup?: string[];
  rawType?: string;
  detail?: string;
  aiMetadata?: {
    model: string;
    tokensUsed?: number;
    durationMs?: number;
    diagnosisSummary?: string;
  };
}

export interface CircuitBreakerWithProject {
  projectId: string;
  projectName: string;
  state: 'closed' | 'open' | 'half_open';
  failureCount: number;
  lastFailureAt: number | null;
  openedAt: number | null;
  resetAt: number | null;
}

export interface DependencyNode {
  id: string;
  type: 'project' | 'service';
  name: string;
  status: string | null;
}

export interface DependencyEdge {
  source: string;
  target: string;
  dependencyType: string;
}

export async function fetchActivityFeed(opts?: {
  projectId?: string;
  types?: string[];
  severity?: string;
  limit?: number;
  before?: string;
}): Promise<{ activities: ActivityItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (opts?.projectId) params.set('projectId', opts.projectId);
  if (opts?.types?.length) params.set('types', opts.types.join(','));
  if (opts?.severity) params.set('severity', opts.severity);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);
  const query = params.toString() ? `?${params.toString()}` : '';
  const resp = await fetchWithAuth(`/api/ops/activity${query}`);
  if (!resp.ok) throw new Error(`fetchActivityFeed failed: ${resp.status}`);
  return resp.json() as Promise<{ activities: ActivityItem[]; nextCursor: string | null }>;
}

export async function fetchAllCircuitBreakers(): Promise<{
  breakers: CircuitBreakerWithProject[];
}> {
  const resp = await fetchWithAuth('/api/ops/circuit-breakers');
  if (!resp.ok) throw new Error(`fetchAllCircuitBreakers failed: ${resp.status}`);
  return resp.json() as Promise<{ breakers: CircuitBreakerWithProject[] }>;
}

export async function fetchDependencyGraph(): Promise<{
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}> {
  const resp = await fetchWithAuth('/api/ops/dependencies');
  if (!resp.ok) throw new Error(`fetchDependencyGraph failed: ${resp.status}`);
  return resp.json() as Promise<{ nodes: DependencyNode[]; edges: DependencyEdge[] }>;
}
