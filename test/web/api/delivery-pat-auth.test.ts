import { Hono } from 'hono';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../../src/app.js';
import type { AuthService } from '../../../src/auth/auth-service.js';
import { OpenLanderError } from '../../../src/errors.js';
import { createDeliveryRoutes } from '../../../src/web/api/delivery-routes.js';
import { createAuthMiddleware } from '../../../src/web/middleware/auth.js';

function authService(scopeProjectId = 'project-1', scopeKind: 'project' | 'org' = 'project') {
  return {
    validateSession: vi.fn(async () => false),
    validateApiToken: vi.fn(async () => false),
    validateMcpBearerToken: vi.fn(async () => ({
      tokenId: 'token-1',
      name: 'CI',
      tokenType: 'pat',
      scopeKind,
      scopeProjectId,
      scopeServiceId: null,
    })),
    isPasswordSet: vi.fn(async () => true),
  } as unknown as AuthService;
}

function authHarness(auth: AuthService) {
  const app = new Hono();
  app.use('*', createAuthMiddleware(auth));
  app.post('/api/projects/:projectId/deliveries/:deliveryId/artifacts', (c) =>
    c.json({ authKind: c.get('authKind') }),
  );
  app.post('/api/projects/:projectId/deliveries/:deliveryId/gates/:gateKey/result', (c) =>
    c.json({ authKind: c.get('authKind') }),
  );
  app.get('/api/projects/:projectId/deliveries/:deliveryId', (c) =>
    c.json({ authKind: c.get('authKind') }),
  );
  return app;
}

describe('Delivery project PAT boundary', () => {
  it('allows only CI artifact and Gate POSTs within the exact Project scope', async () => {
    const auth = authService();
    const app = authHarness(auth);
    const headers = { authorization: 'Bearer olp_ci_token' };

    const artifact = await app.request('/api/projects/project-1/deliveries/delivery-1/artifacts', {
      method: 'POST',
      headers,
    });
    const gate = await app.request(
      '/api/projects/project-1/deliveries/delivery-1/gates/qa/result',
      { method: 'POST', headers },
    );

    expect(artifact.status).toBe(200);
    await expect(artifact.json()).resolves.toEqual({ authKind: 'project_pat' });
    expect(gate.status).toBe(200);
    await expect(gate.json()).resolves.toEqual({ authKind: 'project_pat' });
  });

  it('does not reveal cross-Project or non-CI REST resources to a Project PAT', async () => {
    const auth = authService();
    const app = authHarness(auth);
    const headers = { authorization: 'Bearer olp_ci_token' };

    const crossProject = await app.request(
      '/api/projects/project-2/deliveries/delivery-2/gates/qa/result',
      { method: 'POST', headers },
    );
    const read = await app.request('/api/projects/project-1/deliveries/delivery-1', {
      headers,
    });

    expect(crossProject.status).toBe(401);
    await expect(crossProject.json()).resolves.toMatchObject({
      code: 'MCP_TOKEN_USED_ON_REST_API',
    });
    expect(read.status).toBe(401);
    expect(JSON.stringify(await read.json())).not.toContain('delivery-1');
  });

  it('rejects organization-scoped agent tokens from the CI REST exception', async () => {
    const app = authHarness(authService('project-1', 'org'));
    const response = await app.request(
      '/api/projects/project-1/deliveries/delivery-1/gates/qa/result',
      {
        method: 'POST',
        headers: { authorization: 'Bearer olp_org_token' },
      },
    );
    expect(response.status).toBe(401);
  });
});

