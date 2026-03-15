import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import type { AppContext } from '../src/app.js';
import { Database } from '../src/db/index.js';
import { EnvManager } from '../src/pipeline/env.js';
import { createApiRoutes } from '../src/web/api/routes.js';
import { createMockContext } from './helpers/web-route-mocks.js';

describe('Environment API routes', () => {
  let app: Hono;
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-env-api-test-'));
    db = new Database(join(tmpDir, 'test.db'));

    const ctx = createMockContext(db);
    ctx.env = new EnvManager(db) as AppContext['env'];

    app = new Hono();
    app.route('/api', createApiRoutes(ctx));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('POST /api/projects/:id/environments creates fixed-tier environment with default branch', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });

    const res = await app.request('/api/projects/p1/environments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'development' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.environment.type).toBe('development');
    expect(body.environment.branch).toBe('develop');

    const projectRes = await app.request('/api/projects/p1');
    const projectBody = await projectRes.json();
    expect(Array.isArray(projectBody.environments)).toBe(true);
    expect(projectBody.environments).toHaveLength(2);
  });

  it('DELETE /api/projects/:id/environments/:envId rejects production delete', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });
    const production = db
      .getEnvironmentsByProject('p1')
      .find((environment) => environment.type === 'production');
    expect(production).toBeDefined();

    const res = await app.request(`/api/projects/p1/environments/${production!.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('PRODUCTION_ENVIRONMENT_PROTECTED');
    expect(db.getEnvironment(production!.id)).toBeDefined();
  });

  it('GET /api/projects/:id/environments/:envId/env returns inheritance metadata sources', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });

    const production = db
      .getEnvironmentsByProject('p1')
      .find((environment) => environment.type === 'production');
    expect(production).toBeDefined();

    const development = db.createEnvironment({
      id: 'env-development',
      projectId: 'p1',
      type: 'development',
      branch: 'develop',
    });

    const env = new EnvManager(db);
    env.setGlobalSecret('GLOBAL_ONLY', 'global-value');
    env.set('p1', 'PROJECT_ONLY', 'project-value');
    env.set('p1', 'SHARED_KEY', 'project-shared');
    env.set('p1', 'PROD_ONLY', 'prod-value', production!.id);
    env.set('p1', 'SHARED_KEY', 'prod-shared', production!.id);
    env.set('p1', 'DEVELOPMENT_ONLY', 'dev-value', development.id);
    env.set('p1', 'SHARED_KEY', 'development-shared', development.id);

    const res = await app.request('/api/projects/p1/environments/env-development/env');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.envVars).toMatchObject({
      PROJECT_ONLY: 'project-value',
      PROD_ONLY: 'prod-value',
      DEVELOPMENT_ONLY: 'dev-value',
      SHARED_KEY: 'development-shared',
    });
    expect(body.inheritance.GLOBAL_ONLY).toEqual({ value: 'global-value', source: 'global' });
    expect(body.inheritance.PROJECT_ONLY).toEqual({ value: 'project-value', source: 'project' });
    expect(body.inheritance.PROD_ONLY).toEqual({ value: 'prod-value', source: 'production' });
    expect(body.inheritance.SHARED_KEY).toEqual({
      value: 'development-shared',
      source: 'environment',
      isOverride: true,
    });
  });
});
