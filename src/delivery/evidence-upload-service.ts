import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Database } from '../db/index.js';
import { ulid } from '../db/repos/activity-log.repo.js';
import type { DeliveryArtifactRow } from '../db/schema.drizzle.js';
import { ArtifactValidationError, EvidenceUploadTokenError } from '../errors.js';
import { getMasterKey } from '../env/crypto.js';
import type { DeliveryService } from './delivery-service.js';
import { MAX_ARTIFACT_BYTES, type DeliveryArtifactKind } from './types.js';

const DEFAULT_UPLOAD_TTL_MS = 15 * 60 * 1000;

interface EvidenceUploadPayload {
  v: 1;
  artifact_id: string;
  project_id: string;
  delivery_id: string;
  filename: string;
  mime_type: string | null;
  logical_key: string;
  revision: number;
  kind: DeliveryArtifactKind;
  include_in_receipt: boolean;
  receipt_order: number;
  companion_for_artifact_id: string | null;
  expires_at_ms: number;
}

export interface EvidenceUploadTicket {
  artifactId: string;
  uploadUrl: string;
  expiresAt: string;
  maxBytes: number;
}

function encodePayload(payload: EvidenceUploadPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(value: string): EvidenceUploadPayload {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new EvidenceUploadTokenError('invalid_payload');
    }
    const payload = parsed as Partial<EvidenceUploadPayload>;
    if (
      payload.v !== 1 ||
      typeof payload.artifact_id !== 'string' ||
      typeof payload.project_id !== 'string' ||
      typeof payload.delivery_id !== 'string' ||
      typeof payload.filename !== 'string' ||
      !(typeof payload.mime_type === 'string' || payload.mime_type === null) ||
      typeof payload.logical_key !== 'string' ||
      !Number.isInteger(payload.revision) ||
      typeof payload.kind !== 'string' ||
      typeof payload.include_in_receipt !== 'boolean' ||
      !Number.isInteger(payload.receipt_order) ||
      !(
        typeof payload.companion_for_artifact_id === 'string' ||
        payload.companion_for_artifact_id === null
      ) ||
      !Number.isSafeInteger(payload.expires_at_ms)
    ) {
      throw new EvidenceUploadTokenError('invalid_payload');
    }
    return payload as EvidenceUploadPayload;
  } catch (error) {
    if (error instanceof EvidenceUploadTokenError) throw error;
    throw new EvidenceUploadTokenError('invalid_payload');
  }
}

export class EvidenceUploadService {
  constructor(
    private readonly db: Database,
    private readonly deliveryService: DeliveryService,
    private readonly signingKey: Buffer = getMasterKey(),
  ) {}

  private signature(encodedPayload: string): Buffer {
    return createHmac('sha256', this.signingKey).update(encodedPayload).digest();
  }

  private token(payload: EvidenceUploadPayload): string {
    const encoded = encodePayload(payload);
    return `${encoded}.${this.signature(encoded).toString('base64url')}`;
  }

  private verify(
    token: string,
    expectedArtifactId: string,
    now = Date.now(),
  ): EvidenceUploadPayload {
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra) throw new EvidenceUploadTokenError('invalid_token');
    let presented: Buffer;
    try {
      presented = Buffer.from(signature, 'base64url');
    } catch {
      throw new EvidenceUploadTokenError('invalid_token');
    }
    const expected = this.signature(encoded);
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      throw new EvidenceUploadTokenError('invalid_signature');
    }
    const payload = decodePayload(encoded);
    if (payload.artifact_id !== expectedArtifactId) {
      throw new EvidenceUploadTokenError('artifact_mismatch');
    }
    if (payload.expires_at_ms <= now) throw new EvidenceUploadTokenError('expired', true);
    return payload;
  }

  async issue(input: {
    projectId: string;
    deliveryId: string;
    filename: string;
    mimeType?: string | null;
    logicalKey: string;
    revision: number;
    kind: DeliveryArtifactKind;
    includeInReceipt?: boolean;
    receiptOrder?: number;
    companionForArtifactId?: string | null;
    ttlMs?: number;
  }): Promise<EvidenceUploadTicket> {
    const delivery = await this.db.requireDelivery(input.deliveryId);
    if (delivery.project_id !== input.projectId) {
      throw new ArtifactValidationError('Delivery does not belong to the requested Project.', {
        projectId: input.projectId,
        deliveryId: input.deliveryId,
      });
    }
    await this.deliveryService.assertDeliveryCanMutate(delivery.id);
    const artifactId = ulid();
    const expiresAtMs = Date.now() + (input.ttlMs ?? DEFAULT_UPLOAD_TTL_MS);
    const payload: EvidenceUploadPayload = {
      v: 1,
      artifact_id: artifactId,
      project_id: input.projectId,
      delivery_id: delivery.id,
      filename: input.filename,
      mime_type: input.mimeType ?? null,
      logical_key: input.logicalKey,
      revision: input.revision,
      kind: input.kind,
      include_in_receipt: input.includeInReceipt ?? true,
      receipt_order: input.receiptOrder ?? 0,
      companion_for_artifact_id: input.companionForArtifactId ?? null,
      expires_at_ms: expiresAtMs,
    };
    const token = this.token(payload);
    return {
      artifactId,
      uploadUrl: `/api/evidence-uploads/${encodeURIComponent(artifactId)}?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(expiresAtMs).toISOString(),
      maxBytes: MAX_ARTIFACT_BYTES,
    };
  }

  async consume(input: {
    artifactId: string;
    token: string;
    source: AsyncIterable<Uint8Array>;
  }): Promise<DeliveryArtifactRow> {
    const payload = this.verify(input.token, input.artifactId);
    return await this.deliveryService.uploadArtifact({
      artifactId: payload.artifact_id,
      deliveryId: payload.delivery_id,
      source: input.source,
      filename: payload.filename,
      declaredMimeType: payload.mime_type,
      logicalKey: payload.logical_key,
      revision: payload.revision,
      kind: payload.kind,
      includeInReceipt: payload.include_in_receipt,
      receiptOrder: payload.receipt_order,
      companionForArtifactId: payload.companion_for_artifact_id,
      idempotencyKey: `evidence-upload:${payload.artifact_id}`,
      actor: 'evidence-upload',
    });
  }
}
