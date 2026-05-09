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

  it('POST /api/projects/:id/environments returns 410 (feature frozen)', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });

    const res = await app.request('/api/projects/p1/environments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'development' }),
    });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe('FEATURE_FROZEN');
  });

  it('DELETE /api/projects/:id/environments/:envId returns 410 (feature frozen)', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });
    const production = db
      .getEnvironmentsByProject('p1')
      .find((environment) => environment.type === 'production');
    expect(production).toBeDefined();

    const res = await app.request(`/api/projects/p1/environments/${production!.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe('FEATURE_FROZEN');
  });

  it('keeps list/detail/environment APIs aligned on canonical project environments', async () => {
    db.createProject({
      id: 'stack',
      name: 'stack',
      repoUrl: 'https://github.com/test/stack',
      buildMethod: 'compose',
    });
    db.createProject({
      id: 'stack-worker',
      name: 'stack-worker',
      repoUrl: '',
      parentProjectId: 'stack',
    });
    db.createEnvironment({
      id: 'stack-development',
      projectId: 'stack',
      type: 'development',
      branch: 'develop',
    });

    const canonicalEnvIds = db
      .getEnvironmentsByProject('stack')
      .map((environment) => environment.id)
      .sort();
    const childEnvIds = db
      .getEnvironmentsByProject('stack-worker')
      .map((environment) => environment.id);
    expect(childEnvIds).toContain('stack-worker-production');

    const [listRes, detailRes, envsRes] = await Promise.all([
      app.request('/api/projects'),
      app.request('/api/projects/stack'),
      app.request('/api/projects/stack/environments'),
    ]);

    expect(listRes.status).toBe(200);
    expect(detailRes.status).toBe(200);
    expect(envsRes.status).toBe(200);

    const listBody = (await listRes.json()) as {
      projects: Array<{ id: string; environments: Array<{ id: string; project_id: string }> }>;
    };
    const detailBody = (await detailRes.json()) as {
      environments: Array<{ id: string; project_id: string }>;
    };
    const envsBody = (await envsRes.json()) as {
      environments: Array<{ id: string; project_id: string }>;
    };

    const listProject = listBody.projects.find((project) => project.id === 'stack');
    expect(listProject).toBeDefined();

    for (const environments of [
      listProject!.environments,
      detailBody.environments,
      envsBody.environments,
    ]) {
      expect(environments.map((environment) => environment.id).sort()).toEqual(canonicalEnvIds);
      expect(environments.every((environment) => environment.project_id === 'stack')).toBe(true);
      expect(environments.map((environment) => environment.id)).not.toContain(
        'stack-worker-production',
      );
    }
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
