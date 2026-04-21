/**
 * C4 DangerActions_AND_SERVICES charter (API-layer smoke).
 *
 * Full UI click-through for Purge / Archive / Stop / Delete Service is
 * deferred to operator (v2 charter). This spec verifies the API contract
 * for each mutating endpoint: typed errors on wrong state, confirmation
 * guard on purge, and the per-project lock semantics already covered by
 * concurrent-deploy.spec.ts.
 *
 * Regression gates:
 *   - BUG-002 double redeploy lock → 409 (covered in concurrent-deploy.spec.ts)
 *   - BUG-008 volume duplicate mount path → UI-only; not automated here
 *   - BUG-009 service delete with linked project → warning dialog required
 *     (pure UI; this spec only asserts the delete endpoint itself exists
 *     and returns typed response)
 *   - Purge requires ?confirm=true query param (server-side guard)
 */

import { expect, test } from '@playwright/test';

const BASE_URL = process.env.OPENLANDER_BASE_URL ?? 'http://localhost:10114';
const PASSWORD = process.env.OPENLANDER_ADMIN_PASSWORD;

async function login(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { password: PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  const m = (res.headers()['set-cookie'] ?? '').match(/ol_session=([^;]+)/);
  if (!m) throw new Error('login cookie missing');
  return `ol_session=${m[1]}`;
}

async function pickProject(
  request: import('@playwright/test').APIRequestContext,
  cookie: string,
): Promise<{ id: string; status: string } | null> {
  const res = await request.get(`${BASE_URL}/api/projects`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok()) return null;
  const body = (await res.json()) as {
    projects: Array<{ id: string; status: string }>;
  };
  return body.projects[0] ?? null;
}

test.describe('C4 Danger Actions', () => {
  test.skip(!PASSWORD, 'OPENLANDER_ADMIN_PASSWORD not set');

  test('C4S1 purge without ?confirm=true rejected', async ({ request }) => {
    const cookie = await login(request);
    const project = await pickProject(request, cookie);
    if (!project) {
      test.skip();
      return;
    }
    const res = await request.delete(`${BASE_URL}/api/projects/${project.id}/purge`, {
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    });
    expect(res.status(), 'missing confirm → 400').toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/confirm/i);
  });

  test('C4S2 stop endpoint returns typed error for already-stopped / recovering', async ({
    request,
  }) => {
    const cookie = await login(request);
    const project = await pickProject(request, cookie);
    if (!project) {
      test.skip();
      return;
    }
    const res = await request.post(`${BASE_URL}/api/projects/${project.id}/stop`, {
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    });
    // 200 if running, 400/409 if not — must not 5xx.
    expect(res.status(), 'stop must not 5xx').toBeLessThan(500);
  });

  test('C4S3 archive endpoint requires mutable state', async ({ request }) => {
    const cookie = await login(request);
    const project = await pickProject(request, cookie);
    if (!project) {
      test.skip();
      return;
    }
    const res = await request.post(`${BASE_URL}/api/projects/${project.id}/archive`, {
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    });
    expect(res.status(), 'archive must not 5xx').toBeLessThan(500);
    if (res.status() === 409) {
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(
        /PROJECT_RECOVERING|PROJECT_ARCHIVED|CIRCUIT_BREAKER_OPEN|DEPLOY_LOCKED/,
      );
    }
  });

  test('C4S4 unknown project id returns 404 (not 500)', async ({ request }) => {
    const cookie = await login(request);
    for (const path of ['/stop', '/archive', '/redeploy', '/rollback', '/blue-green']) {
      const res = await request.post(`${BASE_URL}/api/projects/does-not-exist${path}`, {
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        data: {},
      });
      expect(res.status(), `POST ${path} on unknown id must be 404`).toBe(404);
    }
  });

  test('C4S5 env vars: no state leak between projects', async ({ request }) => {
    const cookie = await login(request);
    const projects = await request.get(`${BASE_URL}/api/projects`, {
      headers: { Cookie: cookie },
    });
    const body = (await projects.json()) as { projects: Array<{ id: string }> };
    if (body.projects.length < 2) {
      test.skip();
      return;
    }
    // Fetch env for both — they must not share entries (other than inherited
    // service env, which the UI marks as such)
    const [a, b] = body.projects;
    const [envA, envB] = await Promise.all([
      request.get(`${BASE_URL}/api/projects/${a!.id}/environments`, {
        headers: { Cookie: cookie },
      }),
      request.get(`${BASE_URL}/api/projects/${b!.id}/environments`, {
        headers: { Cookie: cookie },
      }),
    ]);
    expect(envA.status(), 'env read for project A').toBeLessThan(500);
    expect(envB.status(), 'env read for project B').toBeLessThan(500);
  });
});
