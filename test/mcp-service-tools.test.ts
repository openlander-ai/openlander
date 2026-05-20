import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../src/app.js';
import type { ServiceRow } from '../src/db/index.js';
import { ManagedServicePersistenceCleanedError } from '../src/errors.js';
import * as gitPipeline from '../src/pipeline/git.js';
import * as traefikPipeline from '../src/pipeline/traefik.js';
import * as infraAnalyzer from '../src/lib/infra-analyzer.js';
import * as webSearchModule from '../src/lib/web-search.js';
import { createSharedToolRegistry } from './tools/shared-tool-registry.js';

const mockCloneRepo = vi.fn();
const mockAnalyzeInfrastructure = vi.fn();
const mockWebSearch = vi.fn();

function legacyTypeToKind(legacy: string | undefined): ServiceRow['kind'] {
  switch (legacy) {
    case 'postgresql':
      return 'postgres';
    case 'mongodb':
      return 'mongo';
    case 'mysql':
      return 'mysql';
    case 'redis':
      return 'redis';
    case 'minio':
      return 'minio';
    default:
      return 'image';
  }
}

function createServiceRow(partial: Partial<ServiceRow>): ServiceRow {
  const legacyType = partial.type ?? 'postgresql';
  const legacyImage = partial.image ?? 'postgres:16-alpine';
  const legacyPort = partial.port ?? 5432;
  return {
    id: partial.id ?? 'svc-1',
    name: partial.name ?? 'shared-pg',
    type: legacyType,
    image: legacyImage,
    status: partial.status ?? 'running',
    container_id: partial.container_id ?? 'container-1',
    container_name: partial.container_name ?? 'ol-svc-shared-pg',
    port: legacyPort,
    env_vars: partial.env_vars ?? null,
    credentials: partial.credentials ?? null,
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-01-01T00:00:00.000Z',
    // Canonical columns — PR 2.5 migration
    kind: partial.kind ?? legacyTypeToKind(legacyType),
    image_url: partial.image_url ?? legacyImage,
    assigned_port: partial.assigned_port ?? legacyPort,
  };
}

function createMockContext(
  services: ServiceRow[] = [],
  containers: Array<{
    id: string;
    name: string;
    status: string;
    imageTag?: string;
    port?: number;
    labels?: Record<string, string>;
  }> = [],
) {
  const serviceManager = {
    create: vi.fn(),
    list: vi.fn(async () => services),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    remove: vi.fn(async () => ({})),
    createDatabase: vi.fn(),
    createUser: vi.fn(),
    getSuggestedEnv: vi.fn(async () => []),
  };

  const ctx = {
    config: {
      git: {
        sshKeyPath: '',
      },
    },
    serviceManager,
    db: {
      getService: vi.fn(async (id: string) => services.find((service) => service.id === id)),
      getProject: vi.fn(async (id: string) =>
        id === 'proj-1' ? { id: 'proj-1', name: 'myapp' } : undefined,
      ),
      getProjectByName: vi.fn(async (name: string) =>
        name === 'myapp' ? { id: 'proj-1', name: 'myapp' } : undefined,
      ),
      attachServiceToProject: vi.fn(async (_serviceId: string, targetProjectId: string) => ({
        sourceProjectId: '__orphan_managed',
        targetProjectId,
        droppedEnvVarKeys: [],
        droppedSecretFiles: [],
      })),
    },
    docker: {
      listManagedContainers: vi.fn(async () => containers),
      inspectContainer: vi.fn(async () => ({
        State: {},
      })),
      getLogs: vi.fn(async () => ''),
    },
  } as unknown as AppContext;

  return {
    ctx,
    serviceManager,
  };
}

function getTool(ctx: AppContext, name: string) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

