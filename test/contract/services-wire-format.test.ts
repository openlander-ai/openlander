/**
 * PR 2.5 regression: services wire-format stability
 *
 * Asserts that HTTP routes + MCP tools emit the legacy wire keys
 * (type, image, port) populated from the CANONICAL columns
 * (kind, image_url, assigned_port) — not the legacy DB columns.
 *
 * Scenario: a service row has canonical columns populated with the
 * "real" values and legacy columns set to stale/wrong values. Both
 * HTTP responses and MCP tool responses must emit the canonical values
 * under the legacy wire key names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Database } from '../../src/db/index.js';
import type { ServiceRow } from '../../src/db/index.js';
import { createApiRoutes } from '../../src/web/api/routes.js';
import { createMockContext } from '../helpers/web-route-mocks.js';
import { createSharedToolRegistry } from '../tools/shared-tool-registry.js';
import type { AppContext } from '../../src/app.js';
import * as traefikPipeline from '../../src/pipeline/traefik.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a ServiceRow that mimics a 0009-migrated managed service:
 * kind is set from legacyTypeToKind(), but image_url=NULL and assigned_port=NULL
 * as 0009 intentionally left them. Wire emission must fall back to legacy columns.
 */
function buildPreMigrationRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'svc-premigration-1',
    name: 'my-pg-legacy',
    // Legacy columns — source of truth for 0009-migrated rows
    type: 'postgresql',
    image: 'postgres:14',
    port: 5432,
    env_vars: null,
    credentials: null,
    status: 'running',
    container_id: 'ctr-legacy',
    container_name: 'ol-svc-my-pg-legacy',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    // Canonical columns — partially populated as 0009 left them
    kind: 'postgres',
    image_url: null, // 0009 did not backfill
    assigned_port: null, // managed services intentionally NULL per 0009 design
    ...overrides,
  };
}

/**
 * Build a ServiceRow that mimics a post-0012 fresh-create row:
 * canonical columns populated, legacy `type` column is NULL (not written
 * by the new code path after migration 0012). Wire emission must fall back
 * to kindToLegacyType(kind) and emit the legacy vocabulary (postgresql/mongodb).
 */
function buildCanonicalRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'svc-canonical-1',
    name: 'my-postgres',
    // Legacy `type` is NULL — post-0012 fresh-create rows won't have it populated.
    // Wire emission must derive the legacy vocabulary via kindToLegacyType(kind).
    type: null,
    image: 'STALE_IMAGE',
    port: 9999,
    env_vars: null,
    credentials: null,
    status: 'running',
    container_id: 'ctr-abc',
    container_name: 'ol-svc-my-postgres',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    // Canonical columns — source of truth for post-0012 rows
    kind: 'postgres',
    image_url: 'postgres:17-alpine',
    assigned_port: 5432,
    ...overrides,
  };
}

// MCP tool context mock
function createMcpContext(service: ServiceRow) {
  const serviceManager = {
    list: vi.fn(async () => [service]),
    create: vi.fn(),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    remove: vi.fn(async () => ({})),
    createDatabase: vi.fn(),
    createUser: vi.fn(),
    getSuggestedEnv: vi.fn(() => []),
  };

  const ctx = {
    config: { git: { sshKeyPath: '' } },
    serviceManager,
  } as unknown as AppContext;

  return { ctx, serviceManager };
}

// ---------------------------------------------------------------------------
// MCP wire format tests
// ---------------------------------------------------------------------------

