import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { platformActionToolDefs } from '../../src/tools/defs/platform-actions.js';

type MockContainer = {
  id: string;
  name: string;
  image: string;
  imageTag?: string;
  port?: number;
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

  const inspectContainer = vi.fn();

  const listManagedContainers = vi.fn(async () => containers);
  const stopContainer = vi.fn(async (_id: string) => undefined);
  const removeContainer = vi.fn(async (_id: string) => undefined);
  const safeRemoveContainer = vi.fn(async (_id: string) => undefined);

  const listProjects = vi.fn(() => projects);
  const getEnvironmentsByProject = vi.fn((projectId: string) => envMap[projectId] ?? []);
  const listServices = vi.fn(() => services);
  const adoptService = vi.fn(async (service: Record<string, unknown>) => ({
    id: service['id'],
    name: service['name'],
    kind: service['kind'],
    status: 'running',
    container_id: service['containerId'],
    container_name: service['containerName'],
    image_url: service['imageUrl'],
    assigned_port: service['assignedPort'],
  }));
  const insertActivityLog = vi.fn(async (_entry: unknown) => undefined);
  const updateProject = vi.fn((_id: string, _updates: unknown) => undefined);

  const ctx = {
    docker: {
      listManagedContainers,
      stopContainer,
      removeContainer,
      safeRemoveContainer,
      inspectContainer,
    },
    db: {
      listProjects,
      getEnvironmentsByProject,
      listServices,
      adoptService,
      insertActivityLog,
      updateProject,
      getDeployableForProject: vi.fn().mockReturnValue(undefined),
    },
  } as unknown as AppContext;

  return {
    ctx,
    dockerMocks: {
      listManagedContainers,
      stopContainer,
      removeContainer,
      safeRemoveContainer,
      inspectContainer,
    },
    dbMocks: {
      listProjects,
      getEnvironmentsByProject,
      listServices,
      adoptService,
      insertActivityLog,
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

  it('defines MCP-only action tools', () => {
    expect(platformActionToolDefs).toHaveLength(5);
    expect(platformActionToolDefs.map((tool) => tool.name)).toEqual([
      'platform_adopt_orphan_service',
      'platform_cleanup_orphans',
      'platform_reconcile',
      'platform_force_remove',
      'recover_platform',
    ]);
    for (const tool of platformActionToolDefs) {
      expect(tool.targets).toEqual(['mcp']);
    }
  });

  it('platform_cleanup_orphans rejects execution without confirm=true', async () => {
    const { ctx } = createMockPlatformActionContext();

    await expect(
      getTool('platform_cleanup_orphans').execute(
        { dry_run: false },
        { target: 'mcp', appCtx: ctx },
      ),
    ).rejects.toThrow('CONFIRMATION_REQUIRED');
  });

  it('platform_reconcile rejects execution without confirm=true', async () => {
    const { ctx } = createMockPlatformActionContext();

    await expect(
      getTool('platform_reconcile').execute({ dry_run: false }, { target: 'mcp', appCtx: ctx }),
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

  it('platform_adopt_orphan_service previews without confirm', async () => {
    const { ctx, dbMocks } = createMockPlatformActionContext({
      containers: [
        {
          id: 'svc-orphan',
          name: 'ol-svc-flaresolverr',
          image: 'ghcr.io/flaresolverr/flaresolverr:latest',
          imageTag: 'ghcr.io/flaresolverr/flaresolverr:latest',
          port: 8191,
          status: 'running',
          labels: { 'openlander.role': 'service', 'openlander.service': 'flaresolverr' },
        },
      ],
    });

    const result = (await getTool('platform_adopt_orphan_service').execute(
      { container_name: 'ol-svc-flaresolverr' },
      { target: 'mcp', appCtx: ctx },
    )) as {
      confirm_required: boolean;
      proposed_service: { name: string; kind: string; assigned_port: number };
    };

    expect(result.confirm_required).toBe(true);
    expect(result.proposed_service).toMatchObject({
      name: 'flaresolverr',
      kind: 'image',
      assigned_port: 8191,
    });
    expect(dbMocks.adoptService).not.toHaveBeenCalled();
  });

  it('platform_adopt_orphan_service registers with confirm=true', async () => {
    const { ctx, dbMocks } = createMockPlatformActionContext({
      containers: [
        {
          id: 'svc-orphan',
          name: 'ol-svc-flaresolverr',
          image: 'ghcr.io/flaresolverr/flaresolverr:latest',
          imageTag: 'ghcr.io/flaresolverr/flaresolverr:latest',
          port: 8191,
          status: 'running',
          labels: { 'openlander.role': 'service', 'openlander.service': 'flaresolverr' },
        },
      ],
    });

    const result = (await getTool('platform_adopt_orphan_service').execute(
      { container_id: 'svc-orphan', confirm: true },
      { target: 'mcp', appCtx: ctx },
    )) as {
      status: string;
      service: { name: string; kind: string };
      unsupported_operations: string[];
    };

    expect(result.status).toBe('adopted');
    expect(result.service).toMatchObject({ name: 'flaresolverr', kind: 'image' });
    expect(result.unsupported_operations).toContain('redeploy_app');
    expect(dbMocks.adoptService).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'flaresolverr',
        kind: 'image',
        containerId: 'svc-orphan',
        containerName: 'ol-svc-flaresolverr',
        assignedPort: 8191,
      }),
    );
    expect(dbMocks.insertActivityLog).toHaveBeenCalled();
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
    const tool = getTool('platform_cleanup_orphans');
    expect(tool.inputSchema.safeParse({ dry_run: true }).success).toBe(true);

    const result = (await tool.execute(
      {},
      {
        target: 'mcp',
        appCtx: ctx,
      },
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
    dockerMocks.inspectContainer.mockRejectedValueOnce(new Error('No such container: missing-c1'));

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
    dockerMocks.inspectContainer.mockRejectedValueOnce(new Error('No such container: missing-c1'));
    const tool = getTool('platform_reconcile');
    expect(tool.inputSchema.safeParse({ dry_run: true }).success).toBe(true);

    const result = (await tool.execute({}, { target: 'mcp', appCtx: ctx })) as {
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
    dockerMocks.inspectContainer.mockResolvedValueOnce({
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
    dockerMocks.inspectContainer.mockRejectedValueOnce(new Error('No such container: missing-c1'));

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
    dockerMocks.inspectContainer.mockResolvedValueOnce({
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