describe('Delivery REST human and idempotency gates', () => {
  function deliveryHarness(authKind: 'session' | 'api_token' | 'project_pat') {
    const finalizeReceipt = vi.fn(async () => ({ id: 'receipt-1' }));
    const getDeliveryExecution = vi.fn(async () => ({
      agent_runs: [],
      run_events: [],
      run_checks: [],
      project_environments: [],
      releases: [],
      release_artifacts: [],
      release_promotions: [],
    }));
    const getProjectManifestComparison = vi.fn(async () => ({
      status: 'not_applied' as const,
      state: null,
      drift: [],
    }));
    const app = new Hono();
    app.onError((error, c) => {
      if (error instanceof OpenLanderError) {
        return c.json(
          { code: error.code, message: error.message, details: error.details },
          error.statusCode as 400,
        );
      }
      throw error;
    });
    app.use('*', async (c, next) => {
      c.set('authKind', authKind);
      await next();
    });
    app.route(
      '/api',
      createDeliveryRoutes({
        db: {
          getDelivery: vi.fn(async () => ({
            id: 'delivery-1',
            project_id: 'project-1',
          })),
        },
        deliveryService: { finalizeReceipt, getDeliveryExecution },
        projectManifestService: { getComparison: getProjectManifestComparison },
      } as unknown as AppContext),
    );
    return { app, finalizeReceipt, getDeliveryExecution, getProjectManifestComparison };
  }

  it('requires Idempotency-Key before a Project PAT can upload CI evidence', async () => {
    const { app } = deliveryHarness('project_pat');
    const artifactResponse = await app.request(
      '/api/projects/project-1/deliveries/delivery-1/artifacts',
      { method: 'POST' },
    );
    const gateResponse = await app.request(
      '/api/projects/project-1/deliveries/delivery-1/gates/qa/result',
      { method: 'POST' },
    );

    expect(artifactResponse.status).toBe(400);
    await expect(artifactResponse.json()).resolves.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    expect(gateResponse.status).toBe(400);
    await expect(gateResponse.json()).resolves.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
  });

  it('allows Receipt finalization only from an administrator web session', async () => {
    const apiTokenHarness = deliveryHarness('api_token');
    const denied = await apiTokenHarness.app.request(
      '/api/projects/project-1/deliveries/delivery-1/receipt/finalize',
      { method: 'POST' },
    );
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      code: 'RECEIPT_FINALIZE_WEB_SESSION_REQUIRED',
    });
    expect(apiTokenHarness.finalizeReceipt).not.toHaveBeenCalled();

    const sessionHarness = deliveryHarness('session');
    const allowed = await sessionHarness.app.request(
      '/api/projects/project-1/deliveries/delivery-1/receipt/finalize',
      { method: 'POST' },
    );
    expect(allowed.status).toBe(200);
    expect(sessionHarness.finalizeReceipt).toHaveBeenCalledWith('delivery-1', 'admin');
  });

  it('returns the read-only execution view only after verifying Project ownership', async () => {
    const harness = deliveryHarness('session');
    const allowed = await harness.app.request(
      '/api/projects/project-1/deliveries/delivery-1/execution',
    );
    expect(allowed.status).toBe(200);
    expect(harness.getDeliveryExecution).toHaveBeenCalledWith('delivery-1');
    expect(harness.getProjectManifestComparison).toHaveBeenCalledWith('project-1');
    await expect(allowed.json()).resolves.toMatchObject({
      project_manifest: { status: 'not_applied', state: null, drift: [] },
    });

    const denied = await harness.app.request(
      '/api/projects/project-2/deliveries/delivery-1/execution',
    );
    expect(denied.status).toBe(404);
    expect(harness.getDeliveryExecution).toHaveBeenCalledTimes(1);
    expect(harness.getProjectManifestComparison).toHaveBeenCalledTimes(1);
  });

  it('always downloads HTML as an attachment with a restrictive content policy', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('authKind', 'session');
      await next();
    });
    app.route(
      '/api',
      createDeliveryRoutes({
        db: {
          getDelivery: vi.fn(async () => ({
            id: 'delivery-1',
            project_id: 'project-1',
          })),
        },
        deliveryService: {
          getArtifactDownload: vi.fn(async () => ({
            artifact: {
              id: 'artifact-1',
              original_filename: '검토 화면.html',
            },
            blob: {
              mime_type: 'text/html',
              size_bytes: 28,
              storage_key: `sha256/${'a'.repeat(2)}/${'a'.repeat(64)}`,
            },
          })),
        },
        artifactStore: {
          open: vi.fn(() => Readable.from(['<!doctype html><script>x()</script>'])),
        },
      } as unknown as AppContext),
    );

    const response = await app.request(
      '/api/projects/project-1/deliveries/delivery-1/artifacts/artifact-1/download',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toContain('<script>');
  });

  it('preserves UTF-8 artifact filenames from multipart FormData', async () => {
    const attachStoredArtifact = vi.fn(async (input) => ({
      id: 'artifact-utf8',
      original_filename: input.originalFilename,
    }));
    const store = vi.fn(async (source, options) => {
      for await (const _chunk of source) {
        // Consume the upload stream like ArtifactStore.store does.
      }
      return {
        sha256: 'c'.repeat(64),
        mimeType: 'text/html',
        sizeBytes: 28,
        storageKey: `sha256/${'c'.repeat(2)}/${'c'.repeat(64)}`,
        filename: options.filename,
      };
    });
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('authKind', 'session');
      await next();
    });
    app.route(
      '/api',
      createDeliveryRoutes({
        db: {
          getDelivery: vi.fn(async () => ({
            id: 'delivery-1',
            project_id: 'project-1',
          })),
          upsertArtifactBlob: vi.fn(async () => ({ id: 'blob-utf8' })),
        },
        deliveryService: {
          assertDeliveryCanMutate: vi.fn(async () => undefined),
          attachStoredArtifact,
        },
        artifactStore: { store },
      } as unknown as AppContext),
    );
    const form = new FormData();
    form.append('logical_key', 'storyboard');
    form.append('revision', '1');
    form.append('kind', 'review_html');
    form.append(
      'file',
      new File(['<!doctype html><title>검토</title>'], '스토리보드.html', {
        type: 'text/html',
      }),
    );

    const response = await app.request('/api/projects/project-1/deliveries/delivery-1/artifacts', {
      method: 'POST',
      body: form,
    });

    expect(response.status).toBe(201);
    expect(store).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ filename: '스토리보드.html' }),
    );
    expect(attachStoredArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ originalFilename: '스토리보드.html' }),
    );
  });
});
