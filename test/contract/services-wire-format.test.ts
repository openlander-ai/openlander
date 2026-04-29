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

/** Build a ServiceRow that has canonical columns populated with correct values
 * and legacy columns set to intentionally stale/wrong values so the test
 * verifies which source the wire code reads from. */
function buildCanonicalRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'svc-canonical-1',
    name: 'my-postgres',
    // Legacy columns — stale on purpose so the test catches regressions
    type: 'STALE_TYPE',
    image: 'STALE_IMAGE',
    port: 9999,
    env_vars: null,
    credentials: null,
    status: 'running',
    container_id: 'ctr-abc',
    container_name: 'ol-svc-my-postgres',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    // Canonical columns — these should be used for wire responses
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

  it('list_services emits kind as `type` and assigned_port as `port`', async () => {
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
    // Must use canonical values, not legacy stale values
    expect(svc.type).toBe('postgres');
    expect(svc.port).toBe(5432);
    expect(svc.image).toBe('postgres:17-alpine');
    // Must NOT emit stale legacy values
    expect(svc.type).not.toBe('STALE_TYPE');
    expect(svc.port).not.toBe(9999);
    expect(svc.image).not.toBe('STALE_IMAGE');
  });

  it('get_service_credentials emits canonical kind as `type` and assigned_port as `port`', async () => {
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

    expect(result.type).toBe('postgres');
    expect(result.type).not.toBe('STALE_TYPE');
    // Port comes from credentials blob first, which is 5432
    expect(result.port).toBe(5432);
    expect(result.port).not.toBe(9999);
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

  it('GET /projects/:p/managed-services emits canonical kind as `type` and assigned_port as `port`', async () => {
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
    // kind='postgres' should be emitted as type
    expect(svc.type).toBe('postgres');
    // assigned_port=5432 should be emitted as port
    expect(svc.port).toBe(5432);
  });

  it('createService repo writes both legacy and canonical columns', () => {
    const svc = db.getService(serviceId);
    expect(svc).toBeDefined();
    // Canonical columns must be populated at write time
    expect(svc!.kind).toBe('postgres');
    expect(svc!.image_url).toBe('postgres:17-alpine');
    expect(svc!.assigned_port).toBe(5432);
    // Legacy columns also still present (for 0012 Phase C backward compat)
    expect(svc!.type).toBe('postgres');
    expect(svc!.image).toBe('postgres:17-alpine');
    expect(svc!.port).toBe(5432);
  });
});
