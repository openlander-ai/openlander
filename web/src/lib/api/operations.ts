import { fetchWithAuth } from './auth.js';

export interface OpsConfig {
  enabled: boolean;
  auto_restart: boolean;
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
  message: string | null;
  created_at: string;
}

export interface OpsIncident {
  id: string;
  project_id: string;
  title: string;
  status: string;
  severity: string;
  created_at: string;
  updated_at: string;
  events?: OpsIncidentEvent[];
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
  return response.json();
}
