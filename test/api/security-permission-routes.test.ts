import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { OpenLanderError } from '../../src/errors.js';
import { createSecurityPermissionRoutes } from '../../src/web/api/security-permission-routes.js';

function createApp() {
  const settings = new Map<string, string>();
  const project = { id: 'project-1', name: 'demo' };
  const service = { id: 'service-1', name: 'web', project_id: project.id };
  const db = {
    getSetting: vi.fn(async (key: string) => {
      const value = settings.get(key);
      return value === undefined ? null : { value };
    }),
    upsertSetting: vi.fn(async (key: string, value: string) => {
      settings.set(key, value);
    }),
    deleteSetting: vi.fn(async (key: string) => settings.delete(key)),
    getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
    getProjectByName: vi.fn(async (name: string) => (name === project.name ? project : undefined)),
    getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
  };
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof OpenLanderError) {
      return c.json(error.toJSON(), error.statusCode as 403 | 404 | 500);
    }
    throw error;
  });
  app.route('/api', createSecurityPermissionRoutes({ db } as unknown as AppContext));
  return { app, settings };
}

describe('security permission routes', () => {
  it('returns open global defaults and persists a global restriction', async () => {
    const { app } = createApp();
    const initial = await app.request('/api/security/permissions');
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toMatchObject({
      scope: 'global',
      permissions: {
        effective: { destructive_actions: 'allow', database_access: 'allow' },
      },
    });

    const updated = await app.request('/api/security/permissions', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destructive_actions: 'approval_required', database_access: 'block' }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      permissions: {
        effective: { destructive_actions: 'approval_required', database_access: 'block' },
      },
    });
  });

  it('supports Project and service inheritance overrides', async () => {
    const { app } = createApp();
    await app.request('/api/security/permissions', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destructive_actions: 'block', database_access: 'block' }),
    });
    await app.request('/api/projects/project-1/security/permissions', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ database_access: 'allow' }),
    });
    const serviceResponse = await app.request('/api/services/service-1/security/permissions', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destructive_actions: 'allow', database_access: null }),
    });

    expect(serviceResponse.status).toBe(200);
    await expect(serviceResponse.json()).resolves.toMatchObject({
      permissions: {
        effective: { destructive_actions: 'allow', database_access: 'allow' },
        sources: { destructive_actions: 'service', database_access: 'project' },
      },
    });
  });

  it('rejects invalid permission values', async () => {
    const { app } = createApp();
    const response = await app.request('/api/security/permissions', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ database_access: 'read_only' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_OPERATION_PERMISSION' });
  });
});
