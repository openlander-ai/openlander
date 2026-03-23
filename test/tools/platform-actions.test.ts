import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { platformActionToolDefs } from '../../src/tools/defs/platform-actions.js';

type MockContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  labels?: Record<string, string>;
};

function createMockPlatformActionContext(overrides?: {
  containers?: MockContainer[];
  projects?: Array<{ id: string; name: string; container_id: string | null; status?: string }>;
  environmentsByProject?: Record<
    string,
    Array<{
      id: string;
      project_id: string;
      type: 'production' | 'development';
      container_id: string | null;
    }>
  >;
  services?: Array<{ id: string; container_id: string | null; container_name: string }>;
}) {
  const containers = overrides?.containers ?? [];
  const projects = overrides?.projects ?? [];
  const envMap = overrides?.environmentsByProject ?? {};
  const services = overrides?.services ?? [];

  const inspect = vi.fn();
  const getContainer = vi.fn(() => ({ inspect }));

  const listManagedContainers = vi.fn(async () => containers);
  const stopContainer = vi.fn(async (_id: string) => undefined);
  const removeContainer = vi.fn(async (_id: string) => undefined);

  const listProjects = vi.fn(() => projects);
  const getEnvironmentsByProject = vi.fn((projectId: string) => envMap[projectId] ?? []);
  const listServices = vi.fn(() => services);
  const updateProject = vi.fn((_id: string, _updates: unknown) => undefined);

  const ctx = {
    docker: {
      listManagedContainers,
      stopContainer,
      removeContainer,
      getClient: vi.fn(() => ({ getContainer })),
    },
    db: {
      listProjects,
      getEnvironmentsByProject,
      listServices,
      updateProject,
    },
  } as unknown as AppContext;

  return {
    ctx,
    dockerMocks: {
      listManagedContainers,
      stopContainer,
      removeContainer,
      getContainer,
      inspect,
    },
    dbMocks: {
      listProjects,
      getEnvironmentsByProject,
      listServices,
      updateProject,
    },
  };
}

