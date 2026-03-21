/**
 * OAuth API routes for LLM provider authentication.
 *
 * Implements popup-based OAuth flows for OpenRouter and OpenAI.
 * Uses PKCE for security, encrypted token storage, and hot-reload on success.
 */
import { Hono } from 'hono';
import type { AppContext } from '../../app.js';
import { updateConfig } from '../../config/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { generatePkce, generateState } from '../../auth/pkce.js';
import {
  encryptAndStoreToken,
  deleteProviderToken,
  loadDecryptedToken,
} from '../../auth/token-store.js';
import { getOpenRouterAuthUrl, exchangeOpenRouterCode } from '../../auth/openrouter-web.js';

const log = createModuleLogger('auth-routes');

// OpenAI OAuth configuration
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_AUTH_URL = 'https://auth.openai.com/authorize';
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_SCOPES = 'openid profile email offline_access';

// OpenAI token response
interface OpenAITokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

// In-memory PKCE state storage (keyed by state param)
const pendingFlows = new Map<
  string,
  { verifier: string; provider: string; redirectUri: string; createdAt: number }
>();

// Cleanup stale flows (older than 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingFlows) {
    if (now - val.createdAt > 300_000) {
      pendingFlows.delete(key);
      log.debug({ state: key }, 'Cleaned up stale OAuth flow');
    }
  }
}, 60_000);

/**
 * Create OAuth API routes.
 */
