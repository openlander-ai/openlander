import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { OpenLanderError } from '../../src/errors.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function createDuplicateServiceContext(): AppContext {
  const alpha = { id: 'alpha', name: 'alpha', status: 'running', archived_at: null };
  const beta = { id: 'beta', name: 'beta', status: 'running', archived_at: null };
  const alphaService = {
    id: 'alpha__svc',
    name: 'api',
    project_id: alpha.id,
    kind: 'git',
    source: 'git',
  };
  const betaService = {
    id: 'beta__svc',
    name: 'api',
    project_id: beta.id,
    kind: 'git',
    source: 'git',
  };
  const projects = new Map([
    [alpha.id, alpha],
    [beta.id, beta],
  ]);
  const services = [alphaService, betaService];

  return {
    db: {
      getProject: vi.fn((id: string) => projects.get(id)),
      getProjectByName: vi.fn((name: string) =>
        [...projects.values()].find((project) => project.name === name),
      ),
      getService: vi.fn((id: string) => services.find((service) => service.id === id)),
      getDeployableForProject: vi.fn((id: string) =>
        services.find((service) => service.project_id === id),
      ),
      getDeployablesByGroup: vi.fn((id: string) =>
        services.filter((service) => service.project_id === id),
      ),
      listServices: vi.fn(() => services),
      isCircuitBreakerOpen: vi.fn(() => false),
      acquireDeployLock: vi.fn(() => true),
      releaseDeployLock: vi.fn().mockResolvedValue(undefined),
      getDeployLockInfo: vi.fn(() => null),
    },
    pipeline: {
      redeploy: vi.fn().mockResolvedValue({ success: true }),
      rollback: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue(undefined),
    },
    deployQueue: {
      acquire: vi.fn().mockResolvedValue(() => {}),
    },
    cloudflare: {
      createTunnelForService: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as AppContext;
}

function createMultiDeployableProjectContext(): AppContext {
  const alpha = { id: 'alpha', name: 'alpha', status: 'running', archived_at: null };
  const alphaApi = {
    id: 'alpha-api__svc',
    name: 'api',
    project_id: alpha.id,
    kind: 'git',
    source: 'git',
  };
  const alphaWeb = {
    id: 'alpha-web__svc',
    name: 'web',
    project_id: alpha.id,
    kind: 'git',
    source: 'git',
  };
  const services = [alphaApi, alphaWeb];

  return {
    db: {
      getProject: vi.fn((id: string) => (id === alpha.id ? alpha : undefined)),
      getProjectByName: vi.fn((name: string) => (name === alpha.name ? alpha : undefined)),
      getService: vi.fn((id: string) => services.find((service) => service.id === id)),
      getDeployableForProject: vi.fn((id: string) =>
        services.find((service) => service.project_id === id),
      ),
      getDeployablesByGroup: vi.fn((id: string) =>
        services.filter((service) => service.project_id === id),
      ),
      listServices: vi.fn(() => services),
      isCircuitBreakerOpen: vi.fn(() => false),
      acquireDeployLock: vi.fn(() => true),
      releaseDeployLock: vi.fn().mockResolvedValue(undefined),
      getDeployLockInfo: vi.fn(() => null),
    },
    pipeline: {
      redeploy: vi.fn().mockResolvedValue({ success: true }),
      rollback: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue(undefined),
    },
    deployQueue: {
      acquire: vi.fn().mockResolvedValue(() => {}),
    },
    cloudflare: {
      createTunnelForService: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as AppContext;
}

function getTool(ctx: AppContext, name: string) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp', names: [name] }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

describe('deployable service target resolution', () => {
  it('scopes service_name lookup by project_name', async () => {
    const ctx = createDuplicateServiceContext();
    const result = await getTool(ctx, 'redeploy_app').execute(
      { service_name: 'api', project_name: 'beta' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'deploying',
      service: { id: 'beta__svc', name: 'api', projectId: 'beta', projectName: 'beta' },
      diagnostic_call: {
        tool: 'openlander_monitor',
        action: 'diagnose_service',
        params: { service_id: 'beta__svc' },
      },
    });
    expect(result).toMatchObject({
      _agent_guidance: {
        next_steps: expect.arrayContaining([expect.stringContaining('diagnose_service')]),
      },
    });
  });

  it('requires disambiguation for duplicate deployable service names', async () => {
    const ctx = createDuplicateServiceContext();

    await expect(
      getTool(ctx, 'redeploy_app').execute({ service_name: 'api' }, { target: 'mcp' }),
    ).rejects.toMatchObject({
      code: 'SERVICE_SELECTION_REQUIRED',
      statusCode: 400,
    });

    try {
      await getTool(ctx, 'redeploy_app').execute({ service_name: 'api' }, { target: 'mcp' });
    } catch (err) {
      expect(err).toBeInstanceOf(OpenLanderError);
      if (err instanceof OpenLanderError) {
        expect(err.details).toMatchObject({
          serviceName: 'api',
          candidates: [
            { serviceId: 'alpha__svc', projectName: 'alpha' },
            { serviceId: 'beta__svc', projectName: 'beta' },
          ],
        });
      }
    }
  });

  it('maps domains through the scoped deployable service target', async () => {
    const ctx = createDuplicateServiceContext();
    const result = await getTool(ctx, 'map_domain').execute(
      { project_name: 'alpha', domain: 'api.example.com' },
      { target: 'mcp' },
    );

    expect(result).toMatchObject({
      status: 'mapped',
      project: 'alpha',
      service: 'api',
      domain: 'api.example.com',
    });
    expect(ctx.cloudflare.createTunnelForService).toHaveBeenCalledWith(
      'alpha__svc',
      'api.example.com',
    );
  });

  it('requires disambiguation when map_domain targets a duplicated service name', async () => {
    const ctx = createDuplicateServiceContext();

    await expect(
      getTool(ctx, 'map_domain').execute(
        { service_name: 'api', domain: 'api.example.com' },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({
      code: 'SERVICE_SELECTION_REQUIRED',
      statusCode: 400,
    });
  });

  it('requires disambiguation when map_domain targets a multi-deployable project_name', async () => {
    const ctx = createMultiDeployableProjectContext();

    await expect(
      getTool(ctx, 'map_domain').execute(
        { project_name: 'alpha', domain: 'api.example.com' },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({
      code: 'SERVICE_SELECTION_REQUIRED',
      statusCode: 400,
    });

    try {
      await getTool(ctx, 'map_domain').execute(
        { project_name: 'alpha', domain: 'api.example.com' },
        { target: 'mcp' },
      );
    } catch (err) {
      expect(err).toBeInstanceOf(OpenLanderError);
      if (err instanceof OpenLanderError) {
        expect(err.details).toMatchObject({
          projectId: 'alpha',
          projectName: 'alpha',
          candidates: [
            { serviceId: 'alpha-api__svc', serviceName: 'api' },
            { serviceId: 'alpha-web__svc', serviceName: 'web' },
          ],
        });
      }
    }

    expect(ctx.cloudflare.createTunnelForService).not.toHaveBeenCalled();
  });
});
