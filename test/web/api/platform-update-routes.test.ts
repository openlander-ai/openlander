import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../../src/app.js';
import type { AuthService } from '../../../src/auth/auth-service.js';
import { OpenLanderError, PlatformUpdateBusyError } from '../../../src/errors.js';
import { createSystemRoutes } from '../../../src/web/api/system-routes.js';
import { createAuthMiddleware } from '../../../src/web/middleware/auth.js';

function appHarness(options: { authenticated: boolean; startError?: OpenLanderError }) {
  const getStatus = vi.fn(async () => ({
    currentVersion: '0.2.13-rc.7',
    channel: 'rc',
    updateAvailable: true,
    canUpdate: true,
    release: { version: '0.2.14-rc.1' },
    support: { mode: 'compose' },
    checks: [],
    operation: null,
    releaseCheckStale: false,
    releaseCheckedAt: '2026-07-31T00:00:00.000Z',
  }));
  const startUpdate = options.startError
    ? vi.fn(async () => Promise.reject(options.startError))
    : vi.fn(async () => ({
        id: 'update-id',
        targetVersion: '0.2.14-rc.1',
        phase: 'preparing',
      }));
  const auth = {
    validateSession: vi.fn(async () => options.authenticated),
    validateApiToken: vi.fn(async () => false),
    validateMcpBearerToken: vi.fn(async () => null),
    isPasswordSet: vi.fn(async () => true),
  } as unknown as AuthService;
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof OpenLanderError) {
      return c.json(error.toJSON(), error.statusCode as 400);
    }
    throw error;
  });
  app.use('*', createAuthMiddleware(auth));
  app.route(
    '/api',
    createSystemRoutes({
      platformUpdater: { getStatus, startUpdate },
    } as unknown as AppContext),
  );
  return { app, getStatus, startUpdate };
}

describe('platform update REST routes', () => {
  it('requires authentication for status and execution', async () => {
    const { app, getStatus, startUpdate } = appHarness({ authenticated: false });
    expect((await app.request('/api/system/update')).status).toBe(401);
    expect(
      (
        await app.request('/api/system/update', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetVersion: '0.2.14-rc.1' }),
        })
      ).status,
    ).toBe(401);
    expect(getStatus).not.toHaveBeenCalled();
    expect(startUpdate).not.toHaveBeenCalled();
  });

  it('bypasses the release cache only for an explicit refresh query', async () => {
    const { app, getStatus } = appHarness({ authenticated: true });
    const headers = { cookie: 'ol_session=session-token' };

    expect((await app.request('/api/system/update?refresh=true', { headers })).status).toBe(200);

    expect(getStatus).toHaveBeenCalledWith({ refreshRelease: true });
  });

  it('returns the status contract and accepts an exact target with 202', async () => {
    const { app, startUpdate } = appHarness({ authenticated: true });
    const headers = { cookie: 'ol_session=session-token', 'content-type': 'application/json' };
    const status = await app.request('/api/system/update', { headers });
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      currentVersion: '0.2.13-rc.7',
      updateAvailable: true,
      canUpdate: true,
    });
    const start = await app.request('/api/system/update', {
      method: 'POST',
      headers,
      body: JSON.stringify({ targetVersion: '0.2.14-rc.1' }),
    });
    expect(start.status).toBe(202);
    await expect(start.json()).resolves.toMatchObject({ updateId: 'update-id' });
    expect(startUpdate).toHaveBeenCalledWith('0.2.14-rc.1');
  });

  it('serializes typed 409 conflicts', async () => {
    const { app } = appHarness({
      authenticated: true,
      startError: new PlatformUpdateBusyError('deploy_in_progress'),
    });
    const response = await app.request('/api/system/update', {
      method: 'POST',
      headers: {
        cookie: 'ol_session=session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ targetVersion: '0.2.14-rc.1' }),
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PLATFORM_UPDATE_BUSY',
      details: { reason: 'deploy_in_progress' },
    });
  });
});
