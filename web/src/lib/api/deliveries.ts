import { fetchWithAuth } from './auth';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, throwApiError } from './client';

export type DeliveryType = 'software_release' | 'artifact_delivery';
export type DeliveryStatus =
  'draft' | 'in_review' | 'revision_requested' | 'approved' | 'ready' | 'delivered' | 'cancelled';
export type DeliveryMaturity =
  'concept' | 'functional_preview' | 'customer_review' | 'release_candidate' | 'production';
export type GateStatus = 'pending' | 'passed' | 'warning' | 'failed' | 'waived';

export interface Delivery {
  id: string;
  project_id: string;
  title: string;
  summary: string;
  delivery_type: DeliveryType;
  maturity: DeliveryMaturity;
  status: DeliveryStatus;
  evidence_version: number;
  previewed_evidence_version: number | null;
  limitations: string | null;
  predecessor_delivery_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface DeliveryArtifact {
  id: string;
  delivery_id: string;
  blob_id: string;
  logical_key: string;
  revision: number;
  kind:
    'review_html' | 'companion_pdf' | 'markdown' | 'qa_report' | 'data_report' | 'image' | 'other';
  original_filename: string;
  status: 'draft' | 'approved' | 'superseded';
  companion_pdf_artifact_id: string | null;
  include_in_receipt: boolean;
  receipt_order: number;
  blob: {
    id: string;
    sha256: string;
    mime_type: string;
    size_bytes: number;
    storage_key: string;
  };
}

export interface DeliveryFeedbackSource {
  id: string;
  source_type: 'slack' | 'teams' | 'email' | 'meeting' | 'other';
  source_url: string | null;
  author_display_name: string | null;
  raw_text: string;
  occurred_at: string | null;
  created_at: string;
}

export interface DeliveryWorkItem {
  id: string;
  kind: 'decision' | 'change_request' | 'question' | 'note';
  title: string;
  detail: string;
  status: 'proposed' | 'confirmed' | 'rejected' | 'resolved' | 'superseded';
  is_ai_draft: boolean;
  resolution: string | null;
}

export interface DeliveryApproval {
  id: string;
  artifact_ids: string[];
  approver_display_name: string;
  approval_excerpt: string;
  source_type: string;
  source_url: string | null;
  approved_at: string;
  invalidated_at: string | null;
}

export interface DeliveryGate {
  id: string;
  gate_key: string;
  gate_type: 'review' | 'qa' | 'data' | 'custom';
  label: string;
  required: boolean;
  status: GateStatus;
  summary: string | null;
  waiver_reason: string | null;
  warning_accepted: boolean;
  report_artifact_id: string | null;
}

export interface DeliveryDeployEvidence {
  link: {
    id: string;
    deploy_id: string;
    relation: 'candidate' | 'released' | 'rollback';
  };
  deploy: {
    id: string;
    status: 'success' | 'failed' | 'cancelled' | null;
    commit_sha: string | null;
    created_at: string | null;
  };
  service: { id: string; name: string };
  environment: { id: string; type: 'production' | 'development' } | null;
}

export interface DeliveryReceipt {
  id: string;
  revision: number;
  pdf_sha256: string;
  finalized_by: string;
  finalized_at: string;
}

export interface DeliverySettings {
  project_id: string;
  organization_name: string | null;
  document_name: string;
  primary_color: string;
  logo_blob_id: string | null;
  footer_text: string | null;
  locale: 'ko' | 'en';
  default_gates_json: Record<string, unknown>;
}

export interface DeliveryDetail {
  delivery: Delivery;
  settings: DeliverySettings;
  artifacts: DeliveryArtifact[];
  external_refs: Array<{
    id: string;
    provider: 'slack' | 'teams' | 'email' | 'drive' | 'github' | 'other';
    label: string;
    url: string;
  }>;
  feedback_sources: DeliveryFeedbackSource[];
  work_items: DeliveryWorkItem[];
  approvals: DeliveryApproval[];
  gates: DeliveryGate[];
  deploy_links: DeliveryDeployEvidence[];
  receipt: DeliveryReceipt | null;
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
  params?: Record<string, number>;
}

export interface DeliveryReadiness {
  ready: boolean;
  checks: DeliveryReadinessCheck[];
  blockers: string[];
  estimated_pages: number;
}

function base(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/deliveries`;
}

async function blobRequest(url: string, method: 'GET' | 'POST'): Promise<Blob> {
  const response = await fetchWithAuth(url, { method });
  if (!response.ok) await throwApiError(response, 'Delivery document request failed');
  return await response.blob();
}

export async function listDeliveries(projectId: string): Promise<Delivery[]> {
  const response = await apiGet<{ deliveries: Delivery[] }>(base(projectId));
  return response.deliveries;
}

export function createDelivery(
  projectId: string,
  input: {
    title: string;
    summary?: string;
    delivery_type?: DeliveryType;
    maturity?: DeliveryMaturity;
    limitations?: string | null;
    predecessor_delivery_id?: string | null;
  },
): Promise<Delivery> {
  return apiPost<Delivery>(base(projectId), input);
}

export function getDelivery(projectId: string, deliveryId: string): Promise<DeliveryDetail> {
  return apiGet<DeliveryDetail>(`${base(projectId)}/${encodeURIComponent(deliveryId)}`);
}

export function updateDelivery(
  projectId: string,
  deliveryId: string,
  input: Partial<{
    title: string;
    summary: string;
    delivery_type: DeliveryType;
    maturity: DeliveryMaturity;
    limitations: string | null;
  }>,
): Promise<Delivery> {
  return apiPatch<Delivery>(`${base(projectId)}/${encodeURIComponent(deliveryId)}`, input);
}

export function transitionDelivery(
  projectId: string,
  deliveryId: string,
  status: DeliveryStatus,
): Promise<Delivery> {
  return apiPost<Delivery>(`${base(projectId)}/${encodeURIComponent(deliveryId)}/transition`, {
    status,
  });
}

export async function uploadDeliveryArtifact(
  projectId: string,
  deliveryId: string,
  input: {
    file: File;
    logicalKey: string;
    revision: number;
    kind: DeliveryArtifact['kind'];
    includeInReceipt: boolean;
    receiptOrder: number;
    companionForArtifactId?: string;
  },
): Promise<{ artifact: DeliveryArtifact; blob: DeliveryArtifact['blob'] }> {
  const form = new FormData();
  form.append('logical_key', input.logicalKey);
  form.append('revision', String(input.revision));
  form.append('kind', input.kind);
  form.append('include_in_receipt', String(input.includeInReceipt));
  form.append('receipt_order', String(input.receiptOrder));
  if (input.companionForArtifactId) {
    form.append('companion_for_artifact_id', input.companionForArtifactId);
  }
  form.append('file', input.file);
  const response = await fetchWithAuth(
    `${base(projectId)}/${encodeURIComponent(deliveryId)}/artifacts`,
    { method: 'POST', body: form },
  );
  if (!response.ok) await throwApiError(response, 'Artifact upload failed');
  return response.json();
}

export function setDeliveryArtifactStatus(
  projectId: string,
  deliveryId: string,
  artifactId: string,
  status: DeliveryArtifact['status'],
): Promise<DeliveryArtifact> {
  return apiPatch<DeliveryArtifact>(
    `${base(projectId)}/${encodeURIComponent(deliveryId)}/artifacts/${encodeURIComponent(artifactId)}`,
    { status },
  );
}

export function recordDeliveryFeedback(
  projectId: string,
  deliveryId: string,
  input: {
    source_type: DeliveryFeedbackSource['source_type'];
    source_url?: string | null;
    author_display_name?: string | null;
    raw_text: string;
    occurred_at?: string | null;
  },
): Promise<DeliveryFeedbackSource> {
  return apiPost<DeliveryFeedbackSource>(
    `${base(projectId)}/${encodeURIComponent(deliveryId)}/feedback`,
    input,
  );
}

export function attachDeliveryExternalRef(
  projectId: string,
  deliveryId: string,
  input: {
    provider: 'slack' | 'teams' | 'email' | 'drive' | 'github' | 'other';
    label: string;
    url: string;
  },
): Promise<{ id: string; provider: string; label: string; url: string }> {
  return apiPost(`${base(projectId)}/${encodeURIComponent(deliveryId)}/external-refs`, input);
}

export function updateDeliveryWorkItem(
  projectId: string,
  deliveryId: string,
  workItemId: string,
  input: { status: DeliveryWorkItem['status']; resolution?: string | null },
): Promise<DeliveryWorkItem> {
  return apiPatch<DeliveryWorkItem>(
    `${base(projectId)}/${encodeURIComponent(deliveryId)}/work-items/${encodeURIComponent(workItemId)}`,
    input,
  );
}

export function recordDeliveryApproval(
  projectId: string,
  deliveryId: string,
  input: {
    artifact_ids: string[];
    approver_display_name: string;
    approval_excerpt: string;
    source_type: DeliveryFeedbackSource['source_type'];
    source_url?: string | null;
    approved_at: string;
  },
): Promise<DeliveryApproval> {
  return apiPost<DeliveryApproval>(
    `${base(projectId)}/${encodeURIComponent(deliveryId)}/approvals`,
    input,
  );
}

export function recordDeliveryGate(
  projectId: string,
  deliveryId: string,
  gateKey: string,
  input: {
    status: GateStatus;
    summary?: string | null;
    waiver_reason?: string | null;
    warning_accepted?: boolean;
    report_artifact_id?: string | null;
  },
): Promise<DeliveryGate> {
  return apiPost<DeliveryGate>(
    `${base(projectId)}/${encodeURIComponent(deliveryId)}/gates/${encodeURIComponent(gateKey)}/result`,
    input,
  );
}

export function updateDeliveryGateTemplate(
  projectId: string,
  deliveryId: string,
  gateKey: string,
  input: { required?: boolean; label?: string; gate_type?: DeliveryGate['gate_type'] },
): Promise<DeliveryGate> {
  return apiPatch<DeliveryGate>(
    `${base(projectId)}/${encodeURIComponent(deliveryId)}/gates/${encodeURIComponent(gateKey)}/template`,
    input,
  );
}

export function linkDeliveryDeploy(
  projectId: string,
  deliveryId: string,
  deployId: string,
  relation: 'candidate' | 'released' | 'rollback' = 'released',
): Promise<DeliveryDeployEvidence['link']> {
  return apiPost<DeliveryDeployEvidence['link']>(
    `${base(projectId)}/${encodeURIComponent(deliveryId)}/deployments`,
    { deploy_id: deployId, relation },
  );
}

export function unlinkDeliveryDeploy(
  projectId: string,
  deliveryId: string,
  deployId: string,
): Promise<void> {
  return apiDelete(
    `${base(projectId)}/${encodeURIComponent(deliveryId)}/deployments/${encodeURIComponent(deployId)}`,
  );
}

export function getDeliveryReadiness(
  projectId: string,
  deliveryId: string,
): Promise<DeliveryReadiness> {
  return apiGet<DeliveryReadiness>(
    `${base(projectId)}/${encodeURIComponent(deliveryId)}/readiness`,
  );
}

export function generateReceiptPreview(projectId: string, deliveryId: string): Promise<Blob> {
  return blobRequest(
    `${base(projectId)}/${encodeURIComponent(deliveryId)}/receipt/preview`,
    'POST',
  );
}

export function finalizeReceipt(projectId: string, deliveryId: string): Promise<DeliveryReceipt> {
  return apiPost<DeliveryReceipt>(
    `${base(projectId)}/${encodeURIComponent(deliveryId)}/receipt/finalize`,
  );
}

export function downloadReceipt(projectId: string, deliveryId: string): Promise<Blob> {
  return blobRequest(
    `${base(projectId)}/${encodeURIComponent(deliveryId)}/receipt/download`,
    'GET',
  );
}

export function getDeliverySettings(projectId: string): Promise<DeliverySettings> {
  return apiGet<DeliverySettings>(
    `/api/projects/${encodeURIComponent(projectId)}/delivery-settings`,
  );
}

export function updateDeliverySettings(
  projectId: string,
  input: Partial<DeliverySettings>,
): Promise<DeliverySettings> {
  return apiPut<DeliverySettings>(
    `/api/projects/${encodeURIComponent(projectId)}/delivery-settings`,
    input,
  );
}

export async function uploadDeliveryLogo(projectId: string, file: File): Promise<DeliverySettings> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetchWithAuth(
    `/api/projects/${encodeURIComponent(projectId)}/delivery-settings/logo`,
    { method: 'POST', body: form },
  );
  if (!response.ok) await throwApiError(response, 'Receipt logo upload failed');
  const result = (await response.json()) as { settings: DeliverySettings };
  return result.settings;
}
