import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { AuthService } from '../../../src/auth/auth-service.js';
import { createAuthMiddleware } from '../../../src/web/middleware/auth.js';

function makeApp(
  authService: Pick<AuthService, 'isPasswordSet' | 'validateSession' | 'validateApiToken'>,
) {
  const app = new Hono();
  app.use('*', createAuthMiddleware(authService as AuthService));
  app.get('/api/projects', (c) => c.json({ ok: true }));
  return app;
}

describe('auth middleware', () => {
  it('returns a specific error when an MCP personal access token is used on REST APIs', async () => {
    const app = makeApp({
      isPasswordSet: vi.fn(async () => true),
      validateSession: vi.fn(async () => false),
      validateApiToken: vi.fn(async () => false),
    });

    const res = await app.request('/api/projects', {
      headers: { authorization: 'Bearer olp_test_mcp_pat' },
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      error: 'MCP_PAT_NOT_ACCEPTED_FOR_REST',
    });
  });
});
