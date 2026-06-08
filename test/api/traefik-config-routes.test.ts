import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { AppContext } from '../../src/app.js';
import type { DomainMappingRow, ProjectRow, ServiceRow } from '../../src/db/types.js';
import { createApiRoutes } from '../../src/web/api/routes.js';

interface TraefikConfigResponse {
  http: {
    routers: Record<
      string,
      {
        rule: string;
        entryPoints: string[];
        service: string;
        priority?: number;
        middlewares?: string[];
      }
    >;
    services: Record<string, { loadBalancer: { servers: Array<{ url: string }> } }>;
    middlewares?: Record<
      string,
      { stripPrefix?: { prefixes: string[] }; addPrefix?: { prefix: string } }
    >;
  };
}

interface PreviewRouteFixture {
  routeName: string;
  containerName: string;
  containerPort: number;
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
  previews?: PreviewRouteFixture[];
}): {
  app: Hono;
  db: {
    getService: ReturnType<typeof vi.fn>;
    getProject: ReturnType<typeof vi.fn>;
    getDeployableForProject: ReturnType<typeof vi.fn>;
    listServices: ReturnType<typeof vi.fn>;
    previewDeployer: { list: ReturnType<typeof vi.fn> };
  };
} {
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
    previewDeployer: {
      list: vi.fn(() => params.previews ?? []),
    },
  };

  const app = new Hono();
  app.route('/api', createApiRoutes({ db, previewDeployer: db.previewDeployer } as unknown as AppContext));
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
  it('routes auto project hosts to the active service container_name', async () => {
    const project = makeProject({ name: 'stack' });
    const defaultService = makeService({
      id: 'stack__svc',
      project_id: 'stack',
      name: 'stack__svc',
      container_name: 'ol-stack-green-abc123',
      container_port: 8080,
      container_id: 'container-green',
    });
    const harness = createTraefikConfigApp({
      projects: [project],
      services: [defaultService],
      mappings: [],
    });

    const config = await requestTraefikConfig(harness.app);

    expect(config.http.services['svc-stack']?.loadBalancer.servers[0]?.url).toBe(
      'http://ol-stack-green-abc123:8080',
    );
    expect(harness.db.listServices).toHaveBeenCalledOnce();
    expect(harness.db.getDeployableForProject).not.toHaveBeenCalled();
  });

  it('routes compose child auto hosts from non-canonical service rows', async () => {
    const project = makeProject({ name: 'stack' });
    const defaultService = makeService({
      id: 'stack__svc',
      project_id: 'stack',
      name: 'stack__svc',
      kind: 'compose',
      status: 'stopped',
      container_id: null,
    });
    const webService = makeService({
      id: 'child-web__svc',
      project_id: 'stack',
      name: 'stack/web__svc',
      kind: 'compose-child',
      parent_service_id: 'stack__svc',
      assigned_port: 18080,
      container_port: 3000,
      container_id: 'container-stack-web',
      container_name: 'ol-stack-web',
    });
    const config = await requestTraefikConfig(
      createTraefikConfigApp({
        projects: [project],
        services: [defaultService, webService],
        mappings: [],
      }).app,
    );

    expect(config.http.services['svc-stack']).toBeUndefined();
    expect(config.http.services['svc-stack-web']?.loadBalancer.servers[0]?.url).toBe(
      'http://ol-stack-web:3000',
    );
    expect(Object.values(config.http.routers).some((router) => router.service === 'svc-stack-web'))
      .toBe(true);
  });

  it('routes in-memory previews through the HTTP provider', async () => {
    const config = await requestTraefikConfig(
      createTraefikConfigApp({
        projects: [],
        services: [],
        mappings: [],
        previews: [
          {
            routeName: 'preview-feature',
            containerName: 'ol-preview-feature',
            containerPort: 4173,
          },
        ],
      }).app,
    );

    expect(config.http.services['svc-preview-feature']?.loadBalancer.servers[0]?.url).toBe(
      'http://ol-preview-feature:4173',
    );
    expect(
      Object.values(config.http.routers).some(
        (router) => router.service === 'svc-preview-feature',
      ),
    ).toBe(true);
  });

  it('flips auto routes from the service row with priority over Docker label routers', async () => {
    const project = makeProject({ name: 'stack' });
    const service = makeService({
      id: 'stack__svc',
      project_id: 'stack',
      name: 'stack__svc',
      assigned_port: 10010,
      container_name: 'ol-stack',
      container_port: 3000,
      container_id: 'container-old',
    });
    const harness = createTraefikConfigApp({
      projects: [project],
      services: [service],
      mappings: [],
    });

    const before = await requestTraefikConfig(harness.app);
    const beforeRouter = Object.values(before.http.routers).find(
      (router) => router.service === 'svc-stack',
    );
    expect(before.http.services['svc-stack']?.loadBalancer.servers[0]?.url).toBe(
      'http://ol-stack:3000',
    );
    expect(beforeRouter?.priority).toBeGreaterThan(beforeRouter?.rule.length ?? 0);

    service.assigned_port = 12001;
    service.container_name = 'ol-stack-env-abc123';
    service.container_id = 'container-new';

    const after = await requestTraefikConfig(harness.app);
    const afterRouter = Object.values(after.http.routers).find(
      (router) => router.service === 'svc-stack',
    );

    expect(after.http.services['svc-stack']?.loadBalancer.servers[0]?.url).toBe(
      'http://ol-stack-env-abc123:3000',
    );
    expect(after.http.services['svc-stack']?.loadBalancer.servers[0]?.url).not.toContain(
      'ol-stack:3000',
    );
    expect(afterRouter?.priority).toBeGreaterThan(afterRouter?.rule.length ?? 0);
  });

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

  it('omits empty middlewares so Traefik HTTP provider accepts host-only routes', async () => {
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
      mappings: [makeMapping()],
    }).app;

    const config = await requestTraefikConfig(app);

    expect(findRouterForDomain(config, 'api.example.com')).toBeDefined();
    expect(config.http.middlewares).toBeUndefined();
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
      middlewares: ['domain-api-path-strip', 'domain-api-path-add'],
    });
    expect(config.http.middlewares?.['domain-api-path-strip']).toEqual({
      stripPrefix: { prefixes: ['/api'] },
    });
    expect(config.http.middlewares?.['domain-api-path-add']).toEqual({
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
    expect(config.http.services['svc-domain-unsafe']).toBeUndefined();
  });

  it('skips unsafe path values instead of emitting invalid Traefik rules', async () => {
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
      mappings: [makeMapping({ id: 'domain-unsafe-path', path_prefix: '/api bad' })],
    }).app;

    const config = await requestTraefikConfig(app);

    expect(findRouterForDomain(config, 'api.example.com')).toBeUndefined();
    expect(config.http.services['svc-domain-unsafe-path']).toBeUndefined();
  });

  it('skips invalid target_port values that bypassed API validation', async () => {
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
      mappings: [makeMapping({ id: 'domain-bad-port', target_port: 70000 })],
    }).app;

    const config = await requestTraefikConfig(app);

    expect(findRouterForDomain(config, 'api.example.com')).toBeUndefined();
    expect(config.http.services['svc-domain-bad-port']).toBeUndefined();
  });
});

