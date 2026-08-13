import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { DomainMappingRow, ProjectRow, ServiceRow } from '../../src/db/types.js';
import { createServiceAuxRoutes } from '../../src/web/api/service-aux-routes.js';

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

function createApp(ctx: Partial<AppContext>, authKind: 'session' | 'api_token' = 'session') {
  const app = new Hono<{ Variables: { authKind: 'session' | 'api_token' } }>();
  app.use('*', async (c, next) => {
    c.set('authKind', authKind);
    await next();
  });
  app.route('/api', createServiceAuxRoutes(ctx as AppContext));
  return app;
}

const dockerStats = {
  cpu_stats: {
    cpu_usage: { total_usage: 300, percpu_usage: [0, 0] },
    system_cpu_usage: 1000,
    online_cpus: 2,
  },
  precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 500 },
  memory_stats: { usage: 64 * 1024 * 1024, limit: 256 * 1024 * 1024 },
};

describe('createServiceAuxRoutes', () => {
  it('returns service stats using the deployable service container', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow();
    const docker = { getContainerStats: vi.fn(async () => dockerStats) };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployableForProject: vi.fn(async () => service),
      },
      docker,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/stats');

    expect(res.status).toBe(200);
    expect(docker.getContainerStats).toHaveBeenCalledWith('container-1');
    await expect(res.json()).resolves.toMatchObject({
      cpu: 80,
      memory: 67108864,
      memoryLimit: 268435456,
      status: 'running',
    });
  });

  it('returns zeroed stats when the selected service is not running', async () => {
    const project = makeProjectRow();
    const service = makeServiceRow({ status: 'stopped', container_id: 'container-1' });
    const docker = { getContainerStats: vi.fn(async () => dockerStats) };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployableForProject: vi.fn(async () => service),
      },
      docker,
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/stats');

    expect(res.status).toBe(200);
    expect(docker.getContainerStats).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      cpu: 0,
      memory: 0,
      memoryLimit: 0,
      status: 'stopped',
    });
  });

  it('publishes and unpublishes the exact service through protected sharing', async () => {
    const project = makeProjectRow();
    const requestPublicAccess = vi.fn().mockResolvedValue({
      project_id: project.id,
      service_id: 'group-1__svc',
      status: 'public',
      public_url: 'https://workspace.example.com',
    });
    const requestPrivateAccess = vi.fn().mockResolvedValue({
      project_id: project.id,
      service_id: 'group-1__svc',
      status: 'private',
      public_url: null,
    });
    const publicShare = {
      expose: requestPublicAccess,
      unexpose: requestPrivateAccess,
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
      },
      publicShare,
    });

    const expose = await app.request('/api/projects/group-1/services/group-1__svc/expose', {
      method: 'POST',
    });
    const unexpose = await app.request('/api/projects/group-1/services/group-1__svc/unexpose', {
      method: 'POST',
    });

    expect(expose.status).toBe(200);
    expect(requestPublicAccess).toHaveBeenCalledWith({
      projectId: 'group-1',
      serviceId: 'group-1__svc',
      rotateAccessCode: false,
    });
    await expect(expose.json()).resolves.toMatchObject({
      status: 'public',
      status_call: {
        path: '/api/projects/group-1/services/group-1__svc/public-access',
      },
    });
    expect(unexpose.status).toBe(200);
    expect(requestPrivateAccess).toHaveBeenCalledWith({
      projectId: 'group-1',
      serviceId: 'group-1__svc',
    });
  });

  it('reveals a protected-share code only to a signed-in web session', async () => {
    const project = makeProjectRow();
    const revealAccessCode = vi.fn().mockResolvedValue({
      project_id: project.id,
      service_id: 'group-1__svc',
      provider: 'protected_share',
      status: 'public',
      public_url: 'https://workspace.example.com',
      hostname: 'workspace.example.com',
      access_code_configured: true,
      access_code: 'ABCD-EFGH',
      error: null,
    });
    const context = {
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
      },
      publicShare: { revealAccessCode },
    } satisfies Partial<AppContext>;

    const sessionResponse = await createApp(context).request(
      '/api/projects/group-1/services/group-1__svc/public-access/code/reveal',
      { method: 'POST' },
    );

    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.headers.get('cache-control')).toBe('no-store');
    await expect(sessionResponse.json()).resolves.toMatchObject({ access_code: 'ABCD-EFGH' });
    expect(revealAccessCode).toHaveBeenCalledWith({
      projectId: 'group-1',
      serviceId: 'group-1__svc',
    });

    revealAccessCode.mockClear();
    const apiTokenResponse = await createApp(context, 'api_token').request(
      '/api/projects/group-1/services/group-1__svc/public-access/code/reveal',
      { method: 'POST' },
    );
    expect(apiTokenResponse.status).toBe(403);
    await expect(apiTokenResponse.json()).resolves.toMatchObject({
      code: 'WEB_SESSION_REQUIRED',
    });
    expect(revealAccessCode).not.toHaveBeenCalled();
  });

  it('keeps Cloudflare Tunnel available as an explicit service sharing method', async () => {
    const project = makeProjectRow();
    const getPublicAccess = vi.fn().mockResolvedValue({
      project_id: project.id,
      service_id: 'group-1__svc',
      status: 'public',
      public_url: 'https://workspace.example.com',
      hostname: 'workspace.example.com',
      error: null,
    });
    const requestPublicAccess = vi.fn().mockResolvedValue({
      project_id: project.id,
      service_id: 'group-1__svc',
      status: 'provisioning',
      public_url: null,
      hostname: 'workspace.example.com',
      error: null,
    });
    const requestPrivateAccess = vi.fn().mockResolvedValue({
      project_id: project.id,
      service_id: 'group-1__svc',
      status: 'unpublishing',
      public_url: null,
      hostname: 'workspace.example.com',
      error: null,
    });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
      },
      cloudflare: { getPublicAccess, requestPublicAccess, requestPrivateAccess },
    });

    const status = await app.request(
      '/api/projects/group-1/services/group-1__svc/public-access?provider=cloudflare',
    );
    const expose = await app.request('/api/projects/group-1/services/group-1__svc/expose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'cloudflare' }),
    });
    const unexpose = await app.request('/api/projects/group-1/services/group-1__svc/unexpose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'cloudflare' }),
    });

    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      provider: 'cloudflare',
      status: 'public',
    });
    expect(expose.status).toBe(202);
    expect(requestPublicAccess).toHaveBeenCalledWith({
      projectId: 'group-1',
      serviceId: 'group-1__svc',
    });
    await expect(expose.json()).resolves.toMatchObject({
      provider: 'cloudflare',
      status: 'provisioning',
      status_call: {
        path: '/api/projects/group-1/services/group-1__svc/public-access?provider=cloudflare',
      },
    });
    expect(unexpose.status).toBe(202);
    expect(requestPrivateAccess).toHaveBeenCalledWith('group-1');
  });

  it('does not use the removed quick-tunnel pipeline for service aliases', async () => {
    const project = makeProjectRow();
    const requestPublicAccess = vi.fn().mockResolvedValue({
      project_id: project.id,
      service_id: 'group-1__svc',
      status: 'public',
      public_url: 'https://workspace.example.com',
    });
    const exposeTunnel = vi.fn();
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
      },
      publicShare: { expose: requestPublicAccess },
      pipeline: { exposeTunnel },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/expose', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(requestPublicAccess).toHaveBeenCalledOnce();
    expect(exposeTunnel).not.toHaveBeenCalled();
  });

  it('returns disabled responses for service webhook aliases', async () => {
    const app = createApp({});

    const get = await app.request('/api/projects/group-1/services/group-1__svc/webhooks');
    const post = await app.request('/api/projects/group-1/services/group-1__svc/webhooks', {
      method: 'POST',
    });

    expect(get.status).toBe(410);
    expect(post.status).toBe(410);
    await expect(get.json()).resolves.toMatchObject({ code: 'FEATURE_DISABLED' });
  });

  it('lists preview projects with deployable runtime status and normalized timestamps', async () => {
    const project = makeProjectRow();
    const preview = makeProjectRow({
      id: 'preview-1',
      name: 'workspace-pr-7',
      status: 'stopped',
      pr_number: 7,
      public_url: 'https://old.example.com',
      created_at: 1704067200000,
      updated_at: new Date('2026-01-02T00:00:00.000Z'),
    } as Partial<ProjectRow>);
    const previewService = makeServiceRow({
      id: 'preview-1__svc',
      project_id: 'group-1',
      status: 'running',
      public_url: 'https://preview.example.com',
    });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getPreviewProjects: vi.fn(async () => [preview]),
        getServices: vi.fn(async ({ ids }: { ids?: readonly string[] } = {}) =>
          ids?.includes(previewService.id) ? [previewService] : [],
        ),
        getDeployableForProject: vi.fn(async (id: string) =>
          id === preview.id ? previewService : undefined,
        ),
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/previews');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      previews: [
        {
          id: 'preview-1',
          name: 'workspace-pr-7',
          status: 'running',
          prNumber: 7,
          publicUrl: 'https://preview.example.com',
          createdAt: '1704067200000',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
  });

  it('returns service topology with legacy canonical response shape', async () => {
    const project = makeProjectRow({ assigned_port: null });
    const service = makeServiceRow({ assigned_port: 10001 });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getComposeChildProjects: vi.fn(async () => []),
        getChildProjects: vi.fn(async () => []),
        findDependenciesByProject: vi.fn(async () => []),
        getDeployableForProject: vi.fn(async () => service),
        getLatestServiceMetric: vi.fn(async () => ({
          cpu: 12.34,
          mem: 45.6,
          recorded_at: Date.now(),
        })),
      },
      docker: {
        inspectContainer: vi.fn(async () => ({ State: { Health: { Status: 'healthy' } } })),
      },
    });

    const res = await app.request('/api/projects/group-1/services/group-1__svc/topology');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      services: [
        {
          id: 'group-1',
          name: 'workspace',
          kind: 'Application',
          health: 'healthy',
          port: 10001,
          cpu: '12.3%',
          mem: '46 MB',
          dependsOn: [],
        },
      ],
    });
  });

  it('returns connected managed services and dependencies in service topology', async () => {
    const project = makeProjectRow({ id: 'pgredis-fix2', name: 'pgredis-fix2' });
    const appService = makeServiceRow({
      id: 'pgredis-fix2__svc',
      project_id: project.id,
      name: 'pgredis-fix2__svc',
      kind: 'git',
      image_url: 'nginx:alpine',
    });
    const postgres = makeServiceRow({
      id: 'svc-pg',
      project_id: project.id,
      name: 'pgredis-fix2-postgres',
      kind: 'postgres',
      assigned_port: 5432,
      container_id: null,
      image_url: 'postgres:17-alpine',
      source: 'image',
    });
    const redis = makeServiceRow({
      id: 'svc-redis',
      project_id: project.id,
      name: 'pgredis-fix2-redis',
      kind: 'redis',
      assigned_port: 6379,
      container_id: null,
      image_url: 'redis:8-alpine',
      source: 'image',
    });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => [appService]),
        listServiceConnectionsByProject: vi.fn(async () => [
          {
            service_id_consumer: 'pgredis-fix2__svc',
            service_id_provider: 'svc-pg',
          },
          {
            service_id_consumer: 'pgredis-fix2__svc',
            service_id_provider: 'svc-redis',
          },
        ]),
        listServices: vi.fn(async () => [appService, postgres, redis]),
        findDependenciesByProject: vi.fn(async () => [
          {
            source_service_id: 'pgredis-fix2__svc',
            target_service_id: 'svc-pg',
          },
          {
            source_service_id: 'pgredis-fix2__svc',
            target_service_id: 'svc-redis',
          },
        ]),
        getLatestServiceMetric: vi.fn(async () => null),
      },
      docker: {
        inspectContainer: vi.fn(async () => ({ State: { Health: { Status: 'healthy' } } })),
      },
    });

    const res = await app.request('/api/projects/pgredis-fix2/services/pgredis-fix2__svc/topology');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      services: [
        {
          id: 'pgredis-fix2__svc',
          name: 'pgredis-fix2',
          kind: 'Application',
          dependsOn: ['svc-pg', 'svc-redis'],
        },
        {
          id: 'svc-pg',
          name: 'pgredis-fix2-postgres',
          kind: 'Database',
          source: 'managed',
        },
        {
          id: 'svc-redis',
          name: 'pgredis-fix2-redis',
          kind: 'Database',
          source: 'managed',
        },
      ],
    });
  });

  it('uses service domain mappings instead of service-name sslip hosts in service topology', async () => {
    const previousPublicHost = process.env['OPENLANDER_PUBLIC_HOST'];
    const previousContainerized = process.env['OPENLANDER_CONTAINERIZED'];
    process.env['OPENLANDER_PUBLIC_HOST'] = '192.168.219.113';
    process.env['OPENLANDER_CONTAINERIZED'] = 'true';
    const project = makeProjectRow({ id: 'hotdeal', name: 'hotdeal' });
    const webService = makeServiceRow({
      id: 'hotdeal__web__svc',
      project_id: project.id,
      name: 'hotdeal/web__svc',
      kind: 'compose-child',
      parent_service_id: 'hotdeal__svc',
      assigned_port: 20032,
      container_id: null,
      image_url: 'hotdeal-web:latest',
    });
    const app = createApp({
      db: {
        getProject: vi.fn(async () => project),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => [webService]),
        listDomainMappings: vi.fn(async () => [
          makeDomainMappingRow({
            service_id: webService.id,
            domain: 'hotdeal.loancalc.kr',
          }),
        ]),
        listServiceConnectionsByProject: vi.fn(async () => []),
        findDependenciesByProject: vi.fn(async () => []),
        getLatestServiceMetric: vi.fn(async () => null),
      },
      docker: {
        inspectContainer: vi.fn(async () => ({ State: { Health: { Status: 'healthy' } } })),
      },
    });

    const res = await app
      .request('/api/projects/hotdeal/services/hotdeal__web__svc/topology')
      .finally(() => {
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
      services: [
        {
          id: webService.id,
          name: 'hotdeal/web',
          url: 'http://hotdeal.loancalc.kr',
        },
      ],
    });
  });
});
