import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { EnvironmentRow, ProjectRow, ServiceRow } from '../../src/db/types.js';
import { cloneRepo } from '../../src/pipeline/git.js';
import { scanRepoEnvVars } from '../../src/pipeline/env-scan.js';
import { registerEnvScanRoutes } from '../../src/web/api/deploy-failure-handler.js';

vi.mock('../../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn().mockResolvedValue({ path: '/tmp/mock-clone' }),
}));

vi.mock('../../src/pipeline/env-scan.js', () => ({
  scanRepoEnvVars: vi.fn().mockReturnValue({
    vars: [{ key: 'DATABASE_URL', files: [{ path: 'src/app.ts', line: 1 }], optional: false }],
    hasEnvExample: false,
  }),
}));

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'group-1',
    name: 'workspace',
    display_name: 'Workspace',
    description: null,
    tags: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    container_id: null,
    ...overrides,
  };
}

function makeServiceRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'group-1__svc',
    project_id: 'group-1',
    name: 'group-1__svc',
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 10001,
    container_id: 'container-1',
    container_name: 'ol-workspace',
    container_port: 3000,
    image_tag: 'ol-workspace:latest',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: 'apps/api/Dockerfile',
    docker_target: null,
    build_context: 'apps/api',
    build_method: 'dockerfile',
    source: 'git',
    repo_url: 'https://github.com/acme/workspace.git',
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
    ...overrides,
  };
}

function makeEnvironmentRow(overrides: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return {
    id: 'env-1',
    service_id: 'group-1__svc',
    type: 'production',
    branch: 'main',
    status: 'running',
    assigned_port: 10001,
    container_id: 'container-1',
    image_tag: 'ol-workspace:latest',
    previous_image_tag: null,
    public_url: null,
    container_port: 3000,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createApp(ctx: Partial<AppContext>) {
  const app = new Hono();
  registerEnvScanRoutes(app, ctx as AppContext);
  return app;
}

describe('registerEnvScanRoutes', () => {
  it('uses service view records for project env scans', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const getDeployableForProject = vi.fn(async () => {
      throw new Error('getDeployableForProject must not be called by env scan');
    });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getServices: vi.fn(async () => [service]),
        getDeployableForProject,
        getEnvironmentsByProject: vi.fn(async () => [makeEnvironmentRow()]),
      },
      env: {
        getAll: vi.fn(() => ({})),
        getGlobalSecrets: vi.fn(() => ({})),
      },
    });

    const res = await app.request('/projects/group-1/env/scan', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(getDeployableForProject).not.toHaveBeenCalled();
    expect(cloneRepo).toHaveBeenCalledWith({
      repoUrl: service.repo_url,
      branch: service.branch ?? undefined,
    });
    expect(scanRepoEnvVars).toHaveBeenCalledWith('/tmp/mock-clone', {
      dockerfilePath: service.dockerfile_path,
    });
    await expect(res.json()).resolves.toMatchObject({
      newVars: [{ key: 'DATABASE_URL' }],
      existingVars: [],
      hasEnvExample: false,
    });
  });
});