function getTool(name: string) {
  const tool = platformActionToolDefs.find((def) => def.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe('platform-action tools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('defines exactly three MCP-only tools', () => {
    expect(platformActionToolDefs).toHaveLength(3);
    expect(platformActionToolDefs.map((tool) => tool.name)).toEqual([
      'platform_cleanup_orphans',
      'platform_reconcile',
      'platform_force_remove',
    ]);
    for (const tool of platformActionToolDefs) {
      expect(tool.targets).toEqual(['mcp']);
    }
  });

  it('platform_cleanup_orphans rejects confirm=false', async () => {
    const { ctx } = createMockPlatformActionContext();

    await expect(
      getTool('platform_cleanup_orphans').execute(
        { confirm: false },
        { target: 'mcp', appCtx: ctx },
      ),
    ).rejects.toThrow('CONFIRMATION_REQUIRED');
  });

  it('platform_reconcile rejects confirm=false', async () => {
    const { ctx } = createMockPlatformActionContext();

    await expect(
      getTool('platform_reconcile').execute({ confirm: false }, { target: 'mcp', appCtx: ctx }),
    ).rejects.toThrow('CONFIRMATION_REQUIRED');
  });

  it('platform_force_remove rejects confirm=false', async () => {
    const { ctx } = createMockPlatformActionContext();

    await expect(
      getTool('platform_force_remove').execute(
        { container_id: 'c1', confirm: false },
        { target: 'mcp', appCtx: ctx },
      ),
    ).rejects.toThrow('CONFIRMATION_REQUIRED');
  });

  it('platform_cleanup_orphans dry_run lists orphan and does not remove', async () => {
    const { ctx, dockerMocks } = createMockPlatformActionContext({
      containers: [
        { id: 'known', name: 'ol-app', image: 'img', status: 'running' },
        { id: 'orphan-1', name: 'ol-orphan', image: 'img', status: 'running' },
      ],
      projects: [{ id: 'p1', name: 'app', container_id: 'known' }],
      services: [],
    });

    const result = (await getTool('platform_cleanup_orphans').execute(
      { confirm: true, dry_run: true },
      { target: 'mcp', appCtx: ctx },
    )) as {
      mode: string;
      orphans_found: number;
      removed: Array<{ id: string }>;
      skipped: Array<{ id: string; reason: string }>;
      errors: unknown[];
    };

    expect(result.mode).toBe('dry_run');
    expect(result.orphans_found).toBe(1);
    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([{ id: 'orphan-1', name: 'ol-orphan', reason: 'dry_run' }]);
    expect(dockerMocks.stopContainer).not.toHaveBeenCalled();
    expect(dockerMocks.removeContainer).not.toHaveBeenCalled();
  });

  it('platform_cleanup_orphans skips infrastructure containers', async () => {
    const { ctx, dockerMocks } = createMockPlatformActionContext({
      containers: [
        {
          id: 'infra-1',
          name: 'ol-traefik',
          image: 'img',
          status: 'running',
          labels: { 'openlander.role': 'proxy' },
        },
      ],
    });

    const result = (await getTool('platform_cleanup_orphans').execute(
      { confirm: true, dry_run: false },
      { target: 'mcp', appCtx: ctx },
    )) as {
      skipped: Array<{ id: string; reason: string }>;
      removed: unknown[];
    };

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual([
      { id: 'infra-1', name: 'ol-traefik', reason: 'infrastructure' },
    ]);
    expect(dockerMocks.stopContainer).not.toHaveBeenCalled();
    expect(dockerMocks.removeContainer).not.toHaveBeenCalled();
  });

  it('platform_cleanup_orphans executes stop+remove when dry_run=false', async () => {
    const { ctx, dockerMocks } = createMockPlatformActionContext({
      containers: [{ id: 'orphan-1', name: 'ol-orphan', image: 'img', status: 'running' }],
    });

    const result = (await getTool('platform_cleanup_orphans').execute(
      { confirm: true, dry_run: false },
      { target: 'mcp', appCtx: ctx },
    )) as {
      mode: string;
      removed: Array<{ id: string }>;
      errors: unknown[];
    };

    expect(result.mode).toBe('executed');
    expect(result.removed).toEqual([{ id: 'orphan-1', name: 'ol-orphan' }]);
    expect(result.errors).toEqual([]);
    expect(dockerMocks.stopContainer).toHaveBeenCalledWith('orphan-1');
    expect(dockerMocks.removeContainer).toHaveBeenCalledWith('orphan-1');
  });

  it('platform_reconcile marks ghost project records as error', async () => {
    const { ctx, dbMocks, dockerMocks } = createMockPlatformActionContext({
      containers: [],
      projects: [{ id: 'p1', name: 'ghost-app', container_id: 'missing-c1', status: 'running' }],
    });
    dockerMocks.inspect.mockRejectedValueOnce(new Error('No such container: missing-c1'));

    const result = (await getTool('platform_reconcile').execute(
      { confirm: true, dry_run: false },
      { target: 'mcp', appCtx: ctx },
    )) as {
      mode: string;
      actions: Array<{ type: string; target: string }>;
    };

    expect(result.mode).toBe('executed');
    expect(result.actions).toContainEqual(
      expect.objectContaining({ type: 'mark_error', target: 'ghost-app' }),
    );
    expect(dbMocks.updateProject).toHaveBeenCalledWith('p1', { status: 'error' });
  });

  it('platform_reconcile dry_run returns actions without mutation', async () => {
    const { ctx, dbMocks, dockerMocks } = createMockPlatformActionContext({
      containers: [{ id: 'orphan-2', name: 'ol-orphan-2', image: 'img', status: 'running' }],
      projects: [{ id: 'p1', name: 'ghost-app', container_id: 'missing-c1', status: 'running' }],
    });
    dockerMocks.inspect.mockRejectedValueOnce(new Error('No such container: missing-c1'));

    const result = (await getTool('platform_reconcile').execute(
      { confirm: true, dry_run: true },
      { target: 'mcp', appCtx: ctx },
    )) as {
      mode: string;
      actions: Array<{ type: string; target: string }>;
    };

    expect(result.mode).toBe('dry_run');
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'mark_error', target: 'ghost-app' }),
        expect.objectContaining({ type: 'stop_orphan', target: 'ol-orphan-2' }),
      ]),
    );
    expect(dbMocks.updateProject).not.toHaveBeenCalled();
    expect(dockerMocks.stopContainer).not.toHaveBeenCalled();
    expect(dockerMocks.removeContainer).not.toHaveBeenCalled();
  });

  it('platform_reconcile removes orphan managed containers when executing', async () => {
    const { ctx, dockerMocks } = createMockPlatformActionContext({
      containers: [{ id: 'orphan-3', name: 'ol-orphan-3', image: 'img', status: 'running' }],
    });

    const result = (await getTool('platform_reconcile').execute(
      { confirm: true, dry_run: false },
      { target: 'mcp', appCtx: ctx },
    )) as {
      actions: Array<{ type: string; target: string }>;
    };

    expect(result.actions).toContainEqual(
      expect.objectContaining({ type: 'stop_orphan', target: 'ol-orphan-3' }),
    );
    expect(dockerMocks.stopContainer).toHaveBeenCalledWith('orphan-3');
    expect(dockerMocks.removeContainer).toHaveBeenCalledWith('orphan-3');
  });

  it('platform_force_remove protects infrastructure containers', async () => {
    const { ctx, dockerMocks } = createMockPlatformActionContext();
    dockerMocks.inspect.mockResolvedValueOnce({
      Name: '/ol-traefik',
      Config: { Labels: { 'openlander.role': 'proxy' } },
    });

    await expect(
      getTool('platform_force_remove').execute(
        { container_id: 'infra-1', confirm: true },
        { target: 'mcp', appCtx: ctx },
      ),
    ).rejects.toThrow('PROTECTED_CONTAINER: Cannot remove infrastructure container');

    expect(dockerMocks.stopContainer).not.toHaveBeenCalled();
    expect(dockerMocks.removeContainer).not.toHaveBeenCalled();
  });

  it('platform_force_remove returns not_found for missing container', async () => {
    const { ctx, dockerMocks } = createMockPlatformActionContext();
    dockerMocks.inspect.mockRejectedValueOnce(new Error('No such container: missing-c1'));

    const result = await getTool('platform_force_remove').execute(
      { container_id: 'missing-c1', confirm: true },
      { target: 'mcp', appCtx: ctx },
    );

    expect(result).toEqual({ status: 'not_found', container_id: 'missing-c1' });
    expect(dockerMocks.stopContainer).not.toHaveBeenCalled();
    expect(dockerMocks.removeContainer).not.toHaveBeenCalled();
  });

  it('platform_force_remove stops and removes non-protected container', async () => {
    const { ctx, dockerMocks } = createMockPlatformActionContext();
    dockerMocks.inspect.mockResolvedValueOnce({
      Name: '/ol-app',
      Config: { Labels: { 'openlander.project': 'app' } },
    });

    const result = await getTool('platform_force_remove').execute(
      { container_id: 'c1', confirm: true },
      { target: 'mcp', appCtx: ctx },
    );

    expect(dockerMocks.stopContainer).toHaveBeenCalledWith('c1');
    expect(dockerMocks.removeContainer).toHaveBeenCalledWith('c1');
    expect(result).toEqual({ status: 'removed', container_id: 'c1', name: 'ol-app' });
  });
});
