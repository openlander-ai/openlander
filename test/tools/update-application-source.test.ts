import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { ServiceRow } from '../../src/db/index.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function getTool(ctx: AppContext, name: string) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp', names: [name] }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

function serviceRow(partial: Partial<ServiceRow>): ServiceRow {
  return {
    id: 'hotdeal__svc',
    name: 'api',
    project_id: 'hotdeal',
    kind: 'git',
    source: 'git',
    repo_url: 'https://github.com/acme/hotdeal',
    branch: 'main',
    image_url: null,
    image_cmd: null,
    container_port: 3000,
    status: 'running',
    archived_at: null,
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: '.',
    created_at: '2026-06-04T00:00:00.000Z',
    updated_at: '2026-06-04T00:00:00.000Z',
    ...partial,
  } as unknown as ServiceRow;
}

function createContext(initialServices: ServiceRow[]) {
  const project = { id: 'hotdeal', name: 'hotdeal', archived_at: null, status: 'running' };
  const services = new Map(initialServices.map((service) => [service.id, service]));
  const db = {
    getService: vi.fn(async (id: string) => services.get(id)),
    getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
    getProjectByName: vi.fn(async (name: string) => (name === project.name ? project : undefined)),
    listServices: vi.fn(async () => [...services.values()]),
    getDeployablesByGroup: vi.fn(async (projectId: string) =>
      [...services.values()].filter((service) => service.project_id === projectId),
    ),
    updateService: vi.fn(async (id: string, updates: Record<string, unknown>) => {
      const current = services.get(id);
      if (!current) return;
      const next = { ...current } as Record<string, unknown>;
      if (updates['kind'] !== undefined) next['kind'] = updates['kind'];
      if (updates['source'] !== undefined) next['source'] = updates['source'];
      if (updates['repoUrl'] !== undefined) next['repo_url'] = updates['repoUrl'];
      if (updates['branch'] !== undefined) next['branch'] = updates['branch'];
      if (updates['imageUrl'] !== undefined) next['image_url'] = updates['imageUrl'];
      if (updates['imageCmd'] !== undefined) next['image_cmd'] = updates['imageCmd'];
      if (updates['containerPort'] !== undefined) next['container_port'] = updates['containerPort'];
      services.set(id, next as unknown as ServiceRow);
    }),
  };
  const ctx = { db } as unknown as AppContext;
  return { ctx, db };
}

describe('update_application_source MCP action', () => {
  it('updates Git repo and branch as save-only source settings', async () => {
    const { ctx, db } = createContext([serviceRow({})]);

    const result = (await getTool(ctx, 'update_application_source').execute(
      {
        service_id: 'hotdeal__svc',
        repo_url: 'https://github.com/acme/hotdeal-v2',
        branch: 'staging',
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(db.updateService).toHaveBeenCalledWith(
      'hotdeal__svc',
      expect.objectContaining({
        source: 'git',
        repoUrl: 'https://github.com/acme/hotdeal-v2',
        branch: 'staging',
      }),
    );
    expect(result).toMatchObject({
      status: 'updated',
      project_id: 'hotdeal',
      service_id: 'hotdeal__svc',
      source: {
        source: 'git',
        repo_url: 'https://github.com/acme/hotdeal-v2',
        branch: 'staging',
      },
      changed_fields: ['repo_url', 'branch'],
      needs_redeploy: true,
      suggested_call: {
        tool: 'openlander_service',
        action: 'update_app',
        params: { service_id: 'hotdeal__svc' },
      },
    });
  });

  it('updates image source and saved container port', async () => {
    const { ctx, db } = createContext([serviceRow({})]);

    const result = (await getTool(ctx, 'update_application_source').execute(
      {
        service_id: 'hotdeal__svc',
        source: 'image',
        image: 'ghcr.io/acme/hotdeal:2026-06-04',
        cmd: ['node', 'server.js'],
        container_port: 8080,
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(db.updateService).toHaveBeenCalledWith(
      'hotdeal__svc',
      expect.objectContaining({
        kind: 'image',
        source: 'image',
        imageUrl: 'ghcr.io/acme/hotdeal:2026-06-04',
        imageCmd: JSON.stringify(['node', 'server.js']),
        repoUrl: null,
        branch: null,
        containerPort: 8080,
      }),
    );
    expect(result).toMatchObject({
      status: 'updated',
      source: {
        source: 'image',
        image: 'ghcr.io/acme/hotdeal:2026-06-04',
        cmd: ['node', 'server.js'],
        container_port: 8080,
      },
      changed_fields: ['source', 'image', 'cmd', 'repo_url', 'branch', 'container_port'],
      needs_redeploy: true,
    });
  });

  it('returns unchanged without writing when values already match', async () => {
    const { ctx, db } = createContext([serviceRow({})]);

    const result = (await getTool(ctx, 'update_application_source').execute(
      {
        service_id: 'hotdeal__svc',
        repo_url: 'https://github.com/acme/hotdeal',
        branch: 'main',
        container_port: 3000,
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(db.updateService).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'unchanged',
      project_id: 'hotdeal',
      service_id: 'hotdeal__svc',
      changed_fields: [],
      needs_redeploy: false,
    });
  });

  it('rejects mixed Git and image source fields', async () => {
    const { ctx } = createContext([serviceRow({})]);

    await expect(
      getTool(ctx, 'update_application_source').execute(
        {
          service_id: 'hotdeal__svc',
          source: 'image',
          repo_url: 'https://github.com/acme/hotdeal',
          image: 'ghcr.io/acme/hotdeal:latest',
        },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE_FIELDS' });
  });

  it('rejects no source update fields', async () => {
    const { ctx } = createContext([serviceRow({})]);

    await expect(
      getTool(ctx, 'update_application_source').execute(
        { service_id: 'hotdeal__svc' },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'NO_SOURCE_UPDATE_FIELDS' });
  });

  it('rejects image source switches for Compose parents', async () => {
    const { ctx } = createContext([
      serviceRow({ kind: 'compose', source: 'compose', id: 'stack__svc', name: 'stack' }),
    ]);

    await expect(
      getTool(ctx, 'update_application_source').execute(
        { service_id: 'stack__svc', source: 'image', image: 'ghcr.io/acme/stack:latest' },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE_UPDATE' });
  });

  it('rejects managed resources and compose child targets', async () => {
    const managed = createContext([serviceRow({ id: 'pg', kind: 'postgres', source: 'postgres' })]);
    await expect(
      getTool(managed.ctx, 'update_application_source').execute(
        { service_id: 'pg', branch: 'main' },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'SERVICE_OPERATION_UNSUPPORTED' });

    const composeChild = createContext([
      serviceRow({ id: 'stack-web', kind: 'compose-child', source: 'compose-child' }),
    ]);
    await expect(
      getTool(composeChild.ctx, 'update_application_source').execute(
        { service_id: 'stack-web', branch: 'main' },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'SERVICE_OPERATION_UNSUPPORTED' });
  });
});
