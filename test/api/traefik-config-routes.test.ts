import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { AppContext } from '../../src/app.js';
import type { DomainMappingRow, ProjectRow, ServiceRow } from '../../src/db/types.js';
import { createApiRoutes } from '../../src/web/api/routes.js';

interface TraefikConfigResponse {
  http: {
    routers: Record<
      string,
      { rule: string; entryPoints: string[]; service: string; middlewares?: string[] }
    >;
    services: Record<string, { loadBalancer: { servers: Array<{ url: string }> } }>;
    middlewares: Record<
      string,
      { stripPrefix?: { prefixes: string[] }; addPrefix?: { prefix: string } }
    >;
  };
}

const NOW = '2026-05-11T00:00:00.000Z';

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'stack',
    name: 'stack',
    display_name: 'stack',
    description: null,
    tags: null,
    archived_at: null,
    created_at: NOW,
    updated_at: NOW,
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 8080,
    container_id: 'container-stack',
    container_port: 8080,
    public_url: null,
    ...overrides,
  };
}

function makeService(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'stack__svc',
    project_id: 'stack',
    name: 'stack__svc',
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 8080,
    container_id: 'container-stack',
    container_name: null,
    container_port: 8080,
    image_tag: 'stack:latest',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: null,
    build_method: 'dockerfile',
    source: 'git',
    repo_url: 'https://github.com/example/stack',
    branch: 'main',
    image_url: null,
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: null,
    health_check_path: null,
    recovering_started_at: null,
    credentials: null,
    created_at: NOW,
    updated_at: NOW,
    archived_at: null,
    server_id: 'local',
    ...overrides,
  };
}

