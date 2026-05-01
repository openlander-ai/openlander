/**
 * Cross-project parallel deploy smoke (per-project lock verification).
 *
 * Verifies the per-project deploy lock landed in commit f8fb853:
 *   1. Two different projects can redeploy concurrently (wall time < serialized).
 *   2. Same-project double redeploy returns typed 409 DEPLOY_LOCKED.
 *
 * Usage (against the user's running instance on http://localhost:10114):
 *
 *   OPENLANDER_ADMIN_PASSWORD='your-password' \
 *   PROJECT_A_ID='proj_xxx' PROJECT_B_ID='proj_yyy' \
 *   npx playwright test e2e/concurrent-deploy.spec.ts
 *
 * If PROJECT_A_ID / PROJECT_B_ID are not set the spec lists projects and
 * picks the first two with status='running'. The spec only triggers
 * /api/projects/:id/redeploy and reads the response status — it does not
 * wait for builds to complete, so it is safe to run on a live instance.
 */

import { expect, test } from '@playwright/test';

const BASE_URL = process.env.OPENLANDER_BASE_URL ?? 'http://localhost:10114';
const PASSWORD = process.env.OPENLANDER_ADMIN_PASSWORD;

test.describe('Per-project deploy lock (live instance)', () => {
  test.skip(!PASSWORD, 'OPENLANDER_ADMIN_PASSWORD not set');

  let cookie: string;
  let projectA: string;
  let projectB: string;

  test.beforeAll(async ({ request }) => {
    const loginRes = await request.post(`${BASE_URL}/api/auth/login`, {
      data: { password: PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(loginRes.status(), 'login should succeed — check OPENLANDER_ADMIN_PASSWORD').toBe(200);
    const setCookie = loginRes.headers()['set-cookie'] ?? '';
    const m = setCookie.match(/ol_session=([^;]+)/);
    expect(m, 'session cookie missing in login response').not.toBeNull();
    cookie = `ol_session=${m![1]}`;

    projectA = process.env.PROJECT_A_ID ?? '';
    projectB = process.env.PROJECT_B_ID ?? '';
    if (!projectA || !projectB) {
      const listRes = await request.get(`${BASE_URL}/api/projects`, {
        headers: { Cookie: cookie },
      });
      expect(listRes.ok()).toBeTruthy();
      const body = (await listRes.json()) as
        | { projects: Array<{ id: string; status: string; archivedAt?: string | null }> }
        | Array<{ id: string; status: string; archived_at?: string | null }>;
      const list = Array.isArray(body) ? body : body.projects;
      const candidates = list.filter((p) => {
        const archived = p as { archivedAt?: string | null; archived_at?: string | null };
        if (archived.archivedAt || archived.archived_at) return false;
        return p.status === 'running' || p.status === 'stopped';
      });
      expect(
        candidates.length,
        'need ≥ 2 non-archived projects (running or stopped) on the instance',
      ).toBeGreaterThanOrEqual(2);
      const [first, second] = candidates;
      if (!first || !second) throw new Error('insufficient candidates');
      projectA = projectA || first.id;
      projectB = projectB || second.id;
    }
    expect(projectA).not.toBe(projectB);
  });

  test('two different projects redeploy concurrently — both 200/202', async ({ request }) => {
    const start = Date.now();
    const [resA, resB] = await Promise.all([
      request.post(`${BASE_URL}/api/projects/${projectA}/redeploy`, {
        data: {},
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      }),
      request.post(`${BASE_URL}/api/projects/${projectB}/redeploy`, {
        data: {},
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      }),
    ]);
    const elapsed = Date.now() - start;

    // Both endpoints return promptly because pipeline.redeploy is fire-forget
    // through the lock; the response only confirms acquisition + handoff.
    expect([200, 202]).toContain(resA.status());
    expect([200, 202]).toContain(resB.status());
    expect(elapsed, 'two parallel acquires should not serialize at the API boundary').toBeLessThan(
      8_000,
    );
  });

  test('same project double redeploy — second returns 409 DEPLOY_LOCKED', async ({ request }) => {
    const [resA, resB] = await Promise.all([
      request.post(`${BASE_URL}/api/projects/${projectA}/redeploy`, {
        data: {},
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      }),
      request.post(`${BASE_URL}/api/projects/${projectA}/redeploy`, {
        data: {},
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      }),
    ]);

    const statuses = [resA.status(), resB.status()].sort();
    // Either (200,409) or (202,409). One must succeed, one must lock.
    expect(statuses[1], 'second concurrent same-project redeploy must be 409 DEPLOY_LOCKED').toBe(
      409,
    );
    expect([200, 202]).toContain(statuses[0]);

    const lockedRes = resA.status() === 409 ? resA : resB;
    const body = (await lockedRes.json()) as { error?: string };
    expect(body.error, 'typed error code should be DEPLOY_LOCKED').toBe('DEPLOY_LOCKED');
  });
});
