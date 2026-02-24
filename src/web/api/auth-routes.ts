import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { OAuthManager } from '../../auth/oauth-manager.js';
import type { OAuthProviderConfig } from '../../auth/oauth-manager.js';
import {
  ANTHROPIC_OAUTH_CONFIG,
  parseAnthropicAuthorizationCode,
} from '../../auth/providers/anthropic.js';
import { OPENAI_OAUTH_CONFIG } from '../../auth/providers/openai.js';
import { GOOGLE_OAUTH_CONFIG } from '../../auth/providers/google.js';

const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'google'] as const;
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

const providerConfigs: Record<SupportedProvider, OAuthProviderConfig> = {
  anthropic: ANTHROPIC_OAUTH_CONFIG,
  openai: OPENAI_OAUTH_CONFIG,
  google: GOOGLE_OAUTH_CONFIG,
};

const PKCE_STATE_TTL_MS = 10 * 60 * 1000;
const PKCE_STATE_MAX_ENTRIES = 1000;

const pkceStateStore = new Map<
  string,
  { codeVerifier: string; provider: SupportedProvider; createdAt: number }
>();

export function createAuthRoutes(ctx: AppContext): Hono {
  const routes = new Hono();

  routes.get('/:provider/login', async (c) => {
    const providerParam = c.req.param('provider');
    if (!isSupportedProvider(providerParam)) {
      return c.json(
        { error: 'UNKNOWN_PROVIDER', message: `Unsupported provider: ${providerParam}` },
        400,
      );
    }

    const oauthManager = new OAuthManager(providerConfigs[providerParam], ctx.db);
    const { url, state, codeVerifier } = await oauthManager.generateAuthUrl();

    pruneExpiredPkceState();
    if (pkceStateStore.size >= PKCE_STATE_MAX_ENTRIES) {
      return c.json(
        { error: 'RATE_LIMITED', message: 'Too many pending auth requests' },
        429,
      );
    }
    pkceStateStore.set(state, {
      codeVerifier,
      provider: providerParam,
      createdAt: Date.now(),
    });

    return c.redirect(url);
  });

  routes.get('/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');

    if (!code || !state) {
      return c.json(
        { error: 'INVALID_CALLBACK', message: 'Missing code or state query parameter' },
        400,
      );
    }

    pruneExpiredPkceState();
    const pkceEntry = pkceStateStore.get(state);
    if (!pkceEntry) {
      return c.json({ error: 'INVALID_STATE', message: 'State not found or expired' }, 400);
    }

    pkceStateStore.delete(state);

    const oauthManager = new OAuthManager(providerConfigs[pkceEntry.provider], ctx.db);
    const finalCode =
      pkceEntry.provider === 'anthropic' ? parseAnthropicAuthorizationCode(code).code : code;

    try {
      const tokens = await oauthManager.exchangeCode(finalCode, pkceEntry.codeVerifier);
      oauthManager.saveTokens(pkceEntry.provider, tokens);
      return c.redirect('/?auth=success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'TOKEN_EXCHANGE_FAILED', message }, 500);
    }
  });

  routes.post('/:provider/logout', (c) => {
    const providerParam = c.req.param('provider');
    if (!isSupportedProvider(providerParam)) {
      return c.json(
        { error: 'UNKNOWN_PROVIDER', message: `Unsupported provider: ${providerParam}` },
        400,
      );
    }

    const oauthManager = new OAuthManager(providerConfigs[providerParam], ctx.db);
    oauthManager.clearTokens(providerParam);

    return c.json({ status: 'logged_out', provider: providerParam });
  });

  routes.get('/status', (c) => {
    const providers = {
      anthropic: {
        authenticated: Boolean(ctx.db.getOAuthTokens('anthropic')),
      },
      openai: {
        authenticated: Boolean(ctx.db.getOAuthTokens('openai')),
      },
      google: {
        authenticated: Boolean(ctx.db.getOAuthTokens('google')),
      },
    };

    return c.json({ providers });
  });

  return routes;
}

function isSupportedProvider(provider: string): provider is SupportedProvider {
  return SUPPORTED_PROVIDERS.includes(provider as SupportedProvider);
}

function pruneExpiredPkceState(now: number = Date.now()): void {
  for (const [state, entry] of pkceStateStore.entries()) {
    if (now - entry.createdAt > PKCE_STATE_TTL_MS) {
      pkceStateStore.delete(state);
    }
  }
}
