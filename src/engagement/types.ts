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

export interface EngagementBlockerMetadataByKind {
  project_error: {
    runtime_status: 'error';
    error_service_count: number;
  };
  revision_requested: {
    delivery_status: 'revision_requested';
  };
  required_gate_failed: {
    gate_key: string;
    gate_label: string;
    gate_summary: string | null;
    gate_required: true;
    gate_status: 'failed';
  };
  warning_unacknowledged: {
    gate_key: string;
    gate_label: string;
    gate_summary: string | null;
    gate_required: boolean;
    gate_status: 'warning';
    warning_accepted: false;
  };
  work_item_unresolved: {
    work_item_kind: 'question' | 'change_request';
    work_item_status: 'confirmed';
    work_item_title: string;
    work_item_detail: string;
  };
}

export type EngagementBlockerMetadata = EngagementBlockerMetadataByKind[EngagementBlockerKind];

export type EngagementSystemEventType =
  | 'engagement:created'
  | 'engagement:updated'
  | 'engagement:archived'
  | 'engagement:unarchived'
  | 'engagement:project_linked'
  | 'engagement:project_unlinked';

export interface EngagementActivityMetadata extends Record<string, unknown> {
  schema_version: 1;
  engagement_id: string;
  actor?: string;
  engagement_title?: string;
  previous_engagement_title?: string;
  customer_name?: string;
  engagement_status?: EngagementStatus;
  previous_status?: EngagementStatus;
  changed_fields?: string[];
  project_id?: string;
  project_name?: string;
  delivery_id?: string;
  linked_projects_changed?: boolean;
  deliveries_changed?: boolean;
}

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

interface EngagementBlockerBase {
  project_id: string;
  project_name: string;
  delivery_id: string | null;
  delivery_title: string | null;
  resource_id: string;
  title: string;
  detail: string;
  deep_link: string;
}

export type EngagementBlocker = {
  [Kind in EngagementBlockerKind]: EngagementBlockerBase & {
    kind: Kind;
    /** Structured display arguments. `title` and `detail` remain as legacy fallbacks. */
    metadata: EngagementBlockerMetadataByKind[Kind];
  };
}[EngagementBlockerKind];

export interface EngagementActivity {
  id: string;
  event_type: string;
  severity: string;
  project_id: string;
  correlation_id: string | null;
  title: string;
  description: string;
  status: string;
  /** Locale-neutral display arguments keyed by `event_type`. */
  metadata: EngagementActivityMetadata;
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
