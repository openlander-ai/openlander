import type { DeliveryMaturity, DeliveryStatus, DeliveryType } from '../delivery/types.js';

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

export interface EngagementProjectSummary {
  id: string;
  name: string;
  display_name: string;
  archived_at: string | null;
  runtime_status: EngagementProjectRuntimeStatus;
  delivery_count: number;
  blocker_count: number;
  linked_at: string;
}

export interface EngagementDeliveryView {
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

export interface EngagementDetail extends EngagementSummary {
  projects: EngagementProjectSummary[];
  deliveries: EngagementDeliveryView[];
  blockers: EngagementBlocker[];
  recent_activity: EngagementActivity[];
}

export interface ProjectEngagementReference {
  id: string;
  customer_name: string;
  title: string;
  status: EngagementStatus;
}
