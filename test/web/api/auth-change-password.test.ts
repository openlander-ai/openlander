import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../../src/app.js';
import type { AuthService } from '../../../src/auth/auth-service.js';
import { OpenLanderError } from '../../../src/errors.js';
import { createAuthRoutes } from '../../../src/web/api/auth-routes.js';

function createHarness() {
  const authService = {
    validateSession: vi.fn(async (token: string) => token === 'session-ok'),
    changePassword: vi.fn(async () => undefined),
  } as unknown as AuthService;
  const app = createAuthRoutes(authService, {} as AppContext);
  return { app, authService };
}

describe('auth change password route', () => {
  it('accepts the same 8 character minimum used by first-run setup', async () => {
    const { app, authService } = createHarness();

    const res = await app.request('/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'ol_session=session-ok',
      },
      body: JSON.stringify({ currentPassword: 'old-pass', newPassword: '12345678' }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true });
    expect(authService.changePassword).toHaveBeenCalledWith('old-pass', '12345678');
  });

  it('maps backend password policy errors to 400', async () => {
    const { app, authService } = createHarness();
    vi.mocked(authService.changePassword).mockRejectedValueOnce(
      new OpenLanderError('Password must be at least 8 characters.', 'PASSWORD_TOO_SHORT', 400, {
        minLength: 8,
      }),
    );

    const res = await app.request('/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'ol_session=session-ok',
      },
      body: JSON.stringify({ currentPassword: 'old-pass', newPassword: '1234567' }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: 'PASSWORD_TOO_SHORT',
      message: 'Password must be at least 8 characters.',
      details: { minLength: 8 },
    });
    expect(authService.changePassword).toHaveBeenCalledWith('old-pass', '1234567');
  });
});
