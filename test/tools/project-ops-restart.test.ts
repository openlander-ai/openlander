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
    runtime_role: 'application',
    container_id: 'container-1',
  };

  const stop = vi.fn(async () => undefined);
  const redeploy = vi.fn(async () => ({ deployId: 'deploy-1' }));
  const redeployService = vi.fn(async () => ({ deployId: 'deploy-1' }));
  const restartServiceRuntime = vi.fn(async () => ({
    status: 'restarted',
    projectId: project.id,
    serviceId: service.id,
    containerId: service.container_id,
  }));

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
      redeployService,
      restartServiceRuntime,
    },
    deployQueue: {
      acquire: vi.fn().mockResolvedValue(() => {}),
    },
  } as unknown as AppContext;

  return { ctx, stop, redeploy, redeployService, restartServiceRuntime, service };
}

describe('deployable restart_service runtime semantics', () => {
  it('restarts the existing container without clone/build/redeploy', async () => {
    const { ctx, stop, redeploy, redeployService, restartServiceRuntime } = createContext();

    const result = await getRestartServiceTool(ctx).execute(
      { service_name: 'demo-app' },
      { target: 'mcp' },
    );

    expect(stop).not.toHaveBeenCalled();
    expect(restartServiceRuntime).toHaveBeenCalledWith('service-1');
    expect(redeployService).not.toHaveBeenCalled();
    expect(redeploy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'restarted',
      project_id: 'project-1',
      service_id: 'service-1',
      container_id: 'container-1',
      diagnostic_call: {
        tool: 'openlander_monitor',
        action: 'diagnose_service',
        params: { service_id: 'service-1' },
      },
    });
  });

  it('rejects one-shot jobs', async () => {
    const { ctx, service, restartServiceRuntime } = createContext();
    service.runtime_role = 'job';

    await expect(
      getRestartServiceTool(ctx).execute({ service_name: 'demo-app' }, { target: 'mcp' }),
    ).rejects.toMatchObject({ code: 'SERVICE_OPERATION_UNSUPPORTED' });
    expect(restartServiceRuntime).not.toHaveBeenCalled();
  });
});
