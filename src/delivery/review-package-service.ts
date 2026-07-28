import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { Database } from '../db/index.js';
import type {
  DeliveryReviewPackageItemRow,
  DeliveryReviewPackageRow,
} from '../db/schema.drizzle.js';
import {
  ArtifactValidationError,
  DeliveryReviewPackageExpiredError,
  DeliveryReviewPackageFileMismatchError,
  DeliveryReviewPackageNotReadyError,
} from '../errors.js';
import { getMasterKey } from '../env/crypto.js';
import { validateArtifactMetadata } from './artifact-store.js';
import type { ArtifactStore } from './artifact-store.js';
import type {
  DeliveryReviewPackageDetail,
  DeliveryReviewPackageFileSpec,
  DeliveryReviewPackageOverview,
  PublishedDeliveryReviewPackage,
} from './review-package-types.js';
import type { DeliveryService } from './delivery-service.js';

const CAPABILITY_TTL_MS = 15 * 60 * 1000;
const ALLOWED_MIME_BY_ROLE: Record<DeliveryReviewPackageItemRow['role'], ReadonlySet<string>> = {
  review_document: new Set(['application/pdf']),
  interactive_preview: new Set(['text/html']),
  representative_image: new Set(['image/png', 'image/jpeg', 'image/webp']),
} as const;

interface ReviewPackageUploadPayload {
  v: 1;
  item_id: string;
  package_id: string;
  delivery_id: string;
  expected_sha256: string;
  expected_size_bytes: number;
  expected_mime_type: string;
  expires_at_ms: number;
}

export interface DeliveryReviewPackageUploadCapability {
  item_id: string;
  role: DeliveryReviewPackageItemRow['role'];
  upload_url: string;
  upload_method: 'PUT';
  expires_at: string;
}

