import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { loadConfig, saveConfig, updateConfig } from '../../config/index.js';
import { isAuthenticated } from '../middleware/auth.js';
import { createCloudflareSetupRoutes } from './setup/cloudflare-routes.js';
import { createGithubSetupRoutes } from './setup/github-routes.js';
import { createMcpSetupRoutes } from './setup/mcp-routes.js';
import { aiOpsDisabledResponse } from './ai-ops-disabled.js';
import { INTERNAL_AI_OPS_DISABLED_MESSAGE } from '../../feature-flags.js';

export function createSetupRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.all('/setup/llm', aiOpsDisabledResponse);
  api.all('/setup/llm/test', aiOpsDisabledResponse);
  api.all('/setup/providers', aiOpsDisabledResponse);
  api.all('/setup/providers/default', aiOpsDisabledResponse);
  api.all('/setup/providers/auto-recommend', aiOpsDisabledResponse);
  api.all('/setup/providers/:id', aiOpsDisabledResponse);
  api.all('/setup/ai-features', aiOpsDisabledResponse);

  api.get('/setup/status', async (c) => {
    const hasPassword = await ctx.db.isPasswordSet();

    // Day 14 follow-up to Day 13 M5: short-circuit anonymous calls before
    // we even hit Docker / Traefik / config. Once a password is set the
    // unauthenticated UI only needs to know `hasPassword` so it can render
    // the login form — leaking docker state, LLM provider/model, or
    // GitHub username is the recon primitive we want to remove. Returning
    // a constant shape (no `ready: true|false` bit either) also denies the
    // attacker a "is this install fully configured yet?" signal.
    if (hasPassword && !isAuthenticated(c)) {
      return c.json({ ok: true, hasPassword: true });
    }

    const [dockerStatus, traefikOk] = await Promise.all([
      ctx.docker.status(),
      ctx.traefik.isRunning().catch(() => false),
    ]);

    const config = loadConfig();
    const dockerOk = dockerStatus.state === 'running';

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
        ok: false,
        disabled: true,
        provider: null,
        model: null,
        message: INTERNAL_AI_OPS_DISABLED_MESSAGE,
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
