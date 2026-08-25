import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../src/app.js';
import type { ServiceRow } from '../src/db/index.js';
import {
  ManagedServiceNameConflictError,
  ManagedServicePersistenceCleanedError,
} from '../src/errors.js';
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
    case 'neo4j':
      return 'neo4j';
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
    project_id: partial.project_id ?? 'proj-1',
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
      listProjects: vi.fn(async () => [{ id: 'proj-1', name: 'myapp' }]),
      getProjectByName: vi.fn(async (name: string) =>
        name === 'myapp' ? { id: 'proj-1', name: 'myapp' } : undefined,
      ),
      attachServiceToProject: vi.fn(async (_serviceId: string, targetProjectId: string) => ({
        sourceProjectId: '__orphan_managed',
        targetProjectId,
        droppedEnvVarKeys: [],
        droppedSecretFiles: [],
      })),
      upsertServiceConnection: vi.fn(async () => undefined),
      getServiceConnectionByProjectAndService: vi.fn(async () => ({ id: 'conn-1' })),
      updateServiceConnection: vi.fn(async () => undefined),
      listServiceConnectionsByProject: vi.fn(async () => [{ service_id_provider: 'svc-created' }]),
      getDeployableForProject: vi.fn(async (projectId: string) => ({
        id: `${projectId}__svc`,
      })),
      getDeployablesByGroup: vi.fn(async (projectId: string) => [
        {
          id: `${projectId}__svc`,
          name: 'myapp-web',
          kind: 'app',
        },
      ]),
      createProjectDependency: vi.fn(async () => undefined),
      insertActivityLog: vi.fn(async () => undefined),
    },
    env: {
      getAll: vi.fn(async () => ({})),
      getAllForService: vi.fn(async () => ({})),
      set: vi.fn(async () => true),
      setBulkForService: vi.fn(async () => true),
    },
    docker: {
      ensureProjectNetwork: vi.fn(async (projectName: string) => `ol-${projectName}`),
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
        name: 'myapp-pg',
        credentials: '{"host":"ol-svc-shared-pg","port":5432,"user":"openlander","password":"pw"}',
      }),
    );
    serviceManager.getSuggestedEnv.mockResolvedValueOnce([
      { key: 'DATABASE_URL', value: 'postgresql://openlander:pw@ol-svc-shared-pg:5432/app' },
    ]);

    const ok = await tool.execute(
      { name: 'myapp-pg', template: 'postgresql', project_name: 'myapp' },
      { target: 'mcp' },
    );

    expect(ok).toEqual({
      status: 'created',
      scope: 'project',
      attached_to: 'proj-1',
      attached_project_name: 'myapp',
      service: {
        id: 'svc-created',
        name: 'myapp-pg',
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
      auto_injected_env_keys: ['DATABASE_URL'],
      externalAccess: [
        { host: '10.0.0.10', port: 5432, type: 'lan' },
        { host: '100.100.100.10', port: 5432, type: 'vpn' },
      ],
      _agent_guidance: {
        message: expect.stringContaining(
          'Keep DATABASE_URL as the only PostgreSQL connection secret',
        ),
        next_steps: [
          'Connection env was saved automatically on the target Application/Compose workload.',
          'Call update_app for the target service/project to apply it.',
        ],
      },
    });
    expect(serviceManager.getSuggestedEnv.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(ctx.env.setBulkForService).mock.invocationCallOrder[0]!,
    );

    serviceManager.create.mockRejectedValueOnce(new Error('Unsupported service template: bad'));
    await expect(
      tool.execute({ name: 'bad', template: 'bad', project_name: 'myapp' }, { target: 'mcp' }),
    ).rejects.toThrow('Unsupported service template: bad');
  });

  it('create_service requires a project target', async () => {
    const { ctx, serviceManager } = createMockContext();
    const tool = getTool(ctx, 'create_service');

    await expect(
      tool.execute({ name: 'shared-pg', template: 'postgresql' }, { target: 'mcp' }),
    ).resolves.toMatchObject({
      status: 'blocked',
      code: 'PROJECT_TARGET_REQUIRED',
      required_params: ['project_id | project_name'],
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
    expect(ctx.docker.ensureProjectNetwork).toHaveBeenCalledWith('myapp');
    expect(serviceManager.create).toHaveBeenCalledWith({
      name: 'myapp-pg',
      projectId: 'proj-1',
      template: 'postgresql',
      network: 'ol-myapp',
      aliases: ['myapp-pg'],
    });
    expect(ctx.db.attachServiceToProject).toHaveBeenCalledWith('svc-created', 'proj-1');
    expect(ctx.db.upsertServiceConnection).toHaveBeenCalledWith({
      projectId: 'proj-1',
      serviceId: 'svc-created',
      consumerServiceId: 'proj-1__svc',
    });
    expect(ctx.env.setBulkForService).toHaveBeenCalledWith('proj-1', 'proj-1__svc', {
      DATABASE_URL: 'postgresql://openlander:pw@ol-svc-myapp-pg:5432/app',
    });
    expect(ctx.db.updateServiceConnection).toHaveBeenCalledWith('conn-1', {
      autoInjectedEnvKeys: JSON.stringify(['DATABASE_URL']),
    });
    expect(ctx.db.createProjectDependency).toHaveBeenCalledWith({
      source_service_id: 'proj-1__svc',
      target_service_id: 'svc-created',
      dependency_type: 'database',
      source: 'auto',
    });
    expect(result).toMatchObject({
      status: 'created',
      scope: 'project',
      attached_to: 'proj-1',
      attached_project_name: 'myapp',
      suggested_env: [
        { key: 'DATABASE_URL', value: 'postgresql://openlander:pw@ol-svc-myapp-pg:5432/app' },
      ],
      auto_injected_env_keys: ['DATABASE_URL'],
      _agent_guidance: {
        next_steps: expect.arrayContaining([expect.stringContaining('update_app')]),
      },
    });
  });

  it('uses the same prefixed key for suggested and auto-injected env', async () => {
    const { ctx, serviceManager } = createMockContext();
    const tool = getTool(ctx, 'create_service');
    const connectionString = 'postgresql://openlander:pw@ol-svc-analytics-pg:5432/app';

    serviceManager.create.mockResolvedValueOnce(
      createServiceRow({
        id: 'svc-analytics',
        name: 'analytics-pg',
        credentials: JSON.stringify({ connectionString }),
      }),
    );
    serviceManager.getSuggestedEnv.mockResolvedValueOnce([
      { key: 'ANALYTICS_PG_DATABASE_URL', value: connectionString },
    ]);

    const result = await tool.execute(
      { name: 'analytics-pg', template: 'postgresql', project_name: 'myapp' },
      { target: 'mcp' },
    );

    expect(ctx.env.setBulkForService).toHaveBeenCalledWith('proj-1', 'proj-1__svc', {
      ANALYTICS_PG_DATABASE_URL: connectionString,
    });
    expect(result).toMatchObject({
      suggested_env: [{ key: 'ANALYTICS_PG_DATABASE_URL', value: connectionString }],
      auto_injected_env_keys: ['ANALYTICS_PG_DATABASE_URL'],
    });
  });

  it('keeps DATABASE_URL as the only connection env and guides AGE behind an adapter', async () => {
    const { ctx, serviceManager } = createMockContext();
    const tool = getTool(ctx, 'create_service');
    const connectionString = 'postgresql://openlander:pw@ol-svc-graph-pg:5432/app';

    serviceManager.create.mockResolvedValueOnce(
      createServiceRow({
        id: 'svc-graph-pg',
        name: 'graph-pg',
        type: 'postgresql',
        kind: 'postgres',
        image: 'apache/age:release_PG17_1.6.0',
        image_url: 'apache/age:release_PG17_1.6.0',
        credentials: JSON.stringify({ connectionString }),
      }),
    );
    serviceManager.getSuggestedEnv.mockResolvedValueOnce([
      { key: 'DATABASE_URL', value: connectionString },
    ]);

    const result = await tool.execute(
      {
        name: 'graph-pg',
        template: 'postgresql',
        image: 'apache/age:release_PG17_1.6.0',
        project_name: 'myapp',
      },
      { target: 'mcp' },
    );

    expect(serviceManager.create).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'postgresql',
        image: 'apache/age:release_PG17_1.6.0',
      }),
    );
    expect(result).toMatchObject({
      suggested_env: [{ key: 'DATABASE_URL', value: connectionString }],
      auto_injected_env_keys: ['DATABASE_URL'],
      _agent_guidance: {
        message: expect.stringContaining('GRAPH_STORE_BACKEND=age'),
      },
    });
    expect((result as { _agent_guidance: { message: string } })._agent_guidance.message).toContain(
      'GraphRepository',
    );
  });

  it('create_service points empty project groups at first deploy_app attach', async () => {
    const { ctx, serviceManager } = createMockContext();
    const db = ctx.db as unknown as {
      getDeployableForProject: ReturnType<typeof vi.fn>;
      getDeployablesByGroup: ReturnType<typeof vi.fn>;
    };
    // Empty group across every lookup: the linker's consumer resolution AND the
    // tool's projectHasDeployableService check both read getDeployablesByGroup.
    db.getDeployableForProject.mockResolvedValue(null);
    db.getDeployablesByGroup.mockResolvedValue([]);
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

    const result = (await tool.execute(
      { name: 'myapp-pg', template: 'postgresql', project_id: 'proj-1' },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'created',
      attached_to: 'proj-1',
      auto_injected_env_keys: ['DATABASE_URL'],
      suggested_call: {
        tool: 'openlander_deploy',
        arguments: {
          action: 'deploy_app',
          params: {
            target_project_id: 'proj-1',
            name: '<app-service-name>',
            repo_url: '<git-repo-url>',
          },
        },
      },
      _agent_guidance: {
        next_steps: expect.arrayContaining([expect.stringContaining('empty Project')]),
      },
    });
    expect(ctx.env.set).toHaveBeenCalledWith('proj-1', 'DATABASE_URL', expect.any(String));
    expect(ctx.db.upsertServiceConnection).not.toHaveBeenCalled();
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
      tool.execute(
        { name: 'broken-redis', template: 'redis', project_name: 'myapp' },
        { target: 'mcp' },
      ),
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

  it('create_service returns orphan-inspection guidance on Docker name conflict', async () => {
    const { ctx, serviceManager } = createMockContext();
    const tool = getTool(ctx, 'create_service');

    serviceManager.create.mockRejectedValueOnce(
      new ManagedServiceNameConflictError('urlnest-db', {
        containerName: 'ol-svc-urlnest-db',
        volumeName: 'ol-svc-data-urlnest-db',
        volumeRolledBack: true,
      }),
    );

    await expect(
      tool.execute(
        { name: 'urlnest-db', template: 'postgresql', project_name: 'myapp' },
        { target: 'mcp' },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: 'MANAGED_SERVICE_NAME_CONFLICT',
      suggested_call: {
        tool: 'openlander_managed_service',
        arguments: {
          action: 'list_services',
          params: { include_orphans: true },
        },
      },
      details: {
        containerName: 'ol-svc-urlnest-db',
        retrySafe: false,
      },
      _agent_guidance: {
        next_steps: expect.arrayContaining([
          expect.stringContaining('include_orphans=true'),
          expect.stringContaining('choose a different Database/Cache/Storage resource name'),
        ]),
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
          '{"host":"ol-svc-shared-mysql","port":3306,"user":"openlander","password":"mysqlpw","connectionString":"mysql://openlander:mysqlpw@ol-svc-shared-mysql:3306/app"}',
      }),
    );
    serviceManager.getSuggestedEnv.mockResolvedValueOnce([
      {
        key: 'DATABASE_URL',
        value: 'mysql://openlander:mysqlpw@ol-svc-shared-mysql:3306/app',
      },
    ]);

    const result = await tool.execute(
      { name: 'shared-mysql', template: 'mysql', project_name: 'myapp' },
      { target: 'mcp' },
    );

    expect(result).toEqual({
      status: 'created',
      scope: 'project',
      attached_to: 'proj-1',
      attached_project_name: 'myapp',
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
          connectionString: 'mysql://openlander:mysqlpw@ol-svc-shared-mysql:3306/app',
        },
      },
      suggested_env: [
        {
          key: 'DATABASE_URL',
          value: 'mysql://openlander:mysqlpw@ol-svc-shared-mysql:3306/app',
        },
      ],
      auto_injected_env_keys: ['DATABASE_URL'],
      externalAccess: [
        { host: '10.0.0.10', port: 3306, type: 'lan' },
        { host: '100.100.100.10', port: 3306, type: 'vpn' },
      ],
      _agent_guidance: {
        next_steps: [
          'Connection env was saved automatically on the target Application/Compose workload.',
          'Call update_app for the target service/project to apply it.',
        ],
      },
    });
    expect(serviceManager.create).toHaveBeenCalledWith({
      name: 'shared-mysql',
      projectId: 'proj-1',
      template: 'mysql',
      network: 'ol-myapp',
      aliases: ['shared-mysql'],
    });
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
    serviceManager.getSuggestedEnv.mockResolvedValueOnce([
      { key: 'REDIS_URL', value: 'redis://ol-svc-shared-redis:6379' },
    ]);

    const result = await tool.execute(
      { name: 'shared-redis', template: 'redis', project_name: 'myapp' },
      { target: 'mcp' },
    );

    expect(result).toEqual({
      status: 'created',
      scope: 'project',
      attached_to: 'proj-1',
      attached_project_name: 'myapp',
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
      suggested_env: [{ key: 'REDIS_URL', value: 'redis://ol-svc-shared-redis:6379' }],
      auto_injected_env_keys: ['REDIS_URL'],
      externalAccess: [
        { host: '10.0.0.10', port: 6379, type: 'lan' },
        { host: '100.100.100.10', port: 6379, type: 'vpn' },
      ],
      _agent_guidance: {
        next_steps: [
          'Connection env was saved automatically on the target Application/Compose workload.',
          'Call update_app for the target service/project to apply it.',
        ],
      },
    });
    expect(serviceManager.create).toHaveBeenCalledWith({
      name: 'shared-redis',
      projectId: 'proj-1',
      template: 'redis',
      network: 'ol-myapp',
      aliases: ['shared-redis'],
    });
  });

  it('create_service wires Neo4j URI, username, and password into the project', async () => {
    const { ctx, serviceManager } = createMockContext();
    const tool = getTool(ctx, 'create_service');
    serviceManager.create.mockResolvedValueOnce(
      createServiceRow({
        id: 'svc-neo4j',
        name: 'app-graph',
        type: 'neo4j',
        kind: 'neo4j',
        image: 'neo4j:2026.07.1',
        port: 7687,
        credentials: JSON.stringify({
          host: 'ol-svc-app-graph',
          port: 7687,
          user: 'neo4j',
          password: 'graphpw',
          database: 'neo4j',
          connectionString: 'neo4j://ol-svc-app-graph:7687',
        }),
      }),
    );
    serviceManager.getSuggestedEnv.mockResolvedValueOnce([
      { key: 'NEO4J_URI', value: 'neo4j://ol-svc-app-graph:7687' },
      { key: 'NEO4J_USERNAME', value: 'neo4j' },
      { key: 'NEO4J_PASSWORD', value: 'graphpw' },
    ]);

    const result = await tool.execute(
      { name: 'app-graph', template: 'neo4j', project_name: 'myapp' },
      { target: 'mcp' },
    );

    expect(serviceManager.create).toHaveBeenCalledWith({
      name: 'app-graph',
      projectId: 'proj-1',
      template: 'neo4j',
      network: 'ol-myapp',
      aliases: ['app-graph'],
    });
    expect(ctx.env.setBulkForService).toHaveBeenCalledWith('proj-1', 'proj-1__svc', {
      NEO4J_URI: 'neo4j://ol-svc-app-graph:7687',
      NEO4J_USERNAME: 'neo4j',
      NEO4J_PASSWORD: 'graphpw',
    });
    expect(ctx.db.createProjectDependency).toHaveBeenCalledWith(
      expect.objectContaining({ dependency_type: 'database' }),
    );
    expect(result).toMatchObject({
      status: 'created',
      service: { id: 'svc-neo4j', type: 'neo4j', port: 7687 },
      suggested_env: [
        { key: 'NEO4J_URI', value: 'neo4j://ol-svc-app-graph:7687' },
        { key: 'NEO4J_USERNAME', value: 'neo4j' },
        { key: 'NEO4J_PASSWORD', value: 'graphpw' },
      ],
      auto_injected_env_keys: ['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD'],
    });
  });

  it('create_service injects provider-neutral MinIO env without rewriting legacy keys', async () => {
    const { ctx, serviceManager } = createMockContext();
    const tool = getTool(ctx, 'create_service');
    serviceManager.create.mockResolvedValueOnce(
      createServiceRow({
        id: 'svc-minio',
        name: 'app-storage',
        type: 'minio',
        kind: 'minio',
        image: 'minio/minio:RELEASE.2024-11-07T00-52-20Z',
        port: 9000,
        credentials: JSON.stringify({
          host: 'ol-svc-app-storage',
          port: 9000,
          user: 'openlander',
          password: 'storagepw',
          connectionString: 'http://ol-svc-app-storage:9000',
        }),
      }),
    );
    serviceManager.getSuggestedEnv.mockResolvedValueOnce([
      { key: 'OBJECT_STORAGE_ENDPOINT', value: 'http://ol-svc-app-storage:9000' },
      { key: 'OBJECT_STORAGE_ACCESS_KEY', value: 'openlander' },
      { key: 'OBJECT_STORAGE_SECRET_KEY', value: 'storagepw' },
      { key: 'OBJECT_STORAGE_PROVIDER', value: 'minio' },
    ]);

    const result = await tool.execute(
      { name: 'app-storage', template: 'minio', project_name: 'myapp' },
      { target: 'mcp' },
    );

    expect(ctx.env.setBulkForService).toHaveBeenCalledWith('proj-1', 'proj-1__svc', {
      OBJECT_STORAGE_ENDPOINT: 'http://ol-svc-app-storage:9000',
      OBJECT_STORAGE_ACCESS_KEY: 'openlander',
      OBJECT_STORAGE_SECRET_KEY: 'storagepw',
      OBJECT_STORAGE_PROVIDER: 'minio',
    });
    expect(result).toMatchObject({
      status: 'created',
      service: { id: 'svc-minio', type: 'minio', port: 9000 },
      suggested_env: [
        { key: 'OBJECT_STORAGE_ENDPOINT', value: 'http://ol-svc-app-storage:9000' },
        { key: 'OBJECT_STORAGE_ACCESS_KEY', value: 'openlander' },
        { key: 'OBJECT_STORAGE_SECRET_KEY', value: 'storagepw' },
        { key: 'OBJECT_STORAGE_PROVIDER', value: 'minio' },
      ],
      auto_injected_env_keys: [
        'OBJECT_STORAGE_ENDPOINT',
        'OBJECT_STORAGE_ACCESS_KEY',
        'OBJECT_STORAGE_SECRET_KEY',
        'OBJECT_STORAGE_PROVIDER',
      ],
      _agent_guidance: {
        message: expect.stringContaining('object-storage adapter'),
        next_steps: [
          'Connection env was saved automatically on the target Application/Compose workload.',
          'Call update_app for the target service/project to apply it.',
        ],
      },
    });
    expect(JSON.stringify(result)).toContain('logical store plus object key');
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
          kind: 'redis',
          type: 'redis',
          port: 6379,
          scope: 'project',
          attached_to: 'proj-1',
          attached_project_id: 'proj-1',
          attached_project_name: 'myapp',
          network: 'ol-myapp',
        }),
      ]),
      _agent_guidance: {
        networking: [
          'Database/Cache/Storage resources created through MCP are Project-scoped and attached only to their Project Docker network.',
          'Create app databases/caches in the same Project as the app that uses them. Cross-project shared resources are not exposed in OpenLander 0.1.',
          'For existing Docker/PaaS migrations, inspect and back up existing volumes before changing network attachments.',
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
        network: 'ol-myapp',
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
    expect(ctx.db.insertActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'credential:reveal',
        project_id: 'proj-1',
        correlation_id: 'svc-pg',
      }),
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
