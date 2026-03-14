import { requestDeviceCode, getGitHubClientId } from '../../git-providers/github-oauth.js';

import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { loadConfig, saveConfig, updateConfig } from '../../config/index.js';
import { loadDecryptedToken } from '../../auth/token-store.js';
import type { OpenLanderConfig, McpServerEntry } from '../../config/index.js';
import { createGitProvider } from '../../git-providers/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import type { ToolSet } from 'ai';

const log = createModuleLogger('setup-routes');

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
      language: config.language,
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
      const { mergeWithMcpTools } = await import('../../mcp/client-manager.js');
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
        ctx.config.language,
      );

      let tools: ToolSet = createTools(ctx, ctx.questionBridge);
      if (ctx.config.mcp.enabled && ctx.mcpClientManager.connectedCount > 0) {
        tools = await mergeWithMcpTools(tools, ctx.mcpClientManager);
      }
      agent.setTools(tools);
      agent.setQuestionBridge(ctx.questionBridge);

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

  api.get('/setup/cloudflare', (c) => {
    const config = loadConfig();
    const cloudflare = config.cloudflare;
    const configured =
      cloudflare.apiToken.trim() !== '' &&
      cloudflare.accountId.trim() !== '' &&
      cloudflare.tunnelId.trim() !== '';

    return c.json(
      configured
        ? {
            configured: true,
            accountId: cloudflare.accountId,
          }
        : {
            configured: false,
          },
    );
  });

  api.post('/setup/cloudflare/connect', async (c) => {
    const body = await c.req.json<{ api_token?: string }>();
    const apiToken = typeof body.api_token === 'string' ? body.api_token.trim() : '';

    if (!apiToken) {
      return c.json({ error: 'MISSING_FIELD', message: 'api_token is required' }, 400);
    }

    try {
      const accountsResp = await fetch('https://api.cloudflare.com/client/v4/accounts', {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      });

      const accountsData = (await accountsResp.json()) as {
        success?: boolean;
        result?: Array<{ id?: string; name?: string }>;
        errors?: Array<{ message?: string }>;
      };

      if (accountsResp.status === 401 || accountsResp.status === 403) {
        const message = accountsData.errors?.[0]?.message || 'Invalid Cloudflare API token';
        return c.json({ error: 'INVALID_TOKEN', message }, 401);
      }

      if (!accountsResp.ok || !accountsData.success) {
        const message = accountsData.errors?.[0]?.message || 'Failed to list Cloudflare accounts';
        return c.json({ error: 'CF_API_FAILED', message }, 500);
      }

      const account = accountsData.result?.[0];
      const accountId = account?.id?.trim() || '';
      const accountName = account?.name?.trim() || '';

      if (!accountId || !accountName) {
        return c.json({ error: 'CF_API_FAILED', message: 'No Cloudflare account found' }, 500);
      }

      const tunnelsResp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel?is_deleted=false`,
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const tunnelsData = (await tunnelsResp.json()) as {
        success?: boolean;
        result?: Array<{ id?: string; name?: string }>;
        errors?: Array<{ message?: string }>;
      };

      if (!tunnelsResp.ok || !tunnelsData.success) {
        const message = tunnelsData.errors?.[0]?.message || 'Failed to list Cloudflare tunnels';
        return c.json({ error: 'CF_API_FAILED', message }, 500);
      }

      const tunnels = (tunnelsData.result ?? [])
        .map((tunnel) => ({
          id: tunnel.id?.trim() || '',
          name: tunnel.name?.trim() || '',
        }))
        .filter((tunnel) => tunnel.id !== '');

      return c.json({ accountId, accountName, tunnels });
    } catch (error) {
      return c.json(
        {
          error: 'CF_API_FAILED',
          message: error instanceof Error ? error.message : 'Cloudflare API request failed',
        },
        500,
      );
    }
  });

  api.post('/setup/cloudflare', async (c) => {
    const body = await c.req.json<{
      api_token?: string;
      account_id?: string;
      tunnel_id?: string;
    }>();

    const apiToken = typeof body.api_token === 'string' ? body.api_token.trim() : '';
    const accountId = typeof body.account_id === 'string' ? body.account_id.trim() : '';
    const tunnelId = typeof body.tunnel_id === 'string' ? body.tunnel_id.trim() : '';

    if (!apiToken || !accountId || !tunnelId) {
      return c.json(
        {
          error: 'MISSING_FIELD',
          message: 'api_token, account_id, and tunnel_id are required',
        },
        400,
      );
    }

    updateConfig({
      cloudflare: {
        apiToken,
        accountId,
        tunnelId,
      },
    });

    return c.json({ status: 'configured' });
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
  /**
   * POST /setup/language
   *
   * Save the user's preferred language.
   * Body: { language: 'en' | 'ko' }
   */
  api.post('/setup/language', async (c) => {
    const body = await c.req.json<{ language: string }>();
    const lang = body.language;

    if (!lang || !['en', 'ko'].includes(lang)) {
      return c.json({ error: 'INVALID_LANGUAGE', message: 'Language must be "en" or "ko"' }, 400);
    }

    updateConfig({ language: lang as 'en' | 'ko' });
    ctx.config.language = lang as 'en' | 'ko';

    // If agent exists, recreate with new locale
    if (ctx.agent) {
      try {
        const { createModel } = await import('../../llm/index.js');
        const { Agent } = await import('../../agent/index.js');
        const { createTools } = await import('../../agent/tools.js');
        const { buildContextSnapshot } = await import('../../agent/prompts.js');

        const llmModel = createModel({
          provider: ctx.config.llm.provider,
          apiKey: ctx.config.llm.apiKey,
          model: ctx.config.llm.model,
          authToken: ctx.config.llm.authToken || undefined,
        });

        const agent = new Agent(
          llmModel,
          ctx.db,
          async () => buildContextSnapshot(ctx.db, ctx.docker),
          ctx.config.llm.provider,
          lang,
        );

        let tools: ToolSet = createTools(ctx, ctx.questionBridge);
        if (ctx.config.mcp.enabled && ctx.mcpClientManager.connectedCount > 0) {
          const { mergeWithMcpTools } = await import('../../mcp/client-manager.js');
          tools = await mergeWithMcpTools(tools, ctx.mcpClientManager);
        }
        agent.setTools(tools);
        agent.setQuestionBridge(ctx.questionBridge);
        (ctx as { agent: typeof agent }).agent = agent;
      } catch (err) {
        log.debug({ err, language: lang }, 'Agent hot-reload failed');
        // Agent hot-reload failed — language saved but agent uses old locale until restart
      }
    }

    return c.json({ status: 'saved', language: lang });
  });

  api.post('/setup/complete', (c) => {
    const config = loadConfig();
    saveConfig(config);
    return c.json({ status: 'complete', message: 'Setup marked as complete.' });
  });

  // ── MCP Server Management ───────────────────────────────────────────────

  /**
   * GET /setup/mcp/servers
   *
   * List configured MCP servers.
   */
  api.get('/setup/mcp/servers', (c) => {
    const config = loadConfig();
    return c.json({
      enabled: config.mcp.enabled,
      servers: config.mcp.servers,
      connectedCount: ctx.mcpClientManager.connectedCount,
    });
  });

  /**
   * POST /setup/mcp/servers
   *
   * Add a new MCP server.
   * Body: McpServerEntry (without id — auto-generated)
   */
  api.post('/setup/mcp/servers', async (c) => {
    const body = await c.req.json<{
      name: string;
      transport: 'stdio' | 'sse' | 'http';
      url?: string;
      command?: string;
      args?: string[];
      headers?: Record<string, string>;
      env?: Record<string, string>;
      enabled?: boolean;
    }>();

    if (!body.name || !body.name.trim()) {
      return c.json({ error: 'MISSING_FIELD', message: 'name is required' }, 400);
    }
    if (!['stdio', 'sse', 'http'].includes(body.transport)) {
      return c.json(
        { error: 'INVALID_TRANSPORT', message: 'transport must be stdio, sse, or http' },
        400,
      );
    }
    if (body.transport === 'stdio' && !body.command?.trim()) {
      return c.json(
        { error: 'MISSING_FIELD', message: 'command is required for stdio transport' },
        400,
      );
    }
    if ((body.transport === 'sse' || body.transport === 'http') && !body.url?.trim()) {
      return c.json(
        { error: 'MISSING_FIELD', message: 'url is required for sse/http transport' },
        400,
      );
    }

    const { nanoid } = await import('nanoid');
    const config = loadConfig();
    const server: McpServerEntry = {
      id: nanoid(12),
      name: body.name.trim(),
      transport: body.transport,
      url: body.url?.trim(),
      command: body.command?.trim(),
      args: body.args,
      headers: body.headers,
      env: body.env,
      enabled: body.enabled !== false,
    };

    config.mcp.servers.push(server);
    config.mcp.enabled = true;
    saveConfig(config);
    ctx.config.mcp = config.mcp;

    return c.json({ status: 'created', server });
  });

  /**
   * DELETE /setup/mcp/servers/:id
   *
   * Remove an MCP server by ID.
   */
  api.delete('/setup/mcp/servers/:id', (c) => {
    const id = c.req.param('id');
    const config = loadConfig();
    const idx = config.mcp.servers.findIndex((s) => s.id === id);

    if (idx === -1) {
      return c.json({ error: 'NOT_FOUND', message: 'Server not found' }, 404);
    }

    config.mcp.servers.splice(idx, 1);
    if (config.mcp.servers.length === 0) {
      config.mcp.enabled = false;
    }
    saveConfig(config);
    ctx.config.mcp = config.mcp;

    return c.json({ status: 'deleted' });
  });

  /**
   * POST /setup/mcp/servers/:id/test
   *
   * Test connection to an MCP server.
   * Uses the server config from the request body (allows testing before saving).
   */
  api.post('/setup/mcp/servers/:id/test', async (c) => {
    const id = c.req.param('id');
    const config = loadConfig();
    const server = config.mcp.servers.find((s) => s.id === id);

    if (!server) {
      return c.json({ error: 'NOT_FOUND', message: 'Server not found' }, 404);
    }

    try {
      const result = await ctx.mcpClientManager.testConnection(server);
      return c.json({ status: 'ok', tools: result.tools });
    } catch (error) {
      return c.json(
        {
          status: 'failed',
          message: error instanceof Error ? error.message : 'Connection failed',
        },
        500,
      );
    }
  });

  /**
   * POST /setup/mcp/reconnect
   *
   * Disconnect all MCP clients and reconnect.
   * Also re-merges tools with the agent.
   */
  api.post('/setup/mcp/reconnect', async (c) => {
    const config = loadConfig();
    ctx.config.mcp = config.mcp;

    await ctx.mcpClientManager.disconnectAll();

    if (!config.mcp.enabled || config.mcp.servers.length === 0) {
      // Re-set tools without MCP
      if (ctx.agent) {
        const { createTools } = await import('../../agent/tools.js');
        ctx.agent.setTools(createTools(ctx, ctx.questionBridge));
      }
      return c.json({ status: 'disconnected', connected: 0 });
    }

    const enabled = config.mcp.servers.filter((s) => s.enabled);
    await ctx.mcpClientManager.connectAll(enabled);

    // Re-merge tools
    if (ctx.agent) {
      const { createTools } = await import('../../agent/tools.js');
      const { mergeWithMcpTools } = await import('../../mcp/client-manager.js');
      const tools = await mergeWithMcpTools(
        createTools(ctx, ctx.questionBridge),
        ctx.mcpClientManager,
      );
      ctx.agent.setTools(tools);
    }

    return c.json({
      status: 'connected',
      connected: ctx.mcpClientManager.connectedCount,
    });
  });

  return api;
}
