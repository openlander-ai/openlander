import type {
  ArtifactBlobRow,
  DeliveryApprovalRow,
  DeliveryArtifactRow,
  DeliveryDeployLinkRow,
  DeliveryExternalRefRow,
  DeliveryFeedbackSourceRow,
  DeliveryGateRow,
  DeliveryReceiptRow,
  DeliveryRow,
  DeliveryWorkItemRow,
  DeployLogTableRow,
  EnvironmentTableRow,
  ProjectDeliverySettingsRow,
  ServiceTableRow,
} from '../db/schema.drizzle.js';

export type DeliveryType = DeliveryRow['delivery_type'];
export type DeliveryStatus = DeliveryRow['status'];
export type DeliveryMaturity = DeliveryRow['maturity'];
export type DeliveryArtifactKind = DeliveryArtifactRow['kind'];
export type ArtifactStatus = DeliveryArtifactRow['status'];
export type WorkItemKind = DeliveryWorkItemRow['kind'];
export type WorkItemStatus = DeliveryWorkItemRow['status'];
export type GateType = DeliveryGateRow['gate_type'];
export type GateStatus = DeliveryGateRow['status'];
export type DeliveryExternalProvider = DeliveryExternalRefRow['provider'];
export type FeedbackSourceType = DeliveryFeedbackSourceRow['source_type'];

export interface DeliveryArtifactWithBlob extends DeliveryArtifactRow {
  blob: ArtifactBlobRow;
}

export interface DeliveryDeployEvidence {
  link: DeliveryDeployLinkRow;
  deploy: DeployLogTableRow;
  service: ServiceTableRow;
  environment: EnvironmentTableRow | null;
}

export interface DeliveryDetail {
  delivery: DeliveryRow;
  settings: ProjectDeliverySettingsRow;
  artifacts: DeliveryArtifactWithBlob[];
  external_refs: DeliveryExternalRefRow[];
  feedback_sources: DeliveryFeedbackSourceRow[];
  work_items: DeliveryWorkItemRow[];
  approvals: DeliveryApprovalRow[];
  gates: DeliveryGateRow[];
  deploy_links: DeliveryDeployEvidence[];
  receipt: DeliveryReceiptRow | null;
}

export interface DeliveryReadinessCheck {
  key:
    | 'delivery_approved'
    | 'approved_artifact'
    | 'customer_approval'
    | 'work_items_resolved'
    | 'required_gates'
    | 'warnings_acknowledged'
    | 'limitations_recorded'
    | 'html_companion_pdf'
    | 'production_deploy'
    | 'page_limit';
  passed: boolean;
  message: string;
}

export interface DeliveryReadiness {
  ready: boolean;
  checks: DeliveryReadinessCheck[];
  blockers: string[];
  estimated_pages: number;
}

export interface ReceiptSnapshot {
  schema_version: 1;
  generated_at: string;
  project: {
    id: string;
    name: string;
    display_name: string;
  };
  detail: Omit<DeliveryDetail, 'deploy_links'> & {
    deploy_links: Array<{
      link: DeliveryDeployLinkRow;
      deploy: Pick<
        DeployLogTableRow,
        | 'id'
        | 'service_id'
        | 'environment_id'
        | 'status'
        | 'commit_sha'
        | 'commit_message'
        | 'duration_ms'
        | 'created_at'
      >;
      service: Pick<ServiceTableRow, 'id' | 'project_id' | 'name' | 'kind'>;
      environment: Pick<
        EnvironmentTableRow,
        | 'id'
        | 'service_id'
        | 'type'
        | 'branch'
        | 'status'
        | 'image_tag'
        | 'public_url'
        | 'created_at'
        | 'updated_at'
      > | null;
    }>;
  };
  readiness: DeliveryReadiness;
}

export interface DeliveryGateTemplate {
  gate_key: string;
  gate_type: GateType;
  label: string;
  required: boolean;
}

export const DEFAULT_DELIVERY_GATES: Record<DeliveryType, DeliveryGateTemplate[]> = {
  software_release: [
    { gate_key: 'review', gate_type: 'review', label: 'Review', required: true },
    { gate_key: 'qa', gate_type: 'qa', label: 'QA', required: true },
    { gate_key: 'data', gate_type: 'data', label: 'Data', required: false },
  ],
  artifact_delivery: [
    { gate_key: 'review', gate_type: 'review', label: 'Review', required: true },
    { gate_key: 'qa', gate_type: 'qa', label: 'QA', required: false },
    { gate_key: 'data', gate_type: 'data', label: 'Data', required: false },
  ],
};

const DELIVERY_TYPES: readonly DeliveryType[] = ['software_release', 'artifact_delivery'];
const GATE_TYPES: readonly GateType[] = ['review', 'qa', 'data', 'custom'];

export function parseDefaultDeliveryGates(
  value: unknown,
): Record<DeliveryType, DeliveryGateTemplate[]> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result = {} as Record<DeliveryType, DeliveryGateTemplate[]>;
  for (const deliveryType of DELIVERY_TYPES) {
    const configured = record[deliveryType];
    if (configured === undefined) {
      result[deliveryType] = DEFAULT_DELIVERY_GATES[deliveryType].map((gate) => ({ ...gate }));
      continue;
    }
    if (!Array.isArray(configured) || configured.length < 1 || configured.length > 20) return null;
    const keys = new Set<string>();
    const gates: DeliveryGateTemplate[] = [];
    for (const candidate of configured) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
      const gate = candidate as Record<string, unknown>;
      if (
        typeof gate['gate_key'] !== 'string' ||
        !gate['gate_key'].trim() ||
        typeof gate['gate_type'] !== 'string' ||
        !GATE_TYPES.includes(gate['gate_type'] as GateType) ||
        typeof gate['label'] !== 'string' ||
        !gate['label'].trim() ||
        typeof gate['required'] !== 'boolean'
      ) {
        return null;
      }
      const key = gate['gate_key'].trim();
      if (keys.has(key)) return null;
      keys.add(key);
      gates.push({
        gate_key: key,
        gate_type: gate['gate_type'] as GateType,
        label: gate['label'].trim(),
        required: gate['required'],
      });
    }
    result[deliveryType] = gates;
  }
  return result;
}

export const DELIVERY_TRANSITIONS: Readonly<Record<DeliveryStatus, readonly DeliveryStatus[]>> = {
  draft: ['in_review', 'cancelled'],
  in_review: ['revision_requested', 'approved', 'cancelled'],
  revision_requested: ['in_review', 'cancelled'],
  approved: ['in_review', 'ready', 'cancelled'],
  ready: ['approved', 'in_review', 'delivered'],
  delivered: [],
  cancelled: [],
};

export const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024;
export const MAX_RECEIPT_PAGES = 250;
