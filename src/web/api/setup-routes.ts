import { requestDeviceCode, getGitHubClientId } from '../../git-providers/github-oauth.js';

import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { loadConfig, saveConfig, updateConfig } from '../../config/index.js';
import { loadDecryptedToken } from '../../auth/token-store.js';
import type { OpenLanderConfig } from '../../config/index.js';
import { createGitProvider } from '../../git-providers/index.js';

/**
 * Setup / onboarding API routes.
 *
 * These endpoints let the web UI check readiness and configure
 * the system without using the CLI `openlander onboard` command.
 *
 * Endpoints:
 *  GET   /setup/status   — Check Docker, Traefik, LLM readiness
 *  POST  /setup/llm      — Save LLM provider + API key
 *  POST  /setup/traefik  — Start Traefik container
 *  POST  /setup/complete  — Mark setup as done (saves config if needed)
 */
export function createSetupRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  /**
   * GET /setup/status
   *
   * Returns the readiness state of all required components.
   * Frontend calls this on load to decide: show setup or show chat.
   */
  api.get('/setup/status', async (c) => {
    const [dockerStatus, traefikOk] = await Promise.all([
      ctx.docker.status(),
      ctx.traefik.isRunning().catch(() => false),
    ]);

    const dockerOk = dockerStatus.state === 'running';
    const llmConfigured = ctx.agent !== null;
    const config = loadConfig();

    const ready = dockerOk && llmConfigured;

    let dockerMessage: string;
    if (dockerStatus.state === 'running') {
      dockerMessage = 'Docker is running.';
    } else if (dockerStatus.state === 'not_installed') {
      dockerMessage = 'Docker is not installed. Install it to continue.';
    } else if (dockerStatus.state === 'not_running') {
      dockerMessage = 'Docker is installed but the daemon is not running. Start it to continue.';
    } else if (dockerStatus.groupFixed) {
      dockerMessage =
        'Permission fixed! Restart OpenLander for the change to take effect. (Ctrl+C, then `openlander start`)';
    } else {
      dockerMessage =
        'Docker is installed but your user lacks permission. Add yourself to the docker group.';
    }

    return c.json({
      ready,
      docker: {
        ok: dockerOk,
        state: dockerStatus.state,
        groupFixed:
          dockerStatus.state === 'permission_denied' ? dockerStatus.groupFixed : undefined,
        message: dockerMessage,
      },
      traefik: {
        ok: traefikOk,
        message: traefikOk
          ? 'Traefik is running'
          : 'Traefik is not running. Click "Start Traefik" to set it up.',
      },
      llm: {
        ok: llmConfigured,
        provider: config.llm.provider,
        model: config.llm.model,
        message: llmConfigured
          ? `${config.llm.provider} (${config.llm.model})`
          : 'No LLM configured. Connect a provider and token/API key.',
      },
      github: {
        ok: Boolean(config.gitProviders.github.token),
        username: config.gitProviders.github.username || null,
        message: config.gitProviders.github.token
          ? `Connected as ${config.gitProviders.github.username || 'unknown'}`
          : 'No GitHub token configured. Add one to browse and deploy private repos.',
      },
    });
  });

  /**
   * POST /setup/llm
   *
   * Save LLM provider and API key. Requires server restart to take effect
   * (the LLM client and Agent are created at startup).
   *
   * Body: { provider: string, api_key: string, model?: string }
   */
  api.post('/setup/llm', async (c) => {
    const body = await c.req.json<{
      provider: string;
      api_key?: string;
      auth_token?: string;
      model?: string;
    }>();

    const provider = body.provider;
    const rawApiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    const rawAuthToken = typeof body.auth_token === 'string' ? body.auth_token.trim() : '';
    const isOauthProvider = provider === 'openrouter' || provider === 'openai';

    if (!provider) {
      return c.json({ error: 'MISSING_FIELD', message: 'provider is required' }, 400);
    }

    const validProviders = ['gemini', 'openrouter', 'anthropic', 'openai', 'ollama'];
    if (!validProviders.includes(provider)) {
      return c.json(
        {
          error: 'INVALID_PROVIDER',
          message: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
        },
        400,
      );
    }

    // Default model per provider
    const modelDefaults: Record<string, string> = {
      gemini: 'gemini-2.0-flash',
      openrouter: 'openrouter/free',
      anthropic: 'claude-sonnet-4-20250514',
      openai: 'gpt-4o-mini',
      ollama: 'llama3.2',
    };

    const model = body.model || modelDefaults[provider] || 'gemini-2.0-flash';
    const storedOauthToken = isOauthProvider
      ? (loadDecryptedToken(ctx.db, provider)?.accessToken ?? '')
      : '';
    const authToken = rawAuthToken || storedOauthToken;

    if (isOauthProvider && !rawApiKey && !authToken) {
      return c.json({ error: 'MISSING_FIELD', message: 'api_key or auth token is required' }, 400);
    }

    if (!isOauthProvider && !rawApiKey) {
      return c.json({ error: 'MISSING_FIELD', message: 'api_key is required' }, 400);
    }

    const apiKey = !isOauthProvider || rawApiKey ? rawApiKey : '';
    const resolvedAuthToken = isOauthProvider && !apiKey ? authToken : '';

    updateConfig({
      llm: {
        provider: provider as OpenLanderConfig['llm']['provider'],
        apiKey,
        authToken: resolvedAuthToken,
        model,
      },
    });

    // Hot-reload: try to create the agent now so the user doesn't need to restart
    try {
      const { createModel } = await import('../../llm/index.js');
      const { Agent } = await import('../../agent/index.js');
      const { createTools } = await import('../../agent/tools.js');
      const { buildContextSnapshot } = await import('../../agent/prompts.js');

      const llmModel = createModel({
        provider: provider as OpenLanderConfig['llm']['provider'],
        apiKey,
        authToken: resolvedAuthToken || undefined,
        model,
      });

      const agent = new Agent(
        llmModel,
        ctx.db,
        async () => buildContextSnapshot(ctx.db, ctx.docker),
        body.provider as OpenLanderConfig['llm']['provider'],
      );

      const tools = createTools(ctx);
      agent.setTools(tools);

      (ctx as { agent: typeof agent }).agent = agent;

      return c.json({
        status: 'configured',
        provider: body.provider,
        model,
        hot_reloaded: true,
        message: 'LLM configured and ready. No restart needed.',
      });
    } catch (error) {
      // Config saved but hot-reload failed — user needs to restart
      return c.json({
        status: 'configured',
        provider: body.provider,
        model,
        hot_reloaded: false,
        message: 'LLM config saved. Restart the server to activate.',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  /**
   * POST /setup/traefik
   *
   * Start the Traefik reverse proxy container.
   */
  api.post('/setup/traefik', async (c) => {
    try {
      const isRunning = await ctx.traefik.isRunning();
      if (isRunning) {
        return c.json({ status: 'already_running', message: 'Traefik is already running.' });
      }

      await ctx.traefik.start();
      return c.json({ status: 'started', message: 'Traefik started successfully.' });
    } catch (error) {
      return c.json(
        {
          status: 'failed',
          message: 'Failed to start Traefik.',
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  /**
   * POST /setup/github
   *
   * Save and validate a GitHub Personal Access Token.
   * On success, caches the username in config.
   *
   * Body: { token: string }
   */
  api.post('/setup/github', async (c) => {
    const body = await c.req.json<{ token: string }>();

    if (!body.token) {
      return c.json({ error: 'MISSING_FIELD', message: 'token is required' }, 400);
    }

    // Validate the token against GitHub API
    const provider = createGitProvider('github', { token: body.token, username: '' });
    const validation = await provider.validateToken();

    if (!validation.valid) {
      return c.json(
        {
          status: 'invalid',
          error: validation.error ?? 'Token validation failed',
          message:
            'GitHub token is invalid or expired. Generate a new one at github.com/settings/tokens.',
        },
        400,
      );
    }

    // Save validated token + username
    updateConfig({
      gitProviders: {
        github: {
          token: body.token,
          username: validation.user?.username ?? '',
        },
      },
    });

    return c.json({
      status: 'connected',
      username: validation.user?.username,
      scopes: validation.scopes,
      message: `Connected to GitHub as ${validation.user?.username ?? 'unknown'}.`,
    });
  });

  /**
   * DELETE /setup/github
   *
   * Disconnect GitHub — removes stored token.
   */
  api.delete('/setup/github', (c) => {
    updateConfig({
      gitProviders: {
        github: { token: '', username: '' },
      },
    });
    return c.json({ status: 'disconnected', message: 'GitHub disconnected.' });
  });

  /**
   * POST /setup/github/device-code
   *
   * Initiates GitHub Device Flow for browser-based OAuth.
   * Returns device code and user code for the user to authorize.
   */
  api.post('/setup/github/device-code', async (c) => {
    try {
      const response = await requestDeviceCode(getGitHubClientId());
      return c.json(response);
    } catch (error) {
      return c.json(
        {
          error: 'DEVICE_CODE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to request device code',
        },
        500,
      );
    }
  });

  /**
   * POST /setup/github/poll
   *
   * Single poll attempt for Device Flow token.
   * Frontend polls this endpoint at the specified interval.
   *
   * Body: { device_code: string, interval: number }
   */
  api.post('/setup/github/poll', async (c) => {
    const body = await c.req.json<{ device_code: string; interval: number }>();

    if (!body.device_code) {
      return c.json({ error: 'MISSING_FIELD', message: 'device_code is required' }, 400);
    }

    // Single poll attempt against GitHub's token endpoint
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: getGitHubClientId(),
        device_code: body.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (!response.ok) {
      return c.json(
        { status: 'error', message: `GitHub API error: ${String(response.status)}` },
        500,
      );
    }

    const data = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    // Handle GitHub OAuth errors
    if (data.error) {
      switch (data.error) {
        case 'authorization_pending':
          return c.json({ status: 'pending' });

        case 'slow_down':
          return c.json({ status: 'slow_down', interval: body.interval + 5 });

        case 'expired_token':
          return c.json({ status: 'expired', message: 'Code expired. Please restart.' }, 410);

        case 'access_denied':
          return c.json({ status: 'denied', message: 'Authorization denied.' }, 403);

        default:
          return c.json(
            {
              status: 'error',
              message: data.error_description || data.error,
            },
            400,
          );
      }
    }

    // Success - validate token and save
    if (data.access_token) {
      try {
        const provider = createGitProvider('github', {
          token: data.access_token,
          username: '',
        });
        const validation = await provider.validateToken();

        if (!validation.valid) {
          return c.json(
            {
              status: 'error',
              message: 'Token validation failed',
            },
            400,
          );
        }

        const username = validation.user?.username ?? '';
        updateConfig({
          gitProviders: {
            github: { token: data.access_token, username },
          },
        });

        return c.json({ status: 'complete', username });
      } catch (error) {
        return c.json(
          {
            status: 'error',
            message: error instanceof Error ? error.message : 'Failed to save token',
          },
          500,
        );
      }
    }

    // Unexpected response
    return c.json({ status: 'error', message: 'Unexpected response from GitHub' }, 500);
  });

  /**
   * POST /setup/complete
   *
   * Ensure config file exists (marks onboarding as "done" for isOnboarded() check).
   */
  api.post('/setup/complete', (c) => {
    const config = loadConfig();
    saveConfig(config);
    return c.json({ status: 'complete', message: 'Setup marked as complete.' });
  });

  return api;
}
