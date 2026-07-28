import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import {
  ArtifactValidationError,
  DeliveryEvidenceVersionConflictError,
  DeliveryNotFoundError,
  DeliveryReviewPackageExpiredError,
  DeliveryReviewPackageManifestMismatchError,
  DeliveryReviewPackageNotReadyError,
  DeliveryStateError,
  RepoPersistenceError,
} from '../../errors.js';
import type {
  DeliveryReviewPackageDetail,
  DeliveryReviewPackageFileSpec,
  DeliveryReviewPackageOverview,
  PublishedDeliveryReviewPackage,
} from '../../delivery/review-package-types.js';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import {
  artifactBlobs,
  deliveries,
  deliveryAgentRuns,
  deliveryApprovals,
  deliveryArtifacts,
  deliveryGates,
  deliveryReceipts,
  deliveryReviewPackageItems,
  deliveryReviewPackages,
  engagementWeeklyReports,
  projectDeliverySettings,
  type ArtifactBlobRow,
  type DeliveryArtifactRow,
  type DeliveryApprovalRow,
  type DeliveryReviewPackageItemRow,
  type DeliveryReviewPackageRow,
} from '../schema.drizzle.js';
import { ulid } from './activity-log.repo.js';

const REVIEW_PACKAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function requiredForRole(role: DeliveryReviewPackageFileSpec['role']): boolean {
  return role !== 'representative_image';
}

function artifactMetadata(role: DeliveryReviewPackageFileSpec['role']): {
  logicalKey: string;
  kind: DeliveryArtifactRow['kind'];
  receiptOrder: number;
} {
  if (role === 'review_document') {
    return { logicalKey: 'customer-review-package', kind: 'companion_pdf', receiptOrder: 10 };
  }
  if (role === 'interactive_preview') {
    return { logicalKey: 'customer-review-package', kind: 'review_html', receiptOrder: 20 };
  }
  return { logicalKey: 'customer-review-package-image', kind: 'image', receiptOrder: 30 };
}

