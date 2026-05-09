import { expect, test } from '@playwright/test';

import { isNoAuthMode, OPENLANDER_URL } from './fixtures/config.js';

test.describe.configure({ mode: 'serial' });

function skipWhenNoAuthMode() {
  test.skip(isNoAuthMode(), 'Auth tests require auth-enabled OpenLander');
}

async function loginSession(): Promise<string> {
  const loginRes = await fetch(`${OPENLANDER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'e2e-quality-gate' }),
  });
  expect(loginRes.status).toBe(200);
  const setCookie = loginRes.headers.get('set-cookie') ?? '';
  const sessionMatch = setCookie.match(/ol_session=([^;]*)/);
  const sessionToken = sessionMatch?.[1];
  if (!sessionToken) {
    throw new Error('Login succeeded but no ol_session cookie was returned');
  }
  return sessionToken;
}

test.describe('Quality Gate — Authentication', () => {
  test('GET /api/projects without auth returns 401', async () => {
    skipWhenNoAuthMode();
    const res = await fetch(`${OPENLANDER_URL}/api/projects`);
    expect(res.status).toBe(401);
  });

  test('GET /health without auth returns 200 (exempt route)', async () => {
    const res = await fetch(`${OPENLANDER_URL}/health`);
    expect(res.status).toBe(200);
  });

  test('POST /api/auth/login with wrong password returns 401', async () => {
    skipWhenNoAuthMode();
    const res = await fetch(`${OPENLANDER_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password-xyz' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  test('POST /api/auth/login with correct password returns 200 + session cookie', async () => {
    skipWhenNoAuthMode();
    const res = await fetch(`${OPENLANDER_URL}/api/auth/login`, {
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
    skipWhenNoAuthMode();
    const sessionToken = await loginSession();

    const projectsRes = await fetch(`${OPENLANDER_URL}/api/projects`, {
      headers: { Cookie: `ol_session=${sessionToken}` },
    });
    expect(projectsRes.status).toBe(200);
  });

  test('GET /api/auth/token returns ol_ prefixed token for authenticated user', async () => {
    skipWhenNoAuthMode();
    const sessionToken = await loginSession();

    const tokenRes = await fetch(`${OPENLANDER_URL}/api/auth/token`, {
      headers: { Cookie: `ol_session=${sessionToken}` },
    });
    expect(tokenRes.status).toBe(200);
    const body = (await tokenRes.json()) as { token: string };
    expect(body.token).toMatch(/^ol_/);
  });

  test('Bearer token allows access to protected routes', async () => {
    skipWhenNoAuthMode();
    const apiToken = process.env.OPENLANDER_API_TOKEN;
    if (!apiToken) {
      test.skip(true, 'No API token available — skipping Bearer token test');
      return;
    }
    const res = await fetch(`${OPENLANDER_URL}/api/projects`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    expect(res.status).toBe(200);
  });

  test('MCP HTTP without Bearer token returns 401', async () => {
    skipWhenNoAuthMode();
    const res = await fetch(`${OPENLANDER_URL}/mcp`, {
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
    skipWhenNoAuthMode();
    const sessionToken = await loginSession();
    const res = await fetch(`${OPENLANDER_URL}/api/auth/verify`, {
      headers: { Cookie: `ol_session=${sessionToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(true);
  });

  test('GET /api/auth/verify returns 401 without session', async () => {
    skipWhenNoAuthMode();
    const res = await fetch(`${OPENLANDER_URL}/api/auth/verify`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(false);
  });
});
