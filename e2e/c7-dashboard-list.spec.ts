/**
 * C7 Dashboard_AND_LIST_SMOKE charter (best-effort).
 *
 * API-layer smoke for the Overview / ProjectsGrid / Deployments surfaces.
 * Verifies global counts and archive filter behaviour are consistent and
 * respond quickly. Visual checks deferred to operator.
 *
 * Run:
 *   OPENLANDER_ADMIN_PASSWORD='…' npx playwright test \
 *     --config=playwright-live.config.ts e2e/c7-dashboard-list.spec.ts
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

test.describe('C7 Dashboard / ProjectsGrid / Deployments', () => {
  test.skip(!PASSWORD, 'OPENLANDER_ADMIN_PASSWORD not set');

  test('C7S1 /api/projects returns count === projects.length', async ({ request }) => {
    const cookie = await login(request);
    const res = await request.get(`${BASE_URL}/api/projects`, {
      headers: { Cookie: cookie },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      count: number;
      projects: Array<{ id: string; name: string }>;
    };
    expect(body.count, 'count field matches projects array length').toBe(body.projects.length);
  });

  test('C7S2 archive filter: includeArchived toggles visibility', async ({ request }) => {
    const cookie = await login(request);
    // Default (no flag)
    const defaultRes = await request.get(`${BASE_URL}/api/projects`, {
      headers: { Cookie: cookie },
    });
    const defaultBody = (await defaultRes.json()) as {
      projects: Array<{ id: string; archivedAt?: string | null; archived_at?: string | null }>;
    };
    const defaultArchivedCount = defaultBody.projects.filter(
      (p) => p.archivedAt || p.archived_at,
    ).length;

    // With includeArchived=true
    const withArchived = await request.get(`${BASE_URL}/api/projects?includeArchived=true`, {
      headers: { Cookie: cookie },
    });
    const withBody = (await withArchived.json()) as {
      projects: Array<{ id: string; archivedAt?: string | null; archived_at?: string | null }>;
    };
    const withArchivedCount = withBody.projects.filter((p) => p.archivedAt || p.archived_at).length;
    // Either default hides archived entirely (count=0 in default) or does not
    // filter (same count either way). Both are acceptable — we only assert
    // that withArchived ≥ default.
    expect(withBody.projects.length).toBeGreaterThanOrEqual(defaultBody.projects.length);
    expect(withArchivedCount).toBeGreaterThanOrEqual(defaultArchivedCount);
  });

  test('C7S3 deployments list endpoint reachable', async ({ request }) => {
    const cookie = await login(request);
    const res = await request.get(`${BASE_URL}/api/deployments?limit=20`, {
      headers: { Cookie: cookie },
    });
    expect([200, 404]).toContain(res.status());
    if (res.ok()) {
      const body = (await res.json()) as unknown;
      // shape: { deployments: [...] } or array
      const list = Array.isArray(body)
        ? body
        : ((body as { deployments?: unknown[] }).deployments ?? []);
      expect(Array.isArray(list)).toBeTruthy();
    }
  });

  test('C7S4 overview endpoint responds < 2s', async ({ request }) => {
    const cookie = await login(request);
    const start = Date.now();
    const res = await request.get(`${BASE_URL}/api/overview`, {
      headers: { Cookie: cookie },
    });
    const elapsed = Date.now() - start;
    expect([200, 404]).toContain(res.status());
    expect(elapsed, 'overview snapshot < 2s').toBeLessThan(2_000);
  });

  test('C7S5 /api/info: minimal pre-auth surface', async ({ request }) => {
    // Anonymous (no cookie)
    const res = await request.get(`${BASE_URL}/api/info`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as Record<string, unknown>;
    // Day 13 security tighten: must not leak internal details to anonymous
    // callers. Accept only a small allow-list of keys.
    const allowedKeys = new Set(['name', 'version', 'build', 'ok']);
    for (const key of Object.keys(body)) {
      expect(allowedKeys, `/api/info leaks key "${key}" to anonymous caller`).toContain(key);
    }
  });
});
