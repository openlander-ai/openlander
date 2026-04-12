import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function getRestartProjectTool(ctx: AppContext) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
    (entry) => entry.name === 'restart_project',
  );
  expect(tool).toBeDefined();
  return tool!;
}

function createContext() {
  const project = {
    id: 'project-1',
    name: 'demo-app',
  };

  const stop = vi.fn(async () => undefined);
  const redeploy = vi.fn(async () => ({ deployId: 'deploy-1' }));

  const ctx = {
    db: {
      getProjectByName: vi.fn((name: string) => (name === 'demo-app' ? project : undefined)),
    },
    pipeline: {
      stop,
      redeploy,
    },
    deployQueue: {
      acquire: vi.fn().mockResolvedValue(() => {}),
    },
  } as unknown as AppContext;

  return { ctx, stop, redeploy };
}

describe('project-ops restart_project non-blocking', () => {
  it('returns immediately without awaiting redeploy', async () => {
    const { ctx, stop, redeploy } = createContext();
    redeploy.mockImplementationOnce(() => new Promise(() => undefined));

    const result = await Promise.race([
      getRestartProjectTool(ctx).execute({ project_name: 'demo-app' }, { target: 'mcp' }),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 25)),
    ]);

    expect(result).not.toBe('timeout');
    expect(stop).toHaveBeenCalledWith('project-1');
    expect(redeploy).toHaveBeenCalledWith('project-1', { noCache: false });
  });

  it('returns status restarting with polling message', async () => {
    const { ctx, redeploy } = createContext();

    const result = await getRestartProjectTool(ctx).execute(
      {
        project_name: 'demo-app',
        no_cache: true,
      },
      { target: 'mcp' },
    );

    expect(redeploy).toHaveBeenCalledWith('project-1', { noCache: true });
    expect(result).toEqual({
      status: 'restarting',
      project: 'demo-app',
      message:
        'Restart initiated (no_cache). Full rebuild may take 3-5+ minutes. Poll get_deploy_status to track progress.',
    });
  });
});
