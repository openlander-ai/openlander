import { Hono } from 'hono';

import type { AppContext } from '../../../app.js';
import { loadConfig, updateConfig } from '../../../config/index.js';

export function createCloudflareSetupRoutes(ctx: AppContext): Hono {
  const api = new Hono();

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

    const cloudflareConfig = { apiToken, accountId, tunnelId };
    updateConfig({ cloudflare: cloudflareConfig });
    ctx.cloudflare.reloadConfig(cloudflareConfig);

    return c.json({ status: 'configured' });
  });

  return api;
}
