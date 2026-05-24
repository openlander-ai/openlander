import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppContext } from '../../app.js';
import { assertPasswordMeetsPolicy, type AuthService } from '../../auth/auth-service.js';
import { saveConfig } from '../../config/index.js';
import { generatePkce, getGoogleAuthUrl, exchangeGoogleCode } from '../../auth/google-oauth.js';
import { encryptAndStoreToken, loadDecryptedToken } from '../../auth/token-store.js';
import { createModuleLogger } from '../../lib/logger.js';
import { OpenLanderError } from '../../errors.js';
import {
  getMcpEndpointFromRequestUrl,
  getMcpInstancePublicInfo,
  normalizeMcpInstanceName,
} from '../../mcp/instance-identity.js';

const log = createModuleLogger('auth-routes');

const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const DEFAULT_PAT_EXPIRY_DAYS = 90;

function passwordPolicyError(err: unknown): Response | null {
  if (err instanceof OpenLanderError && err.code === 'PASSWORD_TOO_SHORT') {
    return new Response(
      JSON.stringify({
        error: err.message,
        code: err.code,
        message: err.message,
        details: err.details ?? {},
      }),
      {
        status: 400,
        headers: { 'content-type': 'application/json' },
      },
    );
  }
  return null;
}

interface PatTokenRequestBody {
  name?: unknown;
  expires_in_days?: unknown;
  scope_kind?: unknown;
  scope_project_id?: unknown;
}

function tokenMetadata(token: {
  id: string;
  name: string;
  token_suffix: string;
  scope_kind: 'org' | 'project';
  scope_project_id: string | null;
  token_type: 'pat' | 'service' | 'legacy-default';
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}) {
  return {
    id: token.id,
    name: token.name,
    suffix: token.token_suffix,
    scope: {
      kind: token.scope_kind,
      projectId: token.scope_project_id,
    },
    tokenType: token.token_type,
    lastUsedAt: token.last_used_at,
    expiresAt: token.expires_at,
    revokedAt: token.revoked_at,
    createdAt: token.created_at,
  };
}

