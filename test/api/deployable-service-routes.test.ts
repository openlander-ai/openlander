import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type {
  DomainMappingRow,
  EnvironmentRow,
  ProjectRow,
  ServiceRow,
} from '../../src/db/types.js';
import { createDeployableServiceRoutes } from '../../src/web/api/deployable-service-routes.js';

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
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: '.',
    build_method: null,
    source: 'image',
    repo_url: null,
    branch: null,
    image_url: 'nginx:alpine',
    image_cmd: JSON.stringify(['nginx', '-g', 'daemon off;']),
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

function makeDomainMappingRow(overrides: Partial<DomainMappingRow> = {}): DomainMappingRow {
  return {
    id: 'domain-1',
    service_id: 'group-1__svc',
    domain: 'workspace.example.com',
    cloudflare_zone_id: null,
    cloudflare_dns_record_id: null,
    status: 'active',
    path_prefix: '/',
    strip_prefix: false,
    upstream_path_prefix: null,
    target_port: null,
    tls_enabled: false,
    tls_resolver: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createApp(ctx: Partial<AppContext>) {
  const app = new Hono();
  app.route('/api', createDeployableServiceRoutes(ctx as AppContext));
  return app;
}

describe('createDeployableServiceRoutes', () => {
  it('omits archived deployable services from a project group by default', async () => {
    const project = makeProjectRow();
    const archivedAt = '2026-01-02T00:00:00.000Z';
    const service = makeServiceRow({ archived_at: archivedAt });
    const env = makeEnvironmentRow();
    const db = {
      getProject: vi.fn(async () => project),
      getProjectByName: vi.fn(async () => undefined),
      getDeployablesByGroup: vi.fn(async () => [service]),
      getEnvironmentsByProject: vi.fn(async () => [env]),
    };
    const app = createApp({ db });

    const res = await app.request('/api/projects/group-1/services');

    expect(res.status).toBe(200);
    expect(db.getDeployablesByGroup).toHaveBeenCalledWith('group-1');
    await expect(res.json()).resolves.toMatchObject({
      count: 0,
      services: [],
    });
  });

  it('can include archived deployable services when explicitly requested', async () => {
    const project = makeProjectRow();
    const archivedAt = '2026-01-02T00:00:00.000Z';
    const service = makeServiceRow({ archived_at: archivedAt });
    const env = makeEnvironmentRow();
    const db = {
      getProject: vi.fn(async () => project),
      getProjectByName: vi.fn(async () => undefined),
      getDeployablesByGroup: vi.fn(async () => [service]),
      getEnvironmentsByProject: vi.fn(async () => [env]),
    };
    const app = createApp({ db });

    const res = await app.request('/api/projects/group-1/services?include_archived=true');

    expect(res.status).toBe(200);
    expect(db.getDeployablesByGroup).toHaveBeenCalledWith('group-1');
    await expect(res.json()).resolves.toMatchObject({
      count: 1,
      services: [
        {
          id: 'group-1__svc',
          name: 'group-1',
          source: 'image',
          archived_at: archivedAt,
          archivedAt,
          imageCmd: ['nginx', '-g', 'daemon off;'],
          deployedBranch: 'main',
        },
      ],
    });
  });

  it('hides compose child services from the Project-level services list', async () => {
    const previousPublicHost = process.env['OPENLANDER_PUBLIC_HOST'];
    const previousContainerized = process.env['OPENLANDER_CONTAINERIZED'];
    delete process.env['OPENLANDER_PUBLIC_HOST'];
    process.env['OPENLANDER_CONTAINERIZED'] = 'true';
    const project = makeProjectRow({ id: 'stack', name: 'demo-stack' });
    const composeChildren = [
      makeServiceRow({
        id: 'stack__web__svc',
        name: 'demo-stack/web__svc',
        project_id: 'stack',
        kind: 'compose-child',
        parent_service_id: 'stack__svc',
        assigned_port: 10006,
        image_url: 'ol-demo-stack-web:latest',
      }),
      makeServiceRow({
        id: 'stack__postgres__svc',
        name: 'demo-stack/postgres__svc',
        project_id: 'stack',
        kind: 'compose-child',
        parent_service_id: 'stack__svc',
        assigned_port: 10005,
        image_url: 'postgres:16-alpine',
      }),
    ];
    const getDeployablesByGroup = vi.fn(async () => composeChildren);
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup,
        getEnvironmentsByProject: vi.fn(async () => []),
      },
    });

    const res = await app.request('/api/projects/stack/services').finally(() => {
      if (previousPublicHost === undefined) {
        delete process.env['OPENLANDER_PUBLIC_HOST'];
      } else {
        process.env['OPENLANDER_PUBLIC_HOST'] = previousPublicHost;
      }
      if (previousContainerized === undefined) {
        delete process.env['OPENLANDER_CONTAINERIZED'];
      } else {
        process.env['OPENLANDER_CONTAINERIZED'] = previousContainerized;
      }
    });

    expect(res.status).toBe(200);
    expect(getDeployablesByGroup).toHaveBeenCalledWith('stack');
    await expect(res.json()).resolves.toMatchObject({
      count: 0,
      services: [],
    });
  });

  it('returns compose child roles, aggregate status, deploy state, and stored traffic target opt-in', async () => {
    const project = makeProjectRow({ id: 'stack', name: 'demo-stack' });
    const parent = makeServiceRow({
      id: 'stack__svc',
      project_id: 'stack',
      name: 'demo-stack__svc',
      kind: 'compose',
      build_method: 'compose',
      assigned_port: null,
    });
    const web = makeServiceRow({
      id: 'stack__web__svc',
      project_id: 'stack',
      name: 'demo-stack/web',
      kind: 'compose-child',
      parent_service_id: parent.id,
      runtime_role: 'application',
      assigned_port: 10006,
    });
    const db = makeServiceRow({
      id: 'stack__db__svc',
      project_id: 'stack',
      name: 'demo-stack/db',
      kind: 'compose-child',
      parent_service_id: parent.id,
      runtime_role: 'resource',
      assigned_port: null,
      container_port: 5432,
      image_url: 'postgres:16',
      health_check_strategy: null,
    });
    const migrate = makeServiceRow({
      id: 'stack__migrate__svc',
      project_id: 'stack',
      name: 'demo-stack/migrate',
      kind: 'compose-child',
      parent_service_id: parent.id,
      runtime_role: 'job',
      status: 'stopped',
      assigned_port: null,
      container_port: null,
    });
    const lastDeploys = new Map([
      [
        migrate.id,
        {
          id: 'deploy-migrate',
          service_id: migrate.id,
          status: 'success',
          created_at: '2026-01-02T00:00:00.000Z',
        },
      ],
    ]);
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => [parent, web, db, migrate]),
        getEnvironmentsByProject: vi.fn(async () => []),
        getLastDeployLogsForServices: vi.fn(async () => lastDeploys),
        loadDeployConfigForService: vi.fn(async () => ({
          config_json: JSON.stringify({
            version: 2,
            snapshot: { trafficService: 'web' },
            savedAt: '2026-01-02T00:00:00.000Z',
          }),
        })),
      },
    });

    const res = await app.request('/api/projects/stack/services?include_compose_children=true');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      count: 4,
      aggregate_status: 'running',
      services: expect.arrayContaining([
        expect.objectContaining({
          id: web.id,
          runtime_role: 'application',
          lifecycle: 'long_running',
          health_strategy: 'http',
          is_traffic_target: true,
        }),
        expect.objectContaining({
          id: db.id,
          runtime_role: 'resource',
          health_strategy: 'tcp',
          is_traffic_target: false,
        }),
        expect.objectContaining({
          id: migrate.id,
          lifecycle: 'one_shot',
          health_strategy: 'exit_code',
          last_deploy: {
            status: 'success',
            created_at: '2026-01-02T00:00:00.000Z',
          },
        }),
      ]),
    });
  });

  it('synthesizes advertised-host URLs for Project-level Compose resources', async () => {
    const previousPublicHost = process.env['OPENLANDER_PUBLIC_HOST'];
    const previousContainerized = process.env['OPENLANDER_CONTAINERIZED'];
    process.env['OPENLANDER_PUBLIC_HOST'] = '192.168.219.113';
    process.env['OPENLANDER_CONTAINERIZED'] = 'true';
    const project = makeProjectRow({ id: 'hotdeal', name: 'hotdeal' });
    const composeService = makeServiceRow({
      id: 'hotdeal__svc',
      name: 'hotdeal__svc',
      project_id: 'hotdeal',
      kind: 'compose',
      build_method: 'compose',
      assigned_port: 20032,
      image_url: 'hotdeal:latest',
    });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => [composeService]),
        getEnvironmentsByProject: vi.fn(async () => []),
        listDomainMappings: vi.fn(async () => []),
      },
    });

    const res = await app.request('/api/projects/hotdeal/services').finally(() => {
      if (previousPublicHost === undefined) {
        delete process.env['OPENLANDER_PUBLIC_HOST'];
      } else {
        process.env['OPENLANDER_PUBLIC_HOST'] = previousPublicHost;
      }
      if (previousContainerized === undefined) {
        delete process.env['OPENLANDER_CONTAINERIZED'];
      } else {
        process.env['OPENLANDER_CONTAINERIZED'] = previousContainerized;
      }
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      count: 1,
      services: [
        {
          id: composeService.id,
          name: 'hotdeal',
          url: 'http://hotdeal.192.168.219.113.sslip.io',
          preferred_url: 'http://hotdeal.192.168.219.113.sslip.io',
          urls: [
            {
              url: 'http://hotdeal.192.168.219.113.sslip.io',
              type: 'public',
              host: '192.168.219.113',
              reachable: 'external',
            },
          ],
        },
      ],
    });
  });

  it('uses service-scoped domain mappings for deployable service URLs', async () => {
    const previousPublicHost = process.env['OPENLANDER_PUBLIC_HOST'];
    const previousContainerized = process.env['OPENLANDER_CONTAINERIZED'];
    process.env['OPENLANDER_PUBLIC_HOST'] = '192.168.219.113';
    process.env['OPENLANDER_CONTAINERIZED'] = 'true';
    const project = makeProjectRow({ id: 'hotdeal', name: 'hotdeal' });
    const composeService = makeServiceRow({
      id: 'hotdeal__svc',
      name: 'hotdeal__svc',
      project_id: 'hotdeal',
      kind: 'compose',
      build_method: 'compose',
      assigned_port: 20032,
      image_url: 'hotdeal:latest',
    });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => [composeService]),
        getEnvironmentsByProject: vi.fn(async () => []),
        listDomainMappings: vi.fn(async () => [
          makeDomainMappingRow({
            service_id: composeService.id,
            domain: 'hotdeal.loancalc.kr',
          }),
        ]),
      },
    });

    const res = await app.request('/api/projects/hotdeal/services').finally(() => {
      if (previousPublicHost === undefined) {
        delete process.env['OPENLANDER_PUBLIC_HOST'];
      } else {
        process.env['OPENLANDER_PUBLIC_HOST'] = previousPublicHost;
      }
      if (previousContainerized === undefined) {
        delete process.env['OPENLANDER_CONTAINERIZED'];
      } else {
        process.env['OPENLANDER_CONTAINERIZED'] = previousContainerized;
      }
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      count: 1,
      services: [
        {
          id: composeService.id,
          name: 'hotdeal',
          url: 'http://hotdeal.loancalc.kr',
          preferred_url: 'http://hotdeal.loancalc.kr',
          urls: [
            {
              url: 'http://hotdeal.loancalc.kr',
              type: 'public',
              host: 'hotdeal.loancalc.kr',
              reachable: 'external',
            },
          ],
        },
      ],
    });
  });

  it('preserves PROJECT_NOT_FOUND shape on service list project misses', async () => {
    const app = createApp({
      db: {
        getProject: vi.fn(async () => undefined),
        getProjectByName: vi.fn(async () => undefined),
      },
    });

    const res = await app.request('/api/projects/missing/services');

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: 'PROJECT_NOT_FOUND',
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found: missing',
      details: { identifier: 'missing' },
    });
  });

  it('returns service detail with service-scoped env vars and recent deploys', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const env = makeEnvironmentRow();
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
        getEnvironmentsByProject: vi.fn(async () => [env]),
        getDeployLogs: vi.fn(async () => [{ id: 'deploy-1', commit_message: 'Ship it' }]),
        getServices: vi.fn(async () => [service]),
        getDeployableForProject: vi.fn(async () => {
          throw new Error('getDeployableForProject must not be called by service detail');
        }),
      },
      env: {
        getAllForService: vi.fn(async () => [{ key: 'DATABASE_URL', value: 'postgres://db' }]),
        getAll: vi.fn(async () => []),
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      id: 'group-1',
      service: {
        id: 'group-1__svc',
        name: 'group-1',
        deployedBranch: 'main',
      },
      envVars: [{ key: 'DATABASE_URL', value: 'postgres://db' }],
      recentDeploys: [{ id: 'deploy-1', commitMessage: 'Ship it' }],
    });
  });

  it('updates service source/build fields', async () => {
    const project = makeProjectRow();
    const original = makeServiceRow();
    const updated = makeServiceRow({
      source: 'git',
      repo_url: 'github.com/openlander-ai/demo',
      branch: 'develop',
      image_url: null,
      image_cmd: JSON.stringify(['npm', 'start']),
      container_port: 8080,
    });
    const updateService = vi.fn(async () => undefined);
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async (id: string) => {
          if (id !== original.id) return undefined;
          return updateService.mock.calls.length === 0 ? original : updated;
        }),
        updateService,
        getEnvironmentsByProject: vi.fn(async () => []),
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'git',
        repoUrl: 'github.com/openlander-ai/demo',
        branch: 'develop',
        imageUrl: null,
        imageCmd: ['npm', 'start'],
        containerPort: '8080',
      }),
    });

    expect(res.status).toBe(200);
    expect(updateService).toHaveBeenCalledWith(
      'group-1__svc',
      expect.objectContaining({
        source: 'git',
        repoUrl: 'github.com/openlander-ai/demo',
        branch: 'develop',
        imageUrl: null,
        imageCmd: JSON.stringify(['npm', 'start']),
        containerPort: 8080,
      }),
    );
    await expect(res.json()).resolves.toMatchObject({
      service: {
        id: 'group-1__svc',
        source: 'git',
        repoUrl: 'github.com/openlander-ai/demo',
        branch: 'develop',
        containerPort: 8080,
      },
    });
  });

  it('rejects invalid PATCH fields before updating the service', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const updateService = vi.fn(async () => undefined);
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
        updateService,
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ containerPort: 70000 }),
    });

    expect(res.status).toBe(400);
    expect(updateService).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      error: 'INVALID_FIELD',
      message: 'containerPort must be between 1 and 65535',
    });
  });

  it('does not allow a service from another project group', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ project_id: 'other-group' });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'main' }),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: 'NOT_FOUND',
      message: 'Service not found: group-1__svc',
    });
  });

  it('rejects service detail when the service belongs to another project group', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ project_id: 'other-group' });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getService: vi.fn(async () => service),
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc');

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: 'NOT_FOUND',
      message: 'Service not found: group-1__svc',
    });
  });
});
