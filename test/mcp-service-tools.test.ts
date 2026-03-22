import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../src/app.js';
import type { ServiceRow } from '../src/db/index.js';
import * as gitPipeline from '../src/pipeline/git.js';
import * as traefikPipeline from '../src/pipeline/traefik.js';
import * as infraAnalyzer from '../src/lib/infra-analyzer.js';
import * as webSearchModule from '../src/lib/web-search.js';
import { createSharedToolRegistry } from './tools/shared-tool-registry.js';

const mockCloneRepo = vi.fn();
const mockAnalyzeInfrastructure = vi.fn();
const mockWebSearch = vi.fn();

function createServiceRow(partial: Partial<ServiceRow>): ServiceRow {
  return {
    id: partial.id ?? 'svc-1',
    name: partial.name ?? 'shared-pg',
    type: partial.type ?? 'postgresql',
    image: partial.image ?? 'postgres:16-alpine',
    status: partial.status ?? 'running',
    container_id: partial.container_id ?? 'container-1',
    container_name: partial.container_name ?? 'ol-svc-shared-pg',
    port: partial.port ?? 5432,
    env_vars: partial.env_vars ?? null,
    credentials: partial.credentials ?? null,
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-01-01T00:00:00.000Z',
  };
}

function createMockContext(services: ServiceRow[] = []) {
  const serviceManager = {
    create: vi.fn(),
    list: vi.fn(async () => services),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    createDatabase: vi.fn(),
    createUser: vi.fn(),
    getSuggestedEnv: vi.fn(() => []),
  };

  const ctx = {
    config: {
      git: {
        sshKeyPath: '',
      },
    },
    serviceManager,
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
      'create_service_database',
      'create_service_user',
      'analyze_infrastructure',
      'web_search',
    ]) {
      expect(names).toContain(toolName);
    }
  });

  it('enforces service_name contracts for service lookup tools', () => {
    const { ctx } = createMockContext();
    const requiredServiceNameTools = [
      'get_service_status',
      'start_service',
      'stop_service',
      'remove_service',
      'get_service_credentials',
      'create_service_database',
      'create_service_user',
    ];

    for (const name of requiredServiceNameTools) {
      const tool = getTool(ctx, name);
      expect(tool.inputSchema.safeParse({ service_id: 'svc-1' }).success).toBe(false);
    }

    expect(
      getTool(ctx, 'create_service_database').inputSchema.safeParse({
        service_name: 'shared-pg',
        database_name: 'appdb',
      }).success,
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

    const ok = await tool.execute({ name: 'shared-pg', template: 'postgresql' }, { target: 'mcp' });

    expect(ok).toEqual({
      status: 'created',
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
      suggested_env: [],
      externalAccess: [
        { host: '10.0.0.10', port: 5432, type: 'lan' },
        { host: '100.100.100.10', port: 5432, type: 'vpn' },
      ],
      _agent_guidance: {
        next_steps: [
          'Call set_env_vars to link this service to your project (e.g., DATABASE_URL, REDIS_URL).',
          'Then redeploy the project with create_deploy_plan + execute_deploy_plan for changes to take effect.',
        ],
      },
    });

    serviceManager.create.mockRejectedValueOnce(new Error('Unsupported service template: bad'));
    await expect(tool.execute({ name: 'bad', template: 'bad' }, { target: 'mcp' })).rejects.toThrow(
      'Unsupported service template: bad',
    );
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
      { name: 'shared-mysql', template: 'mysql' },
      { target: 'mcp' },
    );

    expect(result).toEqual({
      status: 'created',
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
          'Call set_env_vars to link this service to your project (e.g., DATABASE_URL, REDIS_URL).',
          'Then redeploy the project with create_deploy_plan + execute_deploy_plan for changes to take effect.',
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
      { name: 'shared-redis', template: 'redis' },
      { target: 'mcp' },
    );

    expect(result).toEqual({
      status: 'created',
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
          'Call set_env_vars to link this service to your project (e.g., DATABASE_URL, REDIS_URL).',
          'Then redeploy the project with create_deploy_plan + execute_deploy_plan for changes to take effect.',
        ],
      },
    });
    expect(serviceManager.create).toHaveBeenCalledWith({ name: 'shared-redis', template: 'redis' });
  });

  it('list_services returns services and throws service-manager failures', async () => {
    const services = [
      createServiceRow({ id: 'svc-pg', name: 'shared-pg' }),
      createServiceRow({ id: 'svc-redis', name: 'shared-redis', type: 'redis', port: 6379 }),
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
    });

    serviceManager.list.mockRejectedValueOnce(new Error('Service list unavailable'));
    await expect(tool.execute({}, { target: 'mcp' })).rejects.toThrow('Service list unavailable');
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
    expect(serviceManager.remove).toHaveBeenCalledWith('svc-pg');

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

    for (const tool of [statusTool, startTool, stopTool, removeTool, credentialsTool]) {
      await expect(
        tool.execute({ service_name: 'missing-service' }, { target: 'mcp' }),
      ).rejects.toThrow('Service not found: missing-service');
    }
  });

  it('create_service_database handles happy path, invalid service_name, and redis unsupported path', async () => {
    const services = [
      createServiceRow({ id: 'svc-pg', name: 'shared-pg', type: 'postgresql' }),
      createServiceRow({ id: 'svc-redis', name: 'shared-redis', type: 'redis', port: 6379 }),
    ];
    const { ctx, serviceManager } = createMockContext(services);
    const tool = getTool(ctx, 'create_service_database');

    serviceManager.createDatabase.mockResolvedValueOnce({
      database: 'appdb',
      user: 'openlander',
      password: 'secret',
      connectionString: 'postgresql://openlander:secret@ol-svc-shared-pg:5432/appdb',
    });

    const ok = await tool.execute(
      { service_name: 'shared-pg', database_name: 'appdb' },
      { target: 'mcp' },
    );
    expect(ok).toEqual({
      status: 'created',
      service: 'shared-pg',
      database: 'appdb',
      user: 'openlander',
      password: 'secret',
      connectionString: 'postgresql://openlander:secret@ol-svc-shared-pg:5432/appdb',
    });
    expect(serviceManager.createDatabase).toHaveBeenCalledWith('svc-pg', 'appdb');

    await expect(
      tool.execute({ service_name: 'missing-service', database_name: 'appdb' }, { target: 'mcp' }),
    ).rejects.toThrow('Service not found: missing-service');

    serviceManager.createDatabase.mockRejectedValueOnce(
      new Error('Database creation is not supported for redis services'),
    );
    await expect(
      tool.execute({ service_name: 'shared-redis', database_name: 'cachedb' }, { target: 'mcp' }),
    ).rejects.toThrow('Database creation is not supported for redis services');
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

  it('web_search returns { results } and reports failures', async () => {
    const { ctx } = createMockContext();
    const tool = getTool(ctx, 'web_search');

    mockWebSearch.mockResolvedValueOnce({
      results: [{ title: 'OpenLander', url: 'https://example.com', snippet: 'Deploy fast' }],
    });

    const ok = await tool.execute({ query: 'openlander', max_results: 3 }, { target: 'mcp' });
    expect(ok).toEqual({
      results: [{ title: 'OpenLander', url: 'https://example.com', snippet: 'Deploy fast' }],
    });
    expect(mockWebSearch).toHaveBeenCalledWith('openlander', { maxResults: 3 });

    mockWebSearch.mockRejectedValueOnce(new Error('Search backend unavailable'));
    await expect(tool.execute({ query: 'openlander' }, { target: 'mcp' })).rejects.toThrow(
      'Search backend unavailable',
    );
  });
});
