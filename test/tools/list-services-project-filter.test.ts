import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { ORPHAN_MANAGED_GROUP_ID } from '../../src/db/service-ids.js';
import type { ServiceConnectionRow, ServiceRow } from '../../src/db/types.js';
import { serviceToolDefs } from '../../src/tools/defs/service.js';

function serviceRow(overrides: Partial<ServiceRow>): ServiceRow {
  return {
    id: 'svc',
    project_id: ORPHAN_MANAGED_GROUP_ID,
    name: 'svc',
    kind: 'postgres',
    type: null,
    image: null,
    image_url: 'postgres:17-alpine',
    port: null,
    assigned_port: 5432,
    env_vars: null,
    credentials: null,
    status: 'running',
    container_id: null,
    container_name: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as ServiceRow;
}

function serviceConnectionRow(providerId: string): ServiceConnectionRow {
  return {
    id: `conn-${providerId}`,
    service_id_consumer: 'app__svc',
    service_id_provider: providerId,
    environment_id: null,
    auto_injected_env_keys: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as ServiceConnectionRow;
}

function createContext() {
  const project = { id: 'app', name: 'app' };
  const direct = serviceRow({
    id: 'pg-direct',
    project_id: project.id,
    name: 'app-postgres',
    kind: 'postgres',
  });
  const connected = serviceRow({
    id: 'redis-connected',
    project_id: ORPHAN_MANAGED_GROUP_ID,
    name: 'app-redis',
    kind: 'redis',
    image_url: 'redis:8-alpine',
    assigned_port: 6379,
  });
  const other = serviceRow({
    id: 'mysql-other',
    project_id: 'other',
    name: 'other-mysql',
    kind: 'mysql',
  });

  const ctx = {
    db: {
      getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
      getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
      listProjects: vi.fn().mockResolvedValue([project, { id: 'other', name: 'other' }]),
      listServiceConnectionsByProject: vi
        .fn()
        .mockResolvedValue([serviceConnectionRow(connected.id)]),
    },
    serviceManager: {
      list: vi.fn().mockResolvedValue([direct, connected, other]),
    },
    docker: {
      listManagedContainers: vi.fn().mockResolvedValue([]),
    },
  } as unknown as AppContext;

  return { ctx, direct, connected, other };
}

function getListServicesTool() {
  const tool = serviceToolDefs.find((entry) => entry.name === 'list_services');
  expect(tool).toBeDefined();
  return tool!;
}

describe('list_services project filtering', () => {
  it('accepts project_id and returns direct plus connected managed services', async () => {
    const { ctx, direct, connected, other } = createContext();
    const tool = getListServicesTool();

    const parsed = tool.inputSchema.safeParse({ project_id: 'app' });
    expect(parsed.success).toBe(true);
    expect(tool.inputSchema.safeParse({ project: 'app' }).success).toBe(false);

    const result = (await tool.execute({ project_id: 'app' }, { target: 'mcp', appCtx: ctx })) as {
      count: number;
      services: Array<{
        id: string;
        attached_project_id: string | null;
        attached_project_name: string | null;
      }>;
    };

    expect(result.count).toBe(2);
    expect(result.services.map((service) => service.id).sort()).toEqual(
      [connected.id, direct.id].sort(),
    );
    expect(result.services.map((service) => service.id)).not.toContain(other.id);
    expect(result.services.every((service) => service.attached_project_id === 'app')).toBe(true);
    expect(result.services.every((service) => service.attached_project_name === 'app')).toBe(true);
    expect(ctx.db.listServiceConnectionsByProject).toHaveBeenCalledWith('app');
  });

  it('accepts project_name for the same project-scoped view', async () => {
    const { ctx, direct, connected } = createContext();
    const tool = getListServicesTool();

    const result = (await tool.execute(
      { project_name: 'app' },
      { target: 'mcp', appCtx: ctx },
    )) as { services: Array<{ id: string }> };

    expect(ctx.db.getProjectByName).toHaveBeenCalledWith('app');
    expect(result.services.map((service) => service.id).sort()).toEqual(
      [connected.id, direct.id].sort(),
    );
  });

  it('returns a structured failure for an unknown project filter', async () => {
    const { ctx } = createContext();
    const tool = getListServicesTool();

    const result = (await tool.execute(
      { project_id: 'missing' },
      { target: 'mcp', appCtx: ctx },
    )) as {
      status: string;
      code: string;
      message: string;
    };

    expect(result.status).toBe('failed');
    expect(result.code).toBe('PROJECT_NOT_FOUND');
    expect(result.message).toContain('missing');
    expect(ctx.serviceManager.list).not.toHaveBeenCalled();
  });
});
