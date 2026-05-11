import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { DOCKER_LABELS } from '../../src/config/index.js';
import type { DomainMappingRow, ProjectRow, ServiceRow } from '../../src/db/types.js';
import type { AllContainerInfo } from '../../src/pipeline/docker/types.js';
import { createWebServerRoutes } from '../../src/web/api/web-server-routes.js';

const ORIGINAL_HOST_IP = process.env['HOST_IP'];
const ORIGINAL_HOST_VPN_IP = process.env['HOST_VPN_IP'];

function makeProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'project-1',
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
    ...overrides,
  };
}

function makeService(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'project-1__svc',
    project_id: 'project-1',
    name: 'demo__svc',
    kind: 'image',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 10042,
    container_id: 'container-app',
    container_name: 'ol-demo',
    container_port: 3000,
    image_tag: 'demo:latest',
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

function makeDomain(overrides: Partial<DomainMappingRow> = {}): DomainMappingRow {
  return {
    id: 'domain-1',
    service_id: 'project-1__svc',
    domain: 'demo.example.com',
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
    project_id: 'project-1',
    ...overrides,
  };
}

function makeContainer(overrides: Partial<AllContainerInfo> = {}): AllContainerInfo {
  return {
    id: 'container-app',
    name: 'ol-demo',
    image: 'demo:latest',
    state: 'running',
    status: 'Up 1 minute',
    ports: [{ PrivatePort: 3000, PublicPort: 10042, Type: 'tcp' }],
    labels: { [DOCKER_LABELS.MANAGED]: 'true', [DOCKER_LABELS.PROJECT]: 'demo' },
    managedByOpenLander: true,
    composeProject: null,
    created: 1_700_000_000,
    ...overrides,
  };
}

function createApp(ctx: Partial<AppContext>) {
  const app = new Hono();
  app.route('/api', createWebServerRoutes(ctx as AppContext));
  return app;
}

function createContext(overrides: {
  projects?: ProjectRow[];
  services?: ServiceRow[];
  domainMappings?: DomainMappingRow[];
  containers?: AllContainerInfo[];
  dockerError?: Error;
  traefikMode?: 'managed' | 'external';
}): Partial<AppContext> {
  const projects = overrides.projects ?? [makeProject()];
  const services = overrides.services ?? [makeService()];
  const domainMappings = overrides.domainMappings ?? [makeDomain()];
  const containers = overrides.containers ?? [
    makeContainer(),
    makeContainer({
      id: 'container-traefik',
      name: 'traefik-ol',
      image: 'traefik:v3.6',
      ports: [
        { PrivatePort: 80, PublicPort: 80, Type: 'tcp' },
        { PrivatePort: 8080, PublicPort: 8080, Type: 'tcp' },
      ],
      labels: { [DOCKER_LABELS.MANAGED]: 'true', [DOCKER_LABELS.ROLE]: 'traefik' },
    }),
    makeContainer({
      id: 'container-external',
      name: 'external-nginx',
      image: 'nginx:1.27',
      ports: [{ PrivatePort: 80, PublicPort: 8888, Type: 'tcp' }],
      labels: {},
      managedByOpenLander: false,
      composeProject: 'external',
    }),
  ];

  return {
    config: {
      traefik: { mode: overrides.traefikMode ?? 'managed' },
    },
    docker: {
      listAllContainers: vi.fn(async () => {
        if (overrides.dockerError) throw overrides.dockerError;
        return containers;
      }),
    },
    db: {
      listProjects: vi.fn(async () => projects),
      getServices: vi.fn(async () => services),
      listServices: vi.fn(async () => services),
      listDomainMappings: vi.fn(async () => domainMappings),
    },
  } as Partial<AppContext>;
}

describe('createWebServerRoutes', () => {
  beforeEach(() => {
    process.env['HOST_IP'] = '192.0.2.20';
    process.env['HOST_VPN_IP'] = '198.51.100.20';
  });

  afterEach(() => {
    if (ORIGINAL_HOST_IP === undefined) {
      delete process.env['HOST_IP'];
    } else {
      process.env['HOST_IP'] = ORIGINAL_HOST_IP;
    }
    if (ORIGINAL_HOST_VPN_IP === undefined) {
      delete process.env['HOST_VPN_IP'];
    } else {
      process.env['HOST_VPN_IP'] = ORIGINAL_HOST_VPN_IP;
    }
  });

  it('returns Web Server summary without fake throughput', async () => {
    const app = createApp(createContext({}));
    const res = await app.request('/api/web-server/summary');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proxy).toMatchObject({
      type: 'traefik',
      mode: 'managed',
      version: 'v3.6',
      statusCode: 'traefik_managed',
      statusSeverity: 'ok',
    });
    expect(body.routes).toMatchObject({ total: 3, healthy: 3, issues: 0 });
    expect(body.entrypoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'web', port: 80 }),
        expect.objectContaining({ name: 'dashboard', port: 8080 }),
      ]),
    );
    expect(body).not.toHaveProperty('throughput');
    expect(body.lastReloadAt).toBeNull();
  });

  it('lists generated sslip and custom-domain routes with issue flags', async () => {
    const service = makeService({ status: 'running' });
    const app = createApp(
      createContext({
        services: [service],
        domainMappings: [makeDomain({ status: 'error' })],
        containers: [],
      }),
    );

    const res = await app.request('/api/web-server/routes');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(3);
    expect(body.issueCount).toBe(3);
    const statuses = body.routes.map((route: { status: string }) => route.status);
    expect(statuses).not.toContain('building');
    expect(body.routes.map((route: { host: string }) => route.host)).toEqual(
      [...body.routes.map((route: { host: string }) => route.host)].sort(),
    );
    expect(body.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          host: 'demo.192.0.2.20.sslip.io',
          source: 'sslip',
          status: 'warning',
          tls: expect.objectContaining({ status: 'absent' }),
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'container_not_running' }),
          ]),
        }),
        expect.objectContaining({
          host: 'demo.example.com',
          source: 'domain',
          status: 'error',
          tls: expect.objectContaining({ status: 'unknown' }),
          issues: expect.arrayContaining([expect.objectContaining({ code: 'domain_error' })]),
        }),
      ]),
    );
  });

  it('classifies service and Docker port allocations by environment range', async () => {
    const app = createApp(
      createContext({
        services: [
          makeService(),
          makeService({
            id: 'project-1-worker',
            name: 'worker',
            assigned_port: 20042,
            container_id: null,
            container_name: null,
          }),
        ],
      }),
    );
    const res = await app.request('/api/web-server/ports');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ranges.production).toMatchObject({ portRangeStart: 10001, portRangeEnd: 10999 });
    expect(body.allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          port: 10042,
          environment: 'production',
          source: 'both',
          serviceId: 'project-1__svc',
          external: false,
        }),
        expect.objectContaining({
          port: 20042,
          environment: 'development',
          source: 'service',
          serviceId: 'project-1-worker',
          external: false,
        }),
        expect.objectContaining({
          port: 8888,
          environment: 'outside',
          source: 'docker',
          serviceId: null,
          external: true,
        }),
      ]),
    );
  });

  it('lists external containers without managed OpenLander containers', async () => {
    const app = createApp(createContext({}));
    const res = await app.request('/api/web-server/external-containers');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      count: 1,
      containers: [
        {
          name: 'external-nginx',
          image: 'nginx:1.27',
          ports: [8888],
          rangeConflicts: [],
          composeProject: 'external',
        },
      ],
    });
  });

  it('marks Docker unavailable without returning 500s', async () => {
    const app = createApp(createContext({ dockerError: new Error('Docker is down') }));

    for (const path of [
      '/api/web-server/summary',
      '/api/web-server/routes',
      '/api/web-server/ports',
      '/api/web-server/external-containers',
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      const body = await res.json();
      expect(body.dockerUnavailable, path).toBe(true);
      if (path === '/api/web-server/summary') {
        expect(body.proxy).toMatchObject({
          statusCode: 'docker_unavailable',
          statusSeverity: 'error',
        });
      }
    }
  });

  it('returns structured proxy status codes for no-proxy states', async () => {
    const noProxyApp = createApp(createContext({ containers: [] }));
    const noProxyRes = await noProxyApp.request('/api/web-server/summary');

    expect(noProxyRes.status).toBe(200);
    await expect(noProxyRes.json()).resolves.toMatchObject({
      proxy: {
        type: 'none',
        statusCode: 'no_proxy_managed',
        statusSeverity: 'warning',
      },
    });

    const externalNoProxyApp = createApp(
      createContext({ containers: [], traefikMode: 'external' }),
    );
    const externalNoProxyRes = await externalNoProxyApp.request('/api/web-server/summary');

    expect(externalNoProxyRes.status).toBe(200);
    await expect(externalNoProxyRes.json()).resolves.toMatchObject({
      proxy: {
        type: 'none',
        mode: 'external',
        statusCode: 'no_proxy_external',
        statusSeverity: 'warning',
      },
    });
  });

  it('returns structured proxy status codes for external Traefik and unsupported proxies', async () => {
    const externalTraefikApp = createApp(createContext({ traefikMode: 'external' }));
    const externalTraefikRes = await externalTraefikApp.request('/api/web-server/summary');

    expect(externalTraefikRes.status).toBe(200);
    await expect(externalTraefikRes.json()).resolves.toMatchObject({
      proxy: {
        type: 'traefik',
        mode: 'external',
        statusCode: 'traefik_external',
        statusSeverity: 'ok',
      },
    });

    const disabledProviderApp = createApp(
      createContext({
        containers: [
          makeContainer({
            id: 'container-traefik-disabled',
            name: 'traefik-disabled',
            image: 'traefik:v3.6',
            ports: [{ PrivatePort: 80, PublicPort: 80, Type: 'tcp' }],
            labels: { 'traefik.providers.docker': 'false' },
          }),
        ],
      }),
    );
    const disabledProviderRes = await disabledProviderApp.request('/api/web-server/summary');

    expect(disabledProviderRes.status).toBe(200);
    await expect(disabledProviderRes.json()).resolves.toMatchObject({
      proxy: {
        type: 'traefik',
        traefikDockerProvider: false,
        statusCode: 'traefik_provider_disabled',
        statusSeverity: 'warning',
      },
    });

    const unsupportedProxyApp = createApp(
      createContext({
        containers: [
          makeContainer({
            id: 'container-nginx',
            name: 'edge-nginx',
            image: 'nginx:1.27',
            ports: [{ PrivatePort: 80, PublicPort: 80, Type: 'tcp' }],
            labels: {},
            managedByOpenLander: false,
          }),
        ],
      }),
    );
    const unsupportedProxyRes = await unsupportedProxyApp.request('/api/web-server/summary');

    expect(unsupportedProxyRes.status).toBe(200);
    await expect(unsupportedProxyRes.json()).resolves.toMatchObject({
      proxy: {
        type: 'nginx',
        statusCode: 'unsupported_proxy',
        statusSeverity: 'warning',
      },
    });
  });

  it('does not project archived services into web routes', async () => {
    const app = createApp(
      createContext({
        services: [makeService({ archived_at: '2026-01-02T00:00:00.000Z' })],
      }),
    );

    const res = await app.request('/api/web-server/routes');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      count: 0,
      issueCount: 0,
      routes: [],
    });
  });
});