export interface DeliveryReviewPackageStatusView {
  selected: DeliveryReviewPackageDetail;
  draft: DeliveryReviewPackageRow | null;
  current: DeliveryReviewPackageRow | null;
  previous: DeliveryReviewPackageRow | null;
  blockers: string[];
  missing_roles: DeliveryReviewPackageItemRow['role'][];
  upload_capabilities: DeliveryReviewPackageUploadCapability[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function sha256Json(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function encodePayload(payload: ReviewPackageUploadPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function parsePayload(value: string): ReviewPackageUploadPayload {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    const payload = parsed as Partial<ReviewPackageUploadPayload>;
    if (
      payload.v !== 1 ||
      typeof payload.item_id !== 'string' ||
      typeof payload.package_id !== 'string' ||
      typeof payload.delivery_id !== 'string' ||
      typeof payload.expected_sha256 !== 'string' ||
      !Number.isSafeInteger(payload.expected_size_bytes) ||
      typeof payload.expected_mime_type !== 'string' ||
      !Number.isSafeInteger(payload.expires_at_ms)
    ) {
      throw new Error('invalid');
    }
    return payload as ReviewPackageUploadPayload;
  } catch {
    throw new DeliveryReviewPackageFileMismatchError(value, 'invalid_upload_capability');
  }
}

function overviewSnapshot(delivery: {
  title: string;
  summary: string;
  limitations: string | null;
}): Record<string, unknown> {
  return {
    title: delivery.title,
    summary: delivery.summary,
    limitations: delivery.limitations,
  };
}

function applyOverview(
  current: ReturnType<typeof overviewSnapshot>,
  overview: DeliveryReviewPackageOverview,
): Record<string, unknown> {
  if (overview.mode === 'keep') return current;
  return {
    ...current,
    ...(overview.title !== undefined ? { title: overview.title } : {}),
    ...(overview.summary !== undefined ? { summary: overview.summary } : {}),
    ...(overview.limitations !== undefined ? { limitations: overview.limitations } : {}),
  };
}

function validateFileSpecs(
  files: DeliveryReviewPackageFileSpec[],
): DeliveryReviewPackageFileSpec[] {
  if (files.length < 1 || files.length > 3) {
    throw new ArtifactValidationError('Declare between one and three customer review files.');
  }
  const roles = new Set(files.map((file) => file.role));
  if (roles.size !== files.length || !roles.has('review_document')) {
    throw new ArtifactValidationError(
      'A customer review package requires exactly one review_document and at most one file per role.',
    );
  }
  return files.map((file) => {
    let validated: ReturnType<typeof validateArtifactMetadata>;
    try {
      validated = validateArtifactMetadata(file.filename, file.mime_type);
    } catch (error) {
      throw new DeliveryReviewPackageFileMismatchError(
        file.role,
        'filename_mime_mismatch',
        error instanceof ArtifactValidationError ? error.details : undefined,
      );
    }
    const { filename, mimeType } = validated;
    if (!ALLOWED_MIME_BY_ROLE[file.role].has(mimeType)) {
      throw new DeliveryReviewPackageFileMismatchError(file.role, 'mime_not_allowed_for_role', {
        filename,
        mimeType,
      });
    }
    return {
      ...file,
      filename,
      mime_type: mimeType,
      expected_sha256: file.expected_sha256.toLowerCase(),
    };
  });
}

export class DeliveryReviewPackageService {
  constructor(
    private readonly db: Database,
    private readonly deliveryService: DeliveryService,
    private readonly artifactStore: ArtifactStore,
    private readonly signingKey: Buffer = getMasterKey(),
  ) {}

  private signature(encodedPayload: string): Buffer {
    return createHmac('sha256', this.signingKey).update(encodedPayload).digest();
  }

  private token(payload: ReviewPackageUploadPayload): string {
    const encoded = encodePayload(payload);
    return `${encoded}.${this.signature(encoded).toString('base64url')}`;
  }

  private verify(token: string, itemId: string, now = Date.now()): ReviewPackageUploadPayload {
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra) {
      throw new DeliveryReviewPackageFileMismatchError(itemId, 'invalid_upload_capability');
    }
    const expected = this.signature(encoded);
    const presented = Buffer.from(signature, 'base64url');
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      throw new DeliveryReviewPackageFileMismatchError(itemId, 'invalid_upload_capability');
    }
    const payload = parsePayload(encoded);
    if (payload.item_id !== itemId) {
      throw new DeliveryReviewPackageFileMismatchError(itemId, 'item_mismatch');
    }
    if (payload.expires_at_ms <= now) {
      throw new DeliveryReviewPackageExpiredError(payload.package_id);
    }
    return payload;
  }

  private async audit(
    detail: DeliveryReviewPackageDetail,
    eventType: string,
    title: string,
    description: string,
  ): Promise<void> {
    await this.db.insertActivityLog({
      event_type: eventType,
      activity_type: 'delivery',
      severity: 'info',
      project_id: detail.delivery.project_id,
      correlation_id: detail.delivery.id,
      title,
      description,
      status: 'completed',
      metadata: JSON.stringify({
        delivery_id: detail.delivery.id,
        review_package_id: detail.package.id,
        review_package_revision: detail.package.revision,
        manifest_sha256: detail.package.manifest_sha256,
      }),
    });
  }

  async prepare(input: {
    deliveryId: string;
    sourceRunId?: string | null;
    gateKey: string;
    reviewNote: string;
    files: DeliveryReviewPackageFileSpec[];
    overview: DeliveryReviewPackageOverview;
    replaceDraft?: boolean;
    actor: string;
  }): Promise<DeliveryReviewPackageDetail> {
    await this.deliveryService.assertDeliveryCanMutate(input.deliveryId);
    const delivery = await this.db.requireDelivery(input.deliveryId);
    const files = validateFileSpecs(input.files);
    const currentOverview = overviewSnapshot(delivery);
    const nextOverview = applyOverview(currentOverview, input.overview);
    const manifest = {
      delivery_id: delivery.id,
      source_run_id: input.sourceRunId ?? null,
      gate_key: input.gateKey,
      review_note: input.reviewNote,
      files: [...files].sort((left, right) => left.role.localeCompare(right.role)),
      overview: input.overview,
    };
    const detail = await this.db.createDeliveryReviewPackage({
      deliveryId: delivery.id,
      sourceRunId: input.sourceRunId,
      reviewGateKey: input.gateKey,
      reviewNote: input.reviewNote,
      manifestSha256: sha256Json(manifest),
      overview: input.overview,
      overviewBeforeSha256: sha256Json(currentOverview),
      overviewAfterSha256: sha256Json(nextOverview),
      files,
      replaceDraft: input.replaceDraft === true,
      createdBy: input.actor,
    });
    await this.audit(
      detail,
      'delivery.review_package_prepared',
      'Customer review package prepared',
      `Revision ${String(detail.package.revision)} is ready for file upload.`,
    );
    return detail;
  }

  private capability(
    detail: DeliveryReviewPackageDetail,
    item: DeliveryReviewPackageItemRow,
    now = Date.now(),
  ): DeliveryReviewPackageUploadCapability {
    const packageExpiry = Date.parse(detail.package.expires_at);
    if (detail.package.status !== 'draft' || packageExpiry <= now) {
      throw new DeliveryReviewPackageExpiredError(detail.package.id);
    }
    const expiresAtMs = Math.min(now + CAPABILITY_TTL_MS, packageExpiry);
    const payload: ReviewPackageUploadPayload = {
      v: 1,
      item_id: item.id,
      package_id: detail.package.id,
      delivery_id: detail.delivery.id,
      expected_sha256: item.expected_sha256,
      expected_size_bytes: item.expected_size_bytes,
      expected_mime_type: item.expected_mime_type,
      expires_at_ms: expiresAtMs,
    };
    const token = this.token(payload);
    return {
      item_id: item.id,
      role: item.role,
      upload_url: `/api/review-package-uploads/${encodeURIComponent(item.id)}?token=${encodeURIComponent(token)}`,
      upload_method: 'PUT',
      expires_at: new Date(expiresAtMs).toISOString(),
    };
  }

  async getStatus(input: {
    deliveryId: string;
    packageId?: string | null;
    includeUploadCapabilities?: boolean;
  }): Promise<DeliveryReviewPackageStatusView> {
    const packages = await this.db.listDeliveryReviewPackages(input.deliveryId);
    const selectedPackage = input.packageId
      ? packages.find((candidate) => candidate.id === input.packageId)
      : (packages.find((candidate) => candidate.status === 'draft') ??
        packages.find((candidate) => candidate.status === 'published'));
    if (!selectedPackage) {
      throw new DeliveryReviewPackageNotReadyError(
        input.packageId ?? input.deliveryId,
        'package_not_found',
      );
    }
    const selected = await this.db.getDeliveryReviewPackage(selectedPackage.id);
    if (!selected || selected.delivery.id !== input.deliveryId) {
      throw new DeliveryReviewPackageNotReadyError(selectedPackage.id, 'package_not_found');
    }
    const draft = packages.find((candidate) => candidate.status === 'draft') ?? null;
    const current = packages.find((candidate) => candidate.status === 'published') ?? null;
    const previous =
      packages.find(
        (candidate) =>
          candidate.status === 'superseded' && candidate.revision < (current?.revision ?? Infinity),
      ) ?? null;
    const missingRoles = selected.items
      .filter(({ item, blob }) => item.required && (item.status !== 'uploaded' || !blob))
      .map(({ item }) => item.role);
    const blockers = [
      ...(selected.package.status !== 'draft' && selected.package.status !== 'published'
        ? ['package_not_active']
        : []),
      ...missingRoles.map((role) => `missing:${role}`),
      ...(selected.package.status === 'draft' &&
      Date.parse(selected.package.expires_at) <= Date.now()
        ? ['package_expired']
        : []),
    ];
    const capabilities =
      input.includeUploadCapabilities === true &&
      selected.package.status === 'draft' &&
      Date.parse(selected.package.expires_at) > Date.now()
        ? selected.items
            .filter(({ item }) => item.status !== 'uploaded')
            .map(({ item }) => this.capability(selected, item))
        : [];
    return {
      selected,
      draft,
      current,
      previous,
      blockers,
      missing_roles: missingRoles,
      upload_capabilities: capabilities,
    };
  }

  async consumeUpload(input: {
    itemId: string;
    token: string;
    source: AsyncIterable<Uint8Array>;
  }): Promise<DeliveryReviewPackageItemRow> {
    const payload = this.verify(input.token, input.itemId);
    const context = await this.db.getDeliveryReviewPackageItem(input.itemId);
    if (!context || context.package.id !== payload.package_id) {
      throw new DeliveryReviewPackageFileMismatchError(input.itemId, 'item_not_found');
    }
    await this.deliveryService.assertDeliveryCanMutate(context.package.delivery_id);
    const item = context.item;
    if (
      item.expected_sha256 !== payload.expected_sha256 ||
      item.expected_size_bytes !== payload.expected_size_bytes ||
      item.expected_mime_type !== payload.expected_mime_type
    ) {
      throw new DeliveryReviewPackageFileMismatchError(input.itemId, 'declaration_changed');
    }
    if (item.status === 'uploaded' && item.blob_id) return item;

    let stored;
    try {
      stored = await this.artifactStore.store(input.source, {
        filename: item.filename,
        declaredMimeType: item.expected_mime_type,
        maxBytes: item.expected_size_bytes,
      });
    } catch (error) {
      const details =
        error instanceof ArtifactValidationError ? error.details : { cause: String(error) };
      await this.db.recordDeliveryReviewPackageUploadFailure({
        itemId: item.id,
        code: 'REVIEW_PACKAGE_FILE_MISMATCH',
        details,
      });
      throw new DeliveryReviewPackageFileMismatchError(
        item.id,
        'content_validation_failed',
        details,
      );
    }
    if (
      stored.sha256 !== item.expected_sha256 ||
      stored.sizeBytes !== item.expected_size_bytes ||
      stored.mimeType !== item.expected_mime_type
    ) {
      const details = {
        expectedSha256: item.expected_sha256,
        actualSha256: stored.sha256,
        expectedSizeBytes: item.expected_size_bytes,
        actualSizeBytes: stored.sizeBytes,
        expectedMimeType: item.expected_mime_type,
        actualMimeType: stored.mimeType,
      };
      await this.db.recordDeliveryReviewPackageUploadFailure({
        itemId: item.id,
        code: 'REVIEW_PACKAGE_FILE_MISMATCH',
        details,
        actualSha256: stored.sha256,
        actualSizeBytes: stored.sizeBytes,
        actualMimeType: stored.mimeType,
      });
      throw new DeliveryReviewPackageFileMismatchError(
        item.id,
        'expected_metadata_mismatch',
        details,
      );
    }
    const blob = await this.db.upsertArtifactBlob({
      sha256: stored.sha256,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      storageKey: stored.storageKey,
    });
    return await this.db.recordDeliveryReviewPackageUploadSuccess({ itemId: item.id, blob });
  }

  async publish(input: {
    packageId: string;
    expectedManifestSha256: string;
    expectedDeliveryEvidenceVersion: number;
    actor: string;
  }): Promise<PublishedDeliveryReviewPackage> {
    const detail = await this.db.getDeliveryReviewPackage(input.packageId);
    if (!detail) {
      throw new DeliveryReviewPackageNotReadyError(input.packageId, 'package_not_found');
    }
    await this.deliveryService.assertDeliveryCanMutate(detail.delivery.id);
    const published = await this.db.publishDeliveryReviewPackage(input);
    await this.audit(
      published,
      'delivery.review_package_published',
      'Customer review package published',
      `Revision ${String(published.package.revision)} is waiting for review.`,
    );
    return published;
  }
}
