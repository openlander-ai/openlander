import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function getListProjectsTool(ctx: AppContext) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
    (entry) => entry.name === 'list_projects',
  );
  expect(tool).toBeDefined();
  return tool!;
}

const NOW = '2026-01-01T00:00:00.000Z';

function makeService(overrides: Record<string, unknown>) {
  return {
    id: 'x__svc',
    name: 'x__svc',
    project_id: 'x',
    kind: 'git',
    source: 'git',
    status: 'stopped',
    visibility: 'internal',
    assigned_port: null,
    container_id: null,
    container_name: null,
    public_url: null,
    ...overrides,
  };
}

function createContext(params: {
  projects: Array<Record<string, unknown>>;
  deployables: Record<string, ReturnType<typeof makeService> | undefined>;
  groups?: Record<string, Array<ReturnType<typeof makeService>>>;
}) {
  const services = Object.values(params.deployables).filter(
    (service): service is ReturnType<typeof makeService> => service !== undefined,
  );
  const ctx = {
    db: {
      listProjects: vi.fn(async () => params.projects),
      getServices: vi.fn(async (query?: { ids?: string[] }) =>
        query?.ids ? services.filter((service) => query.ids?.includes(service.id)) : services,
      ),
      getDeployableForProject: vi.fn(async (id: string) => params.deployables[id]),
      getDeployablesByGroup: vi.fn(async (id: string) => params.groups?.[id] ?? []),
      updateProject: vi.fn(async () => undefined),
    },
    docker: { inspectContainer: vi.fn() },
  } as unknown as AppContext;
  return ctx;
}

// Both the MCP adapter and the AI-SDK (agent) adapter serialize tool
// results with JSON.stringify, so an `undefined` field is omitted from the
// wire. Round-trip through JSON to assert the actual agent-facing shape
// rather than the in-memory object.
async function runWire(ctx: AppContext, target: 'mcp' | 'agent' = 'mcp') {
  const result = await getListProjectsTool(ctx).execute({}, { target });
  return JSON.parse(JSON.stringify(result)) as {
    count: number;
    projects: Array<Record<string, unknown>>;
  };
}

describe('list_projects MCP omit-contract (S3.2 ServiceView)', () => {
  it('emits canonical services-row values and omits status/port/publicUrl when both rows are empty', async () => {
    const ctx = createContext({
      projects: [
        // every deprecated project column is null/absent; the services row is live
        {
          id: 'full',
          name: 'full',
          status: null,
          visibility: null,
          created_at: NOW,
          updated_at: NOW,
        },
        // services row exists but its port / public_url are null —
        // listProjects() hydrates these nulls onto the project row via
        // mergeDeployable(), so the historic wire emitted explicit null.
        {
          id: 'nullports',
          name: 'nullports',
          status: 'stopped',
          visibility: null,
          assigned_port: null,
          public_url: null,
          created_at: NOW,
          updated_at: NOW,
        },
        // no services row and no project runtime columns at all
        {
          id: 'empty',
          name: 'empty',
          status: null,
          visibility: null,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      deployables: {
        full: makeService({
          id: 'full__svc',
          name: 'full__svc',
          project_id: 'full',
          status: 'stopped',
          assigned_port: 10001,
          container_id: 'c-full',
          container_name: 'ol-full',
          public_url: 'https://full.example',
        }),
        nullports: makeService({
          id: 'nullports__svc',
          name: 'nullports__svc',
          project_id: 'nullports',
          status: 'stopped',
          assigned_port: null,
          container_id: null,
          public_url: null,
        }),
        empty: undefined,
      },
      groups: {
        full: [
          makeService({
            id: 'full__svc',
            name: 'full__svc',
            project_id: 'full',
            status: 'stopped',
            assigned_port: 10001,
            container_id: 'c-full',
            container_name: 'ol-full',
          }),
        ],
        nullports: [
          makeService({
            id: 'nullports__svc',
            name: 'nullports__svc',
            project_id: 'nullports',
            status: 'stopped',
            assigned_port: null,
            container_id: null,
            public_url: null,
          }),
        ],
        empty: [],
      },
    });

    const wire = await runWire(ctx);
    const full = wire.projects.find((p) => p['id'] === 'full')!;
    const nullports = wire.projects.find((p) => p['id'] === 'nullports')!;
    const empty = wire.projects.find((p) => p['id'] === 'empty')!;

    // Canonical services-row values surface (project columns were null).
    expect(full).toMatchObject({
      status: 'stopped',
      port: 10001,
      publicUrl: 'https://full.example',
    });

    // services row present but port / public_url null: the keys must
    // remain on the wire as explicit null (NOT omitted) — the deployable
    // exists, so the historic shape serialized null.
    expect(nullports).toHaveProperty('port', null);
    expect(nullports).toHaveProperty('publicUrl', null);
    expect(nullports['status']).toBe('stopped');

    // Both-empty project (no services row): the keys must be OMITTED on
    // the wire, not serialized as null / 'idle'.
    expect(empty).not.toHaveProperty('status');
    expect(empty).not.toHaveProperty('port');
    expect(empty).not.toHaveProperty('publicUrl');
  });
});

describe('list_projects agent-branch omit-contract (S3.3 ServiceView)', () => {
  it('applies the same null-vs-omit shape on the non-MCP (agent) return', async () => {
    const ctx = createContext({
      projects: [
        {
          id: 'full',
          name: 'full',
          status: null,
          visibility: null,
          created_at: NOW,
          updated_at: NOW,
        },
        {
          id: 'nullports',
          name: 'nullports',
          status: 'stopped',
          visibility: null,
          assigned_port: null,
          public_url: null,
          created_at: NOW,
          updated_at: NOW,
        },
        {
          id: 'empty',
          name: 'empty',
          status: null,
          visibility: null,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      deployables: {
        full: makeService({
          id: 'full__svc',
          name: 'full__svc',
          project_id: 'full',
          status: 'stopped',
          assigned_port: 10001,
          container_id: 'c-full',
          public_url: 'https://full.example',
        }),
        nullports: makeService({
          id: 'nullports__svc',
          name: 'nullports__svc',
          project_id: 'nullports',
          status: 'stopped',
          assigned_port: null,
          container_id: null,
          public_url: null,
        }),
        empty: undefined,
      },
    });

    // The agent branch keys projects by `name` (no `id`).
    const wire = await runWire(ctx, 'agent');
    const full = wire.projects.find((p) => p['name'] === 'full')!;
    const nullports = wire.projects.find((p) => p['name'] === 'nullports')!;
    const empty = wire.projects.find((p) => p['name'] === 'empty')!;

    expect(full).toMatchObject({
      status: 'stopped',
      port: 10001,
      publicUrl: 'https://full.example',
    });

    // services row present, port/public_url null → explicit null on the wire
    expect(nullports).toHaveProperty('port', null);
    expect(nullports).toHaveProperty('publicUrl', null);

    // no services row → keys omitted
    expect(empty).not.toHaveProperty('status');
    expect(empty).not.toHaveProperty('port');
    expect(empty).not.toHaveProperty('publicUrl');
  });
});
