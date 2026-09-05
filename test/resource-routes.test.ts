import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../src/app.js';
import { deserializeConfig, serializeConfig } from '../src/pipeline/config-snapshot.js';
import { createResourceRoutes } from '../src/web/api/resource-routes.js';

function createApp(
  overrides: Record<string, unknown> = {},
  serviceManager: Record<string, unknown> = {},
) {
  const db = {
    getProject: vi.fn(async (id: string) =>
      id === 'proj-1' ? { id: 'proj-1', name: 'group' } : null,
    ),
    getProjectByName: vi.fn(async (name: string) =>
      name === 'group' ? { id: 'proj-1', name: 'group' } : null,
    ),
    getService: vi.fn(async (id: string) =>
      id === 'svc-1' ? { id: 'svc-1', name: 'api', project_id: 'proj-1' } : null,
    ),
    loadDeployConfigForService: vi.fn(async () => ({
      config_json: serializeConfig({ resourceProfile: 'small' }),
    })),
    saveDeployConfigForService: vi.fn(async () => undefined),
    loadDeployConfig: vi.fn(async () => null),
    saveDeployConfig: vi.fn(async () => undefined),
    ...overrides,
  };

  const app = new Hono();
  app.route('/api', createResourceRoutes({ db, serviceManager } as unknown as AppContext));
  return { app, db };
}

describe('resource routes', () => {
  it('reads actual managed limits and applies changes through the service manager', async () => {
    const manager = {
      getResourceLimits: vi.fn(async () => ({
        profile: 'custom',
        memory: { limitBytes: 128 * 1024 * 1024 },
      })),
      updateResourceLimits: vi.fn(async () => ({
        profile: 'custom',
        memory: { limitBytes: 768 * 1024 * 1024 },
      })),
    };
    const { app, db } = createApp(
      { getService: vi.fn(async () => ({ id: 'db-1', kind: 'redis', project_id: 'proj-1' })) },
      manager,
    );
    const get = await app.request('/api/projects/proj-1/services/db-1/resources');
    expect(get.status).toBe(200);
    expect(manager.getResourceLimits).toHaveBeenCalledWith('db-1');
    const update = await app.request('/api/projects/proj-1/services/db-1/resources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'custom', memoryMb: 768 }),
    });
    expect(update.status).toBe(200);
    expect(manager.updateResourceLimits).toHaveBeenCalledWith('db-1', {
      profile: 'custom',
      memoryMb: 768,
    });
    expect(db.saveDeployConfigForService).not.toHaveBeenCalled();
  });

  it('rejects a managed service belonging to another project before reading or updating it', async () => {
    const manager = { getResourceLimits: vi.fn(), updateResourceLimits: vi.fn() };
    const { app } = createApp(
      {
        getService: vi.fn(async () => ({
          id: 'db-1',
          kind: 'postgres',
          project_id: 'other-project',
        })),
      },
      manager,
    );
    for (const method of ['GET', 'PATCH']) {
      const response = await app.request('/api/projects/proj-1/services/db-1/resources', {
        method,
      });
      expect(response.status).toBe(404);
    }
    expect(manager.getResourceLimits).not.toHaveBeenCalled();
    expect(manager.updateResourceLimits).not.toHaveBeenCalled();
  });

  it('loads resource limits from the selected service', async () => {
    const { app, db } = createApp();

    const response = await app.request('/api/projects/proj-1/services/svc-1/resources');

    expect(response.status).toBe(200);
    expect(db.loadDeployConfigForService).toHaveBeenCalledWith('svc-1');
    expect(db.loadDeployConfig).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      profile: 'small',
      memory: { limitBytes: 536870912 },
      cpu: { shares: 512 },
    });
  });

  it('persists resource updates by service id', async () => {
    const { app, db } = createApp({
      loadDeployConfigForService: vi.fn(async () => ({
        config_json: serializeConfig({ environment: 'production' }),
      })),
    });

    const response = await app.request('/api/projects/proj-1/services/svc-1/resources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'custom', memoryMb: 768 }),
    });

    expect(response.status).toBe(200);
    expect(db.saveDeployConfigForService).toHaveBeenCalledTimes(1);
    const [serviceId, json] = db.saveDeployConfigForService.mock.calls[0] as [string, string];
    expect(serviceId).toBe('svc-1');
    expect(deserializeConfig(json)?.snapshot).toMatchObject({
      environment: 'production',
      resourceProfile: 'custom',
      memoryLimitBytes: 805306368,
    });
    expect(db.saveDeployConfig).not.toHaveBeenCalled();
  });

  it('rejects custom memory paired with a named profile', async () => {
    const { app, db } = createApp();

    const response = await app.request('/api/projects/proj-1/services/svc-1/resources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'large', memoryMb: 768 }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'VALIDATION_ERROR' });
    expect(db.saveDeployConfigForService).not.toHaveBeenCalled();
  });

  it('keeps project resource endpoint as compatibility shim', async () => {
    const { app, db } = createApp({
      loadDeployConfig: vi.fn(async () => ({
        config_json: serializeConfig({ resourceProfile: 'micro' }),
      })),
    });

    const response = await app.request('/api/projects/proj-1/resources');

    expect(response.status).toBe(200);
    expect(db.loadDeployConfig).toHaveBeenCalledWith('proj-1');
    await expect(response.json()).resolves.toMatchObject({
      profile: 'micro',
      memory: { limitBytes: 268435456 },
    });
  });
});
