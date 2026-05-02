import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import type { AppContext } from '../../app.js';
import type { AuthService } from '../../auth/auth-service.js';
import { generatePkce, getGoogleAuthUrl, exchangeGoogleCode } from '../../auth/google-oauth.js';
import { encryptAndStoreToken, loadDecryptedToken } from '../../auth/token-store.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('auth-routes');

const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * Day 14 (M2 polish): classify OAuth callback errors into a small enum
 * before redirecting back to the SPA. Echoing the raw `err.message` (or
 * a `code` from the upstream IdP) into a query string is technically
 * safe under `encodeURIComponent`, but it leaks internal failure modes
 * to the SPA and any logging proxy in front of it. The slug is stable
 * across upstream wording changes, so the SPA can render localized
 * messages without parsing free text.
 */
type OAuthErrorSlug = 'denied' | 'expired' | 'config' | 'other';

function classifyOAuthError(input: unknown): OAuthErrorSlug {
  const text = (
    input instanceof Error ? input.message : typeof input === 'string' ? input : ''
  ).toLowerCase();
  if (!text) return 'other';
  if (
    text.includes('access_denied') ||
    text.includes('denied') ||
    text.includes('consent_required')
  ) {
    return 'denied';
  }
  if (text.includes('expired') || text.includes('invalid_grant')) {
    return 'expired';
  }
  if (
    text.includes('not configured') ||
    text.includes('client_id') ||
    text.includes('client_secret')
  ) {
    return 'config';
  }
  return 'other';
}

const pkceVerifiersByState = new Map<string, { verifier: string; createdAt: number }>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/**
 * Day 12 (MAJOR #4): hard cap on the in-memory PKCE verifier map. Prevents
 * an attacker from exhausting RAM by hitting `/auth/google/start` faster than
 * the 10-minute TTL sweep can reclaim entries. When the cap is reached we
 * evict the single oldest entry (LRU-by-creation) so a legitimate concurrent
 * burst can still proceed.
 *
 * 1.0.x followup: persist to DB so multi-process deployments share state.
 */
const PKCE_STATE_MAX_ENTRIES = 100;

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

/**
 * Insert a new PKCE state with a hard size cap. If the map is full after the
 * scheduled TTL sweep, evict the oldest live entry by `createdAt`. Map
 * iteration order is insertion order, so the first key is the oldest.
 */
function setPkceVerifierWithCap(
  state: string,
  entry: { verifier: string; createdAt: number },
): void {
  if (pkceVerifiersByState.size >= PKCE_STATE_MAX_ENTRIES) {
    const oldestKey = pkceVerifiersByState.keys().next().value;
    if (oldestKey !== undefined) {
      pkceVerifiersByState.delete(oldestKey);
    }
  }
  pkceVerifiersByState.set(state, entry);
}

/**
 * Test-only accessors for the in-memory PKCE state map. Exported so the
 * size-cap and TTL behaviour can be exercised in isolation without driving
 * the full OAuth roundtrip. Do not consume from production code.
 */
export const __pkceTestHooks = {
  set: setPkceVerifierWithCap,
  get size() {
    return pkceVerifiersByState.size;
  },
  has(state: string) {
    return pkceVerifiersByState.has(state);
  },
  clear() {
    pkceVerifiersByState.clear();
  },
  maxEntries: PKCE_STATE_MAX_ENTRIES,
};

export function createAuthRoutes(authService: AuthService, ctx?: AppContext): Hono {
  const api = new Hono();

  api.post('/auth/setup-password', async (c) => {
    if (await authService.isPasswordSet()) {
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

    const { apiToken } = await authService.setupPassword(body.password);

    // Auto-login: create session so subsequent setup API calls work
    const session = await authService.createSession();
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

    const auth = await authService.getAuth();
    if (!auth || !auth.password_hash) {
      return c.json({ error: 'Password not configured' }, 403);
    }

    if (!authService.verifyPassword(body.password, auth.password_hash)) {
      return c.json({ error: 'Invalid password' }, 401);
    }

    const session = await authService.createSession();
    c.header(
      'Set-Cookie',
      `ol_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${String(SESSION_MAX_AGE)}`,
    );
    return c.json({ success: true });
  });

  api.post('/auth/logout', async (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const token = getSessionCookieToken(cookieHeader);
    if (token) {
      await authService.deleteSession(token);
    }
    c.header('Set-Cookie', 'ol_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return c.json({ success: true });
  });

  api.get('/auth/verify', async (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const token = getSessionCookieToken(cookieHeader);

    if (token && (await authService.validateSession(token))) {
      return c.json({ authenticated: true });
    }
    return c.json({ authenticated: false }, 401);
  });

  api.post('/auth/change-password', async (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = getSessionCookieToken(cookieHeader);
    if (!sessionToken || !(await authService.validateSession(sessionToken))) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json<{ currentPassword: string; newPassword: string }>();
    try {
      await authService.changePassword(body.currentPassword, body.newPassword);
      return c.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change password';
      return c.json({ error: message }, 401);
    }
  });

  api.get('/auth/token', async (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = getSessionCookieToken(cookieHeader);
    if (!sessionToken || !(await authService.validateSession(sessionToken))) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = await authService.getDecryptedApiToken();
    if (!token) {
      return c.json({ error: 'No API token configured' }, 404);
    }
    return c.json({ token });
  });

  api.get('/auth/google/status', async (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = getSessionCookieToken(cookieHeader);
    if (!sessionToken || !(await authService.validateSession(sessionToken))) {
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

  api.post('/auth/token/regenerate', async (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = getSessionCookieToken(cookieHeader);
    if (!sessionToken || !(await authService.validateSession(sessionToken))) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { apiToken } = await authService.regenerateToken();
    return c.json({ token: apiToken });
  });

  api.get('/auth/google/start', async (c) => {
    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = getSessionCookieToken(cookieHeader);
    if (!sessionToken || !(await authService.validateSession(sessionToken))) {
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

    setPkceVerifierWithCap(state, { verifier, createdAt: Date.now() });

    const callbackUrl = `${ctx.config.server.baseUrl}/api/auth/callback/google`;
    const authUrl = getGoogleAuthUrl(googleConfig.clientId, callbackUrl, challenge, state);

    return c.redirect(authUrl);
  });

  api.get('/auth/callback/google', async (c) => {
    // Note: we deliberately DO NOT check the session cookie here. The redirect
    // from accounts.google.com is cross-site, so a SameSite=Strict cookie will
    // not be attached. Authentication is established by the state parameter:
    // it can only have been issued by /auth/google/start (which requires a
    // session), is single-use, and expires after 10 minutes (validated below).
    if (!ctx) {
      return c.json({ error: 'OAuth not available' }, 500);
    }

    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error) {
      log.error({ error }, 'Google OAuth callback error');
      return c.redirect(`${ctx.config.server.baseUrl}/?oauth_error=${classifyOAuthError(error)}`);
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
      await Promise.resolve(
        encryptAndStoreToken(ctx.db, 'google', {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || null,
          expiresAt,
        }),
      );

      log.info('Google OAuth tokens stored successfully');
      return c.redirect(`${ctx.config.server.baseUrl}/?oauth_success=google`);
    } catch (err) {
      log.error({ err }, 'Google OAuth code exchange failed');
      return c.redirect(`${ctx.config.server.baseUrl}/?oauth_error=${classifyOAuthError(err)}`);
    }
  });

  return api;
}
