import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { ProjectNotFoundError } from '../../src/errors.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function getTool(ctx: AppContext, name: string) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

describe('archive_project tool', () => {
  function createContext() {
    const project = { id: 'proj-1', name: 'my-app' };
    const archive = vi.fn(async () => undefined);

    const ctx = {
      db: {
        getProjectByName: vi.fn((name: string) => (name === 'my-app' ? project : undefined)),
      },
      pipeline: { archive },
    } as unknown as AppContext;

    return { ctx, archive, project };
  }

  it('calls pipeline.archive() with the project id', async () => {
    const { ctx, archive } = createContext();
    const tool = getTool(ctx, 'archive_project');

    await tool.execute({ project_name: 'my-app' }, { target: 'mcp' });

    expect(archive).toHaveBeenCalledWith('proj-1');
  });

  it('returns archived status with agent guidance', async () => {
    const { ctx } = createContext();
    const tool = getTool(ctx, 'archive_project');

    const result = (await tool.execute({ project_name: 'my-app' }, { target: 'mcp' })) as Record<
      string,
      unknown
    >;

    expect(result).toMatchObject({
      status: 'archived',
      project: 'my-app',
    });
    expect(result['_agent_guidance']).toBeDefined();
  });

  it('throws ProjectNotFoundError for unknown project', async () => {
    const { ctx } = createContext();
    const tool = getTool(ctx, 'archive_project');

    await expect(tool.execute({ project_name: 'nonexistent' }, { target: 'mcp' })).rejects.toThrow(
      ProjectNotFoundError,
    );
  });
});

describe('unarchive_project tool', () => {
  function createContext() {
    const archivedProject = {
      id: 'proj-2',
      name: 'archived-app',
      archived_at: '2026-04-01T00:00:00.000Z',
    };
    const unarchive = vi.fn(async () => undefined);
    const updatedProject = { ...archivedProject, archived_at: null, assigned_port: 20005 };

    const ctx = {
      db: {
        listProjects: vi.fn(() => [archivedProject]),
        getProject: vi.fn(() => updatedProject),
      },
      pipeline: { unarchive },
    } as unknown as AppContext;

    return { ctx, unarchive, archivedProject, updatedProject };
  }

  it('calls pipeline.unarchive() with the project id', async () => {
    const { ctx, unarchive } = createContext();
    const tool = getTool(ctx, 'unarchive_project');

    await tool.execute({ project_name: 'archived-app' }, { target: 'mcp' });

    expect(unarchive).toHaveBeenCalledWith('proj-2');
  });

  it('passes includeArchived option to listProjects', async () => {
    const { ctx } = createContext();
    const tool = getTool(ctx, 'unarchive_project');

    await tool.execute({ project_name: 'archived-app' }, { target: 'mcp' });

    expect(ctx.db.listProjects).toHaveBeenCalledWith(undefined, { includeArchived: true });
  });

  it('returns unarchived status with new port', async () => {
    const { ctx } = createContext();
    const tool = getTool(ctx, 'unarchive_project');

    const result = (await tool.execute(
      { project_name: 'archived-app' },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'unarchived',
      project: 'archived-app',
      port: 20005,
    });
    expect(result['_agent_guidance']).toBeDefined();
  });

  it('throws ProjectNotFoundError for unknown project', async () => {
    const { ctx } = createContext();
    const tool = getTool(ctx, 'unarchive_project');

    await expect(tool.execute({ project_name: 'nonexistent' }, { target: 'mcp' })).rejects.toThrow(
      ProjectNotFoundError,
    );
  });
});

describe('remove_project tool (deprecated — now archives)', () => {
  function createContext() {
    const project = { id: 'proj-3', name: 'legacy-app' };
    const archive = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);

    const ctx = {
      db: {
        getProjectByName: vi.fn((name: string) => (name === 'legacy-app' ? project : undefined)),
      },
      pipeline: { archive, remove },
    } as unknown as AppContext;

    return { ctx, archive, remove, project };
  }

  it('calls pipeline.archive() instead of pipeline.remove()', async () => {
    const { ctx, archive, remove } = createContext();
    const tool = getTool(ctx, 'remove_project');

    await tool.execute({ project_name: 'legacy-app' }, { target: 'mcp' });

    expect(archive).toHaveBeenCalledWith('proj-3');
    expect(remove).not.toHaveBeenCalled();
  });

  it('returns archived status (not removed)', async () => {
    const { ctx } = createContext();
    const tool = getTool(ctx, 'remove_project');

    const result = (await tool.execute(
      { project_name: 'legacy-app' },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'archived',
      project: 'legacy-app',
    });
  });

  it('includes deprecation warning in _agent_guidance', async () => {
    const { ctx } = createContext();
    const tool = getTool(ctx, 'remove_project');

    const result = (await tool.execute(
      { project_name: 'legacy-app' },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    const guidance = result['_agent_guidance'] as Record<string, unknown>;
    expect(guidance).toBeDefined();
    expect(guidance['message']).toContain('archived');
    expect(guidance['message']).toContain('not permanently deleted');
    expect(guidance['next_steps']).toEqual(
      expect.arrayContaining([expect.stringContaining('archive_project')]),
    );
  });
});