function parsePatExpiryDays(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_PAT_EXPIRY_DAYS;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.ceil(value);
}

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

  async function requireWebSession(c: Context) {
    const cookieHeader = c.req.header('cookie') || '';
    const sessionToken = getSessionCookieToken(cookieHeader);
    if (!sessionToken || !(await authService.validateSession(sessionToken))) {
      return c.json(
        {
          error: 'WEB_SESSION_REQUIRED',
          code: 'WEB_SESSION_REQUIRED',
          message: 'This endpoint requires the authenticated web session cookie.',
        },
        403,
      );
    }
    return null;
  }

  api.post('/auth/setup-password', async (c) => {
    if (await authService.isPasswordSet()) {
      return c.json({ error: 'Password already configured' }, 403);
    }

    const body = await c.req.json<{ password: string }>();
    if (!body.password) {
      return c.json({ error: 'Password is required' }, 400);
    }

    let apiToken: string;
    try {
      assertPasswordMeetsPolicy(body.password);
      ({ apiToken } = await authService.setupPassword(body.password));
    } catch (err) {
      const response = passwordPolicyError(err);
      if (response) return response;
      throw err;
    }

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
      assertPasswordMeetsPolicy(body.newPassword);
      await authService.changePassword(body.currentPassword, body.newPassword);
      return c.json({ success: true });
    } catch (err) {
      const response = passwordPolicyError(err);
      if (response) return response;
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

  api.get('/tokens', async (c) => {
    const rejected = await requireWebSession(c);
    if (rejected) return rejected;

    const scope = c.req.query('scope');
    let options:
      | { scopeKind?: 'org' | 'project'; scopeProjectId?: string | null; includeRevoked?: boolean }
      | undefined;
    if (scope === 'org') {
      options = { scopeKind: 'org' };
    } else if (scope?.startsWith('project:')) {
      const projectId = scope.slice('project:'.length);
      if (!projectId) {
        return c.json(
          { error: 'INVALID_FIELD', code: 'INVALID_FIELD', message: 'scope project id is empty.' },
          400,
        );
      }
      options = { scopeKind: 'project', scopeProjectId: projectId };
    } else if (scope !== undefined) {
      return c.json(
        {
          error: 'INVALID_FIELD',
          code: 'INVALID_FIELD',
          message: 'scope must be "org" or "project:<id>".',
        },
        400,
      );
    }

    const tokens = await authService.listPatTokens(options);
    return c.json({
      tokens: tokens.map((token) => tokenMetadata(token)),
    });
  });

  api.get('/mcp/token', async (c) => {
    const rejected = await requireWebSession(c);
    if (rejected) return rejected;

    const tokens = await authService.listPatTokens({ scopeKind: 'org' });
    const activeOrgPat = tokens.find(
      (token) =>
        token.token_type === 'pat' &&
        !token.revoked_at &&
        (!token.expires_at || Date.parse(token.expires_at) > Date.now()),
    );
    return c.json({ token: activeOrgPat ? tokenMetadata(activeOrgPat) : null });
  });

  api.get('/mcp/instance', async (c) => {
    const rejected = await requireWebSession(c);
    if (rejected) return rejected;
    if (!ctx) {
      return c.json(
        {
          error: 'MCP_INSTANCE_UNAVAILABLE',
          code: 'MCP_INSTANCE_UNAVAILABLE',
          message: 'MCP instance configuration is not available in this runtime.',
        },
        500,
      );
    }

    const { endpoint, host } = getMcpEndpointFromRequestUrl(c.req.url);
    return c.json(getMcpInstancePublicInfo(ctx.config, { endpoint, host }));
  });

  api.patch('/mcp/instance', async (c) => {
    const rejected = await requireWebSession(c);
    if (rejected) return rejected;
    if (!ctx) {
      return c.json(
        {
          error: 'MCP_INSTANCE_UNAVAILABLE',
          code: 'MCP_INSTANCE_UNAVAILABLE',
          message: 'MCP instance configuration is not available in this runtime.',
        },
        500,
      );
    }

    const body = await c.req.json<{ name?: unknown }>().catch((): { name?: unknown } => ({}));
    const name = normalizeMcpInstanceName(body.name);
    if (!name) {
      return c.json(
        {
          error: 'INVALID_INSTANCE_NAME',
          code: 'INVALID_INSTANCE_NAME',
          message: 'Instance name must use lowercase letters, numbers, hyphen, underscore, or dot.',
          details: {
            allowedPattern: '^[a-z0-9](?:[a-z0-9._-]{0,61}[a-z0-9])?$',
          },
        },
        400,
      );
    }

    ctx.config.mcp = { ...ctx.config.mcp, instanceName: name };
    saveConfig(ctx.config);
    const { endpoint, host } = getMcpEndpointFromRequestUrl(c.req.url);
    return c.json(getMcpInstancePublicInfo(ctx.config, { endpoint, host }));
  });

  api.post('/tokens', async (c) => {
    const rejected = await requireWebSession(c);
    if (rejected) return rejected;

    const body = await c.req.json<PatTokenRequestBody>().catch((): PatTokenRequestBody => ({}));
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'MCP token';
    const scopeKind =
      body.scope_kind === undefined || body.scope_kind === null
        ? 'org'
        : body.scope_kind === 'org' || body.scope_kind === 'project'
          ? body.scope_kind
          : null;
    if (!scopeKind) {
      return c.json(
        {
          error: 'INVALID_FIELD',
          code: 'INVALID_FIELD',
          message: 'scope_kind must be "org" or "project".',
        },
        400,
      );
    }

    const scopeProjectId =
      scopeKind === 'project' && typeof body.scope_project_id === 'string'
        ? body.scope_project_id.trim()
        : null;
    if (
      scopeKind === 'org' &&
      typeof body.scope_project_id === 'string' &&
      body.scope_project_id.trim()
    ) {
      return c.json(
        {
          error: 'INVALID_FIELD',
          code: 'INVALID_FIELD',
          message: 'scope_project_id is only valid for project-scoped tokens.',
        },
        400,
      );
    }
    if (scopeKind === 'project') {
      if (!ctx || !scopeProjectId) {
        return c.json(
          {
            error: 'PROJECT_REQUIRED',
            code: 'PROJECT_REQUIRED',
            message: 'scope_project_id is required for project-scoped tokens.',
          },
          400,
        );
      }
      const project = await ctx.db.getProject(scopeProjectId);
      if (!project) {
        return c.json(
          {
            error: 'PROJECT_NOT_FOUND',
            code: 'PROJECT_NOT_FOUND',
            message: `Project ${scopeProjectId} not found.`,
          },
          404,
        );
      }
    }

    const expiresInDays = parsePatExpiryDays(body.expires_in_days);
    if (expiresInDays === null) {
      return c.json(
        {
          error: 'INVALID_FIELD',
          code: 'INVALID_FIELD',
          message: 'expires_in_days must be a positive number.',
        },
        400,
      );
    }

    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const issued = await authService.issuePatToken({
      name,
      scopeKind,
      scopeProjectId,
      expiresAt,
    });
    return c.json({
      id: issued.row.id,
      token: issued.token,
      suffix: issued.row.token_suffix,
      expiresAt: issued.row.expires_at,
      scope: {
        kind: issued.row.scope_kind,
        projectId: issued.row.scope_project_id,
      },
    });
  });

  api.post('/mcp/token', async (c) => {
    const rejected = await requireWebSession(c);
    if (rejected) return rejected;

    const body = await c.req.json<PatTokenRequestBody>().catch((): PatTokenRequestBody => ({}));
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'MCP token';
    const expiresInDays = parsePatExpiryDays(body.expires_in_days);
    if (expiresInDays === null) {
      return c.json(
        {
          error: 'INVALID_FIELD',
          code: 'INVALID_FIELD',
          message: 'expires_in_days must be a positive number.',
        },
        400,
      );
    }

    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const result = await authService.ensureOrgMcpPatToken({ name, expiresAt });
    return c.json({
      token: tokenMetadata(result.row),
      plaintext: result.token,
      created: result.created,
      revokedTokenIds: result.revokedTokenIds,
      legacyTokenRotated: result.legacyTokenRotated,
    });
  });

  api.post('/mcp/token/regenerate', async (c) => {
    const rejected = await requireWebSession(c);
    if (rejected) return rejected;

    const body = await c.req.json<PatTokenRequestBody>().catch((): PatTokenRequestBody => ({}));
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'MCP token';
    const expiresInDays = parsePatExpiryDays(body.expires_in_days);
    if (expiresInDays === null) {
      return c.json(
        {
          error: 'INVALID_FIELD',
          code: 'INVALID_FIELD',
          message: 'expires_in_days must be a positive number.',
        },
        400,
      );
    }

    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const result = await authService.rotateOrgMcpPatToken({ name, expiresAt });
    return c.json({
      token: tokenMetadata(result.row),
      plaintext: result.token,
      created: result.created,
      revokedTokenIds: result.revokedTokenIds,
      legacyTokenRotated: result.legacyTokenRotated,
    });
  });

  api.delete('/tokens/:id', async (c) => {
    const rejected = await requireWebSession(c);
    if (rejected) return rejected;

    const revoked = await authService.revokePatToken(c.req.param('id'));
    return c.json({ status: revoked ? 'revoked' : 'not_found' });
  });

  api.get('/session/scope', async (c) => {
    const rejected = await requireWebSession(c);
    if (rejected) return rejected;
    if (!ctx) {
      return c.json({ activeScope: { kind: 'org' } });
    }

    const activeProjectId = await ctx.db.getActiveScopeProjectId();
    if (!activeProjectId) {
      return c.json({ activeScope: { kind: 'org' } });
    }

    const project = await ctx.db.getProject(activeProjectId);
    if (!project) {
      await ctx.db.setActiveScopeProjectId(null);
      return c.json({ activeScope: { kind: 'org' } });
    }

    return c.json({
      activeScope: {
        kind: 'project',
        projectId: project.id,
        projectName: project.name,
        displayName: project.display_name ?? project.name,
      },
    });
  });

  api.post('/session/scope', async (c) => {
    const rejected = await requireWebSession(c);
    if (rejected) return rejected;
    if (!ctx) {
      return c.json({ activeScope: { kind: 'org' } });
    }

    const body = await c.req
      .json<{ project_id?: unknown }>()
      .catch((): { project_id?: unknown } => ({}));
    const requestedProjectId = body.project_id;
    const projectId = typeof requestedProjectId === 'string' ? requestedProjectId.trim() : null;
    if (!projectId) {
      await ctx.db.setActiveScopeProjectId(null);
      return c.json({ activeScope: { kind: 'org' } });
    }

    const project = await ctx.db.getProject(projectId);
    if (!project) {
      return c.json(
        {
          error: 'PROJECT_NOT_FOUND',
          code: 'PROJECT_NOT_FOUND',
          message: `Project ${projectId} not found.`,
        },
        404,
      );
    }

    await ctx.db.setActiveScopeProjectId(project.id);
    return c.json({
      activeScope: {
        kind: 'project',
        projectId: project.id,
        projectName: project.name,
        displayName: project.display_name ?? project.name,
      },
    });
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
