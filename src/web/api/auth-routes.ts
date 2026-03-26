import { Hono } from 'hono';
import type { AuthService } from '../../auth/auth-service.js';

const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function getSessionCookieToken(cookieHeader: string): string | null {
  const match = cookieHeader.match(/(?:^|;\s*)ol_session=([^;]*)/);
  return match?.[1] ?? null;
}

export function createAuthRoutes(authService: AuthService): Hono {
  const api = new Hono();

  api.post('/auth/setup-password', async (c) => {
    if (authService.isPasswordSet()) {
      return c.json({ error: 'Password already configured' }, 403);
    }

    const body = await c.req.json<{ password: string }>();
    if (!body.password) {
      return c.json({ error: 'Password is required' }, 400);
    }

    const { apiToken } = authService.setupPassword(body.password);

    // Auto-login: create session so subsequent setup API calls work
    const session = authService.createSession();
    c.header(
      'Set-Cookie',
      `ol_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${String(SESSION_MAX_AGE)}`,
    );

    return c.json({ success: true, apiToken });
  });

  api.post('/auth/login', async (c) => {
    const body = await c.req.json<{ password: string }>();
    if (!body.password) {
      return c.json({ error: 'Password is required' }, 400);
    }

    const auth = authService.getAuth();
    if (!auth || !auth.password_hash) {
      return c.json({ error: 'Password not configured' }, 403);
    }

    if (!authService.verifyPassword(body.password, auth.password_hash)) {
      return c.json({ error: 'Invalid password' }, 401);
    }

    const session = authService.createSession();
    c.header(
      'Set-Cookie',
      `ol_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${String(SESSION_MAX_AGE)}`,
    );
    return c.json({ success: true });
  });

  api.post('/auth/logout', (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const token = getSessionCookieToken(cookieHeader);
    if (token) {
      authService.deleteSession(token);
    }
    c.header('Set-Cookie', 'ol_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return c.json({ success: true });
  });

  api.get('/auth/verify', (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const token = getSessionCookieToken(cookieHeader);

    if (token && authService.validateSession(token)) {
      return c.json({ authenticated: true });
    }
    return c.json({ authenticated: false }, 401);
  });

  api.post('/auth/change-password', async (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = getSessionCookieToken(cookieHeader);
    if (!sessionToken || !authService.validateSession(sessionToken)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json<{ currentPassword: string; newPassword: string }>();
    try {
      authService.changePassword(body.currentPassword, body.newPassword);
      return c.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password';
      return c.json({ error: message }, 401);
    }
  });

  api.get('/auth/token', (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = getSessionCookieToken(cookieHeader);
    if (!sessionToken || !authService.validateSession(sessionToken)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authService.getDecryptedApiToken();
    if (!token) {
      return c.json({ error: 'No API token configured' }, 404);
    }
    return c.json({ token });
  });

  api.post('/auth/token/regenerate', (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = getSessionCookieToken(cookieHeader);
    if (!sessionToken || !authService.validateSession(sessionToken)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { apiToken } = authService.regenerateToken();
    return c.json({ token: apiToken });
  });

  return api;
}
