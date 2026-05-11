import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { Database, DomainMappingRow, ProjectRow, ServiceRow } from '../src/db/index.js';
import type { OpenLanderConfig } from '../src/config/index.js';
import { createDomainRoutes } from '../src/web/api/domain-routes.js';

function createProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'proj-1',
    name: 'demo-project',
    repo_url: null,
    branch: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: null,
    container_id: null,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    parent_project_id: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: null,
    image_url: null,
    image_cmd: null,
    container_port: null,
    pending_fix: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    deploy_lock_session: null,
    deploy_lock_at: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: null,
    health_check_path: null,
    server_id: 'local',
    recovering_started_at: null,
    ...overrides,
  };
}

function createServiceRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'svc-1',
    project_id: 'proj-1',
    name: 'demo-api',
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'production',
    assigned_port: 10001,
    container_id: 'container-1',
    container_name: 'ol-svc-demo-api',
    container_port: 3000,
    image_tag: 'demo-api:latest',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: null,
    build_method: 'dockerfile',
    source: 'git',
    repo_url: 'github.com/example/demo',
    branch: 'main',
    image_url: null,
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
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

function createDomainMapping(overrides: Partial<DomainMappingRow> = {}): DomainMappingRow {
  return {
    id: 'dom-1',
    service_id: 'svc-1',
    project_id: 'proj-1',
    domain: 'api.example.com',
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

type DomainRouteDb = {
  getProject: ReturnType<typeof vi.fn>;
  getProjectByName: ReturnType<typeof vi.fn>;
  getService: ReturnType<typeof vi.fn>;
  getDeployablesByGroup: ReturnType<typeof vi.fn>;
  listDomainMappingsForService: ReturnType<typeof vi.fn>;
  findDomainMappingByHostAndPath: ReturnType<typeof vi.fn>;
  createDomainMappingForService: ReturnType<typeof vi.fn>;
  deleteDomainMapping: ReturnType<typeof vi.fn>;
};

function createConfig(mode: 'managed' | 'external' = 'managed'): OpenLanderConfig {
  return { traefik: { mode } } as OpenLanderConfig;
}

function createDb(overrides: Partial<DomainRouteDb> = {}): DomainRouteDb {
  const project = createProjectRow();
  const service = createServiceRow({ project_id: project.id });
  const mappings = [createDomainMapping({ service_id: service.id, project_id: project.id })];

  return {
    getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
    getProjectByName: vi.fn(async (name: string) => (name === project.name ? project : undefined)),
    getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
    getDeployablesByGroup: vi.fn(async (projectId: string) =>
      projectId === project.id ? [service] : [],
    ),
    listDomainMappingsForService: vi.fn(async (serviceId: string) =>
      mappings.filter((mapping) => mapping.service_id === serviceId),
    ),
    findDomainMappingByHostAndPath: vi.fn(async () => undefined),
    createDomainMappingForService: vi.fn(async (input: { id: string; serviceId: string; domain: string; pathPrefix?: string; stripPrefix?: boolean; upstreamPathPrefix?: string | null; targetPort?: number | null; }) =>
      createDomainMapping({
        id: input.id,
        service_id: input.serviceId,
        domain: input.domain,
        path_prefix: input.pathPrefix ?? '/',
        strip_prefix: input.stripPrefix ?? false,
        upstream_path_prefix: input.upstreamPathPrefix ?? null,
        target_port: input.targetPort ?? null,
      }),
    ),
    deleteDomainMapping: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createApp(db: DomainRouteDb, config = createConfig()): Hono {
  const app = new Hono();
  app.route('/api', createDomainRoutes({ db: db as unknown as Database, config }));
  return app;
}

describe('createDomainRoutes', () => {
  it('lists service-scoped domain mappings from the database', async () => {
    const db = createDb();
    const response = await createApp(db).request('/api/projects/proj-1/services/svc-1/domains');

    expect(response.status).toBe(200);
    expect(db.listDomainMappingsForService).toHaveBeenCalledWith('svc-1');
    await expect(response.json()).resolves.toMatchObject({
      projectId: 'proj-1',
      serviceId: 'svc-1',
      count: 1,
      domains: [
        {
          id: 'dom-1',
          domain: 'api.example.com',
          pathPrefix: '/',
          stripPrefix: false,
          tls: { enabled: false, status: 'absent' },
        },
      ],
    });
  });

  it('creates service-scoped domain mappings without Cloudflare runtime calls', async () => {
    const db = createDb();
    const response = await createApp(db).request('/api/projects/proj-1/services/svc-1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'API.Example.COM.',
        pathPrefix: 'api/v1/',
        stripPrefix: true,
        upstreamPathPrefix: '/internal/',
        targetPort: 8080,
      }),
    });

    expect(response.status).toBe(201);
    expect(db.findDomainMappingByHostAndPath).toHaveBeenCalledWith('api.example.com', '/api/v1');
    expect(db.createDomainMappingForService).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'svc-1',
        domain: 'api.example.com',
        status: 'active',
        pathPrefix: '/api/v1',
        stripPrefix: true,
        upstreamPathPrefix: '/internal',
        targetPort: 8080,
        tlsEnabled: false,
        tlsResolver: null,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      status: 'mapped',
      projectId: 'proj-1',
      serviceId: 'svc-1',
      domain: { domain: 'api.example.com', pathPrefix: '/api/v1', targetPort: 8080 },
    });
  });

  it('rejects duplicate domain plus path mappings', async () => {
    const existing = createDomainMapping({ id: 'existing', path_prefix: '/api' });
    const db = createDb({ findDomainMappingByHostAndPath: vi.fn(async () => existing) });

    const response = await createApp(db).request('/api/projects/proj-1/services/svc-1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'api.example.com', pathPrefix: '/api' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'DOMAIN_ROUTE_EXISTS' });
    expect(db.createDomainMappingForService).not.toHaveBeenCalled();
  });

  it('rejects URL-shaped and wildcard domains', async () => {
    const db = createDb();
    const urlResponse = await createApp(db).request('/api/projects/proj-1/services/svc-1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'https://api.example.com/path' }),
    });
    const wildcardResponse = await createApp(db).request('/api/projects/proj-1/services/svc-1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: '*.example.com' }),
    });

    expect(urlResponse.status).toBe(400);
    expect(wildcardResponse.status).toBe(400);
    expect(db.createDomainMappingForService).not.toHaveBeenCalled();
  });

  it('blocks domain writes only when Traefik is explicitly external mode', async () => {
    const db = createDb();
    const response = await createApp(db, createConfig('external')).request(
      '/api/projects/proj-1/services/svc-1/domains',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'api.example.com' }),
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'DOMAIN_ROUTING_DISABLED' });
    expect(db.createDomainMappingForService).not.toHaveBeenCalled();
  });

  it('deletes service-scoped domain mappings by id', async () => {
    const db = createDb();
    const response = await createApp(db).request('/api/projects/proj-1/services/svc-1/domains/dom-1', {
      method: 'DELETE',
    });

    expect(response.status).toBe(200);
    expect(db.deleteDomainMapping).toHaveBeenCalledWith('dom-1');
    await expect(response.json()).resolves.toMatchObject({
      status: 'unmapped',
      domain: { id: 'dom-1', domain: 'api.example.com' },
      usedLegacyFallback: false,
    });
  });

  it('keeps legacy delete-by-domain fallback only for root path mappings', async () => {
    const root = createDomainMapping({ id: 'root', domain: 'api.example.com', path_prefix: '/' });
    const api = createDomainMapping({ id: 'api', domain: 'api.example.com', path_prefix: '/api' });
    const db = createDb({
      listDomainMappingsForService: vi.fn(async () => [api, root]),
    });

    const response = await createApp(db).request(
      '/api/projects/proj-1/services/svc-1/domains/api.example.com',
      { method: 'DELETE' },
    );

    expect(response.status).toBe(200);
    expect(db.deleteDomainMapping).toHaveBeenCalledWith('root');
    await expect(response.json()).resolves.toMatchObject({ usedLegacyFallback: true });
  });

  it('aggregates project-scoped domain reads across deployables', async () => {
    const services = [createServiceRow({ id: 'svc-1' }), createServiceRow({ id: 'svc-2', name: 'web' })];
    const db = createDb({
      getDeployablesByGroup: vi.fn(async () => services),
      listDomainMappingsForService: vi.fn(async (serviceId: string) => [
        createDomainMapping({ id: `${serviceId}-domain`, service_id: serviceId }),
      ]),
    });

    const response = await createApp(db).request('/api/projects/proj-1/domains');

    expect(response.status).toBe(200);
    expect(db.listDomainMappingsForService).toHaveBeenCalledWith('svc-1');
    expect(db.listDomainMappingsForService).toHaveBeenCalledWith('svc-2');
    await expect(response.json()).resolves.toMatchObject({ count: 2 });
  });

  it('keeps project-scoped write compatibility for single-deployable projects', async () => {
    const db = createDb();
    const response = await createApp(db).request('/api/projects/proj-1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'api.example.com' }),
    });

    expect(response.status).toBe(201);
    expect(db.createDomainMappingForService).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: 'svc-1', domain: 'api.example.com' }),
    );
  });

  it('requires service selection for project-scoped writes on multi-deployable projects', async () => {
    const db = createDb({
      getDeployablesByGroup: vi.fn(async () => [
        createServiceRow({ id: 'svc-1', name: 'api' }),
        createServiceRow({ id: 'svc-2', name: 'web' }),
      ]),
    });

    const response = await createApp(db).request('/api/projects/proj-1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'api.example.com' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'SERVICE_SELECTION_REQUIRED',
      details: { candidates: [{ serviceId: 'svc-1' }, { serviceId: 'svc-2' }] },
    });
    expect(db.createDomainMappingForService).not.toHaveBeenCalled();
  });
});
