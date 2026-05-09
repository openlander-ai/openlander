/**
 * CORS policy regression tests.
 *
 * Verifies the policy enforced by `createCorsOriginPolicy` and the
 * `/api/*` middleware wired in `src/web/server.ts`:
 *   - default (no `corsOrigin` config) ⇒ same-origin only (`server.baseUrl`)
 *   - explicit allow-list ⇒ only listed origins reflected
 *   - missing `Origin` header (curl, server-to-server) ⇒ no ACAO header
 *   - off-list and null origins ⇒ no ACAO header (browser blocks read)
 *
 * These tests target the wide-open `'*'` regression that previously let any
 * website read OpenLander API responses with the user's session cookie/token.
 */

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  createCorsOriginPolicy,
  parseAllowedOrigins,
} from '../../../src/web/middleware/cors-policy.js';

function makeApp(corsOrigin: string | undefined, baseUrl: string): Hono {
  const app = new Hono();
  app.use(
    '/api/*',
    cors({
      origin: createCorsOriginPolicy(corsOrigin, baseUrl),
      credentials: false,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    }),
  );
  app.get('/api/ping', (c) => c.json({ ok: true }));
  return app;
}

async function fetchOrigin(app: Hono, path: string, origin: string | null): Promise<string | null> {
  const headers: Record<string, string> = {};
  if (origin !== null) headers.Origin = origin;
  const res = await app.request(path, { method: 'GET', headers });
  return res.headers.get('Access-Control-Allow-Origin');
}

describe('parseAllowedOrigins', () => {
  it('returns [] for undefined / empty / whitespace input', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins('   ')).toEqual([]);
    expect(parseAllowedOrigins(',,, ,')).toEqual([]);
  });

  it('splits, trims, and drops empty entries', () => {
    expect(parseAllowedOrigins('https://a.com, https://b.com ,,')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });
});

describe('createCorsOriginPolicy — default (same-origin only)', () => {
  const baseUrl = 'http://localhost:10114';
  const app = makeApp(undefined, baseUrl);

  it('allows requests from the configured baseUrl origin', async () => {
    expect(await fetchOrigin(app, '/api/ping', 'http://localhost:10114')).toBe(
      'http://localhost:10114',
    );
  });

  it('blocks requests from any other origin (no ACAO header sent)', async () => {
    expect(await fetchOrigin(app, '/api/ping', 'https://evil.example.com')).toBeNull();
    expect(await fetchOrigin(app, '/api/ping', 'http://localhost:9999')).toBeNull();
    // Same host, different scheme/port must not match.
    expect(await fetchOrigin(app, '/api/ping', 'https://localhost:10114')).toBeNull();
  });

  it('blocks requests with no Origin header (curl, server-to-server)', async () => {
    // Browsers omit Origin for same-origin GETs; without an Origin we must not
    // emit ACAO at all (Hono cors omits the header when the resolver returns null).
    expect(await fetchOrigin(app, '/api/ping', null)).toBeNull();
  });
});

describe('createCorsOriginPolicy — explicit allow-list override', () => {
  const baseUrl = 'http://localhost:10114';
  const app = makeApp('https://app.example.com, https://admin.example.com', baseUrl);

  it('reflects an origin that is on the allow-list', async () => {
    expect(await fetchOrigin(app, '/api/ping', 'https://app.example.com')).toBe(
      'https://app.example.com',
    );
    expect(await fetchOrigin(app, '/api/ping', 'https://admin.example.com')).toBe(
      'https://admin.example.com',
    );
  });

  it('blocks origins not on the allow-list (including baseUrl)', async () => {
    expect(await fetchOrigin(app, '/api/ping', 'https://evil.example.com')).toBeNull();
    // When operator overrides the allow-list, baseUrl is no longer implicitly trusted —
    // they must add it explicitly. This makes the policy auditable.
    expect(await fetchOrigin(app, '/api/ping', 'http://localhost:10114')).toBeNull();
  });

  it('blocks requests with no Origin header even when allow-list is set', async () => {
    expect(await fetchOrigin(app, '/api/ping', null)).toBeNull();
  });
});
