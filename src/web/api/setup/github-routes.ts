import { requestDeviceCode, getGitHubClientId } from '../../../git-providers/github-oauth.js';

import { Hono } from 'hono';

import type { AppContext } from '../../../app.js';
import { updateConfig } from '../../../config/index.js';
import { createGitProvider } from '../../../git-providers/index.js';

function syncRuntimeGithubConfig(
  ctx: AppContext,
  github: {
    token: string;
    username: string;
    authMethod?: 'oauth' | 'pat';
    connectedAt?: string | null;
    lastSyncAt?: string | null;
  },
): void {
  ctx.config.gitProviders.github = {
    ...ctx.config.gitProviders.github,
    ...github,
  };
}

export function createGithubSetupRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.post('/setup/github', async (c) => {
    const body = await c.req.json<{ token: string }>();

    if (!body.token) {
      return c.json({ error: 'MISSING_FIELD', message: 'token is required' }, 400);
    }

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

    const now = new Date().toISOString();
    updateConfig({
      gitProviders: {
        github: {
          token: body.token,
          username: validation.user?.username ?? '',
          authMethod: 'pat',
          connectedAt: now,
          lastSyncAt: now,
        },
      },
    });
    syncRuntimeGithubConfig(ctx, {
      token: body.token,
      username: validation.user?.username ?? '',
      authMethod: 'pat',
      connectedAt: now,
      lastSyncAt: now,
    });

    return c.json({
      status: 'connected',
      username: validation.user?.username,
      scopes: validation.scopes,
      message: `Connected to GitHub as ${validation.user?.username ?? 'unknown'}.`,
    });
  });

  api.delete('/setup/github', (c) => {
    updateConfig({
      gitProviders: {
        github: { token: '', username: '', connectedAt: null, lastSyncAt: null },
      },
    });
    syncRuntimeGithubConfig(ctx, { token: '', username: '', connectedAt: null, lastSyncAt: null });
    return c.json({ status: 'disconnected', message: 'GitHub disconnected.' });
  });

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

  api.post('/setup/github/poll', async (c) => {
    const body = await c.req.json<{ device_code: string; interval: number }>();

    if (!body.device_code) {
      return c.json({ error: 'MISSING_FIELD', message: 'device_code is required' }, 400);
    }

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
        const now = new Date().toISOString();
        updateConfig({
          gitProviders: {
            github: {
              token: data.access_token,
              username,
              authMethod: 'oauth',
              connectedAt: now,
              lastSyncAt: now,
            },
          },
        });
        syncRuntimeGithubConfig(ctx, {
          token: data.access_token,
          username,
          authMethod: 'oauth',
          connectedAt: now,
          lastSyncAt: now,
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

    return c.json({ status: 'error', message: 'Unexpected response from GitHub' }, 500);
  });

  return api;
}
