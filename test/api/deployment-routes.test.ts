import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { DeployLogRow, ProjectRow, ServiceRow } from '../../src/db/types.js';
import { createDeploymentRoutes } from '../../src/web/api/deployment-routes.js';

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
    kind: 'image',
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
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: 'image',
    repo_url: null,
    branch: null,
    image_url: 'nginx:alpine',
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

function makeDeployLog(overrides: Partial<DeployLogRow> = {}): DeployLogRow {
  return {
    id: 'deploy-1',
    service_id: 'group-1__svc',
    environment_id: null,
    status: 'success',
    trigger: 'api',
    trigger_detail: null,
    commit_sha: 'abcdef123456',
    commit_message: 'Ship it',
    build_log: 'build ok',
    runtime_log: null,
    duration_ms: 1234,
    created_at: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

function createApp(ctx: Partial<AppContext>) {
  const app = new Hono();
  app.route('/api', createDeploymentRoutes(ctx as AppContext));
  return app;
}

describe('createDeploymentRoutes', () => {
  it('lists project deployment summaries with failure summaries', async () => {
    const project = makeProjectRow();
    const getDeployLogs = vi.fn(async () => [
      makeDeployLog({
        id: 'failed-1',
        status: 'failed',
        build_log: 'step 1\nError: package install failed\nlast line',
        commit_message: null,
      }),
    ]);
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployLogs,
      },
    });

    const res = await app.request('/api/projects/group-1/deployments?limit=25&environmentId=env-1');

    expect(res.status).toBe(200);
    expect(getDeployLogs).toHaveBeenCalledWith('group-1', 25, 'env-1');
    await expect(res.json()).resolves.toMatchObject({
      count: 1,
      deployments: [
        {
          id: 'failed-1',
          status: 'failed',
          trigger: 'api',
          commitMessage: null,
          createdAt: '2026-01-02T03:04:05.000Z',
          failureSummary: 'Error: package install failed',
        },
      ],
    });
  });

  it('prepends an in-flight deployment when the project deployable is building', async () => {
    const project = makeProjectRow({ status: 'building' });
    const service = makeServiceRow({
      status: 'building' as ServiceRow['status'],
      updated_at: '2026-01-03T04:05:06.000Z',
    });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployLogs: vi.fn(async () => [makeDeployLog({ id: 'previous-deploy' })]),
        getDeployableForProject: vi.fn(async () => service),
      },
    });

    const res = await app.request('/api/projects/group-1/deployments');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      count: 2,
      deployments: [
        {
          id: 'group-1__svc',
          status: 'building',
          trigger: 'api',
          triggerDetail: 'deploy',
          commitSha: null,
          durationMs: null,
          isInProgress: true,
        },
        { id: 'previous-deploy' },
      ],
    });
  });

  it('returns deployment detail using canonical service ownership', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const log = makeDeployLog({ id: 'deploy-1', service_id: service.id, runtime_log: 'running' });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployLog: vi.fn(async () => log),
        getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
      },
    });

    const res = await app.request('/api/projects/group-1/deployments/deploy-1');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      id: 'deploy-1',
      projectId: 'group-1',
      buildLog: 'build ok',
      runtimeLog: 'running',
    });
  });

  it('rejects deployment details owned by another project group', async () => {
    const project = makeProjectRow();
    const otherService = makeServiceRow({ id: 'other-1__svc', project_id: 'other-1' });
    const log = makeDeployLog({ id: 'deploy-other', service_id: otherService.id });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployLog: vi.fn(async () => log),
        getService: vi.fn(async (id: string) =>
          id === otherService.id ? otherService : undefined,
        ),
      },
    });

    const res = await app.request('/api/projects/group-1/deployments/deploy-other');

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: 'NOT_FOUND',
      message: 'Deployment not found',
    });
  });

  it('lists service deployment history after resolving service aliases', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const getDeployLogs = vi.fn(async () => [makeDeployLog({ id: 'deploy-service' })]);
    const getService = vi.fn(async (id: string) => (id === service.id ? service : undefined));
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService,
        getDeployLogs,
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1/deployments?limit=7');

    expect(res.status).toBe(200);
    expect(getService).toHaveBeenNthCalledWith(1, 'group-1');
    expect(getService).toHaveBeenNthCalledWith(2, 'group-1__svc');
    expect(getDeployLogs).toHaveBeenCalledWith('group-1__svc', 7, undefined);
    await expect(res.json()).resolves.toMatchObject({
      count: 1,
      deployments: [{ id: 'deploy-service', commitMessage: 'Ship it' }],
    });
  });

  it('prepends an in-flight service deployment while redeploy is running', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({
      status: 'building' as ServiceRow['status'],
      updated_at: '2026-01-03T04:05:06.000Z',
    });
    const getDeployLogs = vi.fn(async () => []);
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
        getDeployLogs,
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/deployments');

    expect(res.status).toBe(200);
    expect(getDeployLogs).toHaveBeenCalledWith('group-1__svc', 50, undefined);
    await expect(res.json()).resolves.toMatchObject({
      count: 1,
      deployments: [
        {
          id: 'group-1__svc',
          status: 'building',
          isInProgress: true,
          createdAt: '2026-01-03T04:05:06.000Z',
        },
      ],
    });
  });

  it('rejects service deployment history for cross-project services', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ project_id: 'other-group' });
    const getDeployLogs = vi.fn(async () => [makeDeployLog()]);
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
        getDeployLogs,
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/deployments');

    expect(res.status).toBe(404);
    expect(getDeployLogs).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      error: 'NOT_FOUND',
      message: 'Service not found: group-1__svc',
    });
  });

  it('lists recent deployments and drops stale service/project rows', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const rows = [
      makeDeployLog({ id: 'keep', service_id: service.id }),
      makeDeployLog({ id: 'drop-service', service_id: 'missing-service' }),
      makeDeployLog({ id: 'drop-project', service_id: 'orphan-service' }),
    ];
    const app = createApp({
      db: {
        listRecentDeployLogsAcrossProjects: vi.fn(async () => rows),
        getService: vi.fn(async (id: string) => {
          if (id === service.id) return service;
          if (id === 'orphan-service') return makeServiceRow({ id, project_id: 'missing-project' });
          return undefined;
        }),
        getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
      },
    });

    const res = await app.request('/api/deployments/recent?limit=999');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      count: 1,
      deployments: [
        {
          id: 'keep',
          projectId: 'group-1',
          projectName: 'workspace',
          serviceId: 'group-1__svc',
          serviceName: 'group-1__svc',
        },
      ],
    });
  });
});
