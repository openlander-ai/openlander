import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

type ProjectStatus = 'running' | 'stopped' | 'building' | 'error';

function createProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'project-1',
    name: 'demo-app',
    status: 'running' as ProjectStatus,
    visibility: 'internal',
    repo_url: 'https://github.com/acme/demo-app',
    branch: 'main',
    assigned_port: 10001,
    container_id: 'container-1',
    public_url: null,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    ...overrides,
  };
}

function getListProjectsTool(ctx: AppContext) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
    (entry) => entry.name === 'list_projects',
  );
  expect(tool).toBeDefined();
  return tool!;
}

describe('project-ops list_projects reconciliation', () => {
  it('includes deployable service identifiers for MCP follow-up calls', async () => {
    const project = createProject();
    const deployable = {
      id: 'project-1__svc',
      name: 'demo-web',
      kind: 'git',
      source: 'git',
      status: 'running',
      assigned_port: 10001,
      container_id: 'container-1',
      container_name: 'ol-demo-app',
      public_url: null,
    };

    const ctx = {
      db: {
        listProjects: vi.fn(() => [project]),
        updateProject: vi.fn(),
        getDeployableForProject: vi.fn().mockReturnValue(deployable),
      },
      docker: {
        inspectContainer: vi.fn(async () => ({ Id: 'container-1', State: { Running: true } })),
      },
    } as unknown as AppContext;

    const result = await getListProjectsTool(ctx).execute({}, { target: 'mcp' });

    expect(result).toMatchObject({
      projects: [
        {
          id: 'project-1',
          name: 'demo-app',
          deployable_service: {
            service_id: 'project-1__svc',
            service_name: 'demo-web',
            kind: 'git',
            source: 'git',
          },
        },
      ],
      _agent_guidance: {
        networking: [
          expect.any(String),
          expect.any(String),
          expect.stringContaining('deployable_service.service_id'),
        ],
      },
    });
  });

  it('returns running status when container actually exists', async () => {
    const inspectContainer = vi.fn(async () => ({ Id: 'container-1', State: { Running: true } }));
    const project = createProject();
    const listProjects = vi.fn(() => [project]);
    const updateProject = vi.fn();

    const ctx = {
      db: {
        listProjects,
        updateProject,
        getDeployableForProject: vi.fn().mockReturnValue(undefined),
      },
      docker: {
        inspectContainer,
      },
    } as unknown as AppContext;

    const result = await getListProjectsTool(ctx).execute({}, { target: 'mcp' });

    expect(inspectContainer).toHaveBeenCalledWith('container-1');
    expect(updateProject).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      count: 1,
      projects: [
        {
          name: 'demo-app',
          status: 'running',
        },
      ],
    });
  });

  it('updates status to error when container_id exists but container is gone', async () => {
    const inspectContainer = vi.fn(async () => {
      throw new Error('No such container');
    });
    const project = createProject();
    const staleProject = createProject({ status: 'error', updated_at: '2026-01-01 00:01:00' });
    const listProjects = vi
      .fn(() => [project])
      .mockReturnValueOnce([project])
      .mockReturnValueOnce([staleProject]);
    const updateProject = vi.fn();

    const ctx = {
      db: {
        listProjects,
        updateProject,
        getDeployableForProject: vi.fn().mockReturnValue(undefined),
      },
      docker: {
        inspectContainer,
      },
    } as unknown as AppContext;

    const result = await getListProjectsTool(ctx).execute({}, { target: 'mcp' });

    expect(inspectContainer).toHaveBeenCalledWith('container-1');
    expect(updateProject).toHaveBeenCalledWith('project-1', { status: 'error' });
    expect(result).toMatchObject({
      projects: [
        {
          name: 'demo-app',
          status: 'error',
        },
      ],
    });
  });

  it('handles projects without container_id gracefully', async () => {
    const inspectContainer = vi.fn();
    const project = createProject({ container_id: null });
    const listProjects = vi.fn(() => [project]);
    const updateProject = vi.fn();

    const ctx = {
      db: {
        listProjects,
        updateProject,
        getDeployableForProject: vi.fn().mockReturnValue(undefined),
      },
      docker: {
        inspectContainer,
      },
    } as unknown as AppContext;

    const result = await getListProjectsTool(ctx).execute({}, { target: 'mcp' });

    expect(inspectContainer).not.toHaveBeenCalled();
    expect(updateProject).not.toHaveBeenCalled();
    expect(result).toMatchObject({ count: 1 });
  });

  it('does not crash when Docker inspect throws', async () => {
    const inspectContainer = vi.fn(async () => {
      throw new Error('Docker daemon unavailable');
    });
    const project = createProject();
    const staleProject = createProject({ status: 'error' });
    const listProjects = vi
      .fn(() => [project])
      .mockReturnValueOnce([project])
      .mockReturnValueOnce([staleProject]);
    const updateProject = vi.fn();

    const ctx = {
      db: {
        listProjects,
        updateProject,
        getDeployableForProject: vi.fn().mockReturnValue(undefined),
      },
      docker: {
        inspectContainer,
      },
    } as unknown as AppContext;

    await expect(getListProjectsTool(ctx).execute({}, { target: 'mcp' })).resolves.toMatchObject({
      count: 1,
    });
    expect(updateProject).toHaveBeenCalledWith('project-1', { status: 'error' });
  });
});
