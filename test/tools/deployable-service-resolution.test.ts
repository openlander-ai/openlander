import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { OpenLanderError } from '../../src/errors.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function createDuplicateServiceContext(
  options: {
    traefikMode?: 'managed' | 'external';
    alphaService?: Record<string, unknown>;
    betaService?: Record<string, unknown>;
  } = {},
): AppContext {
  const alpha = { id: 'alpha', name: 'alpha', status: 'running', archived_at: null };
  const beta = { id: 'beta', name: 'beta', status: 'running', archived_at: null };
  const alphaService = {
    id: 'alpha__svc',
    name: 'api',
    project_id: alpha.id,
    kind: 'git',
    source: 'git',
    repo_url: 'https://github.com/acme/alpha.git',
    image_url: null,
    ...options.alphaService,
  };
  const betaService = {
    id: 'beta__svc',
    name: 'api',
    project_id: beta.id,
    kind: 'git',
    source: 'git',
    repo_url: 'https://github.com/acme/beta.git',
    image_url: null,
    ...options.betaService,
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
      updateService: vi.fn(async (serviceId: string, updates: { containerPort?: number }) => {
        const service = services.find((item) => item.id === serviceId);
        if (service && updates.containerPort !== undefined) {
          service.container_port = updates.containerPort;
        }
      }),
      isCircuitBreakerOpen: vi.fn(() => false),
      acquireDeployLock: vi.fn(() => true),
      releaseDeployLock: vi.fn().mockResolvedValue(undefined),
      getDeployLockInfo: vi.fn(() => null),
    },
    pipeline: {
      getBlueGreenEligibility: vi.fn().mockResolvedValue({
        supported: true,
        code: 'BLUE_GREEN_UNSUPPORTED',
        reasons: [],
        fallback_strategy: 'force',
      }),
      redeploy: vi.fn().mockResolvedValue({ success: true }),
      redeployService: vi.fn().mockResolvedValue({ success: true }),
      rollback: vi.fn().mockResolvedValue({ success: true }),
      verifyManagedTraefikRoute: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        attempts: 1,
        elapsedMs: 1,
      }),
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
    repo_url: 'https://github.com/acme/alpha-api.git',
    image_url: null,
  };
  const alphaWeb = {
    id: 'alpha-web__svc',
    name: 'web',
    project_id: alpha.id,
    kind: 'git',
    source: 'git',
    repo_url: 'https://github.com/acme/alpha-web.git',
    image_url: null,
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
      redeployService: vi.fn().mockResolvedValue({ success: true }),
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
  it('lists archived deployable services for explicit lifecycle follow-up', async () => {
    const ctx = createDuplicateServiceContext({
      alphaService: { archived_at: '2026-05-31T00:00:00.000Z' },
    });

    const result = (await getTool(ctx, 'list_archived_services').execute(
      { project_id: 'alpha' },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'ok',
      project: { id: 'alpha', name: 'alpha' },
      count: 1,
      services: [
        {
          id: 'alpha__svc',
          name: 'api',
          projectId: 'alpha',
          archived_at: '2026-05-31T00:00:00.000Z',
          available_actions: {
            restore: {
              kind: 'mcp_approval',
              tool: 'openlander_service',
              action: 'unarchive_service',
              approval_required: true,
              params: { service_id: 'alpha__svc' },
            },
            permanent_delete: {
              kind: 'web_ui_only',
              surface: 'project_settings_danger',
              path: 'Project Settings > Danger > Archived services',
              reason: 'hard_delete_not_exposed_to_mcp',
              typed_confirmation: 'alpha/api',
            },
          },
        },
      ],
      _agent_guidance: {
        message: expect.stringContaining('not permanently deleted'),
        next_steps: expect.arrayContaining([
          expect.stringContaining('unarchive_service'),
          expect.stringContaining('Web UI'),
        ]),
      },
    });
  });

  it('adds explicit lifecycle guidance to archive and restore results', async () => {
    const ctx = createDuplicateServiceContext();
    ctx.pipeline.archive = vi.fn().mockResolvedValue(undefined);
    ctx.pipeline.unarchive = vi.fn().mockResolvedValue(undefined);

    const archiveResult = (await getTool(ctx, 'archive_service').execute(
      { service_id: 'alpha__svc' },
      { target: 'mcp' },
    )) as Record<string, unknown>;
    const unarchiveResult = (await getTool(ctx, 'unarchive_service').execute(
      { service_id: 'alpha__svc' },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(archiveResult).toMatchObject({
      status: 'archived',
      project_id: 'alpha',
      service_id: 'alpha__svc',
      _agent_guidance: {
        message: expect.stringContaining('not permanent deletion'),
        next_steps: expect.arrayContaining([expect.stringContaining('list_archived_services')]),
      },
    });
    expect(unarchiveResult).toMatchObject({
      status: 'unarchived',
      project_id: 'alpha',
      service_id: 'alpha__svc',
	      _agent_guidance: {
	        message: expect.stringContaining('No container was started automatically'),
	        next_steps: expect.arrayContaining([expect.stringContaining('update_app')]),
	      },
	    });
  });

  it('apply_route_config updates the live container port without redeploying', async () => {
    const ctx = createDuplicateServiceContext({
      alphaService: {
        status: 'running',
        container_id: 'container-alpha',
        container_name: 'ol-alpha',
        container_port: 3000,
      },
    });

    const result = (await getTool(ctx, 'apply_route_config').execute(
      { service_id: 'alpha__svc', container_port: 4000 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.db.updateService).toHaveBeenCalledWith('alpha__svc', { containerPort: 4000 });
    expect(ctx.pipeline.redeployService).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'applied',
      project_id: 'alpha',
      service_id: 'alpha__svc',
      route_config: {
        previous_container_port: 3000,
        container_port: 4000,
        container_name: 'ol-alpha',
        provider: 'traefik_http',
        applied_without_redeploy: true,
      },
      route_verification: {
        status: 'skipped',
        provider: 'traefik_http',
        reason: 'missing_health_check_path',
      },
      diagnostic_call: {
        tool: 'openlander_monitor',
        action: 'diagnose_service',
        params: { service_id: 'alpha__svc' },
      },
    });
    expect(ctx.pipeline.verifyManagedTraefikRoute).not.toHaveBeenCalled();
  });

  it('apply_route_config verifies the managed route when health_check_path is configured', async () => {
    const ctx = createDuplicateServiceContext({
      alphaService: {
        status: 'running',
        container_id: 'container-alpha',
        container_name: 'ol-alpha',
        container_port: 3000,
        health_check_path: 'healthz',
      },
    });
    (ctx.pipeline.verifyManagedTraefikRoute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 204,
      attempts: 2,
      elapsedMs: 503,
    });

    const result = (await getTool(ctx, 'apply_route_config').execute(
      { service_id: 'alpha__svc', container_port: 4000 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.db.updateService).toHaveBeenCalledWith('alpha__svc', { containerPort: 4000 });
    expect(ctx.pipeline.verifyManagedTraefikRoute).toHaveBeenCalledWith({
      projectName: 'alpha',
      path: '/healthz',
    });
    expect(result).toMatchObject({
      status: 'applied',
      route_verification: {
        status: 'verified',
        provider: 'traefik_http',
        path: '/healthz',
        http_status: 204,
        attempts: 2,
        elapsed_ms: 503,
      },
      _agent_guidance: {
        next_steps: expect.arrayContaining([
          'Route verification passed through the managed Traefik HTTP provider.',
        ]),
      },
    });
  });

  it('apply_route_config rolls back the route port when managed route verification fails', async () => {
    const ctx = createDuplicateServiceContext({
      alphaService: {
        status: 'running',
        container_id: 'container-alpha',
        container_name: 'ol-alpha',
        container_port: 3000,
        health_check_path: '/healthz',
      },
    });
    (ctx.pipeline.verifyManagedTraefikRoute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: 'Route probe returned HTTP 502',
      attempts: 3,
      elapsedMs: 1_500,
    });

    const result = (await getTool(ctx, 'apply_route_config').execute(
      { service_id: 'alpha__svc', container_port: 4000 },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(ctx.db.updateService).toHaveBeenNthCalledWith(1, 'alpha__svc', { containerPort: 4000 });
    expect(ctx.db.updateService).toHaveBeenNthCalledWith(2, 'alpha__svc', { containerPort: 3000 });
    expect(ctx.pipeline.verifyManagedTraefikRoute).toHaveBeenCalledWith({
      projectName: 'alpha',
      path: '/healthz',
    });
    expect(result).toMatchObject({
      status: 'rolled_back',
      route_config: {
        previous_container_port: 3000,
        container_port: 3000,
        attempted_container_port: 4000,
        provider: 'traefik_http',
        applied_without_redeploy: true,
        rolled_back: true,
      },
      route_verification: {
        status: 'failed',
        provider: 'traefik_http',
        path: '/healthz',
        error: 'Route probe returned HTTP 502',
        attempts: 3,
        elapsed_ms: 1500,
        rolled_back: true,
      },
    });
  });

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
      status_call: {
        tool: 'openlander_deploy',
        action: 'get_deploy_status',
        params: { service_id: 'beta__svc' },
      },
    });
    expect(result).toMatchObject({
      _agent_guidance: {
        next_steps: expect.arrayContaining([expect.stringContaining('diagnose_service')]),
      },
    });
    await vi.waitFor(() =>
      expect(ctx.pipeline.redeployService).toHaveBeenCalledWith(
        'beta__svc',
        expect.objectContaining({ trigger: 'chat' }),
      ),
    );
    expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
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
    await vi.waitFor(() =>
      expect(ctx.pipeline.redeployService).toHaveBeenCalledWith(
        'alpha__svc',
        expect.objectContaining({ trigger: 'chat' }),
      ),
    );
    expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
  });

  it('blocks unsupported blue-green redeploys before acquiring a deploy lock', async () => {
    const ctx = createDuplicateServiceContext();
    (ctx.pipeline.getBlueGreenEligibility as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      supported: false,
      code: 'BLUE_GREEN_UNSUPPORTED',
      reasons: ['Compose stacks are not eligible for blue-green deploys in v0.1.3.'],
      fallback_strategy: 'force',
    });

    const result = await getTool(ctx, 'redeploy_app').execute(
      { service_name: 'api', project_name: 'alpha', strategy: 'blue-green' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      code: 'BLUE_GREEN_UNSUPPORTED',
      strategy: 'blue-green',
      fallback_call: {
        tool: 'openlander_service',
        action: 'redeploy_app',
        params: { service_id: 'alpha__svc', strategy: 'force' },
      },
    });
    expect(ctx.db.acquireDeployLock).not.toHaveBeenCalled();
    expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
    expect(ctx.pipeline.redeployService).not.toHaveBeenCalled();
  });

  it('blocks explicit blue-green redeploys when eligibility checks are unavailable', async () => {
    const ctx = createDuplicateServiceContext();
    const pipelineWithoutEligibility = ctx.pipeline as typeof ctx.pipeline & {
      getBlueGreenEligibility?: unknown;
    };
    delete pipelineWithoutEligibility.getBlueGreenEligibility;

    const result = await getTool(ctx, 'redeploy_app').execute(
      { service_name: 'api', project_name: 'alpha', strategy: 'blue-green' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      code: 'BLUE_GREEN_UNSUPPORTED',
      strategy: 'blue-green',
      fallback_call: {
        tool: 'openlander_service',
        action: 'redeploy_app',
        params: { service_id: 'alpha__svc', strategy: 'force' },
      },
    });
    expect(ctx.db.acquireDeployLock).not.toHaveBeenCalled();
    expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
    expect(ctx.pipeline.redeployService).not.toHaveBeenCalled();
  });

  it('auto-selects blue-green for eligible redeploy_app calls without an explicit strategy', async () => {
    const ctx = createDuplicateServiceContext();

    const result = await getTool(ctx, 'redeploy_app').execute(
      { service_name: 'api', project_name: 'alpha' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'deploying',
      strategy: 'blue-green',
      zero_downtime: true,
      _agent_guidance: {
        next_steps: expect.arrayContaining([
          'Blue-green was selected automatically because this Application is eligible.',
        ]),
      },
    });
    await vi.waitFor(() =>
      expect(ctx.pipeline.redeployService).toHaveBeenCalledWith(
        'alpha__svc',
        expect.objectContaining({ strategy: 'blue-green' }),
      ),
    );
  });

  it('update_app uses the same blue-green resolver as redeploy_app', async () => {
    const ctx = createDuplicateServiceContext();

    const result = await getTool(ctx, 'update_app').execute(
      { service_name: 'api', project_name: 'alpha' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'deploying',
      strategy: 'blue-green',
      zero_downtime: true,
      message:
        'Blue-green app update started. The previous version stays live until route verification and stability checks pass.',
    });
    await vi.waitFor(() =>
      expect(ctx.pipeline.redeployService).toHaveBeenCalledWith(
        'alpha__svc',
        expect.objectContaining({ strategy: 'blue-green' }),
      ),
    );
  });

  it('update_app respects explicit force strategy', async () => {
    const ctx = createDuplicateServiceContext();

    const result = await getTool(ctx, 'update_app').execute(
      { service_name: 'api', project_name: 'alpha', strategy: 'force' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'deploying',
      strategy: 'force',
      message: 'App update started. Poll get_deploy_status to track progress.',
    });
    expect(ctx.pipeline.getBlueGreenEligibility).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(ctx.pipeline.redeployService).toHaveBeenCalledWith(
        'alpha__svc',
        expect.objectContaining({ strategy: 'force' }),
      ),
    );
  });

  it('falls back to force when implicit blue-green is not eligible', async () => {
    const ctx = createDuplicateServiceContext();
    (ctx.pipeline.getBlueGreenEligibility as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      supported: false,
      code: 'BLUE_GREEN_UNSUPPORTED',
      reasons: ['An explicit health_check_path is required.'],
      fallback_strategy: 'force',
    });

    const result = await getTool(ctx, 'redeploy_app').execute(
      { service_name: 'api', project_name: 'alpha' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'deploying',
      strategy: 'force',
      _agent_guidance: {
        next_steps: expect.arrayContaining([
          expect.stringContaining('Force redeploy was used because blue-green is not currently eligible'),
        ]),
      },
    });
    await vi.waitFor(() =>
      expect(ctx.pipeline.redeployService).toHaveBeenCalledWith(
        'alpha__svc',
        expect.objectContaining({ strategy: 'force' }),
      ),
    );
  });

  it('blocks image/manual-restore redeploys without an image source before acquiring a deploy lock', async () => {
    const ctx = createDuplicateServiceContext({
      alphaService: { kind: 'image', source: 'image', repo_url: null, image_url: null },
    });

    const result = await getTool(ctx, 'redeploy_app').execute(
      { service_id: 'alpha__svc' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      code: 'SERVICE_SOURCE_MISSING',
      details: { missingField: 'image_url', source: 'image' },
      service: { id: 'alpha__svc', projectId: 'alpha' },
      _agent_guidance: {
        message: expect.stringContaining('existing container was left untouched'),
      },
    });
    expect(ctx.db.acquireDeployLock).not.toHaveBeenCalled();
    expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
    expect(ctx.pipeline.redeployService).not.toHaveBeenCalled();
  });

  it('blocks local OpenLander image tags before acquiring a deploy lock', async () => {
    const ctx = createDuplicateServiceContext({
      alphaService: {
        kind: 'image',
        source: 'image',
        repo_url: null,
        image_url: 'openlander/home-menu:latest',
      },
    });

    const result = await getTool(ctx, 'restart_service').execute(
      { service_id: 'alpha__svc' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'blocked',
      code: 'SERVICE_SOURCE_MISSING',
      details: { missingField: 'image_url', source: 'image' },
      service: { id: 'alpha__svc', projectId: 'alpha' },
      _agent_guidance: {
        message: expect.stringContaining('existing container was left untouched'),
      },
    });
    expect(ctx.db.acquireDeployLock).not.toHaveBeenCalled();
    expect(ctx.pipeline.stop).not.toHaveBeenCalled();
    expect(ctx.pipeline.redeploy).not.toHaveBeenCalled();
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