describe('GET /api/traefik/config reads the canonical services row (S2.4)', () => {
  it('builds auto + quick-share routers from the services row, not stale project columns', async () => {
    // Every deprecated project column is stale; the canonical services
    // row is the live state. The ServiceView projection must read the
    // services row for the running filter, internal port, and the
    // quick-share visibility / public_url.
    const project = makeProject({
      name: 'stack',
      status: 'stopped',
      visibility: 'internal',
      public_url: null,
      container_port: 8080,
      container_id: null,
    });
    const service = makeService({
      id: 'stack__svc',
      project_id: 'stack',
      name: 'stack__svc',
      status: 'running',
      visibility: 'shared',
      public_url: 'https://qs.example.com',
      container_name: 'ol-stack-green',
      container_port: 9000,
      container_id: 'container-green',
    });
    const config = await requestTraefikConfig(
      createTraefikConfigApp({ projects: [project], services: [service], mappings: [] }).app,
    );

    // Running filter + internalPort resolve from the services row → the
    // service is built on the canonical container_name:container_port.
    expect(config.http.services['svc-stack']?.loadBalancer.servers[0]?.url).toBe(
      'http://ol-stack-green:9000',
    );
    // Quick-share router derives from the services-row visibility +
    // public_url even though the project column says 'internal'.
    expect(config.http.routers['qs-stack']).toMatchObject({
      rule: 'Host(`qs.example.com`)',
      entryPoints: ['web'],
      service: 'svc-stack',
    });
  });

  it('omits both the service and the quick-share router when the services row is stopped', async () => {
    // Inverse pin: a 'running' project column must not resurrect a
    // service whose canonical row is stopped.
    const project = makeProject({
      name: 'stack',
      status: 'running',
      visibility: 'shared',
      public_url: 'https://qs.example.com',
    });
    const service = makeService({
      id: 'stack__svc',
      project_id: 'stack',
      status: 'stopped',
      visibility: 'shared',
      public_url: 'https://qs.example.com',
      container_id: null,
    });
    const config = await requestTraefikConfig(
      createTraefikConfigApp({ projects: [project], services: [service], mappings: [] }).app,
    );

    expect(config.http.services['svc-stack']).toBeUndefined();
    expect(config.http.routers['qs-stack']).toBeUndefined();
  });
});
