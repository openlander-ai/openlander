import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../../src/app.js';
import type { AuthService } from '../../../src/auth/auth-service.js';
import { createAuthRoutes } from '../../../src/web/api/auth-routes.js';

function createHarness() {
  const issuedRow = {
    id: 'pat-1',
    name: 'Cursor',
    token_hash: 'never-return-this',
    token_suffix: 'abcd',
    scope_kind: 'project' as const,
    scope_project_id: 'proj-1',
    scope_service_id: null,
    token_type: 'pat' as const,
    capabilities: null,
    last_used_at: null,
    expires_at: '2026-08-03T00:00:00.000Z',
    revoked_at: null,
    created_at: '2026-05-05T00:00:00.000Z',
    server_id: 'local',
  };
  const orgRow = {
    ...issuedRow,
    id: 'pat-org',
    name: 'OpenLander agent',
    token_suffix: 'org1',
    scope_kind: 'org' as const,
    scope_project_id: null,
  };
  const serviceRow = {
    ...issuedRow,
    id: 'pat-service',
    name: 'Open in Agent handoff',
    token_suffix: 'svc1',
    scope_kind: 'service' as const,
    scope_project_id: null,
    scope_service_id: 'service-1',
    token_type: 'service' as const,
  };
  const authService = {
    validateSession: vi.fn(async (token: string) => token === 'session-ok'),
    issuePatToken: vi.fn(async () => ({ token: 'olp_plaintext', row: issuedRow })),
    listPatTokens: vi.fn(async () => [issuedRow]),
    ensureOrgMcpPatToken: vi.fn(async () => ({
      token: 'olp_new_org',
      row: orgRow,
      created: true,
      revokedTokenIds: ['legacy-default'],
      legacyTokenRotated: true,
    })),
    rotateOrgMcpPatToken: vi.fn(async () => ({
      token: 'olp_rotated_org',
      row: orgRow,
      created: true,
      revokedTokenIds: ['pat-old', 'legacy-default'],
      legacyTokenRotated: true,
    })),
    revokePatToken: vi.fn(async (id: string) => id === 'pat-1'),
  } as unknown as AuthService;
  const ctx = {
    db: {
      getProject: vi.fn(async (projectId: string) =>
        projectId === 'proj-1' ? { id: 'proj-1', name: 'demo' } : null,
      ),
      getService: vi.fn(async (serviceId: string) =>
        serviceId === 'service-1'
          ? { id: 'service-1', name: 'web', project_id: 'proj-1', kind: 'git' }
          : null,
      ),
    },
  } as unknown as AppContext;
  const app = createAuthRoutes(authService, ctx);
  return { app, authService, ctx, serviceRow };
}

