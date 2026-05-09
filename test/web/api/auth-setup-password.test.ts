import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../../src/app.js';
import type { AuthService } from '../../../src/auth/auth-service.js';
import { createAuthRoutes } from '../../../src/web/api/auth-routes.js';

function createHarness(opts: { passwordSet?: boolean } = {}) {
  const authService = {
    isPasswordSet: vi.fn(async () => opts.passwordSet === true),
    setupPassword: vi.fn(async () => ({ apiToken: 'ol_setup_token' })),
    createSession: vi.fn(async () => ({ token: 'session-ok', expiresAt: Date.now() + 3600_000 })),
  } as unknown as AuthService;
  const app = createAuthRoutes(authService, {} as AppContext);
  return { app, authService };
}

describe('auth setup password route', () => {
  it('sets the initial password without requiring a setup secret', async () => {
    const { app, authService } = createHarness();

    const res = await app.request('/auth/setup-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-horse-battery-staple' }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      apiToken: 'ol_setup_token',
    });
    expect(res.headers.get('set-cookie')).toContain('ol_session=session-ok');
    expect(authService.setupPassword).toHaveBeenCalledWith('correct-horse-battery-staple');
    expect(authService.createSession).toHaveBeenCalledOnce();
  });

  it('ignores legacy setupSecret payloads instead of requiring them', async () => {
    const { app, authService } = createHarness();

    const res = await app.request('/auth/setup-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: 'correct-horse-battery-staple',
        setupSecret: 'legacy-client-value',
      }),
    });

    expect(res.status).toBe(200);
    expect(authService.setupPassword).toHaveBeenCalledWith('correct-horse-battery-staple');
  });

  it('still rejects setup when a password already exists', async () => {
    const { app, authService } = createHarness({ passwordSet: true });

    const res = await app.request('/auth/setup-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'correct-horse-battery-staple' }),
    });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: 'Password already configured' });
    expect(authService.setupPassword).not.toHaveBeenCalled();
  });
});
