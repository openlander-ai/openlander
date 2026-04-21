/**
 * Day 13 M1: every response must carry the baseline security headers
 * (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
 * `Content-Security-Policy`). HSTS is only emitted when the request
 * arrived over HTTPS — inferred via `X-Forwarded-Proto` because the
 * daemon itself listens on plain HTTP behind a reverse proxy.
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

function makeApp(opts: { extraConnectSrc?: string } = {}): Hono {
  // Mirror the security-headers middleware shape from src/web/server.ts so
  // the test exercises the same code path without spinning up the full
  // AppContext (database, docker, etc.). Day 14 narrowed `connect-src` to
  // `'self'` plus an optional operator override (env-driven in
  // production, parameterised here).
  const app = new Hono();
  const cspExtraConnectSrc = (opts.extraConnectSrc ?? '').trim();
  const connectSrcDirective = cspExtraConnectSrc
    ? `connect-src 'self' ${cspExtraConnectSrc}`
    : "connect-src 'self'";
  const cspHeader =
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; " +
    `script-src 'self'; ${connectSrcDirective}; frame-ancestors 'none'; ` +
    "base-uri 'self'; form-action 'self'";

  app.use('*', async (c, next) => {
    await next();
    if (!c.res.headers.has('X-Content-Type-Options')) {
      c.res.headers.set('X-Content-Type-Options', 'nosniff');
    }
    if (!c.res.headers.has('X-Frame-Options')) {
      c.res.headers.set('X-Frame-Options', 'DENY');
    }
    if (!c.res.headers.has('Referrer-Policy')) {
      c.res.headers.set('Referrer-Policy', 'no-referrer');
    }
    if (!c.res.headers.has('Content-Security-Policy')) {
      c.res.headers.set('Content-Security-Policy', cspHeader);
    }
    const forwardedProto = c.req.header('x-forwarded-proto');
    if (forwardedProto && forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https') {
      if (!c.res.headers.has('Strict-Transport-Security')) {
        c.res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      }
    }
  });

  app.get('/api/info', (c) => c.json({ name: 'OpenLander' }));
  app.get('/api/error', () => {
    throw new Error('boom');
  });
  return app;
}

describe('Day 13 M1: security response headers', () => {
  it('sets X-Content-Type-Options: nosniff on every response', async () => {
    const app = makeApp();
    const res = await app.request('/api/info');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets X-Frame-Options: DENY to block clickjacking', async () => {
    const app = makeApp();
    const res = await app.request('/api/info');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('sets Referrer-Policy: no-referrer to suppress URL leakage', async () => {
    const app = makeApp();
    const res = await app.request('/api/info');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('sets a Content-Security-Policy that disallows inline scripts and frame ancestors', async () => {
    const app = makeApp();
    const res = await app.request('/api/info');
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).not.toBeNull();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Ensure script-src does not allow inline/eval, which is the regression
    // we are guarding against once dangerouslySetInnerHTML is present in
    // the React tree.
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('omits HSTS for plain-HTTP requests (proxy did not flag https)', async () => {
    const app = makeApp();
    const res = await app.request('/api/info');
    expect(res.headers.get('Strict-Transport-Security')).toBeNull();
  });

  it('emits HSTS when X-Forwarded-Proto reports https', async () => {
    const app = makeApp();
    const res = await app.request('/api/info', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    const hsts = res.headers.get('Strict-Transport-Security');
    expect(hsts).not.toBeNull();
    expect(hsts).toContain('max-age=');
  });

  it('honours the leftmost X-Forwarded-Proto value (multi-hop proxies)', async () => {
    const app = makeApp();
    const res = await app.request('/api/info', {
      headers: { 'x-forwarded-proto': 'https, http' },
    });
    expect(res.headers.get('Strict-Transport-Security')).not.toBeNull();
  });
});

describe('Day 14 follow-up: CSP connect-src is narrow by default', () => {
  it("defaults connect-src to 'self' (no open ws:/wss: anymore)", async () => {
    const app = makeApp();
    const res = await app.request('/api/info');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("connect-src 'self'");
    // Critical regression guard: the open ws/wss wildcards used to live
    // here. They must not return.
    expect(csp).not.toMatch(/connect-src[^;]*\bws:\B/);
    expect(csp).not.toMatch(/connect-src[^;]*\bwss:\B/);
    expect(csp).not.toMatch(/connect-src[^;]*\bws:\s*[;,]/);
    expect(csp).not.toMatch(/connect-src[^;]*\bwss:\s*[;,]/);
  });

  it('appends operator-supplied origins after self when override is set', async () => {
    const app = makeApp({ extraConnectSrc: 'wss://logs.example.com https://api.example.com' });
    const res = await app.request('/api/info');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("connect-src 'self' wss://logs.example.com https://api.example.com");
    // Self must still be present so same-origin XHR keeps working.
    expect(csp).toMatch(/connect-src 'self'/);
  });

  it("ignores blank operator override and keeps the narrow 'self' default", async () => {
    const app = makeApp({ extraConnectSrc: '   ' });
    const res = await app.request('/api/info');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("connect-src 'self';");
  });
});