export class DeliveryReviewPackageRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async create(input: {
    deliveryId: string;
    sourceRunId?: string | null;
    reviewGateKey: string;
    reviewNote: string;
    manifestSha256: string;
    overview: DeliveryReviewPackageOverview;
    overviewBeforeSha256: string;
    overviewAfterSha256: string;
    files: DeliveryReviewPackageFileSpec[];
    replaceDraft: boolean;
    createdBy: string;
    now?: Date;
  }): Promise<DeliveryReviewPackageDetail> {
    const now = input.now ?? new Date();
    return await this.db.transaction(async (tx) => {
      const [delivery] = await tx
        .select()
        .from(deliveries)
        .where(eq(deliveries.id, input.deliveryId))
        .for('update');
      if (!delivery) throw new DeliveryNotFoundError(input.deliveryId);
      if (delivery.status === 'delivered' || delivery.status === 'cancelled') {
        throw new DeliveryStateError(
          delivery.id,
          'A review package cannot be prepared for a finalized or cancelled Delivery.',
          delivery.status,
        );
      }

      const [gate] = await tx
        .select()
        .from(deliveryGates)
        .where(
          and(
            eq(deliveryGates.delivery_id, delivery.id),
            eq(deliveryGates.gate_key, input.reviewGateKey),
          ),
        )
        .limit(1);
      if (!gate || gate.gate_type !== 'review') {
        throw new ArtifactValidationError('The selected Gate is not a Delivery review Gate.', {
          deliveryId: delivery.id,
          gateKey: input.reviewGateKey,
        });
      }

      if (input.sourceRunId) {
        const [run] = await tx
          .select({ delivery_id: deliveryAgentRuns.delivery_id })
          .from(deliveryAgentRuns)
          .where(eq(deliveryAgentRuns.id, input.sourceRunId))
          .limit(1);
        if (!run || run.delivery_id !== delivery.id) {
          throw new ArtifactValidationError('Source Agent Run must belong to the Delivery.', {
            deliveryId: delivery.id,
            sourceRunId: input.sourceRunId,
          });
        }
      }

      const [draft] = await tx
        .select()
        .from(deliveryReviewPackages)
        .where(
          and(
            eq(deliveryReviewPackages.delivery_id, delivery.id),
            eq(deliveryReviewPackages.status, 'draft'),
          ),
        )
        .for('update');
      if (draft) {
        if (Date.parse(draft.expires_at) <= now.getTime()) {
          await tx
            .update(deliveryReviewPackages)
            .set({ status: 'expired', updated_at: now.toISOString() })
            .where(eq(deliveryReviewPackages.id, draft.id));
        } else if (!input.replaceDraft) {
          throw new DeliveryReviewPackageNotReadyError(draft.id, 'active_draft_exists', {
            deliveryId: delivery.id,
          });
        } else {
          await tx
            .update(deliveryReviewPackages)
            .set({ status: 'aborted', updated_at: now.toISOString() })
            .where(eq(deliveryReviewPackages.id, draft.id));
        }
      }

      const [packageRevision] = await tx
        .select({ value: max(deliveryReviewPackages.revision) })
        .from(deliveryReviewPackages)
        .where(eq(deliveryReviewPackages.delivery_id, delivery.id));
      const [artifactRevision] = await tx
        .select({ value: max(deliveryArtifacts.revision) })
        .from(deliveryArtifacts)
        .where(
          and(
            eq(deliveryArtifacts.delivery_id, delivery.id),
            inArray(deliveryArtifacts.kind, ['review_html', 'companion_pdf']),
          ),
        );
      const revision = Math.max(packageRevision?.value ?? 0, artifactRevision?.value ?? 0) + 1;
      const packageId = ulid();
      const [created] = await tx
        .insert(deliveryReviewPackages)
        .values({
          id: packageId,
          delivery_id: delivery.id,
          revision,
          manifest_sha256: input.manifestSha256,
          base_evidence_version: delivery.evidence_version,
          source_run_id: input.sourceRunId ?? null,
          review_gate_key: input.reviewGateKey,
          review_note: input.reviewNote,
          overview_mode: input.overview.mode,
          overview_patch:
            input.overview.mode === 'update'
              ? {
                  ...(input.overview.title !== undefined ? { title: input.overview.title } : {}),
                  ...(input.overview.summary !== undefined
                    ? { summary: input.overview.summary }
                    : {}),
                  ...(input.overview.limitations !== undefined
                    ? { limitations: input.overview.limitations }
                    : {}),
                }
              : null,
          overview_keep_reason: input.overview.mode === 'keep' ? input.overview.reason : null,
          overview_before_sha256: input.overviewBeforeSha256,
          overview_after_sha256: input.overviewAfterSha256,
          expires_at: new Date(now.getTime() + REVIEW_PACKAGE_TTL_MS).toISOString(),
          created_by: input.createdBy,
        })
        .returning();
      if (!created) throw new RepoPersistenceError('delivery review package', packageId);

      const items = await tx
        .insert(deliveryReviewPackageItems)
        .values(
          input.files.map((file) => ({
            id: ulid(),
            package_id: packageId,
            role: file.role,
            filename: file.filename,
            expected_sha256: file.expected_sha256,
            expected_size_bytes: file.expected_size_bytes,
            expected_mime_type: file.mime_type,
            required: requiredForRole(file.role),
          })),
        )
        .returning();
      return {
        package: created,
        delivery,
        items: items.map((item) => ({ item, blob: null, artifact: null })),
        gate,
      };
    });
  }

  async get(packageId: string): Promise<DeliveryReviewPackageDetail | null> {
    const [row] = await this.db
      .select({ package: deliveryReviewPackages, delivery: deliveries })
      .from(deliveryReviewPackages)
      .innerJoin(deliveries, eq(deliveryReviewPackages.delivery_id, deliveries.id))
      .where(eq(deliveryReviewPackages.id, packageId))
      .limit(1);
    if (!row) return null;
    const [items, gates] = await Promise.all([
      this.db
        .select({
          item: deliveryReviewPackageItems,
          blob: artifactBlobs,
          artifact: deliveryArtifacts,
        })
        .from(deliveryReviewPackageItems)
        .leftJoin(artifactBlobs, eq(deliveryReviewPackageItems.blob_id, artifactBlobs.id))
        .leftJoin(
          deliveryArtifacts,
          eq(deliveryReviewPackageItems.artifact_id, deliveryArtifacts.id),
        )
        .where(eq(deliveryReviewPackageItems.package_id, packageId)),
      this.db
        .select()
        .from(deliveryGates)
        .where(
          and(
            eq(deliveryGates.delivery_id, row.delivery.id),
            eq(deliveryGates.gate_key, row.package.review_gate_key),
          ),
        )
        .limit(1),
    ]);
    return { ...row, items, gate: gates[0] ?? null };
  }

  async listForDelivery(deliveryId: string): Promise<DeliveryReviewPackageRow[]> {
    return await this.db
      .select()
      .from(deliveryReviewPackages)
      .where(eq(deliveryReviewPackages.delivery_id, deliveryId))
      .orderBy(desc(deliveryReviewPackages.revision));
  }

  async getItem(itemId: string): Promise<{
    item: DeliveryReviewPackageItemRow;
    package: DeliveryReviewPackageRow;
  } | null> {
    const [row] = await this.db
      .select({ item: deliveryReviewPackageItems, package: deliveryReviewPackages })
      .from(deliveryReviewPackageItems)
      .innerJoin(
        deliveryReviewPackages,
        eq(deliveryReviewPackageItems.package_id, deliveryReviewPackages.id),
      )
      .where(eq(deliveryReviewPackageItems.id, itemId))
      .limit(1);
    return row ?? null;
  }

  async recordUploadSuccess(input: {
    itemId: string;
    blob: ArtifactBlobRow;
    now?: Date;
  }): Promise<DeliveryReviewPackageItemRow> {
    const now = input.now ?? new Date();
    return await this.db.transaction(async (tx) => {
      const [context] = await tx
        .select({ item: deliveryReviewPackageItems, package: deliveryReviewPackages })
        .from(deliveryReviewPackageItems)
        .innerJoin(
          deliveryReviewPackages,
          eq(deliveryReviewPackageItems.package_id, deliveryReviewPackages.id),
        )
        .where(eq(deliveryReviewPackageItems.id, input.itemId))
        .for('update');
      if (!context) {
        throw new DeliveryReviewPackageNotReadyError(input.itemId, 'item_not_found');
      }
      if (context.package.status !== 'draft') {
        throw new DeliveryReviewPackageNotReadyError(context.package.id, 'package_not_draft');
      }
      if (Date.parse(context.package.expires_at) <= now.getTime()) {
        await tx
          .update(deliveryReviewPackages)
          .set({ status: 'expired', updated_at: now.toISOString() })
          .where(eq(deliveryReviewPackages.id, context.package.id));
        throw new DeliveryReviewPackageExpiredError(context.package.id);
      }
      const [row] = await tx
        .update(deliveryReviewPackageItems)
        .set({
          status: 'uploaded',
          blob_id: input.blob.id,
          attempt_count: sql`${deliveryReviewPackageItems.attempt_count} + 1`,
          actual_sha256: input.blob.sha256,
          actual_size_bytes: input.blob.size_bytes,
          actual_mime_type: input.blob.mime_type,
          last_error_code: null,
          last_error_details: null,
          uploaded_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .where(eq(deliveryReviewPackageItems.id, input.itemId))
        .returning();
      if (!row) throw new RepoPersistenceError('delivery review package item', input.itemId);
      return row;
    });
  }

  async recordUploadFailure(input: {
    itemId: string;
    code: string;
    details?: Record<string, unknown>;
    actualSha256?: string | null;
    actualSizeBytes?: number | null;
    actualMimeType?: string | null;
  }): Promise<void> {
    await this.db
      .update(deliveryReviewPackageItems)
      .set({
        status: 'failed',
        attempt_count: sql`${deliveryReviewPackageItems.attempt_count} + 1`,
        last_error_code: input.code,
        last_error_details: input.details ?? null,
        actual_sha256: input.actualSha256 ?? null,
        actual_size_bytes: input.actualSizeBytes ?? null,
        actual_mime_type: input.actualMimeType ?? null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(deliveryReviewPackageItems.id, input.itemId));
  }

  async publish(input: {
    packageId: string;
    expectedManifestSha256: string;
    expectedDeliveryEvidenceVersion: number;
    actor: string;
    now?: Date;
  }): Promise<PublishedDeliveryReviewPackage> {
    const now = input.now ?? new Date();
    return await this.db.transaction(async (tx) => {
      const [context] = await tx
        .select({ package: deliveryReviewPackages, delivery: deliveries })
        .from(deliveryReviewPackages)
        .innerJoin(deliveries, eq(deliveryReviewPackages.delivery_id, deliveries.id))
        .where(eq(deliveryReviewPackages.id, input.packageId))
        .for('update');
      if (!context) {
        throw new DeliveryReviewPackageNotReadyError(input.packageId, 'package_not_found');
      }
      const packageRow = context.package;
      const delivery = context.delivery;
      if (packageRow.status === 'published') {
        if (packageRow.manifest_sha256 !== input.expectedManifestSha256) {
          throw new DeliveryReviewPackageManifestMismatchError(
            packageRow.id,
            input.expectedManifestSha256,
            packageRow.manifest_sha256,
          );
        }
        const publishedItems = await tx
          .select({
            item: deliveryReviewPackageItems,
            blob: artifactBlobs,
            artifact: deliveryArtifacts,
          })
          .from(deliveryReviewPackageItems)
          .leftJoin(artifactBlobs, eq(deliveryReviewPackageItems.blob_id, artifactBlobs.id))
          .leftJoin(
            deliveryArtifacts,
            eq(deliveryReviewPackageItems.artifact_id, deliveryArtifacts.id),
          )
          .where(eq(deliveryReviewPackageItems.package_id, packageRow.id));
        const gates = await tx
          .select()
          .from(deliveryGates)
          .where(
            and(
              eq(deliveryGates.delivery_id, delivery.id),
              eq(deliveryGates.gate_key, packageRow.review_gate_key),
            ),
          )
          .limit(1);
        const primary = publishedItems.find(
          ({ item }) => item.role === 'review_document',
        )?.artifact;
        if (!primary) {
          throw new DeliveryReviewPackageNotReadyError(packageRow.id, 'published_artifact_missing');
        }
        return {
          package: packageRow,
          delivery,
          items: publishedItems,
          gate: gates[0] ?? null,
          primaryArtifact: primary,
          artifacts: publishedItems.flatMap(({ artifact }) => (artifact ? [artifact] : [])),
        };
      }
      if (packageRow.status !== 'draft') {
        throw new DeliveryReviewPackageNotReadyError(packageRow.id, 'package_not_draft', {
          status: packageRow.status,
        });
      }
      if (Date.parse(packageRow.expires_at) <= now.getTime()) {
        await tx
          .update(deliveryReviewPackages)
          .set({ status: 'expired', updated_at: now.toISOString() })
          .where(eq(deliveryReviewPackages.id, packageRow.id));
        throw new DeliveryReviewPackageExpiredError(packageRow.id);
      }
      if (packageRow.manifest_sha256 !== input.expectedManifestSha256) {
        throw new DeliveryReviewPackageManifestMismatchError(
          packageRow.id,
          input.expectedManifestSha256,
          packageRow.manifest_sha256,
        );
      }
      if (
        delivery.evidence_version !== input.expectedDeliveryEvidenceVersion ||
        delivery.evidence_version !== packageRow.base_evidence_version
      ) {
        throw new DeliveryEvidenceVersionConflictError(
          delivery.id,
          packageRow.base_evidence_version,
          delivery.evidence_version,
        );
      }
      if (delivery.status === 'delivered' || delivery.status === 'cancelled') {
        throw new DeliveryStateError(
          delivery.id,
          'A review package cannot be published for a finalized or cancelled Delivery.',
          delivery.status,
        );
      }

      const lockedItems = await tx
        .select()
        .from(deliveryReviewPackageItems)
        .where(eq(deliveryReviewPackageItems.package_id, packageRow.id))
        .for('update');
      const blobIds = lockedItems.flatMap((item) => (item.blob_id ? [item.blob_id] : []));
      const blobs =
        blobIds.length > 0
          ? await tx.select().from(artifactBlobs).where(inArray(artifactBlobs.id, blobIds))
          : [];
      const blobsById = new Map(blobs.map((blob) => [blob.id, blob]));
      const items = lockedItems.map((item) => ({
        item,
        blob: item.blob_id ? (blobsById.get(item.blob_id) ?? null) : null,
      }));
      const blockers = items
        .filter(({ item, blob }) => item.required && (item.status !== 'uploaded' || !blob))
        .map(({ item }) => item.role);
      if (blockers.length > 0) {
        throw new DeliveryReviewPackageNotReadyError(packageRow.id, 'required_files_missing', {
          missingRoles: blockers,
        });
      }
      const primaryItem = items.find(({ item }) => item.role === 'review_document');
      if (!primaryItem?.blob) {
        throw new DeliveryReviewPackageNotReadyError(packageRow.id, 'review_document_missing');
      }
      const [gate] = await tx
        .select()
        .from(deliveryGates)
        .where(
          and(
            eq(deliveryGates.delivery_id, delivery.id),
            eq(deliveryGates.gate_key, packageRow.review_gate_key),
          ),
        )
        .for('update');
      if (!gate || gate.gate_type !== 'review') {
        throw new DeliveryReviewPackageNotReadyError(packageRow.id, 'review_gate_missing');
      }

      await tx
        .update(deliveryReviewPackages)
        .set({ status: 'superseded', updated_at: now.toISOString() })
        .where(
          and(
            eq(deliveryReviewPackages.delivery_id, delivery.id),
            eq(deliveryReviewPackages.status, 'published'),
          ),
        );
      await tx
        .update(deliveryApprovals)
        .set({
          invalidated_at: now.toISOString(),
          invalidated_reason: `Customer review package revision ${String(packageRow.revision)} was published.`,
        })
        .where(
          and(
            eq(deliveryApprovals.delivery_id, delivery.id),
            isNull(deliveryApprovals.invalidated_at),
            sql`${deliveryApprovals.review_package_id} IS NOT NULL`,
          ),
        );

      const artifacts: DeliveryArtifactRow[] = [];
      let primaryArtifact: DeliveryArtifactRow | null = null;
      for (const { item, blob } of items.sort(
        (left, right) =>
          artifactMetadata(left.item.role).receiptOrder -
          artifactMetadata(right.item.role).receiptOrder,
      )) {
        if (item.status !== 'uploaded' || !blob) continue;
        const metadata = artifactMetadata(item.role);
        await tx
          .update(deliveryArtifacts)
          .set({ status: 'superseded', updated_at: now.toISOString() })
          .where(
            and(
              eq(deliveryArtifacts.delivery_id, delivery.id),
              eq(deliveryArtifacts.logical_key, metadata.logicalKey),
              eq(deliveryArtifacts.kind, metadata.kind),
              notInArray(deliveryArtifacts.status, ['superseded']),
            ),
          );
        const artifactId = ulid();
        const companionPdfArtifactId: string | null =
          item.role === 'interactive_preview'
            ? (artifacts.find((candidate) => candidate.kind === 'companion_pdf')?.id ?? null)
            : null;
        const inserted: DeliveryArtifactRow[] = await tx
          .insert(deliveryArtifacts)
          .values({
            id: artifactId,
            delivery_id: delivery.id,
            blob_id: blob.id,
            logical_key: metadata.logicalKey,
            revision: packageRow.revision,
            kind: metadata.kind,
            original_filename: item.filename,
            companion_pdf_artifact_id: companionPdfArtifactId,
            include_in_receipt: true,
            receipt_order: metadata.receiptOrder,
            idempotency_key: `review-package:${packageRow.id}:${item.role}`,
          })
          .returning();
        const artifact: DeliveryArtifactRow | undefined = inserted[0];
        if (!artifact) throw new RepoPersistenceError('delivery artifact', artifactId);
        if (item.role === 'review_document') primaryArtifact = artifact;
        artifacts.push(artifact);
        await tx
          .update(deliveryReviewPackageItems)
          .set({ artifact_id: artifact.id, updated_at: now.toISOString() })
          .where(eq(deliveryReviewPackageItems.id, item.id));
      }
      if (!primaryArtifact) {
        throw new DeliveryReviewPackageNotReadyError(packageRow.id, 'review_document_missing');
      }

      const [publishedPackage] = await tx
        .update(deliveryReviewPackages)
        .set({
          status: 'published',
          published_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .where(eq(deliveryReviewPackages.id, packageRow.id))
        .returning();
      if (!publishedPackage) {
        throw new RepoPersistenceError('delivery review package', packageRow.id);
      }
      const [updatedGate] = await tx
        .update(deliveryGates)
        .set({
          status: 'pending',
          summary: packageRow.review_note,
          waiver_reason: null,
          warning_accepted: false,
          report_artifact_id: primaryArtifact.id,
          review_package_id: packageRow.id,
          recorded_by: input.actor,
          recorded_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .where(eq(deliveryGates.id, gate.id))
        .returning();
      if (!updatedGate) throw new RepoPersistenceError('delivery gate', gate.id);

      const overviewPatch = packageRow.overview_patch ?? {};
      const [updatedDelivery] = await tx
        .update(deliveries)
        .set({
          ...(packageRow.overview_mode === 'update' && overviewPatch.title !== undefined
            ? { title: overviewPatch.title }
            : {}),
          ...(packageRow.overview_mode === 'update' && overviewPatch.summary !== undefined
            ? { summary: overviewPatch.summary }
            : {}),
          ...(packageRow.overview_mode === 'update' && overviewPatch.limitations !== undefined
            ? { limitations: overviewPatch.limitations }
            : {}),
          status: 'in_review',
          previewed_evidence_version: null,
          evidence_version: sql`${deliveries.evidence_version} + 1`,
          updated_at: now.toISOString(),
        })
        .where(eq(deliveries.id, delivery.id))
        .returning();
      if (!updatedDelivery) throw new RepoPersistenceError('delivery', delivery.id);

      return {
        package: publishedPackage,
        delivery: updatedDelivery,
        items: items.map(({ item, blob }) => ({
          item: {
            ...item,
            artifact_id:
              artifacts.find((artifact) => artifact.kind === artifactMetadata(item.role).kind)
                ?.id ?? null,
          },
          blob,
          artifact:
            artifacts.find((artifact) => artifact.kind === artifactMetadata(item.role).kind) ??
            null,
        })),
        gate: updatedGate,
        primaryArtifact,
        artifacts,
      };
    });
  }

  async accept(input: {
    deliveryId: string;
    gateKey: string;
    packageId: string;
    expectedManifestSha256: string;
    summary?: string | null;
    recordedBy: string;
    now?: Date;
  }): Promise<{
    package: DeliveryReviewPackageRow;
    gate: typeof deliveryGates.$inferSelect;
    artifacts: DeliveryArtifactRow[];
    approval: DeliveryApprovalRow;
  }> {
    const now = input.now ?? new Date();
    return await this.db.transaction(async (tx) => {
      const [context] = await tx
        .select({ delivery: deliveries, package: deliveryReviewPackages })
        .from(deliveries)
        .innerJoin(
          deliveryReviewPackages,
          and(
            eq(deliveryReviewPackages.id, input.packageId),
            eq(deliveryReviewPackages.delivery_id, deliveries.id),
          ),
        )
        .where(eq(deliveries.id, input.deliveryId))
        .for('update');
      if (!context || context.package.status !== 'published') {
        throw new DeliveryReviewPackageNotReadyError(input.packageId, 'package_not_current');
      }
      if (context.delivery.status !== 'in_review') {
        throw new DeliveryStateError(
          input.deliveryId,
          'Only a Delivery currently in review can accept a customer review package.',
          context.delivery.status,
        );
      }
      if (context.package.manifest_sha256 !== input.expectedManifestSha256) {
        throw new DeliveryReviewPackageManifestMismatchError(
          context.package.id,
          input.expectedManifestSha256,
          context.package.manifest_sha256,
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
      if (!gate || gate.gate_type !== 'review' || gate.review_package_id !== context.package.id) {
        throw new DeliveryReviewPackageNotReadyError(context.package.id, 'review_gate_not_bound');
      }

      const packageItems = await tx
        .select()
        .from(deliveryReviewPackageItems)
        .where(eq(deliveryReviewPackageItems.package_id, context.package.id))
        .for('update');
      const artifactIds = packageItems.flatMap((item) =>
        item.artifact_id ? [item.artifact_id] : [],
      );
      const artifacts =
        artifactIds.length > 0
          ? await tx
              .select()
              .from(deliveryArtifacts)
              .where(inArray(deliveryArtifacts.id, artifactIds))
              .for('update')
          : [];
      const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
      const primaryItem = packageItems.find((item) => item.role === 'review_document');
      const primary = primaryItem?.artifact_id
        ? artifactsById.get(primaryItem.artifact_id)
        : undefined;
      if (
        !primary ||
        gate.report_artifact_id !== primary.id ||
        artifacts.length === 0 ||
        artifacts.some((artifact) => artifact.status === 'superseded')
      ) {
        throw new DeliveryReviewPackageNotReadyError(
          context.package.id,
          'published_artifacts_not_current',
        );
      }

      const [existingApproval] = await tx
        .select()
        .from(deliveryApprovals)
        .where(
          and(
            eq(deliveryApprovals.delivery_id, input.deliveryId),
            eq(deliveryApprovals.review_package_id, context.package.id),
            eq(deliveryApprovals.package_manifest_sha256, context.package.manifest_sha256),
            isNull(deliveryApprovals.invalidated_at),
          ),
        )
        .limit(1);
      if (gate.status === 'passed' && existingApproval) {
        return { package: context.package, gate, artifacts, approval: existingApproval };
      }
      if (gate.status !== 'pending') {
        throw new DeliveryStateError(
          input.deliveryId,
          'Only a pending customer review package can be accepted.',
          gate.status,
        );
      }

      await tx
        .update(deliveryArtifacts)
        .set({ status: 'approved', updated_at: now.toISOString() })
        .where(
          inArray(
            deliveryArtifacts.id,
            artifacts.map((artifact) => artifact.id),
          ),
        );
      const [acceptedGate] = await tx
        .update(deliveryGates)
        .set({
          status: 'passed',
          summary: input.summary?.trim() || gate.summary,
          waiver_reason: null,
          warning_accepted: false,
          recorded_by: input.recordedBy,
          recorded_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .where(eq(deliveryGates.id, gate.id))
        .returning();
      if (!acceptedGate) throw new RepoPersistenceError('delivery gate', gate.id);
      const approvalId = ulid();
      const [approval] = await tx
        .insert(deliveryApprovals)
        .values({
          id: approvalId,
          delivery_id: input.deliveryId,
          artifact_ids: artifacts.map((artifact) => artifact.id),
          review_package_id: context.package.id,
          package_manifest_sha256: context.package.manifest_sha256,
          approver_display_name: input.recordedBy,
          approval_excerpt:
            input.summary?.trim() ||
            `Customer review package revision ${String(context.package.revision)} accepted.`,
          source_type: 'other',
          approved_at: now.toISOString(),
          recorded_by: input.recordedBy,
        })
        .returning();
      if (!approval) throw new RepoPersistenceError('delivery approval', approvalId);
      await tx
        .update(deliveries)
        .set({
          evidence_version: sql`${deliveries.evidence_version} + 1`,
          previewed_evidence_version: null,
          updated_at: now.toISOString(),
        })
        .where(eq(deliveries.id, input.deliveryId));
      return {
        package: context.package,
        gate: acceptedGate,
        artifacts: artifacts.map((artifact) => ({ ...artifact, status: 'approved' as const })),
        approval,
      };
    });
  }

  async cleanupStagedBlobs(input: {
    now?: Date;
  }): Promise<{ expiredPackages: number; releasedItems: number; deletedBlobRows: number }> {
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const abortedCutoff = new Date(now.getTime() - REVIEW_PACKAGE_TTL_MS).toISOString();
    return await this.db.transaction(async (tx) => {
      const expired = await tx
        .update(deliveryReviewPackages)
        .set({ status: 'expired', updated_at: nowIso })
        .where(
          and(
            eq(deliveryReviewPackages.status, 'draft'),
            lt(deliveryReviewPackages.expires_at, nowIso),
          ),
        )
        .returning({ id: deliveryReviewPackages.id });

      const eligible = await tx
        .select({ item: deliveryReviewPackageItems })
        .from(deliveryReviewPackageItems)
        .innerJoin(
          deliveryReviewPackages,
          eq(deliveryReviewPackageItems.package_id, deliveryReviewPackages.id),
        )
        .where(
          and(
            isNotNull(deliveryReviewPackageItems.blob_id),
            isNull(deliveryReviewPackageItems.artifact_id),
            or(
              and(
                eq(deliveryReviewPackages.status, 'expired'),
                lt(deliveryReviewPackages.expires_at, nowIso),
              ),
              and(
                eq(deliveryReviewPackages.status, 'aborted'),
                lt(deliveryReviewPackages.updated_at, abortedCutoff),
              ),
            ),
          ),
        )
        .for('update');
      const itemIds = eligible.map(({ item }) => item.id);
      const blobIds = [
        ...new Set(eligible.flatMap(({ item }) => (item.blob_id ? [item.blob_id] : []))),
      ];
      if (itemIds.length > 0) {
        await tx
          .update(deliveryReviewPackageItems)
          .set({ blob_id: null, updated_at: nowIso })
          .where(inArray(deliveryReviewPackageItems.id, itemIds));
      }

      const deletedBlobRows =
        blobIds.length === 0
          ? []
          : await tx
              .delete(artifactBlobs)
              .where(
                and(
                  inArray(artifactBlobs.id, blobIds),
                  notExists(
                    tx
                      .select({ id: deliveryArtifacts.id })
                      .from(deliveryArtifacts)
                      .where(eq(deliveryArtifacts.blob_id, artifactBlobs.id)),
                  ),
                  notExists(
                    tx
                      .select({ id: deliveryReviewPackageItems.id })
                      .from(deliveryReviewPackageItems)
                      .where(eq(deliveryReviewPackageItems.blob_id, artifactBlobs.id)),
                  ),
                  notExists(
                    tx
                      .select({ id: deliveryReceipts.id })
                      .from(deliveryReceipts)
                      .where(eq(deliveryReceipts.pdf_blob_id, artifactBlobs.id)),
                  ),
                  notExists(
                    tx
                      .select({ id: projectDeliverySettings.project_id })
                      .from(projectDeliverySettings)
                      .where(eq(projectDeliverySettings.logo_blob_id, artifactBlobs.id)),
                  ),
                  notExists(
                    tx
                      .select({ id: engagementWeeklyReports.id })
                      .from(engagementWeeklyReports)
                      .where(
                        or(
                          eq(engagementWeeklyReports.internal_html_blob_id, artifactBlobs.id),
                          eq(engagementWeeklyReports.internal_pdf_blob_id, artifactBlobs.id),
                          eq(engagementWeeklyReports.customer_html_blob_id, artifactBlobs.id),
                          eq(engagementWeeklyReports.customer_pdf_blob_id, artifactBlobs.id),
                        ),
                      ),
                  ),
                ),
              )
              .returning({ id: artifactBlobs.id });
      return {
        expiredPackages: expired.length,
        releasedItems: itemIds.length,
        deletedBlobRows: deletedBlobRows.length,
      };
    });
  }
}
