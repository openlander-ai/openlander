import { apiDelete, apiGet, apiPatch, apiPost } from './client';
import type { DeliveryMaturity, DeliveryStatus, DeliveryType } from './deliveries';

export type EngagementStatus = 'active' | 'on_hold' | 'completed' | 'archived';
export type EngagementRuntimeHealth = 'healthy' | 'degraded' | 'unknown';
export type EngagementProjectRuntimeStatus = 'running' | 'stopped' | 'error' | 'unknown';
export type EngagementBlockerKind =
  | 'project_error'
  | 'revision_requested'
  | 'required_gate_failed'
  | 'warning_unacknowledged'
  | 'work_item_unresolved';

export interface EngagementDeliverySummary {
  total: number;
  blocker_count: number;
  by_status: Record<DeliveryStatus, number>;
}

export interface EngagementSummary {
  id: string;
  customer_name: string;
  title: string;
  summary: string;
  status: EngagementStatus;
  runtime_health: EngagementRuntimeHealth;
  project_count: number;
  active_project_count: number;
  delivery_summary: EngagementDeliverySummary;
  blocker_count: number;
  recent_activity_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface EngagementProject {
  id: string;
  name: string;
  display_name: string;
  archived_at: string | null;
  runtime_status: EngagementProjectRuntimeStatus;
  delivery_count: number;
  blocker_count: number;
  linked_at: string;
}

export interface EngagementDelivery {
  id: string;
  project_id: string;
  title: string;
  delivery_type: DeliveryType;
  maturity: DeliveryMaturity;
  status: DeliveryStatus;
  blocker_count: number;
  updated_at: string;
}

export interface EngagementBlocker {
  kind: EngagementBlockerKind;
  project_id: string;
  project_name: string;
  delivery_id: string | null;
  delivery_title: string | null;
  resource_id: string;
  title: string;
  detail: string;
  deep_link: string;
}

export interface EngagementActivity {
  id: string;
  event_type: string;
  severity: string;
  project_id: string;
  correlation_id: string | null;
  title: string;
  description: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  deep_link: string | null;
}

export interface EngagementDetail extends EngagementSummary {
  projects: EngagementProject[];
  deliveries: EngagementDelivery[];
  blockers: EngagementBlocker[];
  recent_activity: EngagementActivity[];
}

export interface ProjectEngagementReference {
  id: string;
  customer_name: string;
  title: string;
  status: EngagementStatus;
}

export interface UnassignedEngagementProject {
  id: string;
  name: string;
  display_name: string;
  archived_at: string | null;
}

export async function listEngagements(options?: {
  includeArchived?: boolean;
  status?: EngagementStatus;
}): Promise<EngagementSummary[]> {
  const query = new URLSearchParams();
  if (options?.includeArchived) query.set('include_archived', 'true');
  if (options?.status) query.set('status', options.status);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const response = await apiGet<{ engagements: EngagementSummary[] }>(`/api/engagements${suffix}`);
  return response.engagements;
}

export function getEngagement(id: string): Promise<EngagementDetail> {
  return apiGet(`/api/engagements/${encodeURIComponent(id)}`);
}

export function createEngagement(input: {
  customer_name: string;
  title: string;
  summary?: string;
  status?: Exclude<EngagementStatus, 'archived'>;
}): Promise<EngagementDetail> {
  return apiPost('/api/engagements', input);
}

export function updateEngagement(
  id: string,
  input: {
    customer_name?: string;
    title?: string;
    summary?: string;
    status?: Exclude<EngagementStatus, 'archived'>;
  },
): Promise<EngagementDetail> {
  return apiPatch(`/api/engagements/${encodeURIComponent(id)}`, input);
}

export function archiveEngagement(id: string): Promise<EngagementDetail> {
  return apiPost(`/api/engagements/${encodeURIComponent(id)}/archive`);
}

export function unarchiveEngagement(id: string): Promise<EngagementDetail> {
  return apiPost(`/api/engagements/${encodeURIComponent(id)}/unarchive`);
}

export function linkEngagementProject(id: string, projectId: string): Promise<EngagementDetail> {
  return apiPost(`/api/engagements/${encodeURIComponent(id)}/projects`, {
    project_id: projectId,
  });
}

export async function unlinkEngagementProject(id: string, projectId: string): Promise<void> {
  await apiDelete(
    `/api/engagements/${encodeURIComponent(id)}/projects/${encodeURIComponent(projectId)}`,
  );
}

export async function listUnassignedEngagementProjects(): Promise<UnassignedEngagementProject[]> {
  const response = await apiGet<{ projects: UnassignedEngagementProject[] }>(
    '/api/engagements/unassigned-projects',
  );
  return response.projects;
}

export async function getProjectEngagement(
  projectId: string,
): Promise<ProjectEngagementReference | null> {
  const response = await apiGet<{ engagement: ProjectEngagementReference | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/engagement`,
  );
  return response.engagement;
}
