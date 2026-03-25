import { expect, test } from '@playwright/test';

const BASE = 'http://localhost:10114';

const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

if (!isBunRuntime) {
  test.describe.configure({ mode: 'serial' });

  test.describe('Quality Gate — Authentication', () => {
    test('GET /api/projects without auth returns 401', async () => {
      const res = await fetch(`${BASE}/api/projects`);
      expect(res.status).toBe(401);
    });

    test('GET /health without auth returns 200 (exempt route)', async () => {
      const res = await fetch(`${BASE}/health`);
      expect(res.status).toBe(200);
    });

    test('POST /api/auth/login with wrong password returns 401', async () => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong-password-xyz' }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBeTruthy();
    });

    test('POST /api/auth/login with correct password returns 200 + session cookie', async () => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'e2e-quality-gate' }),
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('ol_session=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Strict');
    });

    test('Session cookie from login allows access to protected routes', async () => {
      const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'e2e-quality-gate' }),
      });
      const setCookie = loginRes.headers.get('set-cookie') ?? '';
      const sessionMatch = setCookie.match(/ol_session=([^;]*)/);
      expect(sessionMatch).toBeTruthy();
      const sessionToken = sessionMatch![1];

      const projectsRes = await fetch(`${BASE}/api/projects`, {
        headers: { Cookie: `ol_session=${sessionToken}` },
      });
      expect(projectsRes.status).toBe(200);
    });

    test('GET /api/auth/token returns ol_ prefixed token for authenticated user', async () => {
      const loginRes = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'e2e-quality-gate' }),
      });
      const setCookie = loginRes.headers.get('set-cookie') ?? '';
      const sessionMatch = setCookie.match(/ol_session=([^;]*)/);
      const sessionToken = sessionMatch![1];

      const tokenRes = await fetch(`${BASE}/api/auth/token`, {
        headers: { Cookie: `ol_session=${sessionToken}` },
      });
      expect(tokenRes.status).toBe(200);
      const body = (await tokenRes.json()) as { token: string };
      expect(body.token).toMatch(/^ol_/);
    });

    test('Bearer token allows access to protected routes', async () => {
      const apiToken = process.env.OPENLANDER_API_TOKEN;
      if (!apiToken) {
        test.skip(true, 'No API token available — skipping Bearer token test');
        return;
      }
      const res = await fetch(`${BASE}/api/projects`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      expect(res.status).toBe(200);
    });

    test('MCP HTTP without Bearer token returns 401', async () => {
      const res = await fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          params: { capabilities: {} },
          id: 1,
        }),
      });
      expect(res.status).toBe(401);
    });

    test('GET /api/auth/verify returns authenticated:true with valid session', async () => {
      const sessionToken = process.env.OPENLANDER_SESSION;
      if (!sessionToken) {
        test.skip(true, 'No session token available');
        return;
      }
      const res = await fetch(`${BASE}/api/auth/verify`, {
        headers: { Cookie: `ol_session=${sessionToken}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { authenticated: boolean };
      expect(body.authenticated).toBe(true);
    });

    test('GET /api/auth/verify returns 401 without session', async () => {
      const res = await fetch(`${BASE}/api/auth/verify`);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { authenticated: boolean };
      expect(body.authenticated).toBe(false);
    });
  });
}
