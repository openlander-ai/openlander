import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function getRestartServiceTool(ctx: AppContext) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
    (entry) => entry.name === 'restart_service',
  );
  expect(tool).toBeDefined();
  return tool!;
}

function createContext() {
  const project = {
    id: 'project-1',
    name: 'demo-group',
    status: 'running',
    archived_at: null,
  };
  const service = {
    id: 'service-1',
    name: 'demo-app',
    project_id: project.id,
    kind: 'git',
    source: 'git',
    repo_url: 'https://github.com/acme/demo-app',
    image_url: null,
  };

  const stop = vi.fn(async () => undefined);
  const redeploy = vi.fn(async () => ({ deployId: 'deploy-1' }));

  const ctx = {
    db: {
      getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
      getService: vi.fn((id: string) => (id === service.id ? service : undefined)),
      getServices: vi.fn((query?: { ids?: string[] }) =>
        query?.ids?.includes(`${project.id}__svc`) ? [service] : [],
      ),
      getDeployableForProject: vi.fn((id: string) => (id === project.id ? service : undefined)),
      listServices: vi.fn(() => [service]),
      isCircuitBreakerOpen: vi.fn(() => false),
      acquireDeployLock: vi.fn(() => true),
      releaseDeployLock: vi.fn().mockResolvedValue(undefined),
      getDeployLockInfo: vi.fn(() => null),
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

describe('deployable restart_service non-blocking', () => {
  it('returns immediately without awaiting redeploy', async () => {
    const { ctx, stop, redeploy } = createContext();
    redeploy.mockImplementationOnce(() => new Promise(() => undefined));

    const result = await Promise.race([
      getRestartServiceTool(ctx).execute({ service_name: 'demo-app' }, { target: 'mcp' }),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 25)),
    ]);

    expect(result).not.toBe('timeout');
    expect(stop).not.toHaveBeenCalled();
    expect(redeploy).toHaveBeenCalledWith('project-1', {
      noCache: false,
      strategy: undefined,
      healthCheckPath: undefined,
      cmd: undefined,
      lockSessionId: expect.any(String),
      trigger: 'chat',
    });
  });

  it('does not stop the live container before redeploy source validation', async () => {
    const { ctx, stop, redeploy } = createContext();

    await getRestartServiceTool(ctx).execute({ service_name: 'demo-app' }, { target: 'mcp' });

    expect(stop).not.toHaveBeenCalled();
    expect(redeploy).toHaveBeenCalledWith(
      'project-1',
      expect.objectContaining({
        lockSessionId: expect.any(String),
        trigger: 'chat',
      }),
    );
  });

  it('returns status restarting with polling message', async () => {
    const { ctx, redeploy } = createContext();

    const result = await getRestartServiceTool(ctx).execute(
      {
        service_name: 'demo-app',
        no_cache: true,
      },
      { target: 'mcp' },
    );

    expect(redeploy).toHaveBeenCalledWith('project-1', {
      noCache: true,
      strategy: undefined,
      healthCheckPath: undefined,
      cmd: undefined,
      lockSessionId: expect.any(String),
      trigger: 'chat',
    });
    expect(result).toMatchObject({
      status: 'restarting',
      service: { name: 'demo-app', projectId: 'project-1', projectName: 'demo-group' },
    });
  });
});
