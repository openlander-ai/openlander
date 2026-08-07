import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const { saveConfig } = vi.hoisted(() => ({ saveConfig: vi.fn() }));

vi.mock('../../src/config/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/config/index.js')>(
    '../../src/config/index.js',
  );
  return { ...actual, saveConfig };
});

import type { AppContext } from '../../src/app.js';
import { createWebServerRoutes } from '../../src/web/api/web-server-routes.js';

function harness() {
  const config = {
    server: { port: 10114 },
    traefik: {
      mode: 'managed',
      externalNetwork: undefined,
      protectedShare: { enabled: false, publicHost: '', acmeEmail: '' },
    },
  };
  const traefik = {
    start: vi.fn(async () => undefined),
    connectToNetwork: vi.fn(async () => undefined),
  };
  const ctx = {
    config,
    traefik,
    db: {
      listProjects: vi.fn(async () => []),
      listServices: vi.fn(async () => []),
    },
  } as unknown as AppContext;
  const app = new Hono();
  app.route('/api', createWebServerRoutes(ctx));
  return { app, ctx, config, traefik };
}

describe('Web Server protected share settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    saveConfig.mockReset();
  });

  it('detects the GCP external address without persisting it automatically', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('34.64.12.34', {
            headers: { 'Metadata-Flavor': 'Google' },
          }),
      ),
    );
    const { app } = harness();

    const response = await app.request('/api/web-server/protected-share-settings');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      publicHost: '',
      acmeEmail: '',
      detectedPublicIp: '34.64.12.34',
      ready: false,
      traefikMode: 'managed',
    });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('normalizes and persists settings without claiming HTTPS before the first share', async () => {
    const { app, config, traefik } = harness();
    const response = await app.request('/api/web-server/protected-share-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicHost: 'https://Share.Example.com/path',
        acmeEmail: 'Admin@Example.com ',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'saved',
      publicHost: 'share.example.com',
      acmeEmail: 'admin@example.com',
      ready: true,
      proxyApplied: true,
    });
    expect(config.traefik.protectedShare).toEqual({
      enabled: false,
      publicHost: 'share.example.com',
      acmeEmail: 'admin@example.com',
    });
    expect(saveConfig).toHaveBeenCalledOnce();
    expect(traefik.start).not.toHaveBeenCalled();
  });

  it('rejects an invalid public host before changing runtime configuration', async () => {
    const { app, config, traefik } = harness();
    const response = await app.request('/api/web-server/protected-share-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicHost: 'localhost', acmeEmail: 'admin@example.com' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'INVALID_PUBLIC_HOST' });
    expect(config.traefik.protectedShare).toEqual({
      enabled: false,
      publicHost: '',
      acmeEmail: '',
    });
    expect(saveConfig).not.toHaveBeenCalled();
    expect(traefik.start).not.toHaveBeenCalled();
  });

  it('restores active settings when managed Traefik cannot apply an edit', async () => {
    const { app, config, traefik } = harness();
    config.traefik.protectedShare = {
      enabled: true,
      publicHost: 'old.example.com',
      acmeEmail: 'old@example.com',
    };
    traefik.start
      .mockRejectedValueOnce(new Error('Bind for 0.0.0.0:443 failed: port is already allocated'))
      .mockResolvedValueOnce(undefined);

    const response = await app.request('/api/web-server/protected-share-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicHost: 'new.example.com', acmeEmail: 'new@example.com' }),
    });

    expect(response.status).toBe(500);
    expect(config.traefik.protectedShare).toEqual({
      enabled: true,
      publicHost: 'old.example.com',
      acmeEmail: 'old@example.com',
    });
    expect(saveConfig).toHaveBeenCalledTimes(2);
    expect(traefik.start).toHaveBeenCalledTimes(2);
  });
});
