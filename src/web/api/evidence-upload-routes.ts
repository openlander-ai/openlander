import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { ArtifactValidationError, EvidenceUploadTokenError } from '../../errors.js';
import { MAX_ARTIFACT_BYTES } from '../../delivery/types.js';

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

export function createEvidenceUploadRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.put('/evidence-uploads/:artifactId', async (c) => {
    const artifactId = c.req.param('artifactId');
    const token = c.req.query('token') ?? c.req.header('x-openlander-upload-token');
    if (!token) throw new EvidenceUploadTokenError('missing_token');
    const contentLength = Number(c.req.header('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_ARTIFACT_BYTES) {
      throw new ArtifactValidationError('Artifact exceeds the configured size limit.', {
        maxBytes: MAX_ARTIFACT_BYTES,
      });
    }
    const body = c.req.raw.body;
    if (!body) throw new ArtifactValidationError('Empty artifacts are not allowed.');
    const artifact = await ctx.evidenceUploadService.consume({
      artifactId,
      token,
      source: requestChunks(body),
    });
    const blob = await ctx.db.getArtifactBlob(artifact.blob_id);
    if (!blob) throw new ArtifactValidationError('Stored artifact metadata is unavailable.');
    return c.json(
      {
        status: 'uploaded',
        artifact_id: artifact.id,
        delivery_id: artifact.delivery_id,
        sha256: blob.sha256,
        size_bytes: blob.size_bytes,
      },
      201,
    );
  });

  return api;
}
