import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { getLogBuffer } from '../../src/lib/log-buffer.js';
import { platformDebugToolDefs } from '../../src/tools/defs/platform-debug.js';

function createMockPlatformDebugContext() {
  const inspectContainer = vi.fn();
  const listAllContainers = vi.fn<() => Promise<unknown[]>>(async () => []);
  const listManagedContainers = vi.fn<() => Promise<unknown[]>>(async () => []);

  const listProjects = vi.fn<() => unknown[]>(() => []);
  const getEnvironmentsByProject = vi.fn<(projectId: string) => unknown[]>(() => []);
  const listServices = vi.fn<() => unknown[]>(() => []);
  const getDeployLogs = vi.fn<(projectId: string, limit?: number) => unknown[]>(() => []);
  const getTimelineEvents = vi.fn<(projectId: string, limit?: number) => unknown[]>(() => []);
  const listDomainMappings = vi.fn<() => unknown[]>(() => []);
  const getDomainMappings = vi.fn<(projectId: string) => unknown[]>(() => []);
  const getWebhookConfigs = vi.fn<(projectId: string) => unknown[]>(() => []);
  const loadDeployConfig = vi.fn(() => undefined);

  const ctx = {
    docker: {
      inspectContainer,
      listAllContainers,
      listManagedContainers,
    },
    db: {
      listProjects,
      getEnvironmentsByProject,
      listServices,
      getDeployLogs,
      getTimelineEvents,
      listDomainMappings,
      getDomainMappings,
      getWebhookConfigs,
      loadDeployConfig,
    },
  } as unknown as AppContext;

  return {
    ctx,
    dockerMocks: {
      inspectContainer,
      listAllContainers,
      listManagedContainers,
    },
    dbMocks: {
      listProjects,
      getEnvironmentsByProject,
      listServices,
      getDeployLogs,
      getTimelineEvents,
      listDomainMappings,
      getDomainMappings,
      getWebhookConfigs,
      loadDeployConfig,
    },
  };
}