describe('PAT token routes', () => {
  it('requires a web session cookie and rejects bearer-only requests', async () => {
    const { app, authService } = createHarness();

    const res = await app.request('/tokens', {
      method: 'POST',
      headers: { Authorization: 'Bearer olp_token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cursor', scope_kind: 'org' }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'WEB_SESSION_REQUIRED' });
    expect(authService.issuePatToken).not.toHaveBeenCalled();
  });

  it('requires a web session cookie for the v0.1 MCP token wrapper', async () => {
    const { app, authService } = createHarness();

    const res = await app.request('/mcp/token/regenerate', {
      method: 'POST',
      headers: { Authorization: 'Bearer olp_token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'OpenLander agent' }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'WEB_SESSION_REQUIRED' });
    expect(authService.rotateOrgMcpPatToken).not.toHaveBeenCalled();
  });

  it('issues project-scoped PATs and returns plaintext only once', async () => {
    const { app, authService } = createHarness();

    const res = await app.request('/tokens', {
      method: 'POST',
      headers: { Cookie: 'ol_session=session-ok', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Cursor',
        scope_kind: 'project',
        scope_project_id: 'proj-1',
        expires_in_days: 30,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      id: 'pat-1',
      token: 'olp_plaintext',
      suffix: 'abcd',
      scope: { kind: 'project', projectId: 'proj-1' },
    });
    expect(authService.issuePatToken).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Cursor',
        scopeKind: 'project',
        scopeProjectId: 'proj-1',
      }),
    );
  });

  it('issues service-scoped PATs after validating the service target', async () => {
    const { app, authService, ctx, serviceRow } = createHarness();
    vi.mocked(authService.issuePatToken).mockResolvedValueOnce({
      token: 'olp_service_plaintext',
      row: serviceRow,
    });

    const res = await app.request('/tokens', {
      method: 'POST',
      headers: { Cookie: 'ol_session=session-ok', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Open in Agent handoff',
        scope_kind: 'service',
        scope_service_id: 'service-1',
        expires_in_days: 1,
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      id: 'pat-service',
      token: 'olp_service_plaintext',
      suffix: 'svc1',
      scope: { kind: 'service', projectId: null, serviceId: 'service-1' },
    });
    expect(ctx.db.getService).toHaveBeenCalledWith('service-1');
    expect(authService.issuePatToken).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Open in Agent handoff',
        scopeKind: 'service',
        scopeProjectId: null,
        scopeServiceId: 'service-1',
      }),
    );
  });

  it('rejects service-scoped PATs when the service target does not exist', async () => {
    const { app, authService } = createHarness();

    const res = await app.request('/tokens', {
      method: 'POST',
      headers: { Cookie: 'ol_session=session-ok', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Missing service',
        scope_kind: 'service',
        scope_service_id: 'missing-service',
      }),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'SERVICE_NOT_FOUND' });
    expect(authService.issuePatToken).not.toHaveBeenCalled();
  });

  it('rejects invalid token scope instead of silently issuing org-wide tokens', async () => {
    const { app, authService } = createHarness();

    const res = await app.request('/tokens', {
      method: 'POST',
      headers: { Cookie: 'ol_session=session-ok', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Cursor',
        scope_kind: 'projectt',
        scope_project_id: 'proj-1',
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'INVALID_FIELD' });
    expect(authService.issuePatToken).not.toHaveBeenCalled();
  });

  it('lists token metadata without exposing hashes or plaintext token values', async () => {
    const { app } = createHarness();

    const res = await app.request('/tokens?scope=project:proj-1', {
      headers: { Cookie: 'ol_session=session-ok' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { tokens: Array<Record<string, unknown>> };
    expect(body.tokens[0]).toMatchObject({
      id: 'pat-1',
      name: 'Cursor',
      suffix: 'abcd',
      scope: { kind: 'project', projectId: 'proj-1' },
    });
    expect(body.tokens[0]).not.toHaveProperty('token');
    expect(body.tokens[0]).not.toHaveProperty('token_hash');
  });

  it('lists service-scoped token metadata by service scope filter', async () => {
    const { app, authService, serviceRow } = createHarness();
    vi.mocked(authService.listPatTokens).mockResolvedValueOnce([serviceRow]);

    const res = await app.request('/tokens?scope=service:service-1', {
      headers: { Cookie: 'ol_session=session-ok' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { tokens: Array<Record<string, unknown>> };
    expect(body.tokens[0]).toMatchObject({
      id: 'pat-service',
      name: 'Open in Agent handoff',
      suffix: 'svc1',
      scope: { kind: 'service', projectId: null, serviceId: 'service-1' },
      tokenType: 'service',
    });
    expect(authService.listPatTokens).toHaveBeenCalledWith({
      scopeKind: 'service',
      scopeServiceId: 'service-1',
    });
  });

  it('returns the active v0.1 MCP org token metadata without plaintext', async () => {
    const { app, authService } = createHarness();
    vi.mocked(authService.listPatTokens).mockResolvedValueOnce([
      {
        id: 'legacy-default',
        name: 'Legacy default token',
        token_hash: 'hidden',
        token_suffix: 'l3g',
        scope_kind: 'org',
        scope_project_id: null,
        scope_service_id: null,
        token_type: 'legacy-default',
        capabilities: null,
        last_used_at: null,
        expires_at: null,
        revoked_at: null,
        created_at: '2026-05-04T00:00:00.000Z',
        server_id: 'local',
      },
      {
        id: 'pat-org',
        name: 'OpenLander agent',
        token_hash: 'hidden',
        token_suffix: 'org1',
        scope_kind: 'org',
        scope_project_id: null,
        scope_service_id: null,
        token_type: 'pat',
        capabilities: null,
        last_used_at: null,
        expires_at: '2026-08-03T00:00:00.000Z',
        revoked_at: null,
        created_at: '2026-05-05T00:00:00.000Z',
        server_id: 'local',
      },
    ]);

    const res = await app.request('/mcp/token', {
      headers: { Cookie: 'ol_session=session-ok' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: Record<string, unknown> | null };
    expect(body.token).toMatchObject({
      id: 'pat-org',
      suffix: 'org1',
      scope: { kind: 'org', projectId: null },
      tokenType: 'pat',
    });
    expect(body.token).not.toHaveProperty('token');
    expect(body.token).not.toHaveProperty('token_hash');
    expect(authService.listPatTokens).toHaveBeenCalledWith({ scopeKind: 'org' });
  });

  it('creates the v0.1 MCP org token through the single-token wrapper', async () => {
    const { app, authService } = createHarness();

    const res = await app.request('/mcp/token', {
      method: 'POST',
      headers: { Cookie: 'ol_session=session-ok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'OpenLander agent', expires_in_days: 30 }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      plaintext: 'olp_new_org',
      created: true,
      revokedTokenIds: ['legacy-default'],
      legacyTokenRotated: true,
      token: {
        id: 'pat-org',
        suffix: 'org1',
        scope: { kind: 'org', projectId: null },
      },
    });
    expect(authService.ensureOrgMcpPatToken).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'OpenLander agent',
      }),
    );
  });

  it('regenerates the v0.1 MCP org token atomically on the backend', async () => {
    const { app, authService } = createHarness();

    const res = await app.request('/mcp/token/regenerate', {
      method: 'POST',
      headers: { Cookie: 'ol_session=session-ok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'OpenLander agent', expires_in_days: 30 }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      plaintext: 'olp_rotated_org',
      created: true,
      revokedTokenIds: ['pat-old', 'legacy-default'],
      legacyTokenRotated: true,
      token: {
        id: 'pat-org',
        suffix: 'org1',
        scope: { kind: 'org', projectId: null },
      },
    });
    expect(authService.rotateOrgMcpPatToken).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'OpenLander agent',
      }),
    );
  });

  it('soft-revokes tokens', async () => {
    const { app, authService } = createHarness();

    const res = await app.request('/tokens/pat-1', {
      method: 'DELETE',
      headers: { Cookie: 'ol_session=session-ok' },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: 'revoked' });
    expect(authService.revokePatToken).toHaveBeenCalledWith('pat-1');
  });
});
