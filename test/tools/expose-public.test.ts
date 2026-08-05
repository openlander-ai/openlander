import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

const project = { id: 'project-1', name: 'demo' };
const service = {
  id: 'project-1__svc',
  project_id: project.id,
  name: 'web',
  kind: 'application',
  source: 'repo',
};

function createContext(options: { deployables?: (typeof service)[] } = {}) {
  const deployables = options.deployables ?? [service];
  const requestPublicAccess = vi.fn().mockResolvedValue({
    project_id: project.id,
    service_id: service.id,
    status: 'provisioning',
    public_url: null,
    hostname: 'demo.example.com',
    error: null,
  });
  const getPublicAccess = vi.fn().mockResolvedValue({
    project_id: project.id,
    service_id: service.id,
    status: 'public',
    public_url: 'https://demo.example.com',
    hostname: 'demo.example.com',
    error: null,
  });
  const requestPrivateAccess = vi.fn().mockResolvedValue({
    project_id: project.id,
    service_id: service.id,
    status: 'unpublishing',
    public_url: null,
    hostname: 'demo.example.com',
    error: null,
  });
  const ctx = {
    db: {
      getProject: vi.fn(async (id: string) =>
        id === project.id || id === project.name ? project : null,
      ),
      getProjectByName: vi.fn(async (name: string) => (name === project.name ? project : null)),
      getDeployablesByGroup: vi.fn().mockResolvedValue(deployables),
      getService: vi.fn(async (id: string) => deployables.find((entry) => entry.id === id) ?? null),
      getProjectPublicAccess: vi.fn().mockResolvedValue({ service_id: service.id }),
    },
    cloudflare: { requestPublicAccess, getPublicAccess, requestPrivateAccess },
  } as unknown as AppContext;
  return { ctx, requestPublicAccess, getPublicAccess, requestPrivateAccess };
}

function getTool(ctx: AppContext, name: string) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

describe('Connected Publish MCP actions', () => {
  it('prefers service_id and returns a compact polling contract', async () => {
    const { ctx, requestPublicAccess } = createContext();

    const result = await getTool(ctx, 'expose_public').execute(
      { service_id: service.id },
      { target: 'mcp' },
    );

    expect(requestPublicAccess).toHaveBeenCalledWith({
      projectId: project.id,
      serviceId: service.id,
    });
    expect(result).toMatchObject({
      status: 'provisioning',
      project_id: project.id,
      service_id: service.id,
      public_url: null,
      status_call: {
        tool: 'openlander_service',
        arguments: {
          action: 'get_public_access',
          params: { service_id: service.id },
        },
      },
    });
  });

  it('accepts project_name only when it resolves to one workload', async () => {
    const { ctx, requestPublicAccess } = createContext();

    await getTool(ctx, 'expose_public').execute({ project_name: project.name }, { target: 'mcp' });

    expect(requestPublicAccess).toHaveBeenCalledWith({
      projectId: project.id,
      serviceId: service.id,
    });
  });

  it('requires a service selector for a Project with multiple workloads', async () => {
    const second = { ...service, id: 'project-1__api', name: 'api' };
    const { ctx, requestPublicAccess } = createContext({ deployables: [service, second] });

    await expect(
      getTool(ctx, 'expose_public').execute({ project_name: project.name }, { target: 'mcp' }),
    ).rejects.toMatchObject({ code: 'SERVICE_SELECTION_REQUIRED' });
    expect(requestPublicAccess).not.toHaveBeenCalled();
  });

  it('reads status and unpublishes by Project while preserving status polling', async () => {
    const { ctx, getPublicAccess, requestPrivateAccess } = createContext();

    const status = await getTool(ctx, 'get_public_access').execute(
      { project_id: project.id },
      { target: 'mcp' },
    );
    const unpublish = await getTool(ctx, 'unexpose_public').execute(
      { project_id: project.id },
      { target: 'mcp' },
    );

    expect(getPublicAccess).toHaveBeenCalledWith(project.id);
    expect(requestPrivateAccess).toHaveBeenCalledWith(project.id);
    expect(status).toMatchObject({
      status: 'public',
      public_url: 'https://demo.example.com',
    });
    expect(unpublish).toMatchObject({
      status: 'unpublishing',
      status_call: { arguments: { action: 'get_public_access' } },
    });
  });
});
