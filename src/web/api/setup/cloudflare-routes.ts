import { randomBytes } from 'node:crypto';

import { Hono, type Context } from 'hono';

import type { AppContext } from '../../../app.js';
import { exchangeCloudflareCode, getCloudflareAuthUrl } from '../../../auth/cloudflare-oauth.js';
import { generatePkce } from '../../../auth/google-oauth.js';
import { encryptAndStoreToken } from '../../../auth/token-store.js';
import { CloudflareOAuthUnavailableError, OperationRequiresHumanUiError } from '../../../errors.js';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const OAUTH_STATE_MAX_ENTRIES = 100;
const pendingOAuthStates = new Map<string, { verifier: string; createdAt: number }>();

function requireWebSession(c: Context): void {
  if (c.get('authKind') !== 'session') {
    throw new OperationRequiresHumanUiError(
      'disconnect_cloudflare',
      'Disconnecting Cloudflare requires confirmation in the OpenLander UI.',
    );
  }
}

function removeExpiredStates(now = Date.now()): void {
  for (const [state, pending] of pendingOAuthStates) {
    if (now - pending.createdAt > OAUTH_STATE_TTL_MS) pendingOAuthStates.delete(state);
  }
}

function rememberOAuthState(state: string, verifier: string): void {
  removeExpiredStates();
  if (pendingOAuthStates.size >= OAUTH_STATE_MAX_ENTRIES) {
    const oldest = pendingOAuthStates.keys().next().value;
    if (oldest !== undefined) pendingOAuthStates.delete(oldest);
  }
  pendingOAuthStates.set(state, { verifier, createdAt: Date.now() });
}

function consumeOAuthState(state: string): string | null {
  const pending = pendingOAuthStates.get(state);
  pendingOAuthStates.delete(state);
  if (!pending || Date.now() - pending.createdAt > OAUTH_STATE_TTL_MS) return null;
  return pending.verifier;
}

export const __cloudflareOAuthStateTestHooks = {
  clear(): void {
    pendingOAuthStates.clear();
  },
  set(state: string, verifier: string, createdAt = Date.now()): void {
    pendingOAuthStates.set(state, { verifier, createdAt });
  },
  consume: consumeOAuthState,
  get size(): number {
    return pendingOAuthStates.size;
  },
  maxEntries: OAUTH_STATE_MAX_ENTRIES,
  ttlMs: OAUTH_STATE_TTL_MS,
};

export function createCloudflareSetupRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/setup/cloudflare', async (c) => {
    return c.json(await ctx.cloudflare.getConnectedPublishConnection());
  });

  api.post('/setup/cloudflare/oauth/start', (c) => {
    const config = ctx.config.cloudflare;
    if (!config.oauthClientId.trim() || !config.oauthRedirectUri.trim()) {
      throw new CloudflareOAuthUnavailableError();
    }

    const { verifier, challenge } = generatePkce();
    const state = randomBytes(24).toString('base64url');
    rememberOAuthState(state, verifier);
    const authUrl = getCloudflareAuthUrl({
      clientId: config.oauthClientId,
      redirectUri: config.oauthRedirectUri,
      challenge,
      state,
      scopes: config.oauthScopes,
    });

    return c.json({
      auth_url: authUrl,
      state,
      callback_origin: new URL(config.oauthRedirectUri).origin,
      expires_in_seconds: OAUTH_STATE_TTL_MS / 1000,
    });
  });

  api.post('/setup/cloudflare/oauth/complete', async (c) => {
    const body = await c.req.json<{ code?: unknown; state?: unknown }>();
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const state = typeof body.state === 'string' ? body.state.trim() : '';
    if (!code || !state) {
      return c.json({ error: 'MISSING_FIELD', message: 'code and state are required' }, 400);
    }

    const verifier = consumeOAuthState(state);
    if (!verifier) {
      return c.json(
        { error: 'INVALID_OAUTH_STATE', message: 'OAuth state is invalid or expired' },
        400,
      );
    }

    const config = ctx.config.cloudflare;
    if (!config.oauthClientId.trim() || !config.oauthRedirectUri.trim()) {
      throw new CloudflareOAuthUnavailableError();
    }
    const token = await exchangeCloudflareCode({
      clientId: config.oauthClientId,
      redirectUri: config.oauthRedirectUri,
      code,
      verifier,
    });
    await encryptAndStoreToken(ctx.db, 'cloudflare', {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    });

    return c.json({
      status: 'authorized',
      accounts: await ctx.cloudflare.listConnectedPublishAccounts(),
    });
  });

  api.get('/setup/cloudflare/accounts', async (c) => {
    return c.json({ accounts: await ctx.cloudflare.listConnectedPublishAccounts() });
  });

  api.get('/setup/cloudflare/zones', async (c) => {
    const accountId = c.req.query('account_id')?.trim() ?? '';
    if (!accountId) {
      return c.json({ error: 'MISSING_FIELD', message: 'account_id is required' }, 400);
    }
    return c.json({ zones: await ctx.cloudflare.listConnectedPublishZones(accountId) });
  });

  api.post('/setup/cloudflare/connect', async (c) => {
    const body = await c.req.json<{ account_id?: unknown; zone_id?: unknown }>();
    const accountId = typeof body.account_id === 'string' ? body.account_id.trim() : '';
    const zoneId = typeof body.zone_id === 'string' ? body.zone_id.trim() : '';
    if (!accountId || !zoneId) {
      return c.json(
        { error: 'MISSING_FIELD', message: 'account_id and zone_id are required' },
        400,
      );
    }

    return c.json(await ctx.cloudflare.connectConnectedPublish({ accountId, zoneId }));
  });

  api.post('/setup/cloudflare/disconnect', async (c) => {
    requireWebSession(c);
    return c.json(await ctx.cloudflare.disconnectConnectedPublish());
  });

  return api;
}
