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
  runtimeStatuses?: Record<string, string>;
  deployables: Record<string, ReturnType<typeof makeService> | undefined>;
  groups?: Record<string, Array<ReturnType<typeof makeService>>>;
  domainMappings?: Array<Record<string, unknown>>;
  failedInitialProjects?: string[];
}) {
  const services = Object.values(params.deployables).filter(
    (service): service is ReturnType<typeof makeService> => service !== undefined,
  );
  const ctx = {
    db: {
      listProjects: vi.fn(async () => params.projects),
      listProjectsWithMetadata: vi.fn(async () =>
        params.projects.map((project) => ({
          project,
          runtimeStatus: params.runtimeStatuses?.[String(project['id'])],
          failedInitialDeploy:
            params.failedInitialProjects?.includes(String(project['id'])) ?? false,
        })),
      ),
      getServices: vi.fn(async (query?: { ids?: string[] }) =>
        query?.ids ? services.filter((service) => query.ids?.includes(service.id)) : services,
      ),
      getDeployableForProject: vi.fn(async (id: string) => params.deployables[id]),
      getDeployablesByGroup: vi.fn(async (id: string) => params.groups?.[id] ?? []),
      listDomainMappings: vi.fn(async () => params.domainMappings ?? []),
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
  it('labels a retained failed first deployment without hiding it', async () => {
    const failedService = makeService({ id: 'failed__svc', project_id: 'failed', status: 'error' });
    const ctx = createContext({
      projects: [
        {
          id: 'failed',
          name: 'failed',
          status: 'error',
          visibility: 'internal',
          created_at: NOW,
          updated_at: NOW,
        },
      ],
      deployables: { failed: failedService },
      groups: { failed: [failedService] },
      failedInitialProjects: ['failed'],
    });

    const wire = await runWire(ctx);

    expect(wire.projects).toHaveLength(1);
    expect(wire.projects[0]).toMatchObject({
      id: 'failed',
      status: 'error',
      failed_initial_deploy: true,
    });
  });

  it('uses the Compose child aggregate status for the Project and parent workload', async () => {
    const rawParent = {
      id: 'incar',
      name: 'incar',
      status: 'stopped',
      visibility: 'internal',
      created_at: NOW,
      updated_at: NOW,
    };
    const composeParent = makeService({
      id: 'incar__svc',
      name: 'incar__svc',
      project_id: 'incar',
      kind: 'compose',
      status: 'stopped',
    });
    const ctx = createContext({
      projects: [rawParent],
      runtimeStatuses: { incar: 'running' },
      deployables: { incar: composeParent },
      groups: { incar: [composeParent] },
    });

    const wire = await runWire(ctx);

    expect(ctx.db.listProjectsWithMetadata).toHaveBeenCalledWith();
    expect(wire.projects[0]).toMatchObject({
      id: 'incar',
      status: 'running',
      route_health: { status: 'unknown', summary: 'No custom domain routes are registered.' },
      deployable_service: {
        status: 'running',
        route_health: {
          status: 'unknown',
          summary: 'No custom domain routes are registered.',
        },
      },
      deployable_services: [
        {
          status: 'running',
          route_health: {
            status: 'unknown',
            summary: 'No custom domain routes are registered.',
          },
        },
      ],
    });
  });

  it('advertises primary Application route URL instead of Project namespace URL', async () => {
    const originalPublicHost = process.env['OPENLANDER_PUBLIC_HOST'];
    process.env['OPENLANDER_PUBLIC_HOST'] = 'apps.example.com';
    try {
      const ctx = createContext({
        projects: [
          {
            id: 'p2probe',
            name: 'p2probe',
            status: null,
            visibility: null,
            created_at: NOW,
            updated_at: NOW,
          },
        ],
        deployables: {
          p2probe: undefined,
        },
        groups: {
          p2probe: [
            makeService({
              id: 'urlnest__svc',
              name: 'urlnest__svc',
              project_id: 'p2probe',
              status: 'running',
              assigned_port: 10001,
              container_id: 'c-urlnest',
              container_name: 'ol-urlnest',
            }),
          ],
        },
        domainMappings: [
          {
            id: 'domain-urlnest',
            service_id: 'urlnest__svc',
            domain: 'urlnest.example.com',
            status: 'active',
            path_prefix: '/',
          },
        ],
      });

      const wire = await runWire(ctx);
      const project = wire.projects[0]!;
      expect(project['name']).toBe('p2probe');
      expect(project['url']).toBe('http://urlnest.apps.example.com');
      expect(project['route_health']).toMatchObject({
        status: 'healthy',
        custom_domain_count: 1,
      });
      expect(
        (project['deployable_service'] as Record<string, unknown>)['route_health'],
      ).toMatchObject({
        status: 'healthy',
        custom_domain_count: 1,
      });
      expect(project['preferred_url']).toBe('http://urlnest.apps.example.com');
      expect(project['urls']).toEqual([
        expect.objectContaining({ url: 'http://urlnest.apps.example.com' }),
      ]);
      expect(project['url']).not.toBe('http://p2probe.apps.example.com');
    } finally {
      if (originalPublicHost === undefined) {
        delete process.env['OPENLANDER_PUBLIC_HOST'];
      } else {
        process.env['OPENLANDER_PUBLIC_HOST'] = originalPublicHost;
      }
    }
  });

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
      visibility: null,
      port: 10001,
      publicUrl: 'https://full.example',
      deployable_service_count: 1,
    });

    // services row present but port / public_url null: the keys must
    // remain on the wire as explicit null (NOT omitted) — the deployable
    // exists, so the historic shape serialized null.
    expect(nullports).toHaveProperty('port', null);
    expect(nullports).toHaveProperty('publicUrl', null);
    expect(nullports).toHaveProperty('visibility', null);
    expect(nullports['status']).toBe('stopped');
    expect(nullports).toHaveProperty('deployable_service_count', 1);

    // Both-empty project (no services row): the keys must be OMITTED on
    // the wire, not serialized as null / 'idle'.
    expect(empty).not.toHaveProperty('status');
    expect(empty).not.toHaveProperty('port');
    expect(empty).not.toHaveProperty('publicUrl');
    expect(empty).toHaveProperty('visibility', null);
    expect(empty).toHaveProperty('deployable_service_count', 0);
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
      groups: {
        full: [
          makeService({
            id: 'full__svc',
            name: 'full__svc',
            project_id: 'full',
            status: 'stopped',
            assigned_port: 10001,
            container_id: 'c-full',
            public_url: 'https://full.example',
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

    // The agent branch keys projects by `name` (no `id`).
    const wire = await runWire(ctx, 'agent');
    const full = wire.projects.find((p) => p['name'] === 'full')!;
    const nullports = wire.projects.find((p) => p['name'] === 'nullports')!;
    const empty = wire.projects.find((p) => p['name'] === 'empty')!;

    expect(full).toMatchObject({
      status: 'stopped',
      visibility: null,
      port: 10001,
      publicUrl: 'https://full.example',
      deployable_service_count: 1,
    });

    // services row present, port/public_url null → explicit null on the wire
    expect(nullports).toHaveProperty('port', null);
    expect(nullports).toHaveProperty('publicUrl', null);
    expect(nullports).toHaveProperty('visibility', null);
    expect(nullports).toHaveProperty('deployable_service_count', 1);

    // no services row → keys omitted
    expect(empty).not.toHaveProperty('status');
    expect(empty).not.toHaveProperty('port');
    expect(empty).not.toHaveProperty('publicUrl');
    expect(empty).toHaveProperty('visibility', null);
    expect(empty).toHaveProperty('deployable_service_count', 0);
  });
});
