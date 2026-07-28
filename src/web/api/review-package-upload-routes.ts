import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import {
  DeliveryReviewPackageFileMismatchError,
  DeliveryReviewPackageNotReadyError,
} from '../../errors.js';

async function* requestChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      yield chunk.value;
    }
  } finally {
    reader.releaseLock();
  }
}

export function createReviewPackageUploadRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.put('/review-package-uploads/:itemId', async (c) => {
    const itemId = c.req.param('itemId');
    const token = c.req.query('token') ?? c.req.header('x-openlander-upload-token');
    if (!token) {
      throw new DeliveryReviewPackageFileMismatchError(itemId, 'missing_upload_capability');
    }
    const body = c.req.raw.body;
    if (!body) {
      throw new DeliveryReviewPackageFileMismatchError(itemId, 'empty_file');
    }
    const item = await ctx.deliveryReviewPackageService.consumeUpload({
      itemId,
      token,
      source: requestChunks(body),
    });
    if (!item.blob_id) {
      throw new DeliveryReviewPackageNotReadyError(item.package_id, 'uploaded_blob_missing');
    }
    const blob = await ctx.db.getArtifactBlob(item.blob_id);
    if (!blob) {
      throw new DeliveryReviewPackageNotReadyError(item.package_id, 'uploaded_blob_missing');
    }
    return c.json(
      {
        status: 'uploaded',
        package_id: item.package_id,
        item_id: item.id,
        role: item.role,
        sha256: blob.sha256,
        mime_type: blob.mime_type,
        size_bytes: blob.size_bytes,
      },
      201,
    );
  });

  return api;
}
