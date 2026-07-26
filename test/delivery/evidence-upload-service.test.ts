import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import type { DeliveryArtifactRow } from '../../src/db/schema.drizzle.js';
import type {
  DeliveryService,
  UploadDeliveryArtifactInput,
} from '../../src/delivery/delivery-service.js';
import { EvidenceUploadService } from '../../src/delivery/evidence-upload-service.js';

function fixture(projectId = 'project-1') {
  let uploaded: UploadDeliveryArtifactInput | null = null;
  const db = {
    requireDelivery: vi.fn(async () => ({ id: 'delivery-1', project_id: projectId })),
  } as unknown as Database;
  const deliveryService = {
    assertDeliveryCanMutate: vi.fn(async () => undefined),
    uploadArtifact: vi.fn(async (input: UploadDeliveryArtifactInput) => {
      uploaded = input;
      return {
        id: input.artifactId,
        delivery_id: input.deliveryId,
        blob_id: 'blob-1',
      } as unknown as DeliveryArtifactRow;
    }),
  } as unknown as DeliveryService;
  const service = new EvidenceUploadService(db, deliveryService, Buffer.alloc(32, 7));
  return { service, deliveryService, uploaded: () => uploaded };
}

function tokenFromUrl(url: string): string {
  return new URL(url, 'http://openlander.test').searchParams.get('token') ?? '';
}

describe('EvidenceUploadService', () => {
  it('binds the signed capability to exact artifact metadata and an idempotent upload', async () => {
    const test = fixture();
    const ticket = await test.service.issue({
      projectId: 'project-1',
      deliveryId: 'delivery-1',
      filename: 'qa-report.json',
      mimeType: 'application/json',
      logicalKey: 'qa-report',
      revision: 2,
      kind: 'qa_report',
      includeInReceipt: true,
      receiptOrder: 4,
    });

    const artifact = await test.service.consume({
      artifactId: ticket.artifactId,
      token: tokenFromUrl(ticket.uploadUrl),
      source: (async function* () {
        yield Buffer.from('{"passed":true}');
      })(),
    });

    expect(artifact.id).toBe(ticket.artifactId);
    expect(test.uploaded()).toMatchObject({
      artifactId: ticket.artifactId,
      deliveryId: 'delivery-1',
      filename: 'qa-report.json',
      declaredMimeType: 'application/json',
      logicalKey: 'qa-report',
      revision: 2,
      kind: 'qa_report',
      includeInReceipt: true,
      receiptOrder: 4,
      idempotencyKey: `evidence-upload:${ticket.artifactId}`,
    });
  });

  it('rejects a changed artifact id before invoking the Delivery service', async () => {
    const test = fixture();
    const ticket = await test.service.issue({
      projectId: 'project-1',
      deliveryId: 'delivery-1',
      filename: 'evidence.md',
      logicalKey: 'brief',
      revision: 1,
      kind: 'markdown',
    });

    await expect(
      test.service.consume({
        artifactId: `${ticket.artifactId}-changed`,
        token: tokenFromUrl(ticket.uploadUrl),
        source: (async function* () {
          yield Buffer.from('evidence');
        })(),
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_UPLOAD_TOKEN_INVALID', statusCode: 401 });
    expect(test.deliveryService.uploadArtifact).not.toHaveBeenCalled();
  });

  it('rejects an expired upload capability', async () => {
    const test = fixture();
    const ticket = await test.service.issue({
      projectId: 'project-1',
      deliveryId: 'delivery-1',
      filename: 'evidence.md',
      logicalKey: 'brief',
      revision: 1,
      kind: 'markdown',
      ttlMs: -1,
    });

    await expect(
      test.service.consume({
        artifactId: ticket.artifactId,
        token: tokenFromUrl(ticket.uploadUrl),
        source: (async function* () {
          yield Buffer.from('evidence');
        })(),
      }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_UPLOAD_EXPIRED', statusCode: 410 });
  });

  it('refuses to issue a capability for a Delivery in another Project', async () => {
    const test = fixture('project-2');
    await expect(
      test.service.issue({
        projectId: 'project-1',
        deliveryId: 'delivery-1',
        filename: 'evidence.md',
        logicalKey: 'brief',
        revision: 1,
        kind: 'markdown',
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_VALIDATION_FAILED' });
  });
});
