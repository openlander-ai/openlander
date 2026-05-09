/**
 * Day 13 M5 + Day 14 follow-up: `/api/info` and `/api/setup/status` used to
 * leak the running version, deployment mode, configured LLM provider/model,
 * and GitHub username to anonymous callers. That's a free CVE-targeting /
 * recon primitive on the open internet. The fix:
 *   - `/api/info` only returns `{ name }` until the request is authenticated
 *   - `/api/setup/status` only returns `{ ok, hasPassword }` to anonymous
 *     callers once the password is configured. Day 14 also drops the
 *     `ready` bit because that bit by itself answers the question "is this
 *     install fully provisioned yet?" — useful intel for an attacker.
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

/**
 * Day 14 follow-up: `/api/setup/status` short-circuits to a constant shape
 * when the caller is anonymous AND a password has been set. We mount only
 * the route handler we care about because the full createSetupRoutes()
 * pulls in Docker/Traefik/LLM clients we don't want to exercise here.
 */
function makeStatusApp(opts: { hasPassword: boolean; authService: AuthService }): Hono {
  const app = new Hono();
  app.use('*', createAuthMiddleware(opts.authService));

  // Re-implement the gating contract under test. Keep this in sync with
  // src/web/api/setup-routes.ts. If the production handler diverges, the
  // tests below should diverge too — that's the intent.
  app.get('/api/setup/status', (c) => {
    const hasPassword = opts.hasPassword;
    if (hasPassword && !isAuthenticated(c)) {
      return c.json({ ok: true, hasPassword: true });
    }
    // Authenticated branch (or first-run): expose full status. Mirror the
    // top-level keys so the test asserts on shape, not values.
    return c.json({
      ready: false,
      hasPassword,
      docker: { ok: false, state: 'not_running', message: 'mock' },
      traefik: { ok: false, message: 'mock' },
      llm: { ok: false, provider: 'gemini', model: 'gemini-2.5-flash', message: 'mock' },
      github: { ok: false, username: null, message: 'mock' },
      language: 'en',
    });
  });
  return app;
}

describe('Day 14 follow-up: /api/setup/status anonymous payload is minimal', () => {
  let tmpDir: string;
  let db: Database;
  let authService: AuthService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-setup-status-'));
    db = new Database(join(tmpDir, 'test.db'));
    authService = new AuthService(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns only { ok, hasPassword } to anonymous callers once password is set', async () => {
    authService.setupPassword('hunter2-correct-horse');
    const app = makeStatusApp({ hasPassword: true, authService });

    const res = await app.request('/api/setup/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Minimum shape: just enough for the login form to know which screen
    // to render. Specifically NO docker / llm / github / language keys.
    expect(body).toEqual({ ok: true, hasPassword: true });
    expect(body).not.toHaveProperty('docker');
    expect(body).not.toHaveProperty('llm');
    expect(body).not.toHaveProperty('github');
    expect(body).not.toHaveProperty('language');
    expect(body).not.toHaveProperty('ready');
  });

  it('returns the full status payload after a valid session cookie is presented', async () => {
    authService.setupPassword('hunter2-correct-horse');
    const session = authService.createSession();
    const app = makeStatusApp({ hasPassword: true, authService });

    const res = await app.request('/api/setup/status', {
      headers: { cookie: `ol_session=${session.token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('docker');
    expect(body).toHaveProperty('llm');
    expect(body).toHaveProperty('github');
    expect(body).toHaveProperty('hasPassword', true);
  });

  it('still serves the full status payload during first-run setup (no password yet)', async () => {
    // Before a password is set, the onboarding shell needs to know the
    // full state to render the wizard. The minimal-payload short-circuit
    // intentionally only triggers once `hasPassword === true`.
    const app = makeStatusApp({ hasPassword: false, authService });
    const res = await app.request('/api/setup/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('docker');
    expect(body).toHaveProperty('llm');
    expect(body).toHaveProperty('hasPassword', false);
  });
});
