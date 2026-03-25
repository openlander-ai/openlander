import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { loadConfig, saveConfig, updateConfig } from '../../config/index.js';
import { loadDecryptedToken } from '../../auth/token-store.js';
import type { OpenLanderConfig } from '../../config/index.js';
import type { LLMConfig } from '../../llm/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { createCloudflareSetupRoutes } from './setup/cloudflare-routes.js';
import { createGithubSetupRoutes } from './setup/github-routes.js';
import { createMcpSetupRoutes } from './setup/mcp-routes.js';
import { reloadAgent } from './setup/shared.js';

const log = createModuleLogger('setup-routes');

export function createSetupRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/setup/status', async (c) => {
    const [dockerStatus, traefikOk] = await Promise.all([
      ctx.docker.status(),
      ctx.traefik.isRunning().catch(() => false),
    ]);

    const dockerOk = dockerStatus.state === 'running';
    const llmConfigured = ctx.agent !== null;
    const config = loadConfig();
    const hasPassword = ctx.db.isPasswordSet();

    const ready = dockerOk && hasPassword;

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
      hasPassword,
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

    try {
      await reloadAgent(ctx, {
        provider: provider as OpenLanderConfig['llm']['provider'],
        apiKey,
        authToken: resolvedAuthToken || undefined,
        model,
        language: ctx.config.language,
      });

      return c.json({
        status: 'configured',
        provider: body.provider,
        model,
        hot_reloaded: true,
        message: 'LLM configured and ready. No restart needed.',
      });
    } catch (error) {
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

  api.post('/setup/llm/test', async (c) => {
    const body = await c.req
      .json<{ provider?: string; api_key?: string }>()
      .catch((): { provider?: string; api_key?: string } => ({}));

    try {
      const config = loadConfig();
      const provider = (body.provider || config.llm.provider) as LLMConfig['provider'];
      const apiKey = body.api_key || config.llm.apiKey;

      if (!apiKey && provider !== 'ollama') {
        return c.json({ ok: false, error: 'No API key configured' }, 400);
      }

      const { createModel: createTestModel } = await import('../../llm/index.js');
      const { generateText } = await import('ai');

      const model = createTestModel({
        provider,
        apiKey,
        model: config.llm.model,
      });

      const start = Date.now();
      await generateText({
        model,
        prompt: 'Respond with exactly: ok',
        maxOutputTokens: 5,
      });
      const latencyMs = Date.now() - start;

      return c.json({ ok: true, latencyMs, provider, model: config.llm.model });
    } catch (error) {
      return c.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  api.delete('/setup/llm', (c) => {
    updateConfig({
      llm: {
        provider: 'gemini',
        apiKey: '',
        authToken: '',
        model: 'gemini-2.0-flash',
      },
    });

    ctx.agent = null;
    log.info('LLM configuration removed');

    return c.json({ status: 'removed', message: 'LLM configuration cleared.' });
  });

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

  api.post('/setup/language', async (c) => {
    const body = await c.req.json<{ language: string }>();

    if (body.language !== 'en' && body.language !== 'ko') {
      return c.json({ error: 'INVALID_LANGUAGE', message: 'Language must be "en" or "ko"' }, 400);
    }

    const language = body.language;
    updateConfig({ language });
    ctx.config.language = language;

    if (ctx.agent) {
      try {
        const llmModel = await reloadAgent(ctx, {
          provider: ctx.config.llm.provider,
          apiKey: ctx.config.llm.apiKey,
          model: ctx.config.llm.model,
          authToken: ctx.config.llm.authToken || undefined,
          language,
        });

        if (ctx.buildDebugger) {
          const { BuildDebugger } = await import('../../pipeline/build-debugger.js');
          ctx.buildDebugger = new BuildDebugger(llmModel, language);
        }
      } catch (err) {
        log.error({ err, language }, 'Agent hot-reload failed');
      }
    }

    return c.json({ status: 'saved', language });
  });

  api.post('/setup/complete', (c) => {
    const config = loadConfig();
    saveConfig(config);
    return c.json({ status: 'complete', message: 'Setup marked as complete.' });
  });

  api.route('/', createCloudflareSetupRoutes(ctx));
  api.route('/', createGithubSetupRoutes(ctx));
  api.route('/', createMcpSetupRoutes(ctx));

  return api;
}
