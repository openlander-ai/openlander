import { and, asc, desc, eq, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import {
  ArtifactNotFoundError,
  ArtifactValidationError,
  DeliveryIdempotencyConflictError,
  DeliveryNotFoundError,
  DeliveryStateError,
  ProjectUpdateItemNotFoundError,
  ProjectUpdateProjectMismatchError,
  RepoPersistenceError,
} from '../../errors.js';
import type {
  DeliveryArtifactKind,
  DeliveryDeployEvidence,
  DeliveryExternalProvider,
  DeliveryMaturity,
  DeliveryStatus,
  DeliveryType,
  FeedbackSourceType,
  GateStatus,
  GateType,
  WorkItemKind,
  WorkItemStatus,
} from '../../delivery/types.js';
import { DEFAULT_DELIVERY_GATES, parseDefaultDeliveryGates } from '../../delivery/types.js';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import {
  artifactBlobs,
  deliveries,
  deliveryApprovals,
  deliveryArtifacts,
  deliveryDeployLinks,
  deliveryExternalRefs,
  deliveryFeedbackSources,
  deliveryGates,
  deliveryIdempotencyRecords,
  deliveryReceipts,
  deliveryReviewPackageItems,
  deliveryWorkItems,
  deliveryProjectUpdateItems,
  deployLogs,
  environments,
  projectDeliverySettings,
  projectUpdateItems,
  projectUpdates,
  services,
  type ArtifactBlobRow,
  type DeliveryApprovalRow,
  type DeliveryArtifactRow,
  type DeliveryExternalRefRow,
  type DeliveryFeedbackSourceRow,
  type DeliveryGateRow,
  type DeliveryReceiptRow,
  type DeliveryRow,
  type DeliveryWorkItemRow,
  type ProjectDeliverySettingsRow,
} from '../schema.drizzle.js';
import { ulid } from './activity-log.repo.js';

export interface CreateDeliveryInput {
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
  createdBy?: string;
  gates?: Array<{
    gate_key: string;
    gate_type: GateType;
    label: string;
    required: boolean;
    source: 'manual' | 'manifest';
    definition_sha256?: string | null;
  }>;
  sourceProjectUpdateItemIds?: string[];
  contextLinkedBy?: string;
}

export interface CreateDeliveryArtifactInput {
  id?: string;
  deliveryId: string;
  blobId: string;
  logicalKey: string;
  revision: number;
  kind: DeliveryArtifactKind;
  originalFilename: string;
  includeInReceipt?: boolean;
  receiptOrder?: number;
  idempotencyKey?: string | null;
}

const DEFAULT_SETTINGS = {
  organization_name: null,
  document_name: 'Delivery Receipt',
  primary_color: '#2563EB',
  logo_blob_id: null,
  footer_text: null,
  locale: 'ko' as const,
  default_gates_json: {},
};

type DeliveryTransaction = Parameters<Parameters<DrizzleClient['transaction']>[0]>[0];

async function touchMutableDelivery(
  tx: DeliveryTransaction,
  deliveryId: string,
  patch: Partial<Pick<DeliveryRow, 'status' | 'previewed_evidence_version'>> = {},
): Promise<DeliveryRow> {
  const [row] = await tx
    .update(deliveries)
    .set({
      ...patch,
      ...(!patch.status
        ? {
            status: sql`CASE WHEN ${deliveries.status} = 'ready' THEN 'approved' ELSE ${deliveries.status} END`,
          }
        : {}),
      evidence_version: sql`${deliveries.evidence_version} + 1`,
      updated_at: new Date().toISOString(),
    })
    .where(
      and(eq(deliveries.id, deliveryId), notInArray(deliveries.status, ['delivered', 'cancelled'])),
    )
    .returning();
  if (row) return row;

  const [current] = await tx
    .select()
    .from(deliveries)
    .where(eq(deliveries.id, deliveryId))
    .limit(1);
  if (!current) throw new DeliveryNotFoundError(deliveryId);
  throw new DeliveryStateError(
    deliveryId,
    'Finalized or cancelled Deliveries are immutable.',
    current.status,
  );
}

export class DeliveryRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryRow> {
    const id = input.id ?? ulid();
    const deliveryType = input.deliveryType ?? 'software_release';
    if (input.id) {
      const existing = await this.getDelivery(input.id);
      if (existing) {
        if (
          existing.project_id === input.projectId &&
          existing.title === input.title &&
          existing.objective === (input.objective ?? '') &&
          existing.manifest_path === (input.manifestPath ?? null)
        ) {
          return existing;
        }
        throw new DeliveryStateError(
          input.id,
          'The deterministic Delivery id is already used by another operation.',
          existing.status,
        );
      }
    }
    return await this.db.transaction(async (tx) => {
      const sourceItemIds = [...new Set(input.sourceProjectUpdateItemIds ?? [])];
      const sourceItems =
        sourceItemIds.length > 0
          ? await tx
              .select({ item: projectUpdateItems, project_id: projectUpdates.project_id })
              .from(projectUpdateItems)
              .innerJoin(
                projectUpdates,
                eq(projectUpdates.id, projectUpdateItems.project_update_id),
              )
              .where(inArray(projectUpdateItems.id, sourceItemIds))
              .for('share')
          : [];
      if (sourceItems.length !== sourceItemIds.length) {
        const found = new Set(sourceItems.map((row) => row.item.id));
        const missing = sourceItemIds.find((itemId) => !found.has(itemId));
        throw new ProjectUpdateItemNotFoundError(missing ?? sourceItemIds[0] ?? 'unknown');
      }
      for (const source of sourceItems) {
        if (source.project_id !== input.projectId) {
          throw new ProjectUpdateProjectMismatchError(
            input.projectId,
            source.item.id,
            'project_update_item',
          );
        }
        if (source.item.status === 'dismissed' || source.item.status === 'superseded') {
          throw new DeliveryStateError(
            id,
            'Dismissed or superseded Project Update items cannot be used as Delivery context.',
          );
        }
      }
      const [created] = await tx
        .insert(deliveries)
        .values({
          id,
          project_id: input.projectId,
          title: input.title,
          summary: input.summary ?? '',
          objective: input.objective ?? '',
          definition_of_done: input.definitionOfDone ?? [],
          manifest_path: input.manifestPath ?? null,
          ...(input.autoFinalize !== undefined ? { auto_finalize: input.autoFinalize } : {}),
          delivery_type: deliveryType,
          maturity: input.maturity ?? 'customer_review',
          limitations: input.limitations ?? null,
          predecessor_delivery_id: input.predecessorDeliveryId ?? null,
          created_by: input.createdBy ?? 'admin',
        })
        .returning();
      if (!created) throw new RepoPersistenceError('delivery', id);

      await tx
        .insert(projectDeliverySettings)
        .values({ project_id: input.projectId, ...DEFAULT_SETTINGS })
        .onConflictDoNothing();
      const [settings] = await tx
        .select()
        .from(projectDeliverySettings)
        .where(eq(projectDeliverySettings.project_id, input.projectId))
        .limit(1);
      const configuredGates =
        parseDefaultDeliveryGates(settings?.default_gates_json) ?? DEFAULT_DELIVERY_GATES;
      const initialGates = input.gates ?? configuredGates[deliveryType];
      if (initialGates.length > 0) {
        await tx.insert(deliveryGates).values(
          initialGates.map((gate) => ({
            id: ulid(),
            delivery_id: id,
            ...gate,
          })),
        );
      }
      if (sourceItems.length > 0) {
        await tx.insert(deliveryProjectUpdateItems).values(
          sourceItems.map(({ item }) => ({
            delivery_id: id,
            project_update_item_id: item.id,
            item_status: item.status,
            item_updated_at: item.updated_at,
            linked_by: input.contextLinkedBy ?? input.createdBy ?? 'admin',
          })),
        );
      }
      return created;
    });
  }

  async getDelivery(id: string): Promise<DeliveryRow | null> {
    const [row] = await this.db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
    return row ?? null;
  }

  async requireDelivery(id: string): Promise<DeliveryRow> {
    const row = await this.getDelivery(id);
    if (!row) throw new DeliveryNotFoundError(id);
    return row;
  }

  async listDeliveries(projectId: string): Promise<DeliveryRow[]> {
    return await this.db
      .select()
      .from(deliveries)
      .where(eq(deliveries.project_id, projectId))
      .orderBy(desc(deliveries.created_at), desc(deliveries.id));
  }

  async updateDelivery(
    id: string,
    patch: {
      title?: string;
      summary?: string;
      deliveryType?: DeliveryType;
      maturity?: DeliveryMaturity;
      limitations?: string | null;
    },
  ): Promise<DeliveryRow> {
    const current = await this.requireDelivery(id);
    if (current.status === 'delivered' || current.status === 'cancelled') {
      throw new DeliveryStateError(
        id,
        'Finalized or cancelled Deliveries cannot be edited.',
        current.status,
      );
    }
    if (patch.deliveryType && current.status !== 'draft') {
      throw new DeliveryStateError(
        id,
        'Delivery type can only be changed while draft.',
        current.status,
      );
    }
    const [row] = await this.db
      .update(deliveries)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.deliveryType !== undefined ? { delivery_type: patch.deliveryType } : {}),
        ...(patch.maturity !== undefined ? { maturity: patch.maturity } : {}),
        ...(patch.limitations !== undefined ? { limitations: patch.limitations } : {}),
        status: sql`CASE WHEN ${deliveries.status} = 'ready' THEN 'approved' ELSE ${deliveries.status} END`,
        evidence_version: sql`${deliveries.evidence_version} + 1`,
        updated_at: new Date().toISOString(),
      })
      .where(and(eq(deliveries.id, id), notInArray(deliveries.status, ['delivered', 'cancelled'])))
      .returning();
    if (!row) {
      const latest = await this.requireDelivery(id);
      throw new DeliveryStateError(
        id,
        'Finalized or cancelled Deliveries cannot be edited.',
        latest.status,
      );
    }
    return row;
  }

  async setDeliveryStatus(id: string, status: DeliveryStatus): Promise<DeliveryRow> {
    const [row] = await this.db
      .update(deliveries)
      .set({
        status,
        evidence_version: sql`${deliveries.evidence_version} + 1`,
        updated_at: new Date().toISOString(),
      })
      .where(and(eq(deliveries.id, id), notInArray(deliveries.status, ['delivered', 'cancelled'])))
      .returning();
    if (!row) {
      const latest = await this.requireDelivery(id);
      throw new DeliveryStateError(
        id,
        'Finalized or cancelled Deliveries are immutable.',
        latest.status,
      );
    }
    return row;
  }

  async upsertArtifactBlob(input: {
    sha256: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
  }): Promise<ArtifactBlobRow> {
    await this.db
      .insert(artifactBlobs)
      .values({
        id: input.sha256,
        sha256: input.sha256,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        storage_key: input.storageKey,
      })
      .onConflictDoNothing();
    const [row] = await this.db
      .select()
      .from(artifactBlobs)
      .where(eq(artifactBlobs.sha256, input.sha256))
      .limit(1);
    if (!row) throw new RepoPersistenceError('artifact blob', input.sha256);
    return row;
  }

  async getArtifactBlob(id: string): Promise<ArtifactBlobRow | null> {
    const [row] = await this.db
      .select()
      .from(artifactBlobs)
      .where(eq(artifactBlobs.id, id))
      .limit(1);
    return row ?? null;
  }

  async createArtifact(input: CreateDeliveryArtifactInput): Promise<DeliveryArtifactRow> {
    const id = input.id ?? ulid();
    return await this.db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, input.deliveryId))
        .limit(1);
      if (!delivery) throw new DeliveryNotFoundError(input.deliveryId);
      if (delivery.status === 'delivered' || delivery.status === 'cancelled') {
        throw new DeliveryStateError(
          input.deliveryId,
          'Artifacts cannot be added to a finalized or cancelled Delivery.',
          delivery.status,
        );
      }

      if (input.idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(deliveryArtifacts)
          .where(
            and(
              eq(deliveryArtifacts.delivery_id, input.deliveryId),
              eq(deliveryArtifacts.idempotency_key, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) return existing;
      }

      await tx
        .update(deliveryArtifacts)
        .set({ status: 'superseded', updated_at: new Date().toISOString() })
        .where(
          and(
            eq(deliveryArtifacts.delivery_id, input.deliveryId),
            eq(deliveryArtifacts.logical_key, input.logicalKey),
            eq(deliveryArtifacts.kind, input.kind),
            lt(deliveryArtifacts.revision, input.revision),
          ),
        );
      const [artifact] = await tx
        .insert(deliveryArtifacts)
        .values({
          id,
          delivery_id: input.deliveryId,
          blob_id: input.blobId,
          logical_key: input.logicalKey,
          revision: input.revision,
          kind: input.kind,
          original_filename: input.originalFilename,
          include_in_receipt: input.includeInReceipt ?? true,
          receipt_order: input.receiptOrder ?? 0,
          idempotency_key: input.idempotencyKey ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (!artifact) {
        if (input.idempotencyKey) {
          const [idempotent] = await tx
            .select()
            .from(deliveryArtifacts)
            .where(
              and(
                eq(deliveryArtifacts.delivery_id, input.deliveryId),
                eq(deliveryArtifacts.idempotency_key, input.idempotencyKey),
              ),
            )
            .limit(1);
          if (idempotent) return idempotent;
        }
        const [sameRevision] = await tx
          .select()
          .from(deliveryArtifacts)
          .where(
            and(
              eq(deliveryArtifacts.delivery_id, input.deliveryId),
              eq(deliveryArtifacts.logical_key, input.logicalKey),
              eq(deliveryArtifacts.kind, input.kind),
              eq(deliveryArtifacts.revision, input.revision),
            ),
          )
          .limit(1);
        if (sameRevision) {
          throw new ArtifactValidationError(
            'Artifact revision already exists; use a newer revision or retry with the original Idempotency-Key.',
            {
              logicalKey: input.logicalKey,
              kind: input.kind,
              revision: input.revision,
            },
          );
        }
        throw new RepoPersistenceError('delivery artifact', id);
      }

      const now = new Date().toISOString();
      await tx
        .update(deliveryApprovals)
        .set({
          invalidated_at: now,
          invalidated_reason: `Artifact ${input.logicalKey} revision ${String(input.revision)} was added.`,
        })
        .where(
          and(
            eq(deliveryApprovals.delivery_id, input.deliveryId),
            isNull(deliveryApprovals.invalidated_at),
          ),
        );
      await touchMutableDelivery(
        tx,
        input.deliveryId,
        delivery.status === 'approved' || delivery.status === 'ready'
          ? { status: 'in_review', previewed_evidence_version: null }
          : {},
      );
      return artifact;
    });
  }

  async getArtifact(id: string): Promise<DeliveryArtifactRow | null> {
    const [row] = await this.db
      .select()
      .from(deliveryArtifacts)
      .where(eq(deliveryArtifacts.id, id))
      .limit(1);
    return row ?? null;
  }

  async listArtifacts(deliveryId: string) {
    const rows = await this.db
      .select({ artifact: deliveryArtifacts, blob: artifactBlobs })
      .from(deliveryArtifacts)
      .innerJoin(artifactBlobs, eq(deliveryArtifacts.blob_id, artifactBlobs.id))
      .where(eq(deliveryArtifacts.delivery_id, deliveryId))
      .orderBy(
        asc(deliveryArtifacts.receipt_order),
        asc(deliveryArtifacts.logical_key),
        asc(deliveryArtifacts.revision),
      );
    const artifactIds = rows.map(({ artifact }) => artifact.id);
    const packageItems =
      artifactIds.length > 0
        ? await this.db
            .select({
              artifact_id: deliveryReviewPackageItems.artifact_id,
              role: deliveryReviewPackageItems.role,
            })
            .from(deliveryReviewPackageItems)
            .where(inArray(deliveryReviewPackageItems.artifact_id, artifactIds))
        : [];
    const roleByArtifactId = new Map(
      packageItems.flatMap((item) => (item.artifact_id ? [[item.artifact_id, item.role]] : [])),
    );
    return rows.map((row) => ({
      ...row,
      review_package_role: roleByArtifactId.get(row.artifact.id) ?? null,
    }));
  }

  async updateArtifact(
    id: string,
    patch: {
      status?: 'draft' | 'approved' | 'superseded';
      companionPdfArtifactId?: string | null;
      includeInReceipt?: boolean;
      receiptOrder?: number;
    },
  ): Promise<DeliveryArtifactRow> {
    return await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(deliveryArtifacts)
        .set({
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.companionPdfArtifactId !== undefined
            ? { companion_pdf_artifact_id: patch.companionPdfArtifactId }
            : {}),
          ...(patch.includeInReceipt !== undefined
            ? { include_in_receipt: patch.includeInReceipt }
            : {}),
          ...(patch.receiptOrder !== undefined ? { receipt_order: patch.receiptOrder } : {}),
          updated_at: new Date().toISOString(),
        })
        .where(eq(deliveryArtifacts.id, id))
        .returning();
      if (!row) throw new RepoPersistenceError('delivery artifact', id);
      await touchMutableDelivery(tx, row.delivery_id);
      return row;
    });
  }

  async createExternalRef(input: {
    deliveryId: string;
    provider: DeliveryExternalProvider;
    label: string;
    url: string;
  }): Promise<DeliveryExternalRefRow> {
    const id = ulid();
    return await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(deliveryExternalRefs)
        .values({
          id,
          delivery_id: input.deliveryId,
          provider: input.provider,
          label: input.label,
          url: input.url,
        })
        .returning();
      if (!row) throw new RepoPersistenceError('delivery external reference', id);
      await touchMutableDelivery(tx, input.deliveryId);
      return row;
    });
  }

  async listExternalRefs(deliveryId: string): Promise<DeliveryExternalRefRow[]> {
    return await this.db
      .select()
      .from(deliveryExternalRefs)
      .where(eq(deliveryExternalRefs.delivery_id, deliveryId))
      .orderBy(asc(deliveryExternalRefs.created_at));
  }

  async createFeedbackSource(input: {
    deliveryId: string;
    sourceType: FeedbackSourceType;
    sourceUrl?: string | null;
    authorDisplayName?: string | null;
    rawText: string;
    occurredAt?: string | null;
  }): Promise<DeliveryFeedbackSourceRow> {
    const id = ulid();
    return await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(deliveryFeedbackSources)
        .values({
          id,
          delivery_id: input.deliveryId,
          source_type: input.sourceType,
          source_url: input.sourceUrl ?? null,
          author_display_name: input.authorDisplayName ?? null,
          raw_text: input.rawText,
          occurred_at: input.occurredAt ?? null,
        })
        .returning();
      if (!row) throw new RepoPersistenceError('delivery feedback source', id);
      await touchMutableDelivery(tx, input.deliveryId);
      return row;
    });
  }

  async listFeedbackSources(deliveryId: string): Promise<DeliveryFeedbackSourceRow[]> {
    return await this.db
      .select()
      .from(deliveryFeedbackSources)
      .where(eq(deliveryFeedbackSources.delivery_id, deliveryId))
      .orderBy(asc(deliveryFeedbackSources.created_at));
  }

  async createWorkItems(
    deliveryId: string,
    items: Array<{
      feedbackSourceId?: string | null;
      kind: WorkItemKind;
      title: string;
      detail?: string;
      isAiDraft?: boolean;
      createdBy?: string;
    }>,
  ): Promise<DeliveryWorkItemRow[]> {
    if (items.length === 0) return [];
    return await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(deliveryWorkItems)
        .values(
          items.map((item) => ({
            id: ulid(),
            delivery_id: deliveryId,
            feedback_source_id: item.feedbackSourceId ?? null,
            kind: item.kind,
            title: item.title,
            detail: item.detail ?? '',
            is_ai_draft: item.isAiDraft ?? false,
            created_by: item.createdBy ?? 'admin',
          })),
        )
        .returning();
      await touchMutableDelivery(tx, deliveryId);
      return rows;
    });
  }

  async listWorkItems(deliveryId: string): Promise<DeliveryWorkItemRow[]> {
    return await this.db
      .select()
      .from(deliveryWorkItems)
      .where(eq(deliveryWorkItems.delivery_id, deliveryId))
      .orderBy(asc(deliveryWorkItems.created_at));
  }

  async updateWorkItem(
    id: string,
    status: WorkItemStatus,
    resolution?: string | null,
  ): Promise<DeliveryWorkItemRow> {
    const now = new Date().toISOString();
    return await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(deliveryWorkItems)
        .set({
          status,
          resolution: resolution ?? null,
          resolved_at: status === 'resolved' ? now : null,
          updated_at: now,
        })
        .where(eq(deliveryWorkItems.id, id))
        .returning();
      if (!row) throw new RepoPersistenceError('delivery work item', id);
      await touchMutableDelivery(tx, row.delivery_id);
      return row;
    });
  }

  async createApproval(input: {
    deliveryId: string;
    artifactIds: string[];
    approverDisplayName: string;
    approvalExcerpt: string;
    sourceType: FeedbackSourceType;
    sourceUrl?: string | null;
    approvedAt: string;
    recordedBy?: string;
  }): Promise<DeliveryApprovalRow> {
    const id = ulid();
    return await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(deliveryApprovals)
        .values({
          id,
          delivery_id: input.deliveryId,
          artifact_ids: input.artifactIds,
          approver_display_name: input.approverDisplayName,
          approval_excerpt: input.approvalExcerpt,
          source_type: input.sourceType,
          source_url: input.sourceUrl ?? null,
          approved_at: input.approvedAt,
          recorded_by: input.recordedBy ?? 'admin',
        })
        .returning();
      if (!row) throw new RepoPersistenceError('delivery approval', id);
      await touchMutableDelivery(tx, input.deliveryId);
      return row;
    });
  }

  async listApprovals(deliveryId: string): Promise<DeliveryApprovalRow[]> {
    return await this.db
      .select()
      .from(deliveryApprovals)
      .where(eq(deliveryApprovals.delivery_id, deliveryId))
      .orderBy(asc(deliveryApprovals.approved_at));
  }

  async listGates(deliveryId: string): Promise<DeliveryGateRow[]> {
    return await this.db
      .select()
      .from(deliveryGates)
      .where(eq(deliveryGates.delivery_id, deliveryId))
      .orderBy(asc(deliveryGates.created_at));
  }

  async updateGateTemplate(
    deliveryId: string,
    gateKey: string,
    patch: { required?: boolean; label?: string; gateType?: GateType },
  ): Promise<DeliveryGateRow> {
    return await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(deliveryGates)
        .set({
          ...(patch.required !== undefined ? { required: patch.required } : {}),
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.gateType !== undefined ? { gate_type: patch.gateType } : {}),
          updated_at: new Date().toISOString(),
        })
        .where(and(eq(deliveryGates.delivery_id, deliveryId), eq(deliveryGates.gate_key, gateKey)))
        .returning();
      if (!row) throw new RepoPersistenceError('delivery gate', gateKey);
      await touchMutableDelivery(tx, deliveryId);
      return row;
    });
  }

  async resetGatesForType(
    deliveryId: string,
    deliveryType: DeliveryType,
  ): Promise<DeliveryGateRow[]> {
    return await this.db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, deliveryId))
        .limit(1);
      if (!delivery) throw new DeliveryNotFoundError(deliveryId);
      const [settings] = await tx
        .select()
        .from(projectDeliverySettings)
        .where(eq(projectDeliverySettings.project_id, delivery.project_id))
        .limit(1);
      const templates =
        parseDefaultDeliveryGates(settings?.default_gates_json) ?? DEFAULT_DELIVERY_GATES;
      await tx.delete(deliveryGates).where(eq(deliveryGates.delivery_id, deliveryId));
      const rows = await tx
        .insert(deliveryGates)
        .values(
          templates[deliveryType].map((gate) => ({
            id: ulid(),
            delivery_id: deliveryId,
            ...gate,
          })),
        )
        .returning();
      await touchMutableDelivery(tx, deliveryId);
      return rows;
    });
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
    requestSha256?: string | null;
    recordedBy?: string;
  }): Promise<DeliveryGateRow> {
    return await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: deliveries.id, status: deliveries.status })
        .from(deliveries)
        .where(eq(deliveries.id, input.deliveryId))
        .for('update');
      if (!locked) throw new DeliveryNotFoundError(input.deliveryId);
      if (locked.status === 'delivered' || locked.status === 'cancelled') {
        throw new DeliveryStateError(
          input.deliveryId,
          'Finalized or cancelled Deliveries are immutable.',
          locked.status,
        );
      }

      const operation = `gate_result:${input.gateKey}`;
      if (input.idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(deliveryIdempotencyRecords)
          .where(
            and(
              eq(deliveryIdempotencyRecords.delivery_id, input.deliveryId),
              eq(deliveryIdempotencyRecords.operation, operation),
              eq(deliveryIdempotencyRecords.idempotency_key, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) {
          if (!input.requestSha256 || existing.request_sha256 !== input.requestSha256) {
            throw new DeliveryIdempotencyConflictError(
              input.deliveryId,
              operation,
              input.idempotencyKey,
            );
          }
          return existing.response_json as unknown as DeliveryGateRow;
        }
      }

      const [row] = await tx
        .update(deliveryGates)
        .set({
          status: input.status,
          summary: input.summary ?? null,
          waiver_reason: input.waiverReason ?? null,
          warning_accepted: input.warningAccepted ?? false,
          report_artifact_id: input.reportArtifactId ?? null,
          idempotency_key: input.idempotencyKey ?? null,
          recorded_by: input.recordedBy ?? 'admin',
          recorded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .where(
          and(
            eq(deliveryGates.delivery_id, input.deliveryId),
            eq(deliveryGates.gate_key, input.gateKey),
          ),
        )
        .returning();
      if (!row) throw new RepoPersistenceError('delivery gate', input.gateKey);

      if (input.idempotencyKey && input.requestSha256) {
        await tx.insert(deliveryIdempotencyRecords).values({
          id: ulid(),
          delivery_id: input.deliveryId,
          operation,
          idempotency_key: input.idempotencyKey,
          request_sha256: input.requestSha256,
          response_json: row,
        });
      }
      await touchMutableDelivery(tx, input.deliveryId);
      return row;
    });
  }

  async acceptReviewCheckpoint(input: {
    deliveryId: string;
    gateKey: string;
    artifactId: string;
    expectedSha256: string;
    summary?: string | null;
    recordedBy: string;
  }): Promise<{ artifact: DeliveryArtifactRow; gate: DeliveryGateRow }> {
    return await this.db.transaction(async (tx) => {
      const [delivery] = await tx
        .select({ id: deliveries.id, status: deliveries.status })
        .from(deliveries)
        .where(eq(deliveries.id, input.deliveryId))
        .for('update');
      if (!delivery) throw new DeliveryNotFoundError(input.deliveryId);
      if (delivery.status !== 'in_review') {
        throw new DeliveryStateError(
          input.deliveryId,
          'Only a Delivery currently in review can accept a review checkpoint.',
          delivery.status,
        );
      }

      const [gate] = await tx
        .select()
        .from(deliveryGates)
        .where(
          and(
            eq(deliveryGates.delivery_id, input.deliveryId),
            eq(deliveryGates.gate_key, input.gateKey),
          ),
        )
        .for('update');
      if (!gate || gate.gate_type !== 'review') {
        throw new ArtifactValidationError('The selected Gate is not a Delivery review Gate.', {
          deliveryId: input.deliveryId,
          gateKey: input.gateKey,
        });
      }
      if (gate.report_artifact_id !== input.artifactId) {
        throw new ArtifactValidationError(
          'The selected artifact is not the exact version bound to this review Gate.',
          {
            deliveryId: input.deliveryId,
            gateKey: input.gateKey,
            artifactId: input.artifactId,
            boundArtifactId: gate.report_artifact_id,
          },
        );
      }

      const [target] = await tx
        .select({ artifact: deliveryArtifacts, blob: artifactBlobs })
        .from(deliveryArtifacts)
        .innerJoin(artifactBlobs, eq(deliveryArtifacts.blob_id, artifactBlobs.id))
        .where(
          and(
            eq(deliveryArtifacts.id, input.artifactId),
            eq(deliveryArtifacts.delivery_id, input.deliveryId),
          ),
        )
        .for('update');
      if (!target) throw new ArtifactNotFoundError(input.artifactId);
      if (target.blob.sha256.toLowerCase() !== input.expectedSha256.toLowerCase()) {
        throw new ArtifactValidationError('Artifact SHA-256 does not match the review request.', {
          artifactId: input.artifactId,
          expectedSha256: input.expectedSha256,
          actualSha256: target.blob.sha256,
        });
      }
      if (target.artifact.status === 'superseded') {
        throw new ArtifactValidationError(
          'A superseded artifact cannot be accepted; review the latest revision instead.',
          { artifactId: input.artifactId },
        );
      }

      const [latest] = await tx
        .select({ id: deliveryArtifacts.id, revision: deliveryArtifacts.revision })
        .from(deliveryArtifacts)
        .where(
          and(
            eq(deliveryArtifacts.delivery_id, input.deliveryId),
            eq(deliveryArtifacts.logical_key, target.artifact.logical_key),
            eq(deliveryArtifacts.kind, target.artifact.kind),
            notInArray(deliveryArtifacts.status, ['superseded']),
          ),
        )
        .orderBy(desc(deliveryArtifacts.revision), desc(deliveryArtifacts.created_at))
        .limit(1);
      if (!latest || latest.id !== input.artifactId) {
        throw new ArtifactValidationError(
          'Only the latest non-superseded artifact can be accepted.',
          {
            artifactId: input.artifactId,
            latestArtifactId: latest?.id ?? null,
            latestRevision: latest?.revision ?? null,
          },
        );
      }

      if (gate.status === 'passed' && target.artifact.status === 'approved') {
        return { artifact: target.artifact, gate };
      }
      if (gate.status !== 'pending') {
        throw new DeliveryStateError(
          input.deliveryId,
          'Only a pending review Gate can be accepted.',
          gate.status,
        );
      }

      const now = new Date().toISOString();
      const [artifact] = await tx
        .update(deliveryArtifacts)
        .set({ status: 'approved', updated_at: now })
        .where(eq(deliveryArtifacts.id, input.artifactId))
        .returning();
      const [acceptedGate] = await tx
        .update(deliveryGates)
        .set({
          status: 'passed',
          summary: input.summary?.trim() || gate.summary,
          waiver_reason: null,
          warning_accepted: false,
          recorded_by: input.recordedBy,
          recorded_at: now,
          updated_at: now,
        })
        .where(eq(deliveryGates.id, gate.id))
        .returning();
      if (!artifact) throw new RepoPersistenceError('delivery artifact', input.artifactId);
      if (!acceptedGate) throw new RepoPersistenceError('delivery gate', input.gateKey);
      await touchMutableDelivery(tx, input.deliveryId);
      return { artifact, gate: acceptedGate };
    });
  }

  async linkDeploy(input: {
    deliveryId: string;
    deployId: string;
    relation: 'candidate' | 'released' | 'rollback';
  }) {
    const id = ulid();
    return await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(deliveryDeployLinks)
        .values({
          id,
          delivery_id: input.deliveryId,
          deploy_id: input.deployId,
          relation: input.relation,
        })
        .onConflictDoNothing()
        .returning();
      if (row) {
        await touchMutableDelivery(tx, input.deliveryId);
        return row;
      }
      const [existing] = await tx
        .select()
        .from(deliveryDeployLinks)
        .where(
          and(
            eq(deliveryDeployLinks.delivery_id, input.deliveryId),
            eq(deliveryDeployLinks.deploy_id, input.deployId),
            eq(deliveryDeployLinks.relation, input.relation),
          ),
        )
        .limit(1);
      if (!existing) throw new RepoPersistenceError('delivery deploy link', id);
      return existing;
    });
  }

  async unlinkDeploy(deliveryId: string, deployId: string): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      const rows = await tx
        .delete(deliveryDeployLinks)
        .where(
          and(
            eq(deliveryDeployLinks.delivery_id, deliveryId),
            eq(deliveryDeployLinks.deploy_id, deployId),
          ),
        )
        .returning({ id: deliveryDeployLinks.id });
      if (rows.length > 0) await touchMutableDelivery(tx, deliveryId);
      return rows.length > 0;
    });
  }

  async listDeployEvidence(deliveryId: string): Promise<DeliveryDeployEvidence[]> {
    const rows = await this.db
      .select({
        link: deliveryDeployLinks,
        deploy: deployLogs,
        service: services,
        environment: environments,
      })
      .from(deliveryDeployLinks)
      .innerJoin(deployLogs, eq(deliveryDeployLinks.deploy_id, deployLogs.id))
      .innerJoin(services, eq(deployLogs.service_id, services.id))
      .leftJoin(environments, eq(deployLogs.environment_id, environments.id))
      .where(eq(deliveryDeployLinks.delivery_id, deliveryId))
      .orderBy(asc(deliveryDeployLinks.linked_at));
    return rows;
  }

  async getSettings(projectId: string): Promise<ProjectDeliverySettingsRow> {
    const [row] = await this.db
      .select()
      .from(projectDeliverySettings)
      .where(eq(projectDeliverySettings.project_id, projectId))
      .limit(1);
    if (row) return row;
    const now = new Date().toISOString();
    return {
      project_id: projectId,
      ...DEFAULT_SETTINGS,
      created_at: now,
      updated_at: now,
    };
  }

  async upsertSettings(
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
    const now = new Date().toISOString();
    return await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(projectDeliverySettings)
        .values({ project_id: projectId, ...DEFAULT_SETTINGS, ...input, updated_at: now })
        .onConflictDoUpdate({
          target: projectDeliverySettings.project_id,
          set: { ...input, updated_at: now },
        })
        .returning();
      if (!row) throw new RepoPersistenceError('project delivery settings', projectId);
      await tx
        .update(deliveries)
        .set({
          status: sql`CASE WHEN ${deliveries.status} = 'ready' THEN 'approved' ELSE ${deliveries.status} END`,
          evidence_version: sql`${deliveries.evidence_version} + 1`,
          updated_at: now,
        })
        .where(
          and(
            eq(deliveries.project_id, projectId),
            notInArray(deliveries.status, ['delivered', 'cancelled']),
          ),
        );
      return row;
    });
  }

  async getReceipt(deliveryId: string): Promise<DeliveryReceiptRow | null> {
    const [row] = await this.db
      .select()
      .from(deliveryReceipts)
      .where(eq(deliveryReceipts.delivery_id, deliveryId))
      .limit(1);
    return row ?? null;
  }

  async recordReceiptPreview(
    deliveryId: string,
    expectedEvidenceVersion: number,
  ): Promise<DeliveryRow> {
    return await this.client.begin(async (tx) => {
      const locked = await tx<
        Array<{
          id: string;
          status: DeliveryStatus;
          evidence_version: number;
          previewed_evidence_version: number | null;
        }>
      >`
        SELECT id, status, evidence_version, previewed_evidence_version
        FROM deliveries
        WHERE id = ${deliveryId}
        FOR UPDATE
      `;
      const delivery = locked[0];
      if (!delivery) throw new DeliveryNotFoundError(deliveryId);
      if (delivery.status !== 'approved' && delivery.status !== 'ready') {
        throw new DeliveryStateError(
          deliveryId,
          'Delivery must be approved before Receipt preview.',
          delivery.status,
        );
      }
      if (delivery.evidence_version !== expectedEvidenceVersion) {
        throw new DeliveryStateError(
          deliveryId,
          'Delivery evidence changed while the Receipt preview was generated. Generate it again.',
          delivery.status,
        );
      }

      const previewedVersion =
        delivery.status === 'approved' ? delivery.evidence_version + 1 : delivery.evidence_version;
      const rows = await tx<DeliveryRow[]>`
        UPDATE deliveries
        SET
          status = 'ready',
          evidence_version = ${previewedVersion},
          previewed_evidence_version = ${previewedVersion},
          updated_at = ${new Date().toISOString()}
        WHERE id = ${deliveryId}
        RETURNING *
      `;
      const updated = rows[0];
      if (!updated) throw new RepoPersistenceError('delivery Receipt preview state', deliveryId);
      return updated;
    });
  }

  async finalizeReceipt(input: {
    id: string;
    deliveryId: string;
    snapshotJson: Record<string, unknown>;
    pdfBlobId: string;
    pdfSha256: string;
    finalizedBy: string;
    finalizedAt: string;
    expectedEvidenceVersion: number;
  }): Promise<DeliveryReceiptRow> {
    return await this.client.begin(async (tx) => {
      const locked = await tx<
        Array<{
          id: string;
          status: DeliveryStatus;
          evidence_version: number;
          previewed_evidence_version: number | null;
        }>
      >`
        SELECT id, status, evidence_version, previewed_evidence_version
        FROM deliveries
        WHERE id = ${input.deliveryId}
        FOR UPDATE
      `;
      const delivery = locked[0];
      if (!delivery) throw new DeliveryNotFoundError(input.deliveryId);
      if (delivery.status === 'delivered') {
        const existing = await tx<DeliveryReceiptRow[]>`
          SELECT * FROM delivery_receipts WHERE delivery_id = ${input.deliveryId} LIMIT 1
        `;
        if (existing[0]) return existing[0];
        throw new DeliveryStateError(
          input.deliveryId,
          'Delivered Delivery is missing its immutable Receipt.',
          delivery.status,
        );
      }
      if (delivery.status !== 'ready') {
        throw new DeliveryStateError(
          input.deliveryId,
          'Delivery must still be ready when the Receipt is finalized.',
          delivery.status,
        );
      }
      if (
        delivery.evidence_version !== input.expectedEvidenceVersion ||
        delivery.previewed_evidence_version !== delivery.evidence_version
      ) {
        throw new DeliveryStateError(
          input.deliveryId,
          'Delivery evidence changed after the last Receipt preview. Generate a new preview.',
          delivery.status,
        );
      }
      const inserted = await tx<DeliveryReceiptRow[]>`
        INSERT INTO delivery_receipts (
          id, delivery_id, revision, snapshot_json, pdf_blob_id, pdf_sha256,
          finalized_by, finalized_at
        ) VALUES (
          ${input.id}, ${input.deliveryId}, 1, ${JSON.stringify(input.snapshotJson)}::jsonb,
          ${input.pdfBlobId}, ${input.pdfSha256}, ${input.finalizedBy}, ${input.finalizedAt}
        )
        ON CONFLICT (delivery_id) DO NOTHING
        RETURNING *
      `;
      const receipt =
        inserted[0] ??
        (
          await tx<DeliveryReceiptRow[]>`
            SELECT * FROM delivery_receipts WHERE delivery_id = ${input.deliveryId} LIMIT 1
          `
        )[0];
      if (!receipt) throw new RepoPersistenceError('delivery receipt', input.id);
      await tx`
        UPDATE deliveries
        SET
          status = 'delivered',
          evidence_version = evidence_version + 1,
          updated_at = ${input.finalizedAt}
        WHERE id = ${input.deliveryId}
      `;
      return receipt;
    });
  }

  async getDeliveryProjectIdByArtifactId(artifactId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ projectId: deliveries.project_id })
      .from(deliveryArtifacts)
      .innerJoin(deliveries, eq(deliveryArtifacts.delivery_id, deliveries.id))
      .where(eq(deliveryArtifacts.id, artifactId))
      .limit(1);
    return row?.projectId ?? null;
  }

  async getDeliveryProjectIdByDeployId(deployId: string): Promise<string[]> {
    const rows = await this.db
      .select({ projectId: deliveries.project_id })
      .from(deliveryDeployLinks)
      .innerJoin(deliveries, eq(deliveryDeployLinks.delivery_id, deliveries.id))
      .where(eq(deliveryDeployLinks.deploy_id, deployId));
    return [...new Set(rows.map((row) => row.projectId))];
  }

  async getArtifactsByIds(ids: string[]): Promise<DeliveryArtifactRow[]> {
    if (ids.length === 0) return [];
    return await this.db.select().from(deliveryArtifacts).where(inArray(deliveryArtifacts.id, ids));
  }

  async getArtifactProjectRowsByIds(
    ids: string[],
  ): Promise<Array<{ artifact_id: string; delivery_id: string; project_id: string }>> {
    if (ids.length === 0) return [];
    return await this.db
      .select({
        artifact_id: deliveryArtifacts.id,
        delivery_id: deliveryArtifacts.delivery_id,
        project_id: deliveries.project_id,
      })
      .from(deliveryArtifacts)
      .innerJoin(deliveries, eq(deliveryArtifacts.delivery_id, deliveries.id))
      .where(inArray(deliveryArtifacts.id, ids));
  }
}
