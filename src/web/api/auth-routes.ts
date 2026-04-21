import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import type { AppContext } from '../../app.js';
import type { AuthService } from '../../auth/auth-service.js';
import { generatePkce, getGoogleAuthUrl, exchangeGoogleCode } from '../../auth/google-oauth.js';
import { encryptAndStoreToken, loadDecryptedToken } from '../../auth/token-store.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('auth-routes');

const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

const pkceVerifiersByState = new Map<string, { verifier: string; createdAt: number }>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function getSessionCookieToken(cookieHeader: string): string | null {
  const match = cookieHeader.match(/(?:^|;\s*)ol_session=([^;]*)/);
  return match?.[1] ?? null;
}

function cleanExpiredOAuthStates(): void {
  const now = Date.now();
  for (const [state, entry] of pkceVerifiersByState) {
    if (now - entry.createdAt > OAUTH_STATE_TTL_MS) {
      pkceVerifiersByState.delete(state);
    }
  }
}

export function createAuthRoutes(authService: AuthService, ctx?: AppContext): Hono {
  const api = new Hono();

  api.post('/auth/setup-password', async (c) => {
    if (authService.isPasswordSet()) {
      return c.json({ error: 'Password already configured' }, 403);
    }

    const body = await c.req.json<{ password: string; setupSecret?: string }>();
    if (!body.password) {
      return c.json({ error: 'Password is required' }, 400);
    }

    if (!authService.verifySetupSecret(body.setupSecret)) {
      log.warn(
        { hasSecret: typeof body.setupSecret === 'string' && body.setupSecret.length > 0 },
        'Setup-password attempt rejected: invalid or missing setup secret',
      );
      return c.json(
        {
          error: 'INVALID_SETUP_SECRET',
          message:
            'A valid one-time setup secret is required. Check the OpenLander server console for the secret printed on startup.',
        },
        401,
      );
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

  api.get('/auth/google/status', async (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = getSessionCookieToken(cookieHeader);
    if (!sessionToken || !authService.validateSession(sessionToken)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    if (!ctx) {
      return c.json({ connected: false });
    }

    try {
      const token = await Promise.resolve(loadDecryptedToken(ctx.db, 'google'));
      return c.json({ connected: token !== null });
    } catch {
      return c.json({ connected: false });
    }
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

  api.get('/auth/google/start', (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = getSessionCookieToken(cookieHeader);
    if (!sessionToken || !authService.validateSession(sessionToken)) {
      return c.json({ error: 'AUTH_REQUIRED' }, 401);
    }

    if (!ctx) {
      return c.json({ error: 'OAuth not available' }, 500);
    }

    const googleConfig = ctx.config.google;
    if (!googleConfig.clientId) {
      return c.json({ error: 'Google OAuth not configured' }, 400);
    }

    cleanExpiredOAuthStates();

    const { verifier, challenge } = generatePkce();
    const state = randomBytes(16).toString('hex');

    pkceVerifiersByState.set(state, { verifier, createdAt: Date.now() });

    const callbackUrl = `${ctx.config.server.baseUrl}/api/auth/callback/google`;
    const authUrl = getGoogleAuthUrl(googleConfig.clientId, callbackUrl, challenge, state);

    return c.redirect(authUrl);
  });

  api.get('/auth/callback/google', async (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = getSessionCookieToken(cookieHeader);
    if (!sessionToken || !authService.validateSession(sessionToken)) {
      return c.json({ error: 'AUTH_REQUIRED' }, 401);
    }

    if (!ctx) {
      return c.json({ error: 'OAuth not available' }, 500);
    }

    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error) {
      log.error({ error }, 'Google OAuth callback error');
      return c.redirect(`${ctx.config.server.baseUrl}/?oauth_error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      return c.json({ error: 'Missing code or state parameter' }, 400);
    }

    const pending = pkceVerifiersByState.get(state);
    if (!pending) {
      log.warn({ state }, 'Unknown or expired OAuth state');
      return c.json({ error: 'Invalid or expired OAuth state' }, 400);
    }

    pkceVerifiersByState.delete(state);

    if (Date.now() - pending.createdAt > OAUTH_STATE_TTL_MS) {
      return c.json({ error: 'OAuth state expired' }, 400);
    }

    const googleConfig = ctx.config.google;
    if (!googleConfig.clientId || !googleConfig.clientSecret) {
      return c.json({ error: 'Google OAuth not configured' }, 500);
    }

    try {
      const callbackUrl = `${ctx.config.server.baseUrl}/api/auth/callback/google`;
      const tokens = await exchangeGoogleCode(
        code,
        pending.verifier,
        callbackUrl,
        googleConfig.clientId,
        googleConfig.clientSecret,
      );

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      encryptAndStoreToken(ctx.db, 'google', {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || null,
        expiresAt,
      });

      log.info('Google OAuth tokens stored successfully');
      return c.redirect(`${ctx.config.server.baseUrl}/?oauth_success=google`);
    } catch (err) {
      log.error({ err }, 'Google OAuth code exchange failed');
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return c.redirect(`${ctx.config.server.baseUrl}/?oauth_error=${encodeURIComponent(msg)}`);
    }
  });

  return api;
}
