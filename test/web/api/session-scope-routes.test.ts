import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../../src/app.js';
import type { AuthService } from '../../../src/auth/auth-service.js';
import { createAuthRoutes } from '../../../src/web/api/auth-routes.js';

function createHarness() {
  let activeProjectId: string | null = null;
  const setActiveScopeProjectId = vi.fn(async (projectId: string | null) => {
    activeProjectId = projectId;
  });
  const project = {
    id: 'proj_1',
    name: 'hotdeal',
    display_name: 'Hotdeal',
  };
  const authService = {
    validateSession: vi.fn(async (token: string) => token === 'session-ok'),
  } as unknown as AuthService;
  const ctx = {
    db: {
      getActiveScopeProjectId: vi.fn(async () => activeProjectId),
      setActiveScopeProjectId,
      getProject: vi.fn(async (projectId: string) => (projectId === project.id ? project : null)),
    },
  } as unknown as AppContext;
  const app = createAuthRoutes(authService, ctx);
  return { app, authService, setActiveScopeProjectId };
}

describe('session scope routes', () => {
  it('rejects bearer-only requests so MCP tokens cannot switch active scope', async () => {
    const { app, authService } = createHarness();
    const res = await app.request('/session/scope', {
      method: 'POST',
      headers: { Authorization: 'Bearer ol_test' },
      body: JSON.stringify({ project_id: 'proj_1' }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'WEB_SESSION_REQUIRED' });
    expect(authService.validateSession).not.toHaveBeenCalledWith('ol_test');
  });

  it('sets and reads project active scope with a web session cookie', async () => {
    const { app, setActiveScopeProjectId } = createHarness();
    const setRes = await app.request('/session/scope', {
      method: 'POST',
      headers: { Cookie: 'ol_session=session-ok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: 'proj_1' }),
    });

    expect(setRes.status).toBe(200);
    await expect(setRes.json()).resolves.toMatchObject({
      activeScope: {
        kind: 'project',
        projectId: 'proj_1',
        projectName: 'hotdeal',
        displayName: 'Hotdeal',
      },
    });
    expect(setActiveScopeProjectId).toHaveBeenCalledWith('proj_1');

    const getRes = await app.request('/session/scope', {
      headers: { Cookie: 'ol_session=session-ok' },
    });
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toMatchObject({
      activeScope: { kind: 'project', projectId: 'proj_1' },
    });
  });

  it('clears active scope back to org-wide mode', async () => {
    const { app, setActiveScopeProjectId } = createHarness();
    const res = await app.request('/session/scope', {
      method: 'POST',
      headers: { Cookie: 'ol_session=session-ok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: null }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ activeScope: { kind: 'org' } });
    expect(setActiveScopeProjectId).toHaveBeenCalledWith(null);
  });
});
