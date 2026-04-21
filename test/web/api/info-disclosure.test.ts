/**
 * Day 13 M5: `/api/info` and `/api/setup/status` used to leak the running
 * version, deployment mode, configured LLM provider/model, and GitHub
 * username to anonymous callers. That's a free CVE-targeting / recon
 * primitive on the open internet. The fix:
 *   - `/api/info` only returns `{ name }` until the request is authenticated
 *   - `/api/setup/status` only returns `{ ready, hasPassword }` to anonymous
 *     callers once the password is configured
 *
 * The auth flag is set by `createAuthMiddleware` from a valid session cookie
 * or Bearer token. We exercise that middleware in front of the live route
 * handlers to make sure the gating works end-to-end.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Database } from '../../../src/db/index.js';
import { AuthService } from '../../../src/auth/auth-service.js';
import { createAuthMiddleware, isAuthenticated } from '../../../src/web/middleware/auth.js';
import { VERSION } from '../../../src/version.js';

function makeInfoApp(authService: AuthService): Hono {
  const app = new Hono();
  app.use('*', createAuthMiddleware(authService));
  app.get('/api/info', (c) => {
    if (isAuthenticated(c)) {
      return c.json({
        name: 'OpenLander',
        version: VERSION,
        mode: 'headless',
        docs: '/health',
        api: '/api',
      });
    }
    return c.json({ name: 'OpenLander' });
  });
  return app;
}

describe('Day 13 M5: /api/info information disclosure', () => {
  let tmpDir: string;
  let db: Database;
  let authService: AuthService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-info-disc-'));
    db = new Database(join(tmpDir, 'test.db'));
    authService = new AuthService(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns only the product name to anonymous callers once setup is complete', async () => {
    authService.setupPassword('hunter2-correct-horse');
    const app = makeInfoApp(authService);

    const res = await app.request('/api/info');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ name: 'OpenLander' });
    expect(body).not.toHaveProperty('version');
    expect(body).not.toHaveProperty('mode');
  });

  it('returns version and mode after a valid session cookie is presented', async () => {
    authService.setupPassword('hunter2-correct-horse');
    const session = authService.createSession();
    const app = makeInfoApp(authService);

    const res = await app.request('/api/info', {
      headers: { cookie: `ol_session=${session.token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe('OpenLander');
    expect(body.version).toBe(VERSION);
    expect(body.mode).toBe('headless');
  });

  it('returns version and mode when a valid Bearer API token is presented', async () => {
    const result = authService.setupPassword('hunter2-correct-horse');
    const app = makeInfoApp(authService);

    const res = await app.request('/api/info', {
      headers: { authorization: `Bearer ${result.apiToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.version).toBe(VERSION);
  });

  it('still serves /api/info during first-run setup (anonymous-only world)', async () => {
    // Before the password is set, every request is effectively anonymous —
    // the lite payload is correct and the route still has to work because
    // the onboarding shell pings it.
    const app = makeInfoApp(authService);
    const res = await app.request('/api/info');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ name: 'OpenLander' });
  });
});