describe('PR 2.5 — services wire-format stability (MCP)', () => {
  beforeEach(() => {
    vi.spyOn(traefikPipeline, 'getAllIps').mockReturnValue([]);
  });

  it('list_services emits legacy vocabulary type (postgresql) via kindToLegacyType when type=NULL', async () => {
    const row = buildCanonicalRow();
    const { ctx } = createMcpContext(row);

    const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
      (t) => t.name === 'list_services',
    );
    expect(tool).toBeDefined();

    const result = (await tool!.execute({}, { target: 'mcp' })) as {
      services: Array<{ type: string; port: number; image: string }>;
    };

    expect(result.services).toHaveLength(1);
    const svc = result.services[0];
    // Wire contract: kind='postgres' + type=NULL → emit 'postgresql' (legacy vocabulary)
    expect(svc.type).toBe('postgresql');
    expect(svc.port).toBe(5432);
    expect(svc.image).toBe('postgres:17-alpine');
    // Must NOT emit canonical kind directly or stale values
    expect(svc.type).not.toBe('postgres');
    expect(svc.port).not.toBe(9999);
    expect(svc.image).not.toBe('STALE_IMAGE');
  });

  it('get_service_credentials emits legacy vocabulary type (postgresql) via kindToLegacyType when type=NULL', async () => {
    const row = buildCanonicalRow({
      credentials: JSON.stringify({
        user: 'openlander',
        password: 'secret',
        database: 'mydb',
        host: 'ol-svc-my-postgres',
        port: 5432,
        connectionString: 'postgresql://openlander:secret@ol-svc-my-postgres:5432/mydb',
      }),
    });
    const { ctx } = createMcpContext(row);

    const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
      (t) => t.name === 'get_service_credentials',
    );
    expect(tool).toBeDefined();

    const result = (await tool!.execute(
      { service_name: 'my-postgres' },
      { target: 'mcp' },
    )) as { type: string; port: number };

    // Wire contract: kind='postgres' + type=NULL → emit 'postgresql' (legacy vocabulary)
    expect(result.type).toBe('postgresql');
    expect(result.type).not.toBe('postgres');
    // Port comes from credentials blob first, which is 5432
    expect(result.port).toBe(5432);
    expect(result.port).not.toBe(9999);
  });

  it('list_services emits legacy type directly for 0009-migrated rows (type=postgresql, image_url=NULL, assigned_port=NULL)', async () => {
    const row = buildPreMigrationRow();
    const { ctx } = createMcpContext(row);

    const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
      (t) => t.name === 'list_services',
    );
    expect(tool).toBeDefined();

    const result = (await tool!.execute({}, { target: 'mcp' })) as {
      services: Array<{ type: string; port: number; image: string }>;
    };

    expect(result.services).toHaveLength(1);
    const svc = result.services[0];
    // Wire contract: legacy type='postgresql' is present, so it passes through directly.
    expect(svc.type).toBe('postgresql');
    // assigned_port is NULL — must fall back to legacy port
    expect(svc.port).toBe(5432);
    // image_url is NULL — must fall back to legacy image, not emit empty string
    expect(svc.image).toBe('postgres:14');
    expect(svc.image).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// HTTP wire format tests
// ---------------------------------------------------------------------------

describe('PR 2.5 — services wire-format stability (HTTP)', () => {
  let app: Hono;
  let db: Database;
  let tmpDir: string;
  let projectId: string;
  let serviceId: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ol-wire-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    const ctx = createMockContext(db);

    db.createProject({ id: 'proj-1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });
    projectId = 'proj-1';

    // Create service via repo — this writes both legacy and canonical columns
    const svc = db.createService({
      id: 'svc-1',
      name: 'my-postgres',
      type: 'postgres',
      image: 'postgres:17-alpine',
      containerName: 'ol-svc-my-postgres',
      port: 5432,
    });
    serviceId = svc.id;

    // Connect to project
    db.createServiceConnection({
      id: 'conn-1',
      projectId,
      serviceId,
    });

    app = new Hono();
    app.route('/api', createApiRoutes(ctx));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /projects/:p/managed-services emits legacy vocabulary type via kindToLegacyType (post-0012: type column dropped)', async () => {
    const res = await app.request(`/api/projects/${projectId}/managed-services`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<{
      type: string;
      port: number;
      id: string;
    }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);

    const svc = body[0];
    // Post-0012: createService no longer writes the legacy type column.
    // Wire contract: type is derived via kindToLegacyType(kind).
    // kind='postgres' → kindToLegacyType → 'postgresql' (legacy vocabulary).
    expect(svc.type).toBe('postgresql');
    // assigned_port=5432 should be emitted as port
    expect(svc.port).toBe(5432);
  });

  it('createService repo writes canonical columns (post-0012: type/image/port dropped)', () => {
    const svc = db.getService(serviceId);
    expect(svc).toBeDefined();
    // Canonical columns populated at write time — source of truth post-0012
    expect(svc!.kind).toBe('postgres');
    expect(svc!.image_url).toBe('postgres:17-alpine');
    expect(svc!.assigned_port).toBe(5432);
    // Post-0012 Phase C: legacy type/image/port columns dropped from services.
    // These are now undefined (column gone from schema).
    expect(svc!.type).toBeUndefined();
    expect(svc!.image).toBeUndefined();
    expect(svc!.port).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CCG regression: kindToLegacyType wire-emission contract
// ---------------------------------------------------------------------------

describe('CCG — kindToLegacyType wire-emission (MCP)', () => {
  beforeEach(() => {
    vi.spyOn(traefikPipeline, 'getAllIps').mockReturnValue([]);
  });

  // Scenario: post-rc.7 fresh-create where legacy `type` column was NOT populated.
  // kind='postgres', type=NULL → wire must emit 'postgresql' (not 'postgres').
  it('list_services emits postgresql (not postgres) for kind=postgres + type=NULL', async () => {
    const row = buildCanonicalRow({ type: null });
    const { ctx } = createMcpContext(row);

    const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
      (t) => t.name === 'list_services',
    );
    expect(tool).toBeDefined();

    const result = (await tool!.execute({}, { target: 'mcp' })) as {
      services: Array<{ type: string }>;
    };

    expect(result.services[0].type).toBe('postgresql');
    expect(result.services[0].type).not.toBe('postgres');
  });

  // Scenario: post-rc.7 fresh-create where legacy `type` column was NOT populated.
  // kind='mongo', type=NULL → wire must emit 'mongodb' (not 'mongo').
  it('list_services emits mongodb (not mongo) for kind=mongo + type=NULL', async () => {
    const row = buildCanonicalRow({ kind: 'mongo', type: null, assigned_port: 27017 });
    const { ctx } = createMcpContext(row);

    const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
      (t) => t.name === 'list_services',
    );
    expect(tool).toBeDefined();

    const result = (await tool!.execute({}, { target: 'mcp' })) as {
      services: Array<{ type: string }>;
    };

    expect(result.services[0].type).toBe('mongodb');
    expect(result.services[0].type).not.toBe('mongo');
  });

  // Scenario: legacy type is already populated (pre-0012 rows) → passes through unchanged.
  it('list_services passes through legacy type when already populated (e.g. postgresql)', async () => {
    const row = buildCanonicalRow({ type: 'postgresql', kind: 'postgres' });
    const { ctx } = createMcpContext(row);

    const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
      (t) => t.name === 'list_services',
    );
    expect(tool).toBeDefined();

    const result = (await tool!.execute({}, { target: 'mcp' })) as {
      services: Array<{ type: string }>;
    };

    expect(result.services[0].type).toBe('postgresql');
  });
});
