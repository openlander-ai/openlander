import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { OpenLanderError } from '../../src/errors.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function createDuplicateServiceContext(
  options: { traefikMode?: 'managed' | 'external' } = {},
): AppContext {
  const alpha = { id: 'alpha', name: 'alpha', status: 'running', archived_at: null };
  const beta = { id: 'beta', name: 'beta', status: 'running', archived_at: null };
  const alphaService = {
    id: 'alpha__svc',
    name: 'api',
    project_id: alpha.id,
    kind: 'git',
    source: 'git',
  };
  const betaService = {
    id: 'beta__svc',
    name: 'api',
    project_id: beta.id,
    kind: 'git',
    source: 'git',
  };
  const projects = new Map([
    [alpha.id, alpha],
    [beta.id, beta],
  ]);
  const services = [alphaService, betaService];
  const domainMappings: unknown[] = [];

  return {
    config: { traefik: { mode: options.traefikMode ?? 'managed' } },
    db: {
      getProject: vi.fn((id: string) => projects.get(id)),
      getProjectByName: vi.fn((name: string) =>
        [...projects.values()].find((project) => project.name === name),
      ),
      getService: vi.fn((id: string) => services.find((service) => service.id === id)),
      getDeployableForProject: vi.fn((id: string) =>
        services.find((service) => service.project_id === id),
      ),
      getDeployablesByGroup: vi.fn((id: string) =>
        services.filter((service) => service.project_id === id),
      ),
      listServices: vi.fn(() => services),
      findDomainMappingByHostAndPath: vi.fn(async () => undefined),
      createDomainMappingForService: vi.fn(async (mapping) => {
        const created = {
          id: mapping.id,
          service_id: mapping.serviceId,
          domain: mapping.domain,
          status: mapping.status ?? 'active',
          path_prefix: mapping.pathPrefix ?? '/',
          strip_prefix: mapping.stripPrefix ?? false,
          upstream_path_prefix: mapping.upstreamPathPrefix ?? null,
          target_port: mapping.targetPort ?? null,
          tls_enabled: mapping.tlsEnabled ?? null,
          tls_resolver: mapping.tlsResolver ?? null,
          created_at: '2026-05-20T00:00:00.000Z',
          updated_at: '2026-05-20T00:00:00.000Z',
        };
        domainMappings.push(created);
        return created;
      }),
      listDomainMappingsForService: vi.fn(async (serviceId: string) =>
        domainMappings.filter(
          (mapping) => (mapping as { service_id: string }).service_id === serviceId,
        ),
      ),
      listDomainMappings: vi.fn(async () => domainMappings),
      isCircuitBreakerOpen: vi.fn(() => false),
      acquireDeployLock: vi.fn(() => true),
      releaseDeployLock: vi.fn().mockResolvedValue(undefined),
      getDeployLockInfo: vi.fn(() => null),
    },
    pipeline: {
      redeploy: vi.fn().mockResolvedValue({ success: true }),
      rollback: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue(undefined),
    },
    deployQueue: {
      acquire: vi.fn().mockResolvedValue(() => {}),
    },
    cloudflare: {
      createTunnelForService: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as AppContext;
}

function createMultiDeployableProjectContext(): AppContext {
  const alpha = { id: 'alpha', name: 'alpha', status: 'running', archived_at: null };
  const alphaApi = {
    id: 'alpha-api__svc',
    name: 'api',
    project_id: alpha.id,
    kind: 'git',
    source: 'git',
  };
  const alphaWeb = {
    id: 'alpha-web__svc',
    name: 'web',
    project_id: alpha.id,
    kind: 'git',
    source: 'git',
  };
  const services = [alphaApi, alphaWeb];

  return {
    config: { traefik: { mode: 'managed' } },
    db: {
      getProject: vi.fn((id: string) => (id === alpha.id ? alpha : undefined)),
      getProjectByName: vi.fn((name: string) => (name === alpha.name ? alpha : undefined)),
      getService: vi.fn((id: string) => services.find((service) => service.id === id)),
      getDeployableForProject: vi.fn((id: string) =>
        services.find((service) => service.project_id === id),
      ),
      getDeployablesByGroup: vi.fn((id: string) =>
        services.filter((service) => service.project_id === id),
      ),
      listServices: vi.fn(() => services),
      findDomainMappingByHostAndPath: vi.fn(async () => undefined),
      createDomainMappingForService: vi.fn(),
      listDomainMappingsForService: vi.fn(async () => []),
      listDomainMappings: vi.fn(async () => []),
      isCircuitBreakerOpen: vi.fn(() => false),
      acquireDeployLock: vi.fn(() => true),
      releaseDeployLock: vi.fn().mockResolvedValue(undefined),
      getDeployLockInfo: vi.fn(() => null),
    },
    pipeline: {
      redeploy: vi.fn().mockResolvedValue({ success: true }),
      rollback: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue(undefined),
    },
    deployQueue: {
      acquire: vi.fn().mockResolvedValue(() => {}),
    },
    cloudflare: {
      createTunnelForService: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as AppContext;
}

function getTool(ctx: AppContext, name: string) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp', names: [name] }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

describe('deployable service target resolution', () => {
  it('scopes service_name lookup by project_name', async () => {
    const ctx = createDuplicateServiceContext();
    const result = await getTool(ctx, 'redeploy_app').execute(
      { service_name: 'api', project_name: 'beta' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'deploying',
      service: { id: 'beta__svc', name: 'api', projectId: 'beta', projectName: 'beta' },
      diagnostic_call: {
        tool: 'openlander_monitor',
        action: 'diagnose_service',
        params: { service_id: 'beta__svc' },
      },
    });
    expect(result).toMatchObject({
      _agent_guidance: {
        next_steps: expect.arrayContaining([expect.stringContaining('diagnose_service')]),
      },
    });
  });

  it('accepts a project group name as service_name when it has one deployable', async () => {
    const ctx = createDuplicateServiceContext();
    const result = await getTool(ctx, 'redeploy_app').execute(
      { service_name: 'alpha' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'deploying',
      service: { id: 'alpha__svc', name: 'api', projectId: 'alpha', projectName: 'alpha' },
      diagnostic_call: {
        tool: 'openlander_monitor',
        action: 'diagnose_service',
        params: { service_id: 'alpha__svc' },
      },
    });
  });

  it('requires service_id when service_name matches a multi-deployable project group', async () => {
    const ctx = createMultiDeployableProjectContext();

    await expect(
      getTool(ctx, 'redeploy_app').execute({ service_name: 'alpha' }, { target: 'mcp' }),
    ).rejects.toMatchObject({
      code: 'SERVICE_SELECTION_REQUIRED',
      statusCode: 400,
    });
  });

  it('requires disambiguation for duplicate deployable service names', async () => {
    const ctx = createDuplicateServiceContext();

    await expect(
      getTool(ctx, 'redeploy_app').execute({ service_name: 'api' }, { target: 'mcp' }),
    ).rejects.toMatchObject({
      code: 'SERVICE_SELECTION_REQUIRED',
      statusCode: 400,
    });

    try {
      await getTool(ctx, 'redeploy_app').execute({ service_name: 'api' }, { target: 'mcp' });
    } catch (err) {
      expect(err).toBeInstanceOf(OpenLanderError);
      if (err instanceof OpenLanderError) {
        expect(err.details).toMatchObject({
          serviceName: 'api',
          candidates: [
            { serviceId: 'alpha__svc', projectName: 'alpha' },
            { serviceId: 'beta__svc', projectName: 'beta' },
          ],
        });
      }
    }
  });

  it('registers domain routes through the scoped deployable service target', async () => {
    const ctx = createDuplicateServiceContext();
    const result = await getTool(ctx, 'add_domain_route').execute(
      { project_name: 'alpha', domain: 'api.example.com' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'route_registered',
      project: { id: 'alpha', name: 'alpha' },
      service: { id: 'alpha__svc', name: 'api' },
      route: {
        service_id: 'alpha__svc',
        domain: 'api.example.com',
        path_prefix: '/',
        upstream_path_prefix: '/',
        status: 'active',
      },
      routing: {
        backend: 'traefik_http_provider',
        docker_labels_expected: false,
        requires_redeploy: false,
      },
    });
    expect(ctx.db.createDomainMappingForService).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'alpha__svc',
        domain: 'api.example.com',
        status: 'active',
        pathPrefix: '/',
        stripPrefix: false,
        upstreamPathPrefix: null,
        targetPort: null,
      }),
    );
    expect(ctx.cloudflare.createTunnelForService).not.toHaveBeenCalled();
  });

  it('rejects domain route writes when Traefik routing is externally managed', async () => {
    const ctx = createDuplicateServiceContext({ traefikMode: 'external' });

    await expect(
      getTool(ctx, 'add_domain_route').execute(
        { service_id: 'alpha__svc', domain: 'api.example.com' },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({
      code: 'DOMAIN_ROUTING_DISABLED',
      statusCode: 409,
    });
    expect(ctx.db.createDomainMappingForService).not.toHaveBeenCalled();
  });

  it.each([
    ['https://api.example.com'],
    ['*.example.com'],
    ['127.0.0.1'],
    ['api.example.com:443'],
    ['localhost'],
    ['api.localhost'],
    ['api.local'],
    ['api'],
    ['api..example.com'],
    ['bad_label.example.com'],
    [`${'a'.repeat(64)}.example.com`],
    [`${'a'.repeat(250)}.com`],
  ])('rejects invalid domain route host %s', async (domain) => {
    const ctx = createDuplicateServiceContext();

    await expect(
      getTool(ctx, 'add_domain_route').execute(
        { service_id: 'alpha__svc', domain },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_HOST',
      statusCode: 400,
    });
    expect(ctx.db.createDomainMappingForService).not.toHaveBeenCalled();
  });

  it('preserves path route options when registering domain routes', async () => {
    const ctx = createDuplicateServiceContext();
    const result = await getTool(ctx, 'add_domain_route').execute(
      {
        service_id: 'alpha__svc',
        domain: 'api.example.com',
        path_prefix: '/api',
        strip_prefix: true,
        upstream_path_prefix: '/internal',
        target_port: 8080,
      },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'route_registered',
      route: {
        domain: 'api.example.com',
        path_prefix: '/api',
        strip_prefix: true,
        upstream_path_prefix: '/internal',
        target_port: 8080,
      },
      routing: {
        backend: 'traefik_http_provider',
        expected_rule: 'Host(`api.example.com`) && PathPrefix(`/api`)',
        docker_labels_expected: false,
        requires_redeploy: false,
      },
    });
    expect(ctx.db.createDomainMappingForService).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'alpha__svc',
        domain: 'api.example.com',
        pathPrefix: '/api',
        stripPrefix: true,
        upstreamPathPrefix: '/internal',
        targetPort: 8080,
      }),
    );
  });

  it('rejects duplicate domain routes for the same host and path', async () => {
    const ctx = createDuplicateServiceContext();
    const first = getTool(ctx, 'add_domain_route');

    await first.execute(
      { service_id: 'alpha__svc', domain: 'api.example.com', path_prefix: '/api' },
      { target: 'mcp' },
    );
    (
      ctx.db.findDomainMappingByHostAndPath as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(async (domain: string, pathPrefix: string) => ({
      id: 'existing-route',
      service_id: 'alpha__svc',
      domain,
      path_prefix: pathPrefix,
    }));

    await expect(
      first.execute(
        { service_id: 'alpha__svc', domain: 'api.example.com', path_prefix: '/api' },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({
      code: 'DOMAIN_ROUTE_EXISTS',
      statusCode: 409,
    });
  });

  it('lists domain routes through the scoped deployable service target', async () => {
    const ctx = createDuplicateServiceContext();
    await getTool(ctx, 'add_domain_route').execute(
      { service_id: 'alpha__svc', domain: 'api.example.com' },
      { target: 'mcp' },
    );

    const result = await getTool(ctx, 'list_domain_routes').execute(
      { service_id: 'alpha__svc' },
      { target: 'mcp' },
    );

    expect(ctx.db.listDomainMappingsForService).toHaveBeenCalledWith('alpha__svc');
    expect(result).toMatchObject({
      count: 1,
      routes: [{ service_id: 'alpha__svc', domain: 'api.example.com' }],
      routing: {
        backend: 'traefik_http_provider',
        config_endpoint: '/api/traefik/config',
        docker_labels_expected: false,
      },
    });
  });

  it('requires disambiguation when add_domain_route targets a duplicated service name', async () => {
    const ctx = createDuplicateServiceContext();

    await expect(
      getTool(ctx, 'add_domain_route').execute(
        { service_name: 'api', domain: 'api.example.com' },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({
      code: 'SERVICE_SELECTION_REQUIRED',
      statusCode: 400,
    });
  });

  it('requires disambiguation when add_domain_route targets a multi-deployable project_name', async () => {
    const ctx = createMultiDeployableProjectContext();

    await expect(
      getTool(ctx, 'add_domain_route').execute(
        { project_name: 'alpha', domain: 'api.example.com' },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({
      code: 'SERVICE_SELECTION_REQUIRED',
      statusCode: 400,
    });

    try {
      await getTool(ctx, 'add_domain_route').execute(
        { project_name: 'alpha', domain: 'api.example.com' },
        { target: 'mcp' },
      );
    } catch (err) {
      expect(err).toBeInstanceOf(OpenLanderError);
      if (err instanceof OpenLanderError) {
        expect(err.details).toMatchObject({
          projectId: 'alpha',
          projectName: 'alpha',
          candidates: [
            { serviceId: 'alpha-api__svc', serviceName: 'api' },
            { serviceId: 'alpha-web__svc', serviceName: 'web' },
          ],
        });
      }
    }

    expect(ctx.cloudflare.createTunnelForService).not.toHaveBeenCalled();
  });
});
