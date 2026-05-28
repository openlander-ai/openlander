import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { ServiceRow } from '../../src/db/types.js';
import {
  __test_resetTopologyNodeCache,
  buildLegacyTopologyNode,
  inferLegacyTopologyKind,
  type LegacyTopologyNodeInput,
} from '../../src/web/api/helpers/topology-runtime.js';

function makeServiceRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'p-1__svc',
    project_id: 'p-1',
    name: 'p-1__svc',
    kind: 'image',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 9100,
    container_id: 'container-1',
    container_name: 'ol-p1',
    container_port: 3000,
    image_tag: 'p-1:tag',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: 'image',
    repo_url: null,
    branch: null,
    image_url: 'nginx:alpine',
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: null,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: null,
    health_check_path: null,
    recovering_started_at: null,
    credentials: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    server_id: 'local',
    ...overrides,
  };
}

function makeInputNode(overrides: Partial<LegacyTopologyNodeInput> = {}): LegacyTopologyNodeInput {
  return {
    id: 'p-1',
    name: 'p-1',
    status: null,
    container_id: null,
    assigned_port: null,
    image_url: null,
    image_tag: null,
    ...overrides,
  };
}

// Topology cache is module-level — clean every test so a previous node's
// cached runtime doesn't leak into the next case.
function makeCtx(overrides: {
  deployable?: ServiceRow | null;
  inspectContainer?: ReturnType<typeof vi.fn>;
}): Pick<AppContext, 'db' | 'docker'> {
  __test_resetTopologyNodeCache();
  const getDeployableForProject = vi.fn(async () => overrides.deployable ?? null);
  const inspectContainer = overrides.inspectContainer ?? vi.fn(async () => ({ State: {} }));
  return {
    db: {
      getDeployableForProject,
      getLatestServiceMetric: vi.fn(async () => undefined),
    } as unknown as AppContext['db'],
    docker: {
      inspectContainer,
      getContainerStats: vi.fn(async () => ({})),
    } as unknown as AppContext['docker'],
  };
}

describe('inferLegacyTopologyKind', () => {
  it('labels recognised database substrings as Database', () => {
    expect(inferLegacyTopologyKind('my-postgres')).toBe('Database');
    expect(inferLegacyTopologyKind('REDIS-cache')).toBe('Database');
    expect(inferLegacyTopologyKind('mongo')).toBe('Database');
    expect(inferLegacyTopologyKind('clickhouse')).toBe('Database');
    expect(inferLegacyTopologyKind('minio')).toBe('Database');
  });

  it('falls through to Application for arbitrary names', () => {
    expect(inferLegacyTopologyKind('web')).toBe('Application');
    expect(inferLegacyTopologyKind('my-api')).toBe('Application');
    expect(inferLegacyTopologyKind('worker')).toBe('Application');
  });
});

describe('buildLegacyTopologyNode', () => {
  it('preserves the inline-block projection shape and field order', async () => {
    const deployable = makeServiceRow();
    const ctx = makeCtx({ deployable });

    const node = await buildLegacyTopologyNode(ctx, makeInputNode({ name: 'p-1' }), {
      dependsOnMap: new Map([['p-1', ['dep-a']]]),
    });

    expect(node).toEqual({
      id: 'p-1',
      name: 'p-1',
      kind: 'Application',
      image: 'nginx:alpine',
      health: expect.any(String),
      port: 9100,
      url: expect.stringContaining('p-1'),
      cpu: expect.any(String),
      mem: expect.any(String),
      dependsOn: ['dep-a'],
    });
  });

  it('falls back deployable → node → null across port/image/runtime fields', async () => {
    const ctx = makeCtx({ deployable: null });

    const node = await buildLegacyTopologyNode(
      ctx,
      makeInputNode({
        name: 'p-2',
        status: 'running',
        container_id: 'fallback-container',
        assigned_port: 8080,
        image_tag: 'fallback:tag',
      }),
      { dependsOnMap: new Map() },
    );

    expect(node.port).toBe(8080);
    expect(node.image).toBe('fallback:tag');
    expect(node.dependsOn).toEqual([]);
  });

  it('uses cachedDeployable instead of refetching when supplied', async () => {
    const cached = makeServiceRow({ assigned_port: 7777 });
    const ctx = makeCtx({ deployable: makeServiceRow({ assigned_port: 9999 }) });

    const node = await buildLegacyTopologyNode(ctx, makeInputNode({ name: 'p-3' }), {
      dependsOnMap: new Map(),
      cachedDeployable: cached,
    });

    expect(node.port).toBe(7777);
    expect(ctx.db.getDeployableForProject).not.toHaveBeenCalled();
  });

  it('treats cachedDeployable: null as a final "no deployable" signal (no refetch)', async () => {
    const ctx = makeCtx({ deployable: makeServiceRow() });

    const node = await buildLegacyTopologyNode(
      ctx,
      makeInputNode({ name: 'p-4', assigned_port: 4444 }),
      { dependsOnMap: new Map(), cachedDeployable: null },
    );

    expect(node.port).toBe(4444);
    expect(ctx.db.getDeployableForProject).not.toHaveBeenCalled();
  });

  it('infers Database kind from name regardless of the deployable row', async () => {
    const ctx = makeCtx({ deployable: makeServiceRow() });

    const node = await buildLegacyTopologyNode(
      ctx,
      makeInputNode({ id: 'pg-1', name: 'my-postgres' }),
      { dependsOnMap: new Map() },
    );

    expect(node.kind).toBe('Database');
  });

  it('returns null url when port is null (project name unused)', async () => {
    const ctx = makeCtx({ deployable: null });

    const node = await buildLegacyTopologyNode(ctx, makeInputNode({ name: 'p-5' }), {
      dependsOnMap: new Map(),
    });

    expect(node.url).toBeNull();
  });
});