export function createAuthRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  /**
   * GET /auth/start/:provider
   *
   * Generate auth URL + PKCE, return URL for frontend popup.
   */
  api.get('/auth/start/:provider', (c) => {
    const provider = c.req.param('provider');

    if (!['openrouter', 'openai'].includes(provider)) {
      return c.json(
        { error: 'INVALID_PROVIDER', message: 'Provider must be openrouter or openai' },
        400,
      );
    }

    try {
      const { verifier, challenge } = generatePkce();
      const state = generateState();

      // Store PKCE state for callback verification
      const host = c.req.header('host') ?? `localhost:${String(ctx.config.server.port)}`;
      const proto = c.req.header('x-forwarded-proto') ?? 'http';
      const baseUrl = `${proto}://${host}`;
      const redirectUri = `${baseUrl}/api/auth/callback/${provider}`;

      pendingFlows.set(state, {
        verifier,
        provider,
        redirectUri,
        createdAt: Date.now(),
      });

      let authUrl: string;

      if (provider === 'openrouter') {
        authUrl = getOpenRouterAuthUrl(redirectUri, challenge);
      } else {
        // OpenAI OAuth
        const url = new URL(OPENAI_AUTH_URL);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', OPENAI_CLIENT_ID);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('scope', OPENAI_SCOPES);
        url.searchParams.set('code_challenge', challenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('state', state);
        authUrl = url.toString();
      }

      log.info({ provider }, 'OAuth flow started');

      return c.json({ url: authUrl, state });
    } catch (err) {
      log.error({ err, provider }, 'Failed to start OAuth flow');
      return c.json(
        {
          error: 'OAUTH_START_FAILED',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
        500,
      );
    }
  });

  /**
   * GET /auth/callback/:provider
   *
   * Receive OAuth callback, exchange code, store token, return postMessage HTML.
   */
  api.get('/auth/callback/:provider', async (c) => {
    const provider = c.req.param('provider');
    const code = c.req.query('code');
    const error = c.req.query('error');
    const state = c.req.query('state');

    // Handle OAuth error from provider
    if (error) {
      log.error({ provider, error }, 'OAuth provider returned error');
      return c.html(getErrorHtml(provider, error));
    }

    if (!code) {
      log.error({ provider }, 'No authorization code in callback');
      return c.html(getErrorHtml(provider, 'No authorization code received'));
    }

    // Verify state and extract verifier
    let verifier: string | undefined;
    let storedRedirectUri: string | undefined;

    if (provider === 'openai') {
      // OpenAI uses state param for CSRF protection
      const flow = state ? pendingFlows.get(state) : null;
      if (!flow) {
        log.error({ provider, state }, 'Invalid or expired OAuth state');
        return c.html(getErrorHtml(provider, 'Invalid or expired OAuth session'));
      }
      verifier = flow.verifier;
      storedRedirectUri = flow.redirectUri;
      if (state) pendingFlows.delete(state);
    } else {
      // OpenRouter doesn't return state - find the most recent flow for this provider
      let latestFlow: { verifier: string; redirectUri: string; createdAt: number } | null = null;
      for (const [, flow] of pendingFlows) {
        if (flow.provider === 'openrouter') {
          if (!latestFlow || flow.createdAt > latestFlow.createdAt) {
            latestFlow = flow;
          }
        }
      }
      if (latestFlow) {
        verifier = latestFlow.verifier;
        storedRedirectUri = latestFlow.redirectUri;
        // Clean up all OpenRouter flows
        for (const [key, flow] of pendingFlows) {
          if (flow.provider === 'openrouter') {
            pendingFlows.delete(key);
          }
        }
      }
    }

    if (!verifier) {
      log.error({ provider }, 'No PKCE verifier found for OAuth callback');
      return c.html(getErrorHtml(provider, 'OAuth session expired. Please try again.'));
    }

    try {
      let accessToken: string;
      let refreshToken: string | null = null;
      let expiresAt: string | null = null;

      if (provider === 'openrouter') {
        // OpenRouter returns an API key directly
        accessToken = await exchangeOpenRouterCode(code, verifier);
        // OpenRouter API keys don't expire
      } else {
        // OpenAI OAuth token exchange — use stored redirect URI for exact match
        const redirectUri =
          storedRedirectUri ??
          `http://localhost:${String(ctx.config.server.port)}/api/auth/callback/openai`;

        const response = await fetch(OPENAI_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            code_verifier: verifier,
            client_id: OPENAI_CLIENT_ID,
            redirect_uri: redirectUri,
          }),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          log.error({ status: response.status, body: text }, 'OpenAI token exchange failed');
          throw new Error(`OpenAI token exchange failed: ${String(response.status)}`);
        }

        const data = (await response.json()) as OpenAITokenResponse;

        if (data.error) {
          throw new Error(`OpenAI OAuth error: ${data.error} - ${data.error_description ?? ''}`);
        }

        if (!data.access_token) {
          throw new Error('No access token in OpenAI response');
        }

        accessToken = data.access_token;
        refreshToken = data.refresh_token ?? null;

        // Calculate expiry time
        if (data.expires_in) {
          const expiresDate = new Date(Date.now() + data.expires_in * 1000);
          expiresAt = expiresDate.toISOString();
        }
      }

      // Encrypt and store token
      encryptAndStoreToken(ctx.db, provider, {
        accessToken,
        refreshToken,
        expiresAt,
      });

      // Update config with auth token for hot-reload
      updateConfig({
        llm: {
          ...ctx.config.llm,
          authToken: accessToken,
        },
      });

      // Hot-reload the agent
      try {
        const { createModel } = await import('../../llm/index.js');
        const { Agent } = await import('../../llm/agent.js');
        const { createTools } = await import('../../tools/index.js');
        const { buildContextSnapshot } = await import('../../llm/prompts.js');

        const llmModel = createModel({
          provider: ctx.config.llm.provider,
          apiKey: ctx.config.llm.apiKey,
          model: ctx.config.llm.model,
          authToken: accessToken,
          ollamaBaseUrl: ctx.config.llm.ollamaEndpoint,
        });

        const agent = new Agent(
          llmModel,
          ctx.db,
          async () => buildContextSnapshot(ctx.db, ctx.docker),
          ctx.config.llm.provider,
          ctx.config.language,
        );

        const tools = createTools(ctx, ctx.questionBridge);
        agent.setTools(tools);
        agent.setQuestionBridge(ctx.questionBridge);

        (ctx as { agent: typeof agent }).agent = agent;

        log.info({ provider }, 'OAuth complete and agent hot-reloaded');
      } catch (err) {
        log.warn({ err }, 'OAuth stored but agent hot-reload failed');
      }

      return c.html(getSuccessHtml(provider));
    } catch (err) {
      log.error({ err, provider }, 'OAuth callback failed');
      return c.html(getErrorHtml(provider, err instanceof Error ? err.message : 'Unknown error'));
    }
  });

  /**
   * GET /auth/status
   *
   * Return current OAuth connection status for all providers.
   */
  api.get('/auth/status', (c) => {
    const providers = ['openrouter', 'openai'];
    const status: Record<string, { connected: boolean; expiresAt: string | null }> = {};

    for (const provider of providers) {
      const token = loadDecryptedToken(ctx.db, provider);
      status[provider] = {
        connected: token !== null,
        expiresAt: token?.expiresAt ?? null,
      };
    }

    return c.json({ providers: status });
  });

  /**
   * POST /auth/disconnect/:provider
   *
   * Remove OAuth token for a provider.
   */
  api.post('/auth/disconnect/:provider', (c) => {
    const provider = c.req.param('provider');

    if (!['openrouter', 'openai'].includes(provider)) {
      return c.json(
        { error: 'INVALID_PROVIDER', message: 'Provider must be openrouter or openai' },
        400,
      );
    }

    deleteProviderToken(ctx.db, provider);

    // Clear auth token from config if this was the active provider
    if (ctx.config.llm.authToken) {
      updateConfig({
        llm: {
          ...ctx.config.llm,
          authToken: '',
        },
      });
    }

    log.info({ provider }, 'OAuth disconnected');

    return c.json({ status: 'disconnected', provider });
  });

  return api;
}

/**
 * Generate success HTML with postMessage for popup flow.
 */
function getSuccessHtml(provider: string): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff;">
  <div style="text-align:center;">
    <h2 style="color:#4ade80;">✓ Connected!</h2>
    <p>You can close this tab.</p>
  </div>
  <script>
    window.opener?.postMessage({ type: 'oauth-success', provider: '${provider}' }, '*');
    setTimeout(() => window.close(), 1500);
  </script>
</body>
</html>`;
}

/**
 * Generate error HTML for OAuth failures.
 */
function getErrorHtml(provider: string, error: string): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff;">
  <div style="text-align:center;">
    <h2 style="color:#f87171;">✗ Connection Failed</h2>
    <p style="color:#9ca3af;">${escapeHtml(error)}</p>
    <p style="color:#6b7280;font-size:0.875rem;">You can close this tab and try again.</p>
  </div>
  <script>
    window.opener?.postMessage({ type: 'oauth-error', provider: '${provider}', error: '${escapeHtml(error)}' }, '*');
    setTimeout(() => window.close(), 3000);
  </script>
</body>
</html>`;
}

/**
 * Escape HTML entities to prevent XSS.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