describe('MCP service tools (Task 8)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(gitPipeline, 'cloneRepo').mockImplementation((...args) => mockCloneRepo(...args));
    vi.spyOn(infraAnalyzer, 'analyzeInfrastructure').mockImplementation((...args) =>
      mockAnalyzeInfrastructure(...args),
    );
    vi.spyOn(webSearchModule, 'webSearch').mockImplementation((...args) => mockWebSearch(...args));
    vi.spyOn(traefikPipeline, 'getAllIps').mockReturnValue([
      { address: '10.0.0.10', interface: 'eth0', type: 'lan' },
      { address: '100.100.100.10', interface: 'tailscale0', type: 'vpn' },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes all 11 new MCP tools', () => {
    const { ctx } = createMockContext();
    const names = createSharedToolRegistry(ctx, { target: 'mcp' }).map((tool) => tool.name);

    for (const toolName of [
      'create_service',
      'list_services',
      'get_service_status',
      'start_service',
      'stop_service',
      'remove_service',
      'get_service_credentials',
      'create_service_user',
      'analyze_infrastructure',
    ]) {
      expect(names).toContain(toolName);
    }
  });

  it('enforces managed service target contracts for service lookup tools', () => {
    const { ctx } = createMockContext();
    const requiredServiceNameTools = [
      'start_service',
      'stop_service',
      'remove_service',
      'create_service_user',
    ];

    for (const name of requiredServiceNameTools) {
      const tool = getTool(ctx, name);
      expect(tool.inputSchema.safeParse({ service_id: 'svc-1' }).success).toBe(false);
    }

    expect(
      getTool(ctx, 'get_service_status').inputSchema.safeParse({ service_id: 'svc-1' }).success,
    ).toBe(true);
    expect(
      getTool(ctx, 'get_service_credentials').inputSchema.safeParse({ service_id: 'svc-1' })
        .success,
    ).toBe(true);

    expect(
      getTool(ctx, 'create_service_user').inputSchema.safeParse({
        service_name: 'shared-pg',
        username: 'appuser',
      }).success,
    ).toBe(true);
  });

  it('create_service returns parsed credentials and throws service-manager errors', async () => {
    const { ctx, serviceManager } = createMockContext();
    const tool = getTool(ctx, 'create_service');

    serviceManager.create.mockResolvedValueOnce(
      createServiceRow({
        id: 'svc-created',
        name: 'shared-pg',
        credentials: '{"host":"ol-svc-shared-pg","port":5432,"user":"openlander","password":"pw"}',
      }),
    );
    serviceManager.getSuggestedEnv.mockResolvedValueOnce([
      { key: 'DATABASE_URL', value: 'postgresql://openlander:pw@ol-svc-shared-pg:5432/app' },
    ]);

    const ok = await tool.execute(
      { name: 'shared-pg', template: 'postgresql', scope: 'global' },
      { target: 'mcp' },
    );

    expect(ok).toEqual({
      status: 'created',
      scope: 'global',
      attached_to: null,
      service: {
        id: 'svc-created',
        name: 'shared-pg',
        type: 'postgresql',
        status: 'running',
        port: 5432,
        credentials: {
          host: 'ol-svc-shared-pg',
          port: 5432,
          user: 'openlander',
          password: 'pw',
        },
      },
      suggested_env: [
        { key: 'DATABASE_URL', value: 'postgresql://openlander:pw@ol-svc-shared-pg:5432/app' },
      ],
      externalAccess: [
        { host: '10.0.0.10', port: 5432, type: 'lan' },
        { host: '100.100.100.10', port: 5432, type: 'vpn' },
      ],
      _agent_guidance: {
        next_steps: [
          'This service is global/unassigned. Attach or link it to a deployable project before expecting runtime env to be available.',
          'Use get_service_credentials when you need the connection string manually.',
        ],
      },
    });

    serviceManager.create.mockRejectedValueOnce(new Error('Unsupported service template: bad'));
    await expect(
      tool.execute({ name: 'bad', template: 'bad', scope: 'global' }, { target: 'mcp' }),
    ).rejects.toThrow('Unsupported service template: bad');
  });

  it('create_service requires a project target unless global scope is explicit', async () => {
    const { ctx, serviceManager } = createMockContext();
    const tool = getTool(ctx, 'create_service');

    await expect(
      tool.execute({ name: 'shared-pg', template: 'postgresql' }, { target: 'mcp' }),
    ).resolves.toMatchObject({
      status: 'blocked',
      code: 'PROJECT_TARGET_REQUIRED',
      required_params: ['project_id | project_name | scope="global"'],
    });
    expect(serviceManager.create).not.toHaveBeenCalled();
  });

  it('create_service attaches to project_name and returns project scope', async () => {
    const { ctx, serviceManager } = createMockContext();
    const tool = getTool(ctx, 'create_service');

    serviceManager.create.mockResolvedValueOnce(
      createServiceRow({
        id: 'svc-created',
        name: 'myapp-pg',
        credentials: '{"connectionString":"postgresql://openlander:pw@ol-svc-myapp-pg:5432/app"}',
      }),
    );
    serviceManager.getSuggestedEnv.mockResolvedValueOnce([
      { key: 'DATABASE_URL', value: 'postgresql://openlander:pw@ol-svc-myapp-pg:5432/app' },
    ]);

    const result = await tool.execute(
      { name: 'myapp-pg', template: 'postgresql', project_name: 'myapp' },
      { target: 'mcp' },
    );

    expect(ctx.db.getProjectByName).toHaveBeenCalledWith('myapp');
    expect(ctx.db.attachServiceToProject).toHaveBeenCalledWith('svc-created', 'proj-1');
    expect(result).toMatchObject({
      status: 'created',
      scope: 'project',
      attached_to: 'proj-1',
      attached_project_name: 'myapp',
      suggested_env: [
        { key: 'DATABASE_URL', value: 'postgresql://openlander:pw@ol-svc-myapp-pg:5432/app' },
      ],
      _agent_guidance: {
        next_steps: expect.arrayContaining([expect.stringContaining('redeploy_app')]),
      },
    });
  });

  it('create_service returns retry-safe guidance after managed service rollback', async () => {
    const { ctx, serviceManager } = createMockContext();
    const tool = getTool(ctx, 'create_service');

    serviceManager.create.mockRejectedValueOnce(
      new ManagedServicePersistenceCleanedError('broken-redis', {
        serviceId: 'svc-broken',
        containerName: 'ol-svc-broken-redis',
        volumeName: 'ol-svc-data-broken-redis',
        hostPort: 10001,
        originalError: new Error('insert failed'),
      }),
    );

    await expect(
      tool.execute({ name: 'broken-redis', template: 'redis', scope: 'global' }, { target: 'mcp' }),
    ).resolves.toMatchObject({
      status: 'failed',
      error: 'MANAGED_SERVICE_PERSIST_FAILED_CLEANED',
      details: {
        retrySafe: true,
        rollback: {
          containerRemoved: true,
          volumeRemoved: true,
        },
      },
      _agent_guidance: {
        message: expect.stringContaining('safe to retry'),
      },
    });
  });

  it('create_service works for mysql template', async () => {
    const { ctx, serviceManager } = createMockContext();
    const tool = getTool(ctx, 'create_service');

    serviceManager.create.mockResolvedValueOnce(
      createServiceRow({
        id: 'svc-mysql',
        name: 'shared-mysql',
        type: 'mysql',
        port: 3306,
        credentials:
          '{"host":"ol-svc-shared-mysql","port":3306,"user":"openlander","password":"mysqlpw"}',
      }),
    );

    const result = await tool.execute(
      { name: 'shared-mysql', template: 'mysql', scope: 'global' },
      { target: 'mcp' },
    );

    expect(result).toEqual({
      status: 'created',
      scope: 'global',
      attached_to: null,
      service: {
        id: 'svc-mysql',
        name: 'shared-mysql',
        type: 'mysql',
        status: 'running',
        port: 3306,
        credentials: {
          host: 'ol-svc-shared-mysql',
          port: 3306,
          user: 'openlander',
          password: 'mysqlpw',
        },
      },
      suggested_env: [],
      externalAccess: [
        { host: '10.0.0.10', port: 3306, type: 'lan' },
        { host: '100.100.100.10', port: 3306, type: 'vpn' },
      ],
      _agent_guidance: {
        next_steps: [
          'This service is global/unassigned. Attach or link it to a deployable project before expecting runtime env to be available.',
          'Use get_service_credentials when you need the connection string manually.',
        ],
      },
    });
    expect(serviceManager.create).toHaveBeenCalledWith({ name: 'shared-mysql', template: 'mysql' });
  });

  it('create_service works for redis template', async () => {
    const { ctx, serviceManager } = createMockContext();
    const tool = getTool(ctx, 'create_service');

    serviceManager.create.mockResolvedValueOnce(
      createServiceRow({
        id: 'svc-redis',
        name: 'shared-redis',
        type: 'redis',
        port: 6379,
        credentials:
          '{"host":"ol-svc-shared-redis","port":6379,"connectionString":"redis://ol-svc-shared-redis:6379"}',
      }),
    );

    const result = await tool.execute(
      { name: 'shared-redis', template: 'redis', scope: 'global' },
      { target: 'mcp' },
    );

    expect(result).toEqual({
      status: 'created',
      scope: 'global',
      attached_to: null,
      service: {
        id: 'svc-redis',
        name: 'shared-redis',
        type: 'redis',
        status: 'running',
        port: 6379,
        credentials: {
          host: 'ol-svc-shared-redis',
          port: 6379,
          connectionString: 'redis://ol-svc-shared-redis:6379',
        },
      },
      suggested_env: [],
      externalAccess: [
        { host: '10.0.0.10', port: 6379, type: 'lan' },
        { host: '100.100.100.10', port: 6379, type: 'vpn' },
      ],
      _agent_guidance: {
        next_steps: [
          'This service is global/unassigned. Attach or link it to a deployable project before expecting runtime env to be available.',
          'Use get_service_credentials when you need the connection string manually.',
        ],
      },
    });
    expect(serviceManager.create).toHaveBeenCalledWith({ name: 'shared-redis', template: 'redis' });
  });

  it('list_services returns services and throws service-manager failures', async () => {
    const services = [
      createServiceRow({ id: 'svc-pg', name: 'shared-pg' }),
      createServiceRow({ id: 'svc-redis', name: 'shared-redis', type: 'redis', port: 6379 }),
      createServiceRow({
        id: 'app__svc',
        name: 'web',
        type: null,
        kind: 'git',
        port: null,
        assigned_port: 10001,
      }),
    ];
    const { ctx, serviceManager } = createMockContext(services);
    const tool = getTool(ctx, 'list_services');

    const ok = await tool.execute({}, { target: 'mcp' });
    expect(ok).toEqual({
      count: 2,
      services: expect.arrayContaining([
        expect.objectContaining({ id: 'svc-pg', name: 'shared-pg' }),
        expect.objectContaining({
          id: 'svc-redis',
          name: 'shared-redis',
          type: 'redis',
          port: 6379,
        }),
      ]),
      _agent_guidance: {
        networking: [
          'All containers are on the shared Docker network ("openlander"). Do NOT create Docker networks manually.',
          'For managed service containers, use http://ol-svc-{service-name}:{port} (DNS auto-resolved). Deployable app containers use http://ol-{project-name}:{port}.',
          'Networks are auto-managed by OpenLander. Manual docker network commands will cause conflicts.',
        ],
      },
    });

    serviceManager.list.mockRejectedValueOnce(new Error('Service list unavailable'));
    await expect(tool.execute({}, { target: 'mcp' })).rejects.toThrow('Service list unavailable');
  });

  it('list_services include_orphans returns unregistered service containers', async () => {
    const services = [createServiceRow({ id: 'svc-pg', name: 'shared-pg' })];
    const { ctx } = createMockContext(services, [
      {
        id: 'container-1',
        name: 'ol-svc-shared-pg',
        status: 'running',
        imageTag: 'postgres:16-alpine',
        labels: { 'openlander.role': 'service', 'openlander.service': 'shared-pg' },
      },
      {
        id: 'orphan-flaresolverr',
        name: 'ol-svc-flaresolverr',
        status: 'running',
        imageTag: 'ghcr.io/flaresolverr/flaresolverr:latest',
        port: 8191,
        labels: { 'openlander.role': 'service', 'openlander.service': 'flaresolverr' },
      },
    ]);
    const tool = getTool(ctx, 'list_services');

    const result = await tool.execute({ include_orphans: true }, { target: 'mcp' });

    expect(result).toMatchObject({
      count: 1,
      orphan_count: 1,
      orphan_services: [
        {
          id: 'orphan-flaresolverr',
          name: 'flaresolverr',
          containerName: 'ol-svc-flaresolverr',
          status: 'running',
          port: 8191,
        },
      ],
    });
  });

  it('get_service_status/start/stop/remove/get_credentials support happy and invalid service paths', async () => {
    const services = [
      createServiceRow({
        id: 'svc-pg',
        name: 'shared-pg',
        credentials: '{"host":"ol-svc-shared-pg","port":5432}',
      }),
    ];
    const { ctx, serviceManager } = createMockContext(services);

    const statusTool = getTool(ctx, 'get_service_status');
    const startTool = getTool(ctx, 'start_service');
    const stopTool = getTool(ctx, 'stop_service');
    const removeTool = getTool(ctx, 'remove_service');
    const credentialsTool = getTool(ctx, 'get_service_credentials');

    expect(await statusTool.execute({ service_name: 'shared-pg' }, { target: 'mcp' })).toEqual(
      expect.objectContaining({
        id: 'svc-pg',
        name: 'shared-pg',
        status: 'running',
        port: 5432,
        externalAccess: [
          { host: '10.0.0.10', port: 5432, type: 'lan' },
          { host: '100.100.100.10', port: 5432, type: 'vpn' },
        ],
      }),
    );
    expect(await statusTool.execute({ service_id: 'svc-pg' }, { target: 'mcp' })).toEqual(
      expect.objectContaining({
        id: 'svc-pg',
        name: 'shared-pg',
      }),
    );
    expect(await startTool.execute({ service_name: 'shared-pg' }, { target: 'mcp' })).toEqual({
      status: 'started',
      service: 'shared-pg',
    });
    expect(serviceManager.start).toHaveBeenCalledWith('svc-pg');

    expect(await stopTool.execute({ service_name: 'shared-pg' }, { target: 'mcp' })).toEqual({
      status: 'stopped',
      service: 'shared-pg',
    });
    expect(serviceManager.stop).toHaveBeenCalledWith('svc-pg');

    expect(
      await removeTool.execute({ service_name: 'shared-pg' }, { target: 'mcp' }),
    ).toMatchObject({
      status: 'removed',
      service: 'shared-pg',
    });
    expect(serviceManager.remove).toHaveBeenCalledWith('svc-pg', { force: false });

    expect(await credentialsTool.execute({ service_name: 'shared-pg' }, { target: 'mcp' })).toEqual(
      {
        service: 'shared-pg',
        type: 'postgresql',
        credentials: { host: 'ol-svc-shared-pg', port: 5432 },
        connectionString: null,
        host: 'ol-svc-shared-pg',
        port: 5432,
        user: null,
        password: null,
        database: null,
        externalAccess: [
          { host: '10.0.0.10', port: 5432, type: 'lan' },
          { host: '100.100.100.10', port: 5432, type: 'vpn' },
        ],
        externalConnectionStrings: [],
      },
    );
    expect(await credentialsTool.execute({ service_id: 'svc-pg' }, { target: 'mcp' })).toEqual(
      expect.objectContaining({
        service: 'shared-pg',
        type: 'postgresql',
      }),
    );

    for (const tool of [statusTool, startTool, stopTool, removeTool, credentialsTool]) {
      await expect(
        tool.execute({ service_name: 'missing-service' }, { target: 'mcp' }),
      ).rejects.toThrow('Service not found: missing-service');
    }
  });

  it('managed service status and credentials reject deployable app services with guidance', async () => {
    const services = [
      createServiceRow({
        id: 'app__svc',
        name: 'web',
        type: null,
        kind: 'git',
        port: null,
        assigned_port: 10001,
      }),
    ];
    const { ctx } = createMockContext(services);

    for (const toolName of ['get_service_status', 'get_service_credentials']) {
      const result = await getTool(ctx, toolName).execute(
        { service_id: 'app__svc' },
        { target: 'mcp' },
      );
      expect(result).toMatchObject({
        status: 'blocked',
        code: 'SERVICE_KIND_MISMATCH',
        service: { id: 'app__svc', kind: 'git' },
        _agent_guidance: {
          next_steps: expect.arrayContaining([expect.stringContaining('diagnose_service')]),
        },
      });
    }
  });

  it('create_service_user handles happy path, invalid service_name, and redis unsupported path', async () => {
    const services = [
      createServiceRow({ id: 'svc-pg', name: 'shared-pg', type: 'postgresql' }),
      createServiceRow({ id: 'svc-redis', name: 'shared-redis', type: 'redis', port: 6379 }),
    ];
    const { ctx, serviceManager } = createMockContext(services);
    const tool = getTool(ctx, 'create_service_user');

    serviceManager.createUser.mockResolvedValueOnce({
      user: 'appuser',
      password: 'pw123',
      database: 'appdb',
      connectionString: 'postgresql://appuser:pw123@ol-svc-shared-pg:5432/appdb',
    });

    const ok = await tool.execute(
      {
        service_name: 'shared-pg',
        username: 'appuser',
        password: 'pw123',
        database: 'appdb',
      },
      { target: 'mcp' },
    );
    expect(ok).toEqual({
      status: 'created',
      service: 'shared-pg',
      user: 'appuser',
      password: 'pw123',
      database: 'appdb',
      connectionString: 'postgresql://appuser:pw123@ol-svc-shared-pg:5432/appdb',
    });
    expect(serviceManager.createUser).toHaveBeenCalledWith('svc-pg', 'appuser', 'pw123', {
      database: 'appdb',
    });

    await expect(
      tool.execute({ service_name: 'missing-service', username: 'u1' }, { target: 'mcp' }),
    ).rejects.toThrow('Service not found: missing-service');

    serviceManager.createUser.mockRejectedValueOnce(
      new Error('User creation is not supported for redis services'),
    );
    await expect(
      tool.execute({ service_name: 'shared-redis', username: 'cache-user' }, { target: 'mcp' }),
    ).rejects.toThrow('User creation is not supported for redis services');
  });

  it('analyze_infrastructure returns analyzer contract and reports clone failures', async () => {
    const services = [createServiceRow({ id: 'svc-pg', name: 'shared-pg', type: 'postgresql' })];
    const { ctx, serviceManager } = createMockContext(services);
    const tool = getTool(ctx, 'analyze_infrastructure');

    mockCloneRepo.mockResolvedValueOnce({ path: '/tmp/repo', commitSha: 'abc123' });
    mockAnalyzeInfrastructure.mockReturnValueOnce({
      needs: [{ type: 'postgresql', detectedFrom: 'pg' }],
      available: [{ type: 'postgresql', name: 'shared-pg', id: 'svc-pg' }],
      missing: [],
    });

    const ok = await tool.execute(
      { repo_url: 'https://github.com/example/repo', branch: 'main' },
      { target: 'mcp' },
    );
    expect(ok).toEqual({
      needs: [{ type: 'postgresql', detectedFrom: 'pg' }],
      available: [{ type: 'postgresql', name: 'shared-pg', id: 'svc-pg' }],
      missing: [],
    });

    expect(mockCloneRepo).toHaveBeenCalledWith({
      repoUrl: 'https://github.com/example/repo',
      branch: 'main',
      sshKeyPath: undefined,
    });
    expect(serviceManager.list).toHaveBeenCalled();
    expect(mockAnalyzeInfrastructure).toHaveBeenCalledWith('/tmp/repo', services);

    mockCloneRepo.mockRejectedValueOnce(new Error('CLONE_FAILED'));
    await expect(
      tool.execute({ repo_url: 'https://github.com/example/bad' }, { target: 'mcp' }),
    ).rejects.toThrow('CLONE_FAILED');
  });
});
