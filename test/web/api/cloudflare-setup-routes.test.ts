import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../../src/app.js';
import { exchangeCloudflareCode } from '../../../src/auth/cloudflare-oauth.js';
import { encryptAndStoreToken } from '../../../src/auth/token-store.js';
import { OpenLanderError } from '../../../src/errors.js';
import {
  __cloudflareOAuthStateTestHooks,
  createCloudflareSetupRoutes,
} from '../../../src/web/api/setup/cloudflare-routes.js';

vi.mock('../../../src/auth/cloudflare-oauth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/auth/cloudflare-oauth.js')>();
  return {
    ...actual,
    exchangeCloudflareCode: vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
      tokenType: 'Bearer',
    }),
  };
});

vi.mock('../../../src/auth/token-store.js', () => ({
  encryptAndStoreToken: vi.fn().mockResolvedValue(undefined),
}));

function createHarness(authKind: 'session' | 'api_token' = 'session') {
  const cloudflare = {
    getConnectedPublishConnection: vi.fn().mockResolvedValue({
      configured: false,
      oauthAvailable: true,
      status: 'disconnected',
    }),
    listConnectedPublishAccounts: vi
      .fn()
      .mockResolvedValue([{ id: 'account-1', name: 'Account One' }]),
    listConnectedPublishZones: vi
      .fn()
      .mockResolvedValue([{ id: 'zone-1', name: 'example.com', status: 'active' }]),
    connectConnectedPublish: vi.fn().mockResolvedValue({
      configured: true,
      oauthAvailable: true,
      status: 'connected',
      zone: { id: 'zone-1', name: 'example.com' },
    }),
    disconnectConnectedPublish: vi.fn().mockResolvedValue({
      configured: false,
      oauthAvailable: true,
      status: 'disconnected',
    }),
  };
  const ctx = {
    config: {
      cloudflare: {
        apiToken: '',
        accountId: '',
        tunnelId: '',
        oauthClientId: 'public-client-id',
        oauthRedirectUri: 'https://openlander.example/cloudflare-oauth-callback.html',
        oauthScopes: ['account:read', 'zone:read'],
      },
    },
    cloudflare,
    db: {},
  } as unknown as AppContext;
  const app = new Hono<{ Variables: { authKind: 'session' | 'api_token' } }>();
  app.use('*', async (c, next) => {
    c.set('authKind', authKind);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof OpenLanderError) return c.json(error.toJSON(), 409);
    throw error;
  });
  app.route('/api', createCloudflareSetupRoutes(ctx));
  return { app, cloudflare, ctx };
}

describe('Cloudflare setup routes', () => {
  beforeEach(() => {
    __cloudflareOAuthStateTestHooks.clear();
    vi.clearAllMocks();
  });

  it('starts a bounded PKCE flow for the fixed public callback page', async () => {
    const { app } = createHarness();

    const response = await app.request('/api/setup/cloudflare/oauth/start', { method: 'POST' });
    const body = (await response.json()) as Record<string, unknown>;
    const authUrl = new URL(String(body['auth_url']));

    expect(response.status).toBe(200);
    expect(authUrl.origin + authUrl.pathname).toBe('https://dash.cloudflare.com/oauth2/auth');
    expect(authUrl.searchParams.get('client_id')).toBe('public-client-id');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'https://openlander.example/cloudflare-oauth-callback.html',
    );
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(body).toMatchObject({
      callback_origin: 'https://openlander.example',
      expires_in_seconds: 600,
    });
  });

  it('consumes OAuth state once, encrypts tokens, and returns accessible accounts', async () => {
    const { app, cloudflare, ctx } = createHarness();
    __cloudflareOAuthStateTestHooks.set('state-1', 'verifier-1');

    const response = await app.request('/api/setup/cloudflare/oauth/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'code-1', state: 'state-1' }),
    });

    expect(response.status).toBe(200);
    expect(exchangeCloudflareCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'code-1', verifier: 'verifier-1' }),
    );
    expect(encryptAndStoreToken).toHaveBeenCalledWith(
      ctx.db,
      'cloudflare',
      expect.objectContaining({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }),
    );
    expect(cloudflare.listConnectedPublishAccounts).toHaveBeenCalledOnce();

    const replay = await app.request('/api/setup/cloudflare/oauth/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'code-1', state: 'state-1' }),
    });
    expect(replay.status).toBe(400);
  });

  it('repairs an existing connected-publish configuration during OAuth completion', async () => {
    const { app, cloudflare } = createHarness();
    cloudflare.getConnectedPublishConnection.mockResolvedValue({
      configured: true,
      oauthAvailable: true,
      status: 'error',
      account: { id: 'account-1', name: 'Account One' },
      zone: { id: 'zone-1', name: 'example.com' },
    });
    __cloudflareOAuthStateTestHooks.set('state-1', 'verifier-1');

    const response = await app.request('/api/setup/cloudflare/oauth/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'code-1', state: 'state-1' }),
    });

    expect(response.status).toBe(200);
    expect(cloudflare.connectConnectedPublish).toHaveBeenCalledWith({
      accountId: 'account-1',
      zoneId: 'zone-1',
    });
  });

  it('caps pending OAuth state and connects only after account and Zone selection', async () => {
    const { app, cloudflare } = createHarness();
    for (let index = 0; index <= __cloudflareOAuthStateTestHooks.maxEntries; index += 1) {
      await app.request('/api/setup/cloudflare/oauth/start', { method: 'POST' });
    }
    expect(__cloudflareOAuthStateTestHooks.size).toBe(__cloudflareOAuthStateTestHooks.maxEntries);

    const response = await app.request('/api/setup/cloudflare/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account_id: 'account-1', zone_id: 'zone-1' }),
    });

    expect(response.status).toBe(200);
    expect(cloudflare.connectConnectedPublish).toHaveBeenCalledWith({
      accountId: 'account-1',
      zoneId: 'zone-1',
    });
  });

  it('disconnects only from an authenticated web session', async () => {
    const web = createHarness('session');
    const response = await web.app.request('/api/setup/cloudflare/disconnect', {
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect(web.cloudflare.disconnectConnectedPublish).toHaveBeenCalledOnce();

    const apiToken = createHarness('api_token');
    const rejected = await apiToken.app.request('/api/setup/cloudflare/disconnect', {
      method: 'POST',
    });
    expect(rejected.status).toBe(409);
    await expect(rejected.json()).resolves.toMatchObject({
      code: 'OPERATION_REQUIRES_HUMAN_UI',
    });
    expect(apiToken.cloudflare.disconnectConnectedPublish).not.toHaveBeenCalled();
  });
});
