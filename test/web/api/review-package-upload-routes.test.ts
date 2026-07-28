import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../../src/app.js';
import { OpenLanderError } from '../../../src/errors.js';
import { createReviewPackageUploadRoutes } from '../../../src/web/api/review-package-upload-routes.js';

describe('Review package upload route', () => {
  it('accepts a capability URL without a session and returns exact uploaded metadata', async () => {
    const consumeUpload = vi.fn(async () => ({
      id: 'item-review',
      package_id: 'package-1',
      role: 'review_document' as const,
      blob_id: 'blob-review',
    }));
    const app = createReviewPackageUploadRoutes({
      deliveryReviewPackageService: { consumeUpload },
      db: {
        getArtifactBlob: vi.fn(async () => ({
          id: 'blob-review',
          sha256: 'a'.repeat(64),
          mime_type: 'application/pdf',
          size_bytes: 4,
        })),
      },
    } as unknown as AppContext);

    const response = await app.request(
      'http://openlander.test/review-package-uploads/item-review?token=short-lived-token',
      { method: 'PUT', body: new Uint8Array([1, 2, 3, 4]) },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      status: 'uploaded',
      package_id: 'package-1',
      item_id: 'item-review',
      sha256: 'a'.repeat(64),
      size_bytes: 4,
    });
    expect(consumeUpload).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'item-review', token: 'short-lived-token' }),
    );
  });

  it('rejects requests that omit the upload capability', async () => {
    const app = createReviewPackageUploadRoutes({} as AppContext);
    app.onError((error, context) => {
      if (error instanceof OpenLanderError) {
        return context.json(error.toJSON(), error.statusCode as 400);
      }
      throw error;
    });

    const response = await app.request(
      'http://openlander.test/review-package-uploads/item-review',
      { method: 'PUT', body: new Uint8Array([1]) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'REVIEW_PACKAGE_FILE_MISMATCH',
      details: { reason: 'missing_upload_capability' },
    });
  });
});
