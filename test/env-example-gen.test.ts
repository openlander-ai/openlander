import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { AppContext } from '../src/app.js';
import type { EnvironmentRow, ProjectRow, ServiceRow } from '../src/db/types.js';
import { OpenLanderError } from '../src/errors.js';
import { generateEnvExample } from '../src/pipeline/env-inject.js';
import { cloneRepo } from '../src/pipeline/git.js';
import { createProjectEnvRoutes } from '../src/web/api/project-env-routes.js';
import { scanForEnvUsage } from '../src/pipeline/env-scan.js';

vi.mock('../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn().mockResolvedValue({ path: '/tmp/mock-clone', commitSha: 'deadbeef' }),
}));

vi.mock('../src/pipeline/env-scan.js', () => ({
  scanForEnvUsage: vi.fn().mockReturnValue({
    vars: [
      { key: 'API_KEY', files: [{ path: 'src/app.ts', line: 5 }], optional: false },
      { key: 'APP_ORIGIN', files: [{ path: 'src/app.ts', line: 8 }], optional: false },
      { key: 'FEATURE_FLAG', files: [{ path: 'src/config.ts', line: 3 }], optional: false },
    ],
    hasEnvExample: false,
    language: 'node',
    serviceHints: ['redis'],
  }),
}));

describe('generateEnvExample', () => {
  it('includes scan keys and service-derived keys without leaking raw values', () => {
    const text = generateEnvExample(
      {
        vars: [
          { key: 'API_KEY', files: [{ path: 'src/app.ts', line: 3 }], optional: false },
          { key: 'APP_ORIGIN', files: [{ path: 'src/app.ts', line: 6 }], optional: false },
        ],
        hasEnvExample: false,
        language: 'node',
        serviceHints: ['redis'],
      },
      {
        API_KEY: 'super-secret-token',
        APP_ORIGIN: 'https://prod.example.com',
      },
    );

    expect(text).toContain('API_KEY=');
    expect(text).toContain('APP_ORIGIN=<configured-in-openlander>');
    expect(text).toContain('REDIS_URL=redis://redis:6379');
    expect(text).not.toContain('super-secret-token');
    expect(text).not.toContain('https://prod.example.com');
  });
});

describe('GET /api/projects/:id/env-example', () => {
  let app: Hono;
  let project: ProjectRow;
  let deployable: ServiceRow;
  let productionEnvironment: EnvironmentRow;
  let ctx: Partial<AppContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    project = {
      id: 'p1',
      name: 'demo',
      display_name: 'Demo',
      description: null,
      tags: null,
      archived_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      server_id: 'local',
      deploy_lock_session: null,
      deploy_lock_at: null,
      container_id: null,
    };
    deployable = {
      id: 'p1__svc',
      project_id: 'p1',
      name: 'demo__svc',
      kind: 'image',
      parent_service_id: null,
      status: 'running',
      visibility: 'internal',
      assigned_port: 10001,
      container_id: 'container-1',
      container_name: 'ol-demo',
      container_port: 3000,
      image_tag: 'ol-demo:latest',
      previous_image_tag: null,
      public_url: null,
      dockerfile_path: null,
      docker_target: null,
      build_context: null,
      build_method: null,
      source: 'git',
      repo_url: 'https://github.com/openlander/demo',
      branch: 'main',
      image_url: null,
      image_cmd: null,
      pending_fix: null,
      access_code: null,
      access_code_iv: null,
      is_preview: null,
      pr_number: null,
      project_type: 'web',
      health_check_strategy: 'http',
      health_check_path: '/',
      recovering_started_at: null,
      credentials: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      archived_at: null,
      server_id: 'local',
    };
    productionEnvironment = {
      id: 'env-production',
      service_id: 'p1__svc',
      project_id: 'p1',
      type: 'production',
      branch: 'main',
      status: 'running',
      assigned_port: 10001,
      container_id: 'container-1',
      image_tag: 'ol-demo:latest',
      previous_image_tag: null,
      public_url: null,
      container_port: 3000,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    ctx = {
      db: {
        getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn(async () => undefined),
        getDeployableForProject: vi.fn(async () => deployable),
        getEnvironmentsByProject: vi.fn(async () => [productionEnvironment]),
      },
      env: {
        getAllForService: vi.fn(async () => ({
          API_KEY: 'prod-secret-value',
          APP_ORIGIN: 'https://prod.example.com',
        })),
      },
    };
    app = new Hono();
    app.onError((err, c) => {
      if (err instanceof OpenLanderError) {
        return c.json(err.toJSON(), err.statusCode as 400);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: err.message }, 500);
    });
    app.route('/api', createProjectEnvRoutes(ctx as AppContext));
  });

  it('returns generated env-example text', async () => {
    const productionRes = await app.request('/api/projects/p1/env-example');

    expect(productionRes.status).toBe(200);

    const productionBody = await productionRes.text();

    expect(productionBody).toContain('FEATURE_FLAG=');
    expect(productionBody).toContain('REDIS_URL=redis://redis:6379');

    expect(productionBody).not.toContain('prod-secret-value');
    expect(productionBody).not.toContain('https://prod.example.com');

    const mockedCloneRepo = cloneRepo as unknown as ReturnType<typeof vi.fn>;
    expect(mockedCloneRepo).toHaveBeenCalledWith(
      expect.objectContaining({ branch: productionEnvironment.branch }),
    );

    const mockedScan = scanForEnvUsage as unknown as ReturnType<typeof vi.fn>;
    expect(mockedScan).toHaveBeenCalledTimes(1);
  });
});
