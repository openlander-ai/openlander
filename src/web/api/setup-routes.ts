import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { loadConfig, saveConfig, updateConfig } from '../../config/index.js';
import type { OpenLanderConfig } from '../../config/index.js';

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
    const [dockerOk, traefikOk] = await Promise.all([
      ctx.docker.ping().catch(() => false),
      ctx.traefik.isRunning().catch(() => false),
    ]);

    const llmConfigured = ctx.agent !== null;
    const config = loadConfig();

    // "ready" = can deploy and chat. Minimum: Docker + LLM.
    // Traefik is recommended but not blocking (containers still work without routing).
    const ready = dockerOk && llmConfigured;

    return c.json({
      ready,
      docker: {
        ok: dockerOk,
        message: dockerOk
          ? 'Docker is running'
          : 'Docker is not running. Please install and start Docker.',
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
          : 'No LLM configured. Add an API key to enable chat.',
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
      api_key: string;
      model?: string;
    }>();

    if (!body.provider || !body.api_key) {
      return c.json({ error: 'MISSING_FIELD', message: 'provider and api_key are required' }, 400);
    }

    const validProviders = ['gemini', 'openrouter', 'anthropic', 'openai', 'ollama'];
    if (!validProviders.includes(body.provider)) {
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
      openrouter: 'google/gemini-2.0-flash-exp:free',
      anthropic: 'claude-sonnet-4-20250514',
      openai: 'gpt-4o-mini',
      ollama: 'llama3.2',
    };

    const model = body.model || modelDefaults[body.provider] || 'gemini-2.0-flash';

    updateConfig({
      llm: {
        provider: body.provider as OpenLanderConfig['llm']['provider'],
        apiKey: body.api_key,
        model,
      },
    });

    // Hot-reload: try to create the agent now so the user doesn't need to restart
    try {
      const { createLLMClient } = await import('../../llm/index.js');
      const { Agent } = await import('../../agent/index.js');
      const { createTools } = await import('../../agent/tools.js');
      const { buildContextSnapshot } = await import('../../agent/prompts.js');

      const llm = createLLMClient({
        provider: body.provider as OpenLanderConfig['llm']['provider'],
        apiKey: body.api_key,
        model,
      });

      const agent = new Agent(
        llm,
        ctx.db,
        () => buildContextSnapshot(ctx.db),
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
