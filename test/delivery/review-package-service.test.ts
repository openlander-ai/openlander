import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import type { ArtifactBlobRow, DeliveryReviewPackageItemRow } from '../../src/db/schema.drizzle.js';
import { ArtifactStore } from '../../src/delivery/artifact-store.js';
import type { DeliveryService } from '../../src/delivery/delivery-service.js';
import { DeliveryReviewPackageService } from '../../src/delivery/review-package-service.js';
import type { DeliveryReviewPackageDetail } from '../../src/delivery/review-package-types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function pdfBytes(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

function detailFor(input: {
  sha256: string;
  sizeBytes: number;
  mimeType?: string;
  filename?: string;
}): DeliveryReviewPackageDetail {
  const createdAt = '2026-07-28T00:00:00.000Z';
  const item: DeliveryReviewPackageItemRow = {
    id: 'item-review',
    package_id: 'package-1',
    role: 'review_document',
    filename: input.filename ?? 'customer-review.pdf',
    expected_sha256: input.sha256,
    expected_size_bytes: input.sizeBytes,
    expected_mime_type: input.mimeType ?? 'application/pdf',
    required: true,
    blob_id: null,
    artifact_id: null,
    status: 'pending',
    attempt_count: 0,
    actual_sha256: null,
    actual_size_bytes: null,
    actual_mime_type: null,
    last_error_code: null,
    last_error_details: null,
    uploaded_at: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
  return {
    delivery: {
      id: 'delivery-1',
      project_id: 'project-1',
      title: 'Customer review',
      summary: 'Current summary',
      objective: '',
      definition_of_done: [],
      manifest_path: null,
      auto_finalize: true,
      delivery_type: 'artifact_delivery',
      maturity: 'customer_review',
      status: 'draft',
      evidence_version: 3,
      previewed_evidence_version: null,
      limitations: null,
      predecessor_delivery_id: null,
      created_by: 'agent',
      created_at: createdAt,
      updated_at: createdAt,
    },
    package: {
      id: 'package-1',
      delivery_id: 'delivery-1',
      revision: 1,
      status: 'draft',
      manifest_sha256: 'f'.repeat(64),
      base_evidence_version: 3,
      source_run_id: null,
      review_gate_key: 'review',
      review_note: 'Please review',
      overview_mode: 'keep',
      overview_patch: null,
      overview_keep_reason: 'Still current',
      overview_before_sha256: 'a'.repeat(64),
      overview_after_sha256: 'a'.repeat(64),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      published_at: null,
      created_by: 'agent',
      created_at: createdAt,
      updated_at: createdAt,
    },
    items: [{ item, blob: null, artifact: null }],
    gate: null,
  };
}

async function fixture(detail: DeliveryReviewPackageDetail) {
  const directory = await mkdtemp(join(tmpdir(), 'openlander-review-package-'));
  temporaryDirectories.push(directory);
  const recordedFailures: Array<Record<string, unknown>> = [];
  let recordedSuccess: { itemId: string; blob: ArtifactBlobRow } | null = null;
  const db = {
    requireDelivery: vi.fn(async () => detail.delivery),
    createDeliveryReviewPackage: vi.fn(async () => detail),
    listDeliveryReviewPackages: vi.fn(async () => [detail.package]),
    getDeliveryReviewPackage: vi.fn(async () => detail),
    getDeliveryReviewPackageItem: vi.fn(async () => ({
      item: detail.items[0]?.item,
      package: detail.package,
    })),
    recordDeliveryReviewPackageUploadFailure: vi.fn(async (input: Record<string, unknown>) => {
      recordedFailures.push(input);
      const item = detail.items[0]?.item;
      if (item) {
        item.status = 'failed';
        item.attempt_count += 1;
        item.last_error_code = String(input['code'] ?? 'REVIEW_PACKAGE_FILE_MISMATCH');
      }
    }),
    upsertArtifactBlob: vi.fn(
      async (input: {
        sha256: string;
        mimeType: string;
        sizeBytes: number;
        storageKey: string;
      }): Promise<ArtifactBlobRow> => ({
        id: input.sha256,
        sha256: input.sha256,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        storage_key: input.storageKey,
        created_at: '2026-07-28T00:00:00.000Z',
      }),
    ),
    recordDeliveryReviewPackageUploadSuccess: vi.fn(
      async (input: { itemId: string; blob: ArtifactBlobRow }) => {
        recordedSuccess = input;
        return {
          ...detail.items[0]?.item,
          status: 'uploaded' as const,
          blob_id: input.blob.id,
        } as DeliveryReviewPackageItemRow;
      },
    ),
    insertActivityLog: vi.fn(async () => ({ id: 'activity-1' })),
  } as unknown as Database;
  const deliveryService = {
    assertDeliveryCanMutate: vi.fn(async () => undefined),
  } as unknown as DeliveryService;
  const service = new DeliveryReviewPackageService(
    db,
    deliveryService,
    new ArtifactStore(directory),
    Buffer.alloc(32, 9),
  );
  return { service, db, deliveryService, recordedFailures, recordedSuccess: () => recordedSuccess };
}

function tokenFromUrl(url: string): string {
  return new URL(url, 'http://openlander.test').searchParams.get('token') ?? '';
}

describe('DeliveryReviewPackageService', () => {
  it('preflights extension and MIME before creating a package draft', async () => {
    const bytes = await pdfBytes();
    const detail = detailFor({
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
    });
    const test = await fixture(detail);

    await expect(
      test.service.prepare({
        deliveryId: detail.delivery.id,
        gateKey: 'review',
        reviewNote: 'Please review',
        files: [
          {
            role: 'review_document',
            filename: 'customer-review.png',
            expected_sha256: detail.package.manifest_sha256,
            expected_size_bytes: 100,
            mime_type: 'application/pdf',
          },
        ],
        overview: { mode: 'keep', reason: 'Still current' },
        actor: 'agent',
      }),
    ).rejects.toMatchObject({ code: 'REVIEW_PACKAGE_FILE_MISMATCH' });
    expect(test.db.createDeliveryReviewPackage).not.toHaveBeenCalled();
  });

  it('mints upload capabilities only from the status query and accepts exact PDF bytes', async () => {
    const bytes = await pdfBytes();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const detail = detailFor({ sha256, sizeBytes: bytes.length });
    const test = await fixture(detail);

    const withoutCapabilities = await test.service.getStatus({
      deliveryId: detail.delivery.id,
      packageId: detail.package.id,
    });
    expect(withoutCapabilities.upload_capabilities).toEqual([]);

    const status = await test.service.getStatus({
      deliveryId: detail.delivery.id,
      packageId: detail.package.id,
      includeUploadCapabilities: true,
    });
    expect(status.upload_capabilities).toHaveLength(1);
    const capability = status.upload_capabilities[0];
    expect(capability?.upload_url).toContain('/api/review-package-uploads/item-review');

    const uploaded = await test.service.consumeUpload({
      itemId: detail.items[0]?.item.id ?? '',
      token: tokenFromUrl(capability?.upload_url ?? ''),
      source: (async function* () {
        yield bytes;
      })(),
    });
    expect(uploaded.status).toBe('uploaded');
    expect(test.recordedSuccess()).toMatchObject({
      itemId: 'item-review',
      blob: { sha256, size_bytes: bytes.length, mime_type: 'application/pdf' },
    });
  });

  it('records magic-byte failures without creating a visible artifact', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const detail = detailFor({
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
      mimeType: 'image/png',
      filename: 'screen.png',
    });
    const imageItem = detail.items[0]?.item;
    if (!imageItem) throw new Error('fixture item missing');
    imageItem.role = 'representative_image';
    imageItem.required = false;
    const test = await fixture(detail);
    const status = await test.service.getStatus({
      deliveryId: detail.delivery.id,
      packageId: detail.package.id,
      includeUploadCapabilities: true,
    });

    await expect(
      test.service.consumeUpload({
        itemId: imageItem.id,
        token: tokenFromUrl(status.upload_capabilities[0]?.upload_url ?? ''),
        source: (async function* () {
          yield bytes;
        })(),
      }),
    ).rejects.toMatchObject({
      code: 'REVIEW_PACKAGE_FILE_MISMATCH',
      details: {
        reason: 'content_validation_failed',
        expectedMimeType: 'image/png',
        actualMimeType: 'image/jpeg',
      },
    });
    expect(test.recordedFailures).toMatchObject([
      {
        itemId: imageItem.id,
        code: 'REVIEW_PACKAGE_FILE_MISMATCH',
        details: { expectedMimeType: 'image/png', actualMimeType: 'image/jpeg' },
      },
    ]);
    expect(test.recordedSuccess()).toBeNull();

    const resumed = await test.service.getStatus({
      deliveryId: detail.delivery.id,
      packageId: detail.package.id,
      includeUploadCapabilities: true,
    });
    expect(resumed.selected.items[0]?.item).toMatchObject({
      status: 'failed',
      last_error_code: 'REVIEW_PACKAGE_FILE_MISMATCH',
    });
    expect(resumed.upload_capabilities).toHaveLength(1);
  });
});