function getTool(name: string) {
  const tool = platformDebugToolDefs.find((def) => def.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe('platform-debug tools', () => {
  beforeEach(() => {
    getLogBuffer().clear();
    vi.restoreAllMocks();
  });

  it('defines exactly four MCP-only tools', () => {
    expect(platformDebugToolDefs).toHaveLength(4);
    expect(platformDebugToolDefs.map((tool) => tool.name)).toEqual([
      'platform_logs',
      'platform_docker_inspect',
      'platform_docker_ps',
      'platform_db_inspect',
    ]);
    for (const tool of platformDebugToolDefs) {
      expect(tool.targets).toEqual(['mcp']);
    }
  });

  it('platform_logs applies level filtering', async () => {
    const { ctx } = createMockPlatformDebugContext();
    const now = Date.now();
    getLogBuffer().push({ level: 20, msg: 'debug', module: 'deploy', timestamp: now - 2000 });
    getLogBuffer().push({ level: 30, msg: 'info', module: 'deploy', timestamp: now - 1000 });
    getLogBuffer().push({ level: 50, msg: 'error', module: 'deploy', timestamp: now });

    const result = (await getTool('platform_logs').execute(
      { level: 'info' },
      { target: 'mcp', appCtx: ctx },
    )) as {
      count: number;
      logs: Array<{ msg: string; level: number }>;
    };

    expect(result.count).toBe(2);
    expect(result.logs.map((entry) => entry.msg)).toEqual(['info', 'error']);
    expect(result.logs.every((entry) => entry.level >= 30)).toBe(true);
  });

  it('platform_logs applies module filtering', async () => {
    const { ctx } = createMockPlatformDebugContext();
    const now = Date.now();
    getLogBuffer().push({ level: 30, msg: 'deploy log', module: 'deploy', timestamp: now });
    getLogBuffer().push({ level: 30, msg: 'git log', module: 'git', timestamp: now });

    const result = (await getTool('platform_logs').execute(
      { module: 'git' },
      { target: 'mcp', appCtx: ctx },
    )) as {
      count: number;
      logs: Array<{ module?: string; msg: string }>;
    };

    expect(result.count).toBe(1);
    expect(result.logs[0]?.module).toBe('git');
    expect(result.logs[0]?.msg).toBe('git log');
  });

  it('platform_logs applies since_minutes filtering', async () => {
    const { ctx } = createMockPlatformDebugContext();
    getLogBuffer().push({ level: 30, msg: 'old', module: 'deploy', timestamp: 1000 });
    getLogBuffer().push({ level: 30, msg: 'fresh', module: 'deploy', timestamp: 120000 });
    vi.spyOn(Date, 'now').mockReturnValue(130000);

    const result = (await getTool('platform_logs').execute(
      { since_minutes: 1 },
      { target: 'mcp', appCtx: ctx },
    )) as {
      count: number;
      logs: Array<{ msg: string }>;
    };

    expect(result.count).toBe(1);
    expect(result.logs[0]?.msg).toBe('fresh');
  });

  it('platform_docker_inspect returns raw inspect response', async () => {
    const { ctx, dockerMocks } = createMockPlatformDebugContext();
    dockerMocks.inspectContainer.mockResolvedValueOnce({ Id: 'abc123', State: { Running: true } });

    const result = await getTool('platform_docker_inspect').execute(
      { container_id: 'abc123' },
      { target: 'mcp', appCtx: ctx },
    );

    expect(dockerMocks.inspectContainer).toHaveBeenCalledWith('abc123');
    expect(result).toEqual({ Id: 'abc123', State: { Running: true } });
  });

  it('platform_docker_inspect throws CONTAINER_NOT_FOUND on missing container', async () => {
    const { ctx, dockerMocks } = createMockPlatformDebugContext();
    dockerMocks.inspectContainer.mockRejectedValueOnce(new Error('No such container: missing'));

    await expect(
      getTool('platform_docker_inspect').execute(
        { container_id: 'missing' },
        { target: 'mcp', appCtx: ctx },
      ),
    ).rejects.toThrow('CONTAINER_NOT_FOUND: missing');
  });

  it('platform_docker_ps uses managed container list when filter_managed=true', async () => {
    const { ctx, dockerMocks } = createMockPlatformDebugContext();
    dockerMocks.listManagedContainers.mockResolvedValueOnce([
      {
        id: 'm1',
        name: 'ol-app',
        status: 'running',
        imageTag: 'openlander/app:latest',
        labels: { 'openlander.managed': 'true' },
        port: 8080,
      },
    ]);

    const result = (await getTool('platform_docker_ps').execute(
      { filter_managed: true },
      { target: 'mcp', appCtx: ctx },
    )) as {
      count: number;
      containers: Array<{ id: string; image: string; ports: Array<{ PublicPort?: number }> }>;
    };

    expect(dockerMocks.listManagedContainers).toHaveBeenCalledTimes(1);
    expect(dockerMocks.listAllContainers).not.toHaveBeenCalled();
    expect(result.count).toBe(1);
    expect(result.containers[0]).toEqual(
      expect.objectContaining({ id: 'm1', image: 'openlander/app:latest' }),
    );
    expect(result.containers[0]?.ports[0]?.PublicPort).toBe(8080);
  });

  it('platform_docker_ps uses docker client listContainers when filter_managed=false', async () => {
    const { ctx, dockerMocks } = createMockPlatformDebugContext();
    dockerMocks.listAllContainers.mockResolvedValueOnce([
      {
        id: 'c1',
        name: 'plain-container',
        image: 'nginx:latest',
        status: 'Up 1 minute',
        state: 'running',
        created: 123,
        labels: { a: 'b' },
        ports: [{ IP: '0.0.0.0', PublicPort: 80, PrivatePort: 80, Type: 'tcp' }],
      },
    ]);

    const result = (await getTool('platform_docker_ps').execute(
      { all: true, filter_managed: false },
      { target: 'mcp', appCtx: ctx },
    )) as {
      count: number;
      containers: Array<{ id: string; name: string; state: string }>;
    };

    expect(dockerMocks.listAllContainers).toHaveBeenCalledTimes(1);
    expect(result.count).toBe(1);
    expect(result.containers[0]).toEqual(
      expect.objectContaining({ id: 'c1', name: 'plain-container', state: 'running' }),
    );
  });

  it('platform_db_inspect queries projects table', async () => {
    const { ctx, dbMocks } = createMockPlatformDebugContext();
    dbMocks.listProjects.mockReturnValueOnce([
      { id: 'p1', name: 'app-1' },
      { id: 'p2', name: 'app-2' },
    ]);

    const result = (await getTool('platform_db_inspect').execute(
      { table: 'projects', limit: 1 },
      { target: 'mcp', appCtx: ctx },
    )) as {
      table: string;
      count: number;
      rows: Array<{ id: string }>;
    };

    expect(result.table).toBe('projects');
    expect(result.count).toBe(1);
    expect(result.rows).toEqual([{ id: 'p1', name: 'app-1' }]);
  });

  it('platform_db_inspect rejects forbidden tables at runtime', async () => {
    const { ctx } = createMockPlatformDebugContext();

    expect(() =>
      getTool('platform_db_inspect').execute(
        { table: 'global_secrets' } as unknown as Record<string, unknown>,
        { target: 'mcp', appCtx: ctx },
      ),
    ).toThrow('FORBIDDEN_TABLE: global_secrets');
  });

  it('platform_db_inspect uses project_id filter for environments', async () => {
    const { ctx, dbMocks } = createMockPlatformDebugContext();
    dbMocks.getEnvironmentsByProject.mockReturnValueOnce([{ id: 'env1', project_id: 'p1' }]);

    const result = (await getTool('platform_db_inspect').execute(
      { table: 'environments', project_id: 'p1' },
      { target: 'mcp', appCtx: ctx },
    )) as {
      count: number;
      rows: Array<{ id: string }>;
    };

    expect(dbMocks.getEnvironmentsByProject).toHaveBeenCalledWith('p1');
    expect(result.count).toBe(1);
    expect(result.rows[0]?.id).toBe('env1');
  });

  it('platform_db_inspect queries deploy_logs using project_id and limit', async () => {
    const { ctx, dbMocks } = createMockPlatformDebugContext();
    dbMocks.getDeployLogs.mockReturnValueOnce([{ id: 'd1', project_id: 'p1' }]);

    const result = (await getTool('platform_db_inspect').execute(
      { table: 'deploy_logs', project_id: 'p1', limit: 5 },
      { target: 'mcp', appCtx: ctx },
    )) as {
      count: number;
      rows: Array<{ id: string }>;
    };

    expect(dbMocks.getDeployLogs).toHaveBeenCalledWith('p1', 5);
    expect(result.count).toBe(1);
    expect(result.rows[0]?.id).toBe('d1');
  });
});
