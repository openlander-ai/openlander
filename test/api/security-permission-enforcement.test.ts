import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { OpenLanderError } from '../../src/errors.js';
import { createSystemRoutes } from '../../src/web/api/system-routes.js';

function createApp(serviceOverride: Record<string, unknown>) {
  const service = {
    id: 'service-1',
    project_id: 'project-1',
    name: 'postgres',
    kind: 'postgres',
    credentials: JSON.stringify({ password: 'secret' }),
  };
  const remove = vi.fn();
  const getEnvVarsForService = vi.fn();
  const settings = new Map([
    ['security.operation_permissions.service.service-1', JSON.stringify(serviceOverride)],
  ]);
  const ctx = {
    serviceManager: {
      getDetail: vi.fn().mockResolvedValue(service),
      remove,
    },
    db: {
      getService: vi.fn().mockResolvedValue(service),
      getSetting: vi.fn(async (key: string) => {
        const value = settings.get(key);
        return value === undefined ? null : { value };
      }),
      getEnvVarsForService,
      insertActivityLog: vi.fn(),
    },
    config: { gitProviders: { github: {} } },
    docker: {},
  } as unknown as AppContext;
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof OpenLanderError) {
      return c.json(error.toJSON(), error.statusCode as 403 | 500);
    }
    throw error;
  });
  app.route('/api', createSystemRoutes(ctx));
  return { app, remove, getEnvVarsForService };
}

describe('operation permission enforcement', () => {
  it('blocks credential reveal before any secret is read or audited', async () => {
    const { app, getEnvVarsForService } = createApp({ database_access: 'block' });
    const response = await app.request('/api/services/service-1/credentials/reveal', {
      method: 'POST',
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'OPERATION_PERMISSION_DENIED',
      details: { permission: 'database_access', service_id: 'service-1' },
    });
    expect(getEnvVarsForService).not.toHaveBeenCalled();
  });

  it('blocks managed resource deletion before the remove pipeline runs', async () => {
    const { app, remove } = createApp({ destructive_actions: 'block' });
    const response = await app.request('/api/services/service-1', { method: 'DELETE' });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'OPERATION_PERMISSION_DENIED',
      details: { permission: 'destructive_actions', service_id: 'service-1' },
    });
    expect(remove).not.toHaveBeenCalled();
  });
});
