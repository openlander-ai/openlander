import type { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { Database } from '../db/index.js';
import type {
  ArtifactBlobRow,
  DeliveryApprovalRow,
  DeliveryArtifactRow,
  DeliveryGateRow,
  DeliveryReceiptRow,
  DeliveryRow,
  DeliveryWorkItemRow,
  ProjectDeliverySettingsRow,
} from '../db/schema.drizzle.js';
import {
  ArtifactNotFoundError,
  ArtifactValidationError,
  DeliveryNotFoundError,
  DeliveryStateError,
  ProjectNotFoundError,
  ReceiptNotReadyError,
} from '../errors.js';
import { loadServiceViewRecord } from '../db/views/service-view.js';
import { assertProjectMutable } from '../pipeline/mutation-policy.js';
import { ulid } from '../db/repos/activity-log.repo.js';
import type { ArtifactStore, StoreArtifactOptions } from './artifact-store.js';
import { evaluateDeliveryReadiness } from './readiness.js';
import { deriveDeliveryReviewStatus, requireDeliveryReviewTarget } from './review-status.js';
import { parseJUnitReport } from './report-normalizer.js';
import { ReceiptBuilder, type ReceiptBuildResult } from './receipt-builder.js';
import {
  DELIVERY_TRANSITIONS,
  parseDefaultDeliveryGates,
  type DeliveryArtifactKind,
  type DeliveryDetail,
  type DeliveryExecutionView,
  type DeliveryExternalProvider,
  type DeliveryMaturity,
  type DeliveryReadiness,
  type DeliveryReviewStatus,
  type DeliveryStatus,
  type DeliveryType,
  type FeedbackSourceType,
  type GateStatus,
  type GateType,
  type WorkItemKind,
  type WorkItemStatus,
} from './types.js';

type BinarySource = AsyncIterable<Uint8Array> | Readable;

function requestSha256(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export interface UploadDeliveryArtifactInput {
  artifactId?: string;
  deliveryId: string;
  source: BinarySource;
  filename: string;
  declaredMimeType?: string | null;
  logicalKey: string;
  revision: number;
  kind: DeliveryArtifactKind;
  includeInReceipt?: boolean;
  receiptOrder?: number;
  companionForArtifactId?: string | null;
  idempotencyKey?: string | null;
  actor?: string;
}

export class DeliveryService {
  readonly receiptBuilder: ReceiptBuilder;

  constructor(
    private readonly db: Database,
    readonly artifactStore: ArtifactStore,
  ) {
    this.receiptBuilder = new ReceiptBuilder(artifactStore);
  }

  private async requireMutableProject(projectId: string) {
    const project = await this.db.getProject(projectId);
    if (!project) throw new ProjectNotFoundError(projectId);
    const [record, circuitOpen] = await Promise.all([
      loadServiceViewRecord(this.db, project),
      this.db.isCircuitBreakerOpen(project.id),
    ]);
    assertProjectMutable(project, {
      db: {
        service: record.service,
        isCircuitBreakerOpen: () => circuitOpen,
      },
    });
    return project;
  }

  private async requireMutableDelivery(deliveryId: string): Promise<DeliveryRow> {
    const delivery = await this.db.requireDelivery(deliveryId);
    await this.requireMutableProject(delivery.project_id);
    if (delivery.status === 'delivered' || delivery.status === 'cancelled') {
      throw new DeliveryStateError(
        deliveryId,
        'Finalized or cancelled Deliveries are immutable.',
        delivery.status,
      );
    }
    return delivery;
  }

  async assertProjectCanMutate(projectId: string): Promise<void> {
    await this.requireMutableProject(projectId);
  }

  async assertDeliveryCanMutate(deliveryId: string): Promise<void> {
    await this.requireMutableDelivery(deliveryId);
  }

  private async audit(
    delivery: DeliveryRow,
    eventType: string,
    title: string,
    description: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.db.insertActivityLog({
      event_type: eventType,
      activity_type: 'delivery',
      severity: 'info',
      project_id: delivery.project_id,
      correlation_id: delivery.id,
      title,
      description,
      status: 'completed',
      metadata: JSON.stringify({ delivery_id: delivery.id, ...metadata }),
    });
  }

  async createDelivery(input: {
    id?: string;
    projectId: string;
    title: string;
    summary?: string;
    objective?: string;
    definitionOfDone?: string[];
    manifestPath?: string | null;
    autoFinalize?: boolean;
    deliveryType?: DeliveryType;
    maturity?: DeliveryMaturity;
    limitations?: string | null;
    predecessorDeliveryId?: string | null;
    actor?: string;
    gates?: Array<{
      gate_key: string;
      gate_type: GateType;
      label: string;
      required: boolean;
      source: 'manual' | 'manifest';
      definition_sha256?: string | null;
    }>;
  }): Promise<DeliveryRow> {
    await this.requireMutableProject(input.projectId);
    if (!input.title.trim()) {
      throw new DeliveryStateError('new', 'Delivery title is required.');
    }
    if (input.predecessorDeliveryId) {
      const predecessor = await this.db.requireDelivery(input.predecessorDeliveryId);
      if (predecessor.project_id !== input.projectId) {
        throw new DeliveryStateError(
          input.predecessorDeliveryId,
          'Predecessor Delivery must belong to the same project.',
        );
      }
    }
    const delivery = await this.db.createDelivery({
      id: input.id,
      projectId: input.projectId,
      title: input.title.trim(),
      summary: input.summary?.trim(),
      objective: input.objective?.trim(),
      definitionOfDone: input.definitionOfDone?.map((item) => item.trim()).filter(Boolean),
      manifestPath: input.manifestPath?.trim() || null,
      autoFinalize: input.autoFinalize,
      deliveryType: input.deliveryType,
      maturity: input.maturity,
      limitations: input.limitations?.trim() || null,
      predecessorDeliveryId: input.predecessorDeliveryId,
      createdBy: input.actor ?? 'admin',
      gates: input.gates,
    });
    await this.audit(
      delivery,
      'delivery.created',
      'Delivery created',
      `Created Delivery "${delivery.title}".`,
    );
    return delivery;
  }

  async listDeliveries(projectId: string): Promise<DeliveryRow[]> {
    const project = await this.db.getProject(projectId);
    if (!project) throw new ProjectNotFoundError(projectId);
    return await this.db.listDeliveries(projectId);
  }

  async getDeliveryDetail(deliveryId: string): Promise<DeliveryDetail> {
    const delivery = await this.db.getDelivery(deliveryId);
    if (!delivery) throw new DeliveryNotFoundError(deliveryId);
    const [
      settings,
      artifacts,
      externalRefs,
      feedback,
      workItems,
      approvals,
      gates,
      deployLinks,
      receipt,
    ] = await Promise.all([
      this.db.getProjectDeliverySettings(delivery.project_id),
      this.db.listDeliveryArtifacts(deliveryId),
      this.db.listDeliveryExternalRefs(deliveryId),
      this.db.listDeliveryFeedbackSources(deliveryId),
      this.db.listDeliveryWorkItems(deliveryId),
      this.db.listDeliveryApprovals(deliveryId),
      this.db.listDeliveryGates(deliveryId),
      this.db.listDeliveryDeployEvidence(deliveryId),
      this.db.getDeliveryReceipt(deliveryId),
    ]);
    return {
      delivery,
      settings,
      artifacts: artifacts.map(({ artifact, blob }) => ({ ...artifact, blob })),
      external_refs: externalRefs,
      feedback_sources: feedback,
      work_items: workItems,
      approvals,
      gates,
      deploy_links: deployLinks,
      receipt,
    };
  }

  async getDeliveryExecution(deliveryId: string): Promise<DeliveryExecutionView> {
    const delivery = await this.db.requireDelivery(deliveryId);
    const [agentRuns, projectEnvironments, releases] = await Promise.all([
      this.db.listDeliveryAgentRuns(deliveryId),
      this.db.listProjectEnvironments(delivery.project_id),
      this.db.listReleasesForDelivery(deliveryId),
    ]);
    const runIds = agentRuns.map((run) => run.id);
    const releaseIds = releases.map((release) => release.id);
    const [runEvents, runChecks, releaseArtifacts, releasePromotions] = await Promise.all([
      this.db.listDeliveryAgentRunEventsForRuns(runIds),
      this.db.listDeliveryRunChecksForRuns(runIds),
      this.db.listReleaseArtifactsForReleases(releaseIds),
      this.db.listReleasePromotionsForReleases(releaseIds),
    ]);
    return {
      agent_runs: agentRuns,
      run_events: runEvents,
      run_checks: runChecks,
      project_environments: projectEnvironments,
      releases,
      release_artifacts: releaseArtifacts,
      release_promotions: releasePromotions,
    };
  }

  async updateDraft(
    deliveryId: string,
    patch: {
      title?: string;
      summary?: string;
      deliveryType?: DeliveryType;
      maturity?: DeliveryMaturity;
      limitations?: string | null;
    },
  ): Promise<DeliveryRow> {
    const delivery = await this.requireMutableDelivery(deliveryId);
    if (patch.title !== undefined && !patch.title.trim()) {
      throw new DeliveryStateError(deliveryId, 'Delivery title cannot be empty.', delivery.status);
    }
    const updated = await this.db.updateDelivery(deliveryId, {
      ...patch,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary.trim() } : {}),
      ...(patch.limitations !== undefined
        ? { limitations: patch.limitations?.trim() || null }
        : {}),
    });
    if (patch.deliveryType && patch.deliveryType !== delivery.delivery_type) {
      await this.db.resetDeliveryGatesForType(deliveryId, patch.deliveryType);
    }
    await this.audit(updated, 'delivery.updated', 'Delivery updated', 'Updated Delivery metadata.');
    return updated;
  }

  async transition(deliveryId: string, target: DeliveryStatus): Promise<DeliveryRow> {
    const delivery = await this.requireMutableDelivery(deliveryId);
    if (target === 'ready') {
      throw new DeliveryStateError(
        deliveryId,
        'Ready is calculated from Readiness checks and cannot be selected directly.',
        delivery.status,
      );
    }
    if (target === 'delivered') {
      throw new DeliveryStateError(
        deliveryId,
        'Delivered can only be reached by finalizing a Receipt in the web UI.',
        delivery.status,
      );
    }
    if (!DELIVERY_TRANSITIONS[delivery.status].includes(target)) {
      throw new DeliveryStateError(
        deliveryId,
        `Cannot transition Delivery from ${delivery.status} to ${target}.`,
        delivery.status,
      );
    }
    if (target === 'approved') {
      const detail = await this.getDeliveryDetail(deliveryId);
      if (!detail.approvals.some((approval) => !approval.invalidated_at)) {
        throw new DeliveryStateError(
          deliveryId,
          'Customer approval evidence is required before approval.',
          delivery.status,
        );
      }
    }
    const updated = await this.db.setDeliveryStatus(deliveryId, target);
    await this.audit(
      updated,
      'delivery.status_changed',
      'Delivery status changed',
      `${delivery.status} → ${target}`,
      { from: delivery.status, to: target },
    );
    return updated;
  }

  private async validateArtifactRevision(input: {
    deliveryId: string;
    logicalKey: string;
    revision: number;
    kind: DeliveryArtifactKind;
    idempotencyKey?: string | null;
  }): Promise<DeliveryArtifactRow | null> {
    if (!input.logicalKey.trim() || input.revision < 1) {
      throw new ArtifactValidationError('Artifact logical key and positive revision are required.');
    }
    const existing = await this.db.listDeliveryArtifacts(input.deliveryId);
    const idempotent = input.idempotencyKey
      ? existing.find(({ artifact }) => artifact.idempotency_key === input.idempotencyKey)?.artifact
      : null;
    if (idempotent) return idempotent;
    const revisions = existing
      .map(({ artifact }) => artifact)
      .filter(
        (artifact) =>
          artifact.logical_key === input.logicalKey.trim() && artifact.kind === input.kind,
      )
      .map((artifact) => artifact.revision);
    const latestRevision = revisions.length > 0 ? Math.max(...revisions) : 0;
    if (input.revision <= latestRevision) {
      throw new ArtifactValidationError(
        'Artifact revision must be newer than the current revision.',
        {
          logicalKey: input.logicalKey.trim(),
          kind: input.kind,
          latestRevision,
        },
      );
    }
    return null;
  }

  async uploadArtifact(input: UploadDeliveryArtifactInput): Promise<DeliveryArtifactRow> {
    const delivery = await this.requireMutableDelivery(input.deliveryId);
    const idempotent = await this.validateArtifactRevision(input);
    if (idempotent) return idempotent;

    const stored = await this.artifactStore.store(input.source, {
      filename: input.filename,
      declaredMimeType: input.declaredMimeType,
    });
    const blob = await this.db.upsertArtifactBlob(stored);
    const artifact = await this.db.createDeliveryArtifact({
      id: input.artifactId,
      deliveryId: input.deliveryId,
      blobId: blob.id,
      logicalKey: input.logicalKey.trim(),
      revision: input.revision,
      kind: input.kind,
      originalFilename: input.filename,
      includeInReceipt: input.includeInReceipt,
      receiptOrder: input.receiptOrder,
      idempotencyKey: input.idempotencyKey,
    });
    if (input.companionForArtifactId) {
      await this.linkCompanionPdf(input.deliveryId, input.companionForArtifactId, artifact.id);
    }
    await this.audit(
      delivery,
      'delivery.artifact_uploaded',
      'Delivery artifact uploaded',
      `${artifact.original_filename} r${String(artifact.revision)}`,
      { artifact_id: artifact.id, sha256: blob.sha256 },
    );
    return artifact;
  }

  async attachStoredArtifact(input: {
    deliveryId: string;
    blobId: string;
    logicalKey: string;
    revision: number;
    kind: DeliveryArtifactKind;
    originalFilename: string;
    includeInReceipt?: boolean;
    receiptOrder?: number;
    idempotencyKey?: string | null;
    actor?: string;
  }): Promise<DeliveryArtifactRow> {
    const delivery = await this.requireMutableDelivery(input.deliveryId);
    const idempotent = await this.validateArtifactRevision(input);
    if (idempotent) return idempotent;
    const blob = await this.db.getArtifactBlob(input.blobId);
    if (!blob || !(await this.artifactStore.exists(blob.storage_key))) {
      throw new ArtifactNotFoundError(input.blobId);
    }
    const artifact = await this.db.createDeliveryArtifact({
      ...input,
      logicalKey: input.logicalKey.trim(),
    });
    await this.audit(
      delivery,
      'delivery.artifact_attached',
      'Stored artifact attached',
      artifact.original_filename,
      { artifact_id: artifact.id, sha256: blob.sha256 },
    );
    return artifact;
  }

  async setArtifactStatus(
    deliveryId: string,
    artifactId: string,
    status: 'draft' | 'approved' | 'superseded',
  ): Promise<DeliveryArtifactRow> {
    const delivery = await this.requireMutableDelivery(deliveryId);
    const artifact = await this.db.getDeliveryArtifact(artifactId);
    if (!artifact || artifact.delivery_id !== deliveryId)
      throw new ArtifactNotFoundError(artifactId);
    if (artifact.status === 'superseded' && status !== 'superseded') {
      throw new ArtifactValidationError(
        'A superseded artifact cannot be restored; upload a newer revision instead.',
        { artifactId },
      );
    }
    if (status === 'approved') {
      const artifacts = await this.db.listDeliveryArtifacts(deliveryId);
      const latestRevision = Math.max(
        ...artifacts
          .map(({ artifact: candidate }) => candidate)
          .filter(
            (candidate) =>
              candidate.logical_key === artifact.logical_key && candidate.kind === artifact.kind,
          )
          .map((candidate) => candidate.revision),
      );
      if (artifact.revision !== latestRevision) {
        throw new ArtifactValidationError('Only the latest artifact revision can be approved.', {
          artifactId,
          latestRevision,
        });
      }
    }
    const updated = await this.db.updateDeliveryArtifact(artifactId, { status });
    await this.audit(
      delivery,
      'delivery.artifact_status_changed',
      'Artifact status changed',
      `${artifact.original_filename}: ${artifact.status} → ${status}`,
      { artifact_id: artifactId },
    );
    return updated;
  }

  async linkCompanionPdf(
    deliveryId: string,
    htmlArtifactId: string,
    pdfArtifactId: string,
  ): Promise<DeliveryArtifactRow> {
    const delivery = await this.requireMutableDelivery(deliveryId);
    const [html, pdf] = await Promise.all([
      this.db.getDeliveryArtifact(htmlArtifactId),
      this.db.getDeliveryArtifact(pdfArtifactId),
    ]);
    if (
      !html ||
      !pdf ||
      html.delivery_id !== deliveryId ||
      pdf.delivery_id !== deliveryId ||
      html.kind !== 'review_html' ||
      pdf.kind !== 'companion_pdf' ||
      html.logical_key !== pdf.logical_key ||
      html.revision !== pdf.revision
    ) {
      throw new ArtifactValidationError(
        'HTML and companion PDF must share the same Delivery, logical key, and revision.',
        { htmlArtifactId, pdfArtifactId },
      );
    }
    const updated = await this.db.updateDeliveryArtifact(htmlArtifactId, {
      companionPdfArtifactId: pdfArtifactId,
    });
    await this.audit(
      delivery,
      'delivery.companion_pdf_linked',
      'Companion PDF linked',
      `${html.original_filename} → ${pdf.original_filename}`,
      { html_artifact_id: htmlArtifactId, pdf_artifact_id: pdfArtifactId },
    );
    return updated;
  }

  async attachExternalUrl(input: {
    deliveryId: string;
    provider: DeliveryExternalProvider;
    label: string;
    url: string;
  }) {
    const delivery = await this.requireMutableDelivery(input.deliveryId);
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      throw new ArtifactValidationError('External evidence URL is invalid.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new ArtifactValidationError('External evidence URL must use HTTP or HTTPS.');
    }
    const ref = await this.db.createDeliveryExternalRef(input);
    await this.audit(
      delivery,
      'delivery.external_ref_added',
      'External evidence linked',
      input.label,
      { external_ref_id: ref.id, provider: ref.provider },
    );
    return ref;
  }

  async recordFeedback(input: {
    deliveryId: string;
    sourceType: FeedbackSourceType;
    sourceUrl?: string | null;
    authorDisplayName?: string | null;
    rawText: string;
    occurredAt?: string | null;
  }) {
    const delivery = await this.requireMutableDelivery(input.deliveryId);
    if (!input.rawText.trim()) {
      throw new DeliveryStateError(input.deliveryId, 'Feedback text cannot be empty.');
    }
    const source = await this.db.createDeliveryFeedbackSource({
      ...input,
      rawText: input.rawText.trim(),
    });
    await this.audit(
      delivery,
      'delivery.feedback_recorded',
      'Customer feedback recorded',
      `${source.source_type} feedback stored.`,
      { feedback_source_id: source.id },
    );
    return source;
  }

  async submitWorkItemDrafts(
    deliveryId: string,
    items: Array<{
      feedbackSourceId?: string | null;
      kind: WorkItemKind;
      title: string;
      detail?: string;
    }>,
    actor = 'external-agent',
  ): Promise<DeliveryWorkItemRow[]> {
    const delivery = await this.requireMutableDelivery(deliveryId);
    if (items.length === 0 || items.length > 100) {
      throw new DeliveryStateError(deliveryId, 'Submit between 1 and 100 work item drafts.');
    }
    const feedbackIds = new Set(
      (await this.db.listDeliveryFeedbackSources(deliveryId)).map((source) => source.id),
    );
    for (const item of items) {
      if (!item.title.trim()) {
        throw new DeliveryStateError(deliveryId, 'Work item title cannot be empty.');
      }
      if (item.feedbackSourceId && !feedbackIds.has(item.feedbackSourceId)) {
        throw new DeliveryStateError(
          deliveryId,
          'Work item feedback source must belong to the Delivery.',
        );
      }
    }
    const rows = await this.db.createDeliveryWorkItems(
      deliveryId,
      items.map((item) => ({
        ...item,
        title: item.title.trim(),
        detail: item.detail?.trim(),
        isAiDraft: true,
        createdBy: actor,
      })),
    );
    await this.audit(
      delivery,
      'delivery.work_item_drafts_submitted',
      'Work item drafts submitted',
      `${String(rows.length)} proposed items were submitted for FDE review.`,
      { count: rows.length, actor },
    );
    return rows;
  }

  async updateWorkItem(
    deliveryId: string,
    workItemId: string,
    status: WorkItemStatus,
    resolution?: string | null,
  ): Promise<DeliveryWorkItemRow> {
    const delivery = await this.requireMutableDelivery(deliveryId);
    const item = (await this.db.listDeliveryWorkItems(deliveryId)).find(
      (candidate) => candidate.id === workItemId,
    );
    if (!item) {
      throw new DeliveryStateError(deliveryId, 'Work item does not belong to the Delivery.');
    }
    const allowed: Readonly<Record<WorkItemStatus, readonly WorkItemStatus[]>> = {
      proposed: ['confirmed', 'rejected'],
      confirmed: ['resolved', 'superseded'],
      rejected: [],
      resolved: [],
      superseded: [],
    };
    if (!allowed[item.status].includes(status)) {
      throw new DeliveryStateError(
        deliveryId,
        `Cannot transition work item from ${item.status} to ${status}.`,
      );
    }
    if (status === 'resolved' && !resolution?.trim()) {
      throw new DeliveryStateError(deliveryId, 'A resolution is required to resolve a work item.');
    }
    const updated = await this.db.updateDeliveryWorkItem(
      workItemId,
      status,
      resolution?.trim() || null,
    );
    await this.audit(
      delivery,
      'delivery.work_item_updated',
      'Review item updated',
      `${item.title}: ${item.status} → ${status}`,
      { work_item_id: workItemId },
    );
    return updated;
  }

  async recordApproval(input: {
    deliveryId: string;
    artifactIds: string[];
    approverDisplayName: string;
    approvalExcerpt: string;
    sourceType: FeedbackSourceType;
    sourceUrl?: string | null;
    approvedAt: string;
    actor?: string;
  }): Promise<DeliveryApprovalRow> {
    const delivery = await this.requireMutableDelivery(input.deliveryId);
    if (
      input.artifactIds.length === 0 ||
      !input.approverDisplayName.trim() ||
      !input.approvalExcerpt.trim() ||
      Number.isNaN(Date.parse(input.approvedAt))
    ) {
      throw new DeliveryStateError(
        input.deliveryId,
        'Approval requires artifacts, approver, excerpt, and a valid timestamp.',
      );
    }
    const artifacts = await this.db.getDeliveryArtifactsByIds(input.artifactIds);
    if (
      artifacts.length !== new Set(input.artifactIds).size ||
      artifacts.some(
        (artifact) => artifact.delivery_id !== input.deliveryId || artifact.status !== 'approved',
      )
    ) {
      throw new DeliveryStateError(
        input.deliveryId,
        'Approval may only reference approved artifacts in this Delivery.',
      );
    }
    const approval = await this.db.createDeliveryApproval({
      ...input,
      approverDisplayName: input.approverDisplayName.trim(),
      approvalExcerpt: input.approvalExcerpt.trim(),
      recordedBy: input.actor ?? 'admin',
    });
    await this.audit(
      delivery,
      'delivery.approval_recorded',
      'Customer approval recorded',
      `${approval.approver_display_name} approved ${String(artifacts.length)} artifact(s).`,
      { approval_id: approval.id, artifact_ids: input.artifactIds },
    );
    return approval;
  }

  async updateGateTemplate(
    deliveryId: string,
    gateKey: string,
    patch: { required?: boolean; label?: string; gateType?: GateType },
  ): Promise<DeliveryGateRow> {
    const delivery = await this.requireMutableDelivery(deliveryId);
    if (delivery.status !== 'draft') {
      throw new DeliveryStateError(
        deliveryId,
        'Gate requirements can only be changed while draft.',
        delivery.status,
      );
    }
    const gate = await this.db.updateDeliveryGateTemplate(deliveryId, gateKey, patch);
    await this.audit(
      delivery,
      'delivery.gate_template_updated',
      'Delivery Gate requirement updated',
      `${gate.label}: ${gate.required ? 'required' : 'optional'}`,
      { gate_key: gate.gate_key, required: gate.required },
    );
    return gate;
  }

  async recordGateResult(input: {
    deliveryId: string;
    gateKey: string;
    status: GateStatus;
    summary?: string | null;
    waiverReason?: string | null;
    warningAccepted?: boolean;
    reportArtifactId?: string | null;
    idempotencyKey?: string | null;
    actor?: string;
  }): Promise<DeliveryGateRow> {
    const delivery = await this.requireMutableDelivery(input.deliveryId);
    if (input.status === 'waived' && !input.waiverReason?.trim()) {
      throw new DeliveryStateError(input.deliveryId, 'A waiver reason is required.');
    }
    let normalizedSummary = input.summary?.trim() || null;
    if (input.reportArtifactId) {
      const artifact = await this.db.getDeliveryArtifact(input.reportArtifactId);
      if (!artifact || artifact.delivery_id !== input.deliveryId) {
        throw new ArtifactNotFoundError(input.reportArtifactId);
      }
      const blob = await this.db.getArtifactBlob(artifact.blob_id);
      if (!blob) throw new ArtifactNotFoundError(artifact.blob_id);
      if (blob.mime_type === 'application/junit+xml') {
        const normalized = parseJUnitReport(
          (await this.artifactStore.read(blob.storage_key)).toString('utf8'),
        );
        if (input.status === 'passed' && normalized.status === 'failed') {
          throw new DeliveryStateError(
            input.deliveryId,
            'A failed JUnit report cannot be recorded as a passed Gate.',
          );
        }
        normalizedSummary ??= normalized.summary;
      }
    }
    const gate = await this.db.recordDeliveryGateResult({
      ...input,
      summary: normalizedSummary,
      waiverReason: input.waiverReason?.trim() || null,
      requestSha256: input.idempotencyKey
        ? requestSha256({
            gate_key: input.gateKey,
            status: input.status,
            summary: normalizedSummary,
            waiver_reason: input.waiverReason?.trim() || null,
            warning_accepted: input.warningAccepted ?? false,
            report_artifact_id: input.reportArtifactId ?? null,
          })
        : null,
      recordedBy: input.actor ?? 'admin',
    });
    await this.audit(
      delivery,
      'delivery.gate_recorded',
      'Delivery Gate recorded',
      `${gate.label}: ${gate.status}`,
      { gate_key: gate.gate_key, status: gate.status },
    );
    return gate;
  }

  async requestReview(input: {
    deliveryId: string;
    gateKey: string;
    artifactId: string;
    expectedSha256: string;
    summary?: string | null;
    idempotencyKey: string;
    actor: string;
  }): Promise<DeliveryReviewStatus> {
    const delivery = await this.requireMutableDelivery(input.deliveryId);
    const detail = await this.getDeliveryDetail(delivery.id);
    const artifact = requireDeliveryReviewTarget(detail, input);
    await this.recordGateResult({
      deliveryId: delivery.id,
      gateKey: input.gateKey,
      status: 'pending',
      summary:
        input.summary?.trim() ||
        `Review requested for ${artifact.logical_key} revision ${String(artifact.revision)}.`,
      reportArtifactId: artifact.id,
      idempotencyKey: input.idempotencyKey,
      actor: input.actor,
    });
    if (delivery.status === 'draft' || delivery.status === 'revision_requested') {
      await this.transition(delivery.id, 'in_review');
    }
    return await this.getReviewStatus(delivery.id, input.gateKey);
  }

  async getReviewStatus(deliveryId: string, gateKey: string): Promise<DeliveryReviewStatus> {
    return deriveDeliveryReviewStatus(await this.getDeliveryDetail(deliveryId), gateKey);
  }

  async acceptReview(input: {
    deliveryId: string;
    gateKey: string;
    artifactId: string;
    expectedSha256: string;
    summary?: string | null;
    actor: string;
  }): Promise<DeliveryReviewStatus> {
    const delivery = await this.requireMutableDelivery(input.deliveryId);
    const detail = await this.getDeliveryDetail(delivery.id);
    const artifact = requireDeliveryReviewTarget(detail, input);
    await this.db.acceptDeliveryReviewCheckpoint({
      deliveryId: delivery.id,
      gateKey: input.gateKey,
      artifactId: artifact.id,
      expectedSha256: input.expectedSha256,
      summary: input.summary,
      recordedBy: input.actor,
    });
    await this.audit(
      delivery,
      'delivery.review_accepted',
      'Delivery review accepted',
      `${artifact.original_filename} revision ${String(artifact.revision)} accepted.`,
      {
        gate_key: input.gateKey,
        artifact_id: artifact.id,
        revision: artifact.revision,
        sha256: artifact.blob.sha256,
      },
    );
    return await this.getReviewStatus(delivery.id, input.gateKey);
  }

  async linkDeploy(input: {
    deliveryId: string;
    deployId: string;
    relation?: 'candidate' | 'released' | 'rollback';
  }) {
    const delivery = await this.requireMutableDelivery(input.deliveryId);
    const deploy = await this.db.getDeployLog(input.deployId);
    if (!deploy) {
      throw new DeliveryStateError(input.deliveryId, 'Deployment was not found.');
    }
    const [service, environment] = await Promise.all([
      this.db.getService(deploy.service_id),
      deploy.environment_id ? this.db.getEnvironment(deploy.environment_id) : null,
    ]);
    if (
      !service ||
      service.project_id !== delivery.project_id ||
      deploy.status !== 'success' ||
      environment?.type !== 'production'
    ) {
      throw new DeliveryStateError(
        input.deliveryId,
        'Only a successful Production deployment from the same project can be linked.',
      );
    }
    const relation = input.relation ?? 'released';
    const link = await this.db.linkDeliveryDeploy({
      deliveryId: input.deliveryId,
      deployId: input.deployId,
      relation,
    });
    await this.audit(
      delivery,
      'delivery.deploy_linked',
      'Production deployment linked',
      `${deploy.id} (${relation})`,
      { deploy_id: deploy.id, relation },
    );
    return link;
  }

  async unlinkDeploy(deliveryId: string, deployId: string): Promise<boolean> {
    const delivery = await this.requireMutableDelivery(deliveryId);
    const unlinked = await this.db.unlinkDeliveryDeploy(deliveryId, deployId);
    if (unlinked) {
      await this.audit(delivery, 'delivery.deploy_unlinked', 'Deployment unlinked', deployId, {
        deploy_id: deployId,
      });
    }
    return unlinked;
  }

  async getReadiness(deliveryId: string): Promise<DeliveryReadiness> {
    const detail = await this.getDeliveryDetail(deliveryId);
    return await this.getDetailReadiness(detail);
  }

  private async getDetailReadiness(detail: DeliveryDetail): Promise<DeliveryReadiness> {
    const companionPages = await this.receiptBuilder.countCompanionPages(detail);
    const estimatedPages = companionPages + 7;
    return evaluateDeliveryReadiness(detail, estimatedPages);
  }

  async generateReceiptPreview(deliveryId: string): Promise<ReceiptBuildResult> {
    const delivery = await this.requireMutableDelivery(deliveryId);
    const detail = await this.getDeliveryDetail(deliveryId);
    const readiness = await this.getDetailReadiness(detail);
    if (!readiness.ready) throw new ReceiptNotReadyError(deliveryId, readiness.blockers);
    const project = await this.db.getProject(delivery.project_id);
    if (!project) throw new ProjectNotFoundError(delivery.project_id);

    const previewVersion =
      detail.delivery.status === 'approved'
        ? detail.delivery.evidence_version + 1
        : detail.delivery.evidence_version;
    const previewDetail: DeliveryDetail = {
      ...detail,
      delivery: {
        ...detail.delivery,
        status: 'ready',
        evidence_version: previewVersion,
        previewed_evidence_version: previewVersion,
      },
    };
    const result = await this.receiptBuilder.build(project, previewDetail, readiness);
    const updated = await this.db.recordDeliveryReceiptPreview(
      deliveryId,
      detail.delivery.evidence_version,
    );
    await this.audit(
      updated,
      'delivery.receipt_previewed',
      'Receipt preview generated',
      `${String(result.pageCount)} page(s)`,
    );
    return result;
  }

  async finalizeReceipt(deliveryId: string, finalizedBy = 'admin'): Promise<DeliveryReceiptRow> {
    const delivery = await this.requireMutableDelivery(deliveryId);
    if (delivery.status !== 'ready') {
      throw new DeliveryStateError(
        deliveryId,
        'Generate a current Receipt preview before finalization.',
        delivery.status,
      );
    }
    if (delivery.previewed_evidence_version !== delivery.evidence_version) {
      throw new ReceiptNotReadyError(deliveryId, [
        'Delivery evidence changed after the last Receipt preview. Generate a new preview.',
      ]);
    }
    const detail = await this.getDeliveryDetail(deliveryId);
    const readiness = await this.getDetailReadiness(detail);
    if (!readiness.ready) throw new ReceiptNotReadyError(deliveryId, readiness.blockers);
    const project = await this.db.getProject(delivery.project_id);
    if (!project) throw new ProjectNotFoundError(delivery.project_id);
    const finalizedAt = new Date().toISOString();
    const built = await this.receiptBuilder.build(project, detail, readiness, finalizedAt);
    const stored = await this.artifactStore.storeBuffer(built.bytes, {
      filename: `${delivery.id}-receipt.pdf`,
      declaredMimeType: 'application/pdf',
    });
    const blob = await this.db.upsertArtifactBlob(stored);
    const receipt = await this.db.finalizeDeliveryReceipt({
      id: ulid(),
      deliveryId,
      snapshotJson: built.snapshot as unknown as Record<string, unknown>,
      pdfBlobId: blob.id,
      pdfSha256: blob.sha256,
      finalizedBy,
      finalizedAt,
      expectedEvidenceVersion: detail.delivery.evidence_version,
    });
    await this.audit(
      { ...delivery, status: 'delivered' },
      'delivery.receipt_finalized',
      'Delivery finalized',
      `Immutable Receipt ${receipt.id} was finalized.`,
      { receipt_id: receipt.id, pdf_sha256: receipt.pdf_sha256 },
    );
    return receipt;
  }

  async getArtifactDownload(
    deliveryId: string,
    artifactId: string,
  ): Promise<{ artifact: DeliveryArtifactRow; blob: ArtifactBlobRow }> {
    const detail = await this.getDeliveryDetail(deliveryId);
    const artifact = detail.artifacts.find((item) => item.id === artifactId);
    if (!artifact) throw new ArtifactNotFoundError(artifactId);
    return { artifact, blob: artifact.blob };
  }

  async getReceiptDownload(
    deliveryId: string,
  ): Promise<{ receipt: DeliveryReceiptRow; blob: ArtifactBlobRow }> {
    const receipt = await this.db.getDeliveryReceipt(deliveryId);
    if (!receipt) {
      throw new DeliveryStateError(deliveryId, 'Delivery Receipt has not been finalized.');
    }
    const blob = await this.db.getArtifactBlob(receipt.pdf_blob_id);
    if (!blob) throw new ArtifactNotFoundError(receipt.pdf_blob_id);
    return { receipt, blob };
  }

  async updateProjectSettings(
    projectId: string,
    input: Partial<
      Pick<
        ProjectDeliverySettingsRow,
        | 'organization_name'
        | 'document_name'
        | 'primary_color'
        | 'logo_blob_id'
        | 'footer_text'
        | 'locale'
        | 'default_gates_json'
      >
    >,
  ): Promise<ProjectDeliverySettingsRow> {
    const project = await this.requireMutableProject(projectId);
    if (input.primary_color !== undefined && !/^#[0-9a-f]{6}$/i.test(input.primary_color)) {
      throw new DeliveryStateError(
        projectId,
        'Receipt primary color must be a six-digit hex color.',
      );
    }
    if (input.logo_blob_id) {
      const logo = await this.db.getArtifactBlob(input.logo_blob_id);
      if (
        !logo ||
        (logo.mime_type !== 'image/png' && logo.mime_type !== 'image/jpeg') ||
        !(await this.artifactStore.exists(logo.storage_key))
      ) {
        throw new ArtifactValidationError('Receipt logo must be a stored PNG or JPEG artifact.');
      }
    }
    const normalizedInput = { ...input };
    if (input.default_gates_json !== undefined) {
      const parsed = parseDefaultDeliveryGates(input.default_gates_json);
      if (!parsed) {
        throw new ArtifactValidationError(
          'Default Gate templates must define valid, uniquely keyed Gate arrays.',
        );
      }
      normalizedInput.default_gates_json = parsed;
    }
    const settings = await this.db.upsertProjectDeliverySettings(projectId, normalizedInput);
    await this.db.insertActivityLog({
      event_type: 'delivery.settings_updated',
      activity_type: 'delivery',
      severity: 'info',
      project_id: project.id,
      title: 'Delivery Receipt settings updated',
      description: 'Updated project Receipt theme and default Gate template.',
      status: 'completed',
      metadata: '{}',
    });
    return settings;
  }

  artifactOptions(filename: string, declaredMimeType?: string | null): StoreArtifactOptions {
    return { filename, declaredMimeType };
  }
}