function makeMapping(overrides: Partial<DomainMappingRow> = {}): DomainMappingRow {
  return {
    id: 'dm-api',
    service_id: 'stack-api__svc',
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
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function createTraefikConfigApp(params: {
  projects: ProjectRow[];
  services: ServiceRow[];
  mappings: DomainMappingRow[];
}): { app: Hono; db: { getService: ReturnType<typeof vi.fn>; getProject: ReturnType<typeof vi.fn> } } {
  const projectsById = new Map(params.projects.map((project) => [project.id, project]));
  const servicesById = new Map(params.services.map((service) => [service.id, service]));

  const db = {
    listProjects: vi.fn(async () => params.projects),
    getDeployableForProject: vi.fn(async (projectId: string) =>
      servicesById.get(`${projectId}__svc`),
    ),
    listServices: vi.fn(async () => params.services),
    listDomainMappings: vi.fn(async () => params.mappings),
    getService: vi.fn(async (serviceId: string) => servicesById.get(serviceId)),
    getProject: vi.fn(async (projectId: string) => projectsById.get(projectId)),
    releaseDeployLock: vi.fn(async () => undefined),
  };

  const app = new Hono();
  app.route('/api', createApiRoutes({ db } as unknown as AppContext));
  return { app, db };
}

async function requestTraefikConfig(app: Hono): Promise<TraefikConfigResponse> {
  const res = await app.request('/api/traefik/config');
  expect(res.status).toBe(200);
  return (await res.json()) as TraefikConfigResponse;
}

function findRouterForDomain(config: TraefikConfigResponse, domain: string) {
  return Object.values(config.http.routers).find((router) =>
    router.rule.includes(`Host(\`${domain}\`)`),
  );
}

describe('GET /api/traefik/config domain routing', () => {
  it('routes custom domains through mapping.service_id, not the parent project container', async () => {
    const project = makeProject();
    const defaultService = makeService();
    const apiService = makeService({
      id: 'stack-api__svc',
      project_id: 'stack',
      name: 'stack/api__svc',
      kind: 'compose-child',
      parent_service_id: 'stack__svc',
      assigned_port: 18080,
      container_port: 3000,
      container_id: 'container-stack-api',
      container_name: 'ol-stack-api',
    });
    const mapping = makeMapping({ project_id: 'wrong-parent' });
    const { app, db } = createTraefikConfigApp({
      projects: [project],
      services: [defaultService, apiService],
      mappings: [mapping],
    });

    const config = await requestTraefikConfig(app);
    const router = findRouterForDomain(config, 'api.example.com');

    expect(router).toBeDefined();
    expect(router?.service).not.toBe('svc-stack');
    expect(config.http.services[router!.service]?.loadBalancer.servers[0]?.url).toBe(
      'http://ol-stack-api:3000',
    );
    expect(db.getService).not.toHaveBeenCalled();
    expect(db.getProject).not.toHaveBeenCalled();
  });

  it('does not depend on deprecated domain_mappings.project_id for custom routes', async () => {
    const project = makeProject();
    const defaultService = makeService();
    const apiService = makeService({
      id: 'stack-api__svc',
      project_id: 'stack',
      name: 'stack/api__svc',
      kind: 'compose-child',
      parent_service_id: 'stack__svc',
      assigned_port: 18080,
      container_port: 3000,
      container_id: 'container-stack-api',
      container_name: 'ol-stack-api',
    });
    const mapping = makeMapping({ project_id: undefined });
    const { app, db } = createTraefikConfigApp({
      projects: [project],
      services: [defaultService, apiService],
      mappings: [mapping],
    });

    const config = await requestTraefikConfig(app);
    const router = findRouterForDomain(config, 'api.example.com');

    expect(router).toBeDefined();
    expect(config.http.services[router!.service]?.loadBalancer.servers[0]?.url).toBe(
      'http://ol-stack-api:3000',
    );
    expect(db.getService).not.toHaveBeenCalled();
    expect(db.getProject).not.toHaveBeenCalled();
  });

  it('keeps custom-domain routes alive while the mapped service is building with a container', async () => {
    const project = makeProject();
    const defaultService = makeService();
    const apiService = makeService({
      id: 'stack-api__svc',
      project_id: 'stack',
      name: 'stack/api__svc',
      kind: 'compose-child',
      parent_service_id: 'stack__svc',
      status: 'building',
      assigned_port: 18080,
      container_port: 3000,
      container_id: 'container-stack-api',
      container_name: 'ol-stack-api',
    });
    const app = createTraefikConfigApp({
      projects: [project],
      services: [defaultService, apiService],
      mappings: [makeMapping()],
    }).app;

    const config = await requestTraefikConfig(app);
    const router = findRouterForDomain(config, 'api.example.com');

    expect(router).toBeDefined();
    expect(config.http.services[router!.service]?.loadBalancer.servers[0]?.url).toBe(
      'http://ol-stack-api:3000',
    );
  });

  it('does not expose pending or errored domain mappings to Traefik', async () => {
    const project = makeProject();
    const defaultService = makeService();
    const apiService = makeService({
      id: 'stack-api__svc',
      project_id: 'stack',
      name: 'stack/api__svc',
      kind: 'compose-child',
      parent_service_id: 'stack__svc',
      assigned_port: 18080,
      container_port: 3000,
      container_id: 'container-stack-api',
      container_name: 'ol-stack-api',
    });
    const app = createTraefikConfigApp({
      projects: [project],
      services: [defaultService, apiService],
      mappings: [
        makeMapping({ id: 'dm-pending', domain: 'pending.example.com', status: 'pending' }),
        makeMapping({ id: 'dm-error', domain: 'error.example.com', status: 'error' }),
      ],
    }).app;

    const config = await requestTraefikConfig(app);

    expect(findRouterForDomain(config, 'pending.example.com')).toBeUndefined();
    expect(findRouterForDomain(config, 'error.example.com')).toBeUndefined();
  });

  it('compiles path prefixes and strip/add middlewares from domain mappings', async () => {
    const project = makeProject();
    const apiService = makeService({
      id: 'stack-api__svc',
      project_id: 'stack',
      name: 'stack/api__svc',
      kind: 'compose-child',
      parent_service_id: 'stack__svc',
      assigned_port: 18080,
      container_port: 3000,
      container_id: 'container-stack-api',
      container_name: 'ol-stack-api',
    });
    const app = createTraefikConfigApp({
      projects: [project],
      services: [makeService(), apiService],
      mappings: [
        makeMapping({
          id: 'domain-api-path',
          path_prefix: '/api',
          strip_prefix: true,
          upstream_path_prefix: '/internal',
        }),
      ],
    }).app;

    const config = await requestTraefikConfig(app);
    const router = findRouterForDomain(config, 'api.example.com');

    expect(router).toMatchObject({
      rule: 'Host(`api.example.com`) && PathPrefix(`/api`)',
      middlewares: ['domain-domain-api-path-strip', 'domain-domain-api-path-add'],
    });
    expect(config.http.middlewares['domain-domain-api-path-strip']).toEqual({
      stripPrefix: { prefixes: ['/api'] },
    });
    expect(config.http.middlewares['domain-domain-api-path-add']).toEqual({
      addPrefix: { prefix: '/internal' },
    });
  });

  it('routes a domain mapping to target_port when provided', async () => {
    const project = makeProject();
    const apiService = makeService({
      id: 'stack-api__svc',
      project_id: 'stack',
      name: 'stack/api__svc',
      kind: 'compose-child',
      parent_service_id: 'stack__svc',
      assigned_port: 18080,
      container_port: 3000,
      container_id: 'container-stack-api',
      container_name: 'ol-stack-api',
    });
    const app = createTraefikConfigApp({
      projects: [project],
      services: [makeService(), apiService],
      mappings: [makeMapping({ id: 'domain-port', target_port: 9090 })],
    }).app;

    const config = await requestTraefikConfig(app);
    const router = findRouterForDomain(config, 'api.example.com');

    expect(config.http.services[router!.service]?.loadBalancer.servers[0]?.url).toBe(
      'http://ol-stack-api:9090',
    );
  });

  it('skips unsafe rule values instead of emitting invalid Traefik config', async () => {
    const project = makeProject();
    const apiService = makeService({
      id: 'stack-api__svc',
      project_id: 'stack',
      name: 'stack/api__svc',
      kind: 'compose-child',
      parent_service_id: 'stack__svc',
      assigned_port: 18080,
      container_port: 3000,
      container_id: 'container-stack-api',
      container_name: 'ol-stack-api',
    });
    const app = createTraefikConfigApp({
      projects: [project],
      services: [makeService(), apiService],
      mappings: [makeMapping({ id: 'domain-unsafe', domain: 'bad`host.example.com' })],
    }).app;

    const config = await requestTraefikConfig(app);

    expect(findRouterForDomain(config, 'bad`host.example.com')).toBeUndefined();
    expect(config.http.services['svc-domain-domain-unsafe']).toBeUndefined();
  });
});
