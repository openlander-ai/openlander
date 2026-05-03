import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { AppContext } from '../../src/app.js';
import { createDeployStreamRoutes } from '../../src/web/api/deploy-stream-routes.js';

function createApp(ctx: Partial<AppContext>) {
  const app = new Hono();
  app.route('/api', createDeployStreamRoutes(ctx as AppContext));
  return app;
}

describe('POST /api/services/deploy', () => {
  it('rejects source fields that do not match the selected source', async () => {
    const app = createApp({ db: {} as AppContext['db'] });

    const res = await app.request('/api/services/deploy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'git',
        repo_url: 'https://github.com/acme/app',
        image_url: 'nginx:latest',
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'INVALID_SOURCE_FIELDS',
      code: 'INVALID_SOURCE_FIELDS',
    });
  });

  it('rejects mismatched project_id and project_name with INVALID_PROJECT_TARGET details', async () => {
    const db = {
      getProject: vi.fn(async () => ({ id: 'p1', name: 'real-name' })),
    };
    const app = createApp({ db } as unknown as AppContext);

    const res = await app.request('/api/services/deploy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'git',
        repo_url: 'https://github.com/acme/app',
        project_id: 'p1',
        project_name: 'wrong-name',
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'INVALID_PROJECT_TARGET',
      code: 'INVALID_PROJECT_TARGET',
      details: {
        projectId: 'p1',
        actualName: 'real-name',
        providedName: 'wrong-name',
      },
    });
  });

  it('suffixes the temporary deploy name when an attached service already owns the derived service name', async () => {
    const db = {
      getProject: vi.fn(async () => ({ id: 'group-1', name: 'workspace' })),
      getServices: vi.fn(async () => [
        {
          id: 'existing-svc',
          name: 'api__svc',
        },
      ]),
      getProjectByName: vi.fn(async () => undefined),
      attachServiceToProject: vi.fn(async () => ({
        sourceProjectId: 'api-2',
        targetProjectId: 'group-1',
        droppedEnvVarKeys: [],
        droppedSecretFiles: [],
      })),
    };
    const pipeline = {
      deploy: vi.fn(async () => ({
        success: true,
        projectId: 'api-2',
        url: 'http://localhost:10001',
      })),
    };
    const app = createApp({
      db,
      pipeline,
      config: { git: {} },
    } as unknown as AppContext);

    const res = await app.request('/api/services/deploy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'git',
        repo_url: 'https://github.com/acme/api.git',
        project_id: 'group-1',
      }),
    });

    expect(res.status).toBe(200);
    expect(pipeline.deploy).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: 'https://github.com/acme/api.git',
        name: 'api-2',
      }),
    );
    expect(db.attachServiceToProject).toHaveBeenCalledWith('api-2__svc', 'group-1');
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      projectId: 'group-1',
      serviceName: 'api-2',
    });
  });
});
