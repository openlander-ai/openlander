import { apiGet, apiPost, apiPostVoid, apiPut } from './client';

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
  return apiGet<{ config: OpsConfig }>('/api/ops/config');
}

export async function updateOpsConfig(config: Partial<OpsConfig>): Promise<{ config: OpsConfig }> {
  return apiPut<{ config: OpsConfig }>('/api/ops/config', config);
}

export async function triggerTestEmail(): Promise<void> {
  return apiPostVoid('/api/ops/digest/trigger');
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
  projectName?: string;
  title: string;
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
  triggerDetails?: string;
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
  search?: string,
  from?: number,
  to?: number,
): Promise<{ incidents: OpsIncident[] }> {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  if (from !== undefined) params.set('from', String(from));
  if (to !== undefined) params.set('to', String(to));
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiGet<{ incidents: OpsIncident[] }>(`/api/ops/incidents${query}`);
}

export async function fetchOpsIncident(
  id: string,
): Promise<{ incident: OpsIncident; events: OpsIncidentEvent[] }> {
  return apiGet<{ incident: OpsIncident; events: OpsIncidentEvent[] }>(`/api/ops/incidents/${id}`);
}

export async function fetchCircuitBreakerState(projectId: string): Promise<CircuitBreakerState> {
  const data = await apiGet<{
    state: (CircuitBreakerState & { project_id?: string }) | null;
  }>(`/api/ops/circuit-breaker/${projectId}`);
  return data.state ?? { state: 'closed' };
}

export async function resetCircuitBreaker(projectId: string): Promise<{ reset: boolean }> {
  return apiPost<{ reset: boolean }>(`/api/ops/circuit-breaker/${projectId}/reset`);
}

export async function fetchIncidentEvents(
  incidentId: string,
): Promise<{ events: OpsIncidentEvent[] }> {
  try {
    return await apiGet<{ events: OpsIncidentEvent[] }>(`/api/ops/incidents/${incidentId}/events`);
  } catch {
    return { events: [] };
  }
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
  triggerType?: string;
  triggerDetails?: string;
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
  from?: number;
  to?: number;
}): Promise<{ activities: ActivityItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (opts?.projectId) params.set('projectId', opts.projectId);
  if (opts?.types?.length) params.set('types', opts.types.join(','));
  if (opts?.severity) params.set('severity', opts.severity);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);
  if (opts?.from !== undefined) params.set('from', String(opts.from));
  if (opts?.to !== undefined) params.set('to', String(opts.to));
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiGet<{ activities: ActivityItem[]; nextCursor: string | null }>(
    `/api/ops/activity${query}`,
  );
}

export async function fetchAllCircuitBreakers(): Promise<{
  breakers: CircuitBreakerWithProject[];
}> {
  return apiGet<{ breakers: CircuitBreakerWithProject[] }>('/api/ops/circuit-breakers');
}

export async function fetchDependencyGraph(): Promise<{
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}> {
  return apiGet<{ nodes: DependencyNode[]; edges: DependencyEdge[] }>('/api/ops/dependencies');
}

// === Automation Policy types ===

export type AutomationStep = 'restart' | 'diagnosis' | 'apply_fixes' | 'rollback';
export type AutomationMode = 'auto' | 'confirm';
export type AutomationPolicy = Record<AutomationStep, AutomationMode>;

export interface AutomationDefaultsResponse {
  defaults: AutomationPolicy;
  effective: AutomationPolicy | null;
  isAutopilot: boolean;
}

export interface ProjectAutomationResponse {
  effective: AutomationPolicy | null;
  overrides: Partial<AutomationPolicy> | null;
  isAutopilot: boolean;
}

export async function fetchAutomationDefaults(): Promise<AutomationDefaultsResponse> {
  return apiGet<AutomationDefaultsResponse>('/api/ops/automation/defaults');
}

export async function fetchProjectAutomation(
  projectId: string,
): Promise<ProjectAutomationResponse> {
  return apiGet<ProjectAutomationResponse>(`/api/ops/projects/${projectId}/automation`);
}

export async function updateProjectAutomation(
  projectId: string,
  automation: Partial<AutomationPolicy>,
): Promise<ProjectAutomationResponse> {
  return apiPut<ProjectAutomationResponse>(`/api/ops/projects/${projectId}/automation`, {
    automation,
  });
}

export interface PostmortemEntry {
  id: string;
  project_id: string;
  project_name: string;
  content: string;
  created_at: string;
}

export async function fetchPostmortems(
  projectId?: string,
): Promise<{ postmortems: PostmortemEntry[]; total: number }> {
  const url = projectId ? `/api/ops/postmortems/${projectId}` : '/api/ops/postmortems';
  return apiGet(url);
}
