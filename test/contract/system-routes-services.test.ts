/**
 * Contract test: /api/services wire shape stability post-Phase-C.
 *
 * Asserts that GET /services, POST /services, and GET /services/:id all
 * return objects with the legacy wire fields (type, image, port, env_vars)
 * populated from canonical ServiceRow fields after migration 0012 Phase C
 * drops the storage columns.
 *
 * This test pins the wire contract so the frontend (ServicesPage.tsx,
 * ServiceDetailV2.tsx, ServiceConnectionTab.tsx) continues to receive
 * the shape it expects through 1.x.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { testClient } from 'hono/testing';
import { ServiceInUseError } from '../../src/errors.js';

// Minimal ServiceRow shape post-0012 Phase C (storage cols dropped)
const makeCanonicalServiceRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'svc-test-001',
  name: 'test-redis',
  project_id: 'proj-test-001',
  kind: 'redis' as const,
  status: 'running' as const,
  visibility: 'internal' as const,
  source: 'image' as const,
  image_url: 'redis:7-alpine',
  assigned_port: 6379,
  container_id: 'abc123',
  container_name: 'test-redis',
  container_port: 6379,
  public_url: null,
  image_tag: null,
  previous_image_tag: null,
  dockerfile_path: null,
  docker_target: null,
  build_context: null,
  build_method: null,
  image_cmd: null,
  pending_fix: null,
  access_code: null,
  access_code_iv: null,
  is_preview: 0 as const,
  pr_number: null,
  project_type: null,
  health_check_strategy: null,
  health_check_path: null,
  recovering_started_at: null,
  parent_service_id: null,
  credentials: null,
  archived_at: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  server_id: 'local',
  // Post-0012: storage columns absent (undefined, not present on row)
  // type, image, port, env_vars are NOT set here
  ...overrides,
});

const makeCardSummary = (overrides: Record<string, unknown> = {}) => ({
  ...makeCanonicalServiceRow(overrides),
  summary: { healthStatus: 'healthy', uptimeSeconds: 3600, restartCount: 0 },
});

function buildMockRoutes(
  serviceRow = makeCanonicalServiceRow(),
  envVarsRecord: Record<string, string> = {},
) {
  const app = new Hono();

  const mockCtx = {
    serviceManager: {
      listWithCardSummary: vi.fn().mockResolvedValue([makeCardSummary()]),
      create: vi.fn().mockResolvedValue(serviceRow),
      getDetail: vi.fn().mockResolvedValue(serviceRow),
    },
    db: {
      getEnvVars: vi.fn().mockReturnValue(envVarsRecord),
      getEnvVarsForService: vi.fn().mockReturnValue(envVarsRecord),
    },
  };

  // Inline minimal route that mirrors the real system-routes.ts logic
  // (calls toServiceWire). We import the real route builder.
  return { app, mockCtx };
}

describe('system-routes /api/services wire shape contract', () => {
  it('GET /services: each item has type, image, port derived from canonical fields', async () => {
    // Build the real route using mocked AppContext
    const { createSystemRoutes } = await import('../../src/web/api/system-routes.js');
    const app = new Hono();

    const mockCtx = {
      serviceManager: {
        listWithCardSummary: vi.fn().mockResolvedValue([makeCardSummary()]),
        create: vi.fn(),
        getDetail: vi.fn(),
        getLogs: vi.fn(),
        getStats: vi.fn(),
        getInspectionHealth: vi.fn(),
        getConnectedProjects: vi.fn(),
        listDatabases: vi.fn(),
        createDatabase: vi.fn(),
        listUsers: vi.fn(),
        createUser: vi.fn(),
        remove: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
      },
      db: {
        getEnvVars: vi.fn().mockReturnValue({ REDIS_URL: 'redis://localhost:6379' }),
        getEnvVarsForService: vi.fn().mockReturnValue({ REDIS_URL: 'redis://localhost:6379' }),
        getService: vi.fn(),
        hasAnyServiceMetrics: vi.fn(),
        listServiceMetricsSince: vi.fn(),
      },
      config: { gitProviders: { github: {} } },
      docker: {},
    } as unknown as Parameters<typeof createSystemRoutes>[0];

    app.route('/api', createSystemRoutes(mockCtx));
    const res = await app.request('/api/services');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);

    const svc = body[0];
    // Wire contract: legacy fields must be present and populated
    expect(svc).toHaveProperty('type');
    expect(svc.type).toBe('redis'); // kind → type
    expect(svc).toHaveProperty('image');
    expect(svc.image).toBe('redis:7-alpine'); // image_url → image
    expect(svc).toHaveProperty('port');
    expect(svc.port).toBe(6379); // assigned_port → port
    expect(svc).toHaveProperty('env_vars');
    expect(typeof svc.env_vars).toBe('string'); // JSON string from env_vars repo
  });

  it('GET /services: env_vars is null when no env vars exist', async () => {
    const { createSystemRoutes } = await import('../../src/web/api/system-routes.js');
    const app = new Hono();

    const mockCtx = {
      serviceManager: {
        listWithCardSummary: vi.fn().mockResolvedValue([makeCardSummary()]),
        create: vi.fn(),
        getDetail: vi.fn(),
        getLogs: vi.fn(),
        getStats: vi.fn(),
        getInspectionHealth: vi.fn(),
        getConnectedProjects: vi.fn(),
        listDatabases: vi.fn(),
        createDatabase: vi.fn(),
        listUsers: vi.fn(),
        createUser: vi.fn(),
        remove: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
      },
      db: {
        getEnvVars: vi.fn().mockReturnValue({}), // no env vars
        getEnvVarsForService: vi.fn().mockReturnValue({}),
        getService: vi.fn(),
        hasAnyServiceMetrics: vi.fn(),
        listServiceMetricsSince: vi.fn(),
      },
      config: { gitProviders: { github: {} } },
      docker: {},
    } as unknown as Parameters<typeof createSystemRoutes>[0];

    app.route('/api', createSystemRoutes(mockCtx));
    const res = await app.request('/api/services');
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body[0].env_vars).toBeNull();
  });

  it('GET /services/:id: wire fields present on single service', async () => {
    const { createSystemRoutes } = await import('../../src/web/api/system-routes.js');
    const app = new Hono();

    const mockCtx = {
      serviceManager: {
        listWithCardSummary: vi.fn(),
        create: vi.fn(),
        getDetail: vi.fn().mockResolvedValue(makeCanonicalServiceRow()),
        getLogs: vi.fn(),
        getStats: vi.fn(),
        getInspectionHealth: vi.fn(),
        getConnectedProjects: vi.fn(),
        listDatabases: vi.fn(),
        createDatabase: vi.fn(),
        listUsers: vi.fn(),
        createUser: vi.fn(),
        remove: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
      },
      db: {
        getEnvVars: vi.fn().mockReturnValue({}),
        getEnvVarsForService: vi.fn().mockReturnValue({}),
        getService: vi.fn(),
        hasAnyServiceMetrics: vi.fn(),
        listServiceMetricsSince: vi.fn(),
      },
      config: { gitProviders: { github: {} } },
      docker: {},
    } as unknown as Parameters<typeof createSystemRoutes>[0];

    app.route('/api', createSystemRoutes(mockCtx));
    const res = await app.request('/api/services/svc-test-001');
    expect(res.status).toBe(200);

    const svc = (await res.json()) as Record<string, unknown>;
    expect(svc.type).toBe('redis');
    expect(svc.image).toBe('redis:7-alpine');
    expect(svc.port).toBe(6379);
  });

  it('GET /services/:id/connected-projects resolves and returns connected projects', async () => {
    const { createSystemRoutes } = await import('../../src/web/api/system-routes.js');
    const app = new Hono();
    const connectedProjects = [{ id: 'proj-1', name: 'baby-worldcup' }];

    const mockCtx = {
      serviceManager: {
        getConnectedProjects: vi.fn().mockResolvedValue(connectedProjects),
      },
      db: {},
      config: { gitProviders: { github: {} } },
      docker: {},
    } as unknown as Parameters<typeof createSystemRoutes>[0];

    app.route('/api', createSystemRoutes(mockCtx));
    const res = await app.request('/api/services/svc-pg/connected-projects');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(connectedProjects);
    expect(mockCtx.serviceManager.getConnectedProjects).toHaveBeenCalledWith('svc-pg');
  });

  it('DELETE /services/:id returns SERVICE_IN_USE with connected_projects', async () => {
    const { createSystemRoutes } = await import('../../src/web/api/system-routes.js');
    const app = new Hono();
    const connectedProjects = [{ id: 'proj-1', name: 'baby-worldcup' }];

    const mockCtx = {
      serviceManager: {
        remove: vi.fn().mockRejectedValue(new ServiceInUseError('postgres', connectedProjects)),
      },
      db: {},
      config: { gitProviders: { github: {} } },
      docker: {},
    } as unknown as Parameters<typeof createSystemRoutes>[0];

    app.route('/api', createSystemRoutes(mockCtx));
    const res = await app.request('/api/services/svc-pg', { method: 'DELETE' });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: 'SERVICE_IN_USE',
      code: 'SERVICE_IN_USE',
      connected_projects: connectedProjects,
    });
    expect(mockCtx.serviceManager.remove).toHaveBeenCalledWith('svc-pg');
  });

  it('GET /services: kind=postgres + type=NULL → wire emits postgresql (CCG regression)', async () => {
    const { createSystemRoutes } = await import('../../src/web/api/system-routes.js');
    const app = new Hono();

    const postgresRow = makeCardSummary({
      kind: 'postgres',
      // type is absent (post-0012 fresh row — legacy column dropped)
      image_url: 'postgres:17-alpine',
      assigned_port: 5432,
    });

    const mockCtx = {
      serviceManager: {
        listWithCardSummary: vi.fn().mockResolvedValue([postgresRow]),
        create: vi.fn(),
        getDetail: vi.fn(),
        getLogs: vi.fn(),
        getStats: vi.fn(),
        getInspectionHealth: vi.fn(),
        getConnectedProjects: vi.fn(),
        listDatabases: vi.fn(),
        createDatabase: vi.fn(),
        listUsers: vi.fn(),
        createUser: vi.fn(),
        remove: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
      },
      db: {
        getEnvVars: vi.fn().mockReturnValue({}),
        getEnvVarsForService: vi.fn().mockReturnValue({}),
        getService: vi.fn(),
        hasAnyServiceMetrics: vi.fn(),
        listServiceMetricsSince: vi.fn(),
      },
      config: { gitProviders: { github: {} } },
      docker: {},
    } as unknown as Parameters<typeof createSystemRoutes>[0];

    app.route('/api', createSystemRoutes(mockCtx));
    const res = await app.request('/api/services');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    // kind='postgres' + type=NULL → kindToLegacyType → 'postgresql'
    expect(body[0].type).toBe('postgresql');
    expect(body[0].type).not.toBe('postgres');
  });

  it('GET /services/:id: kind=postgres + type=NULL → wire emits postgresql (CCG regression)', async () => {
    const { createSystemRoutes } = await import('../../src/web/api/system-routes.js');
    const app = new Hono();

    const postgresRow = makeCanonicalServiceRow({
      id: 'svc-pg-001',
      kind: 'postgres',
      // type absent — post-0012 fresh row
      image_url: 'postgres:17-alpine',
      assigned_port: 5432,
    });

    const mockCtx = {
      serviceManager: {
        listWithCardSummary: vi.fn(),
        create: vi.fn(),
        getDetail: vi.fn().mockResolvedValue(postgresRow),
        getLogs: vi.fn(),
        getStats: vi.fn(),
        getInspectionHealth: vi.fn(),
        getConnectedProjects: vi.fn(),
        listDatabases: vi.fn(),
        createDatabase: vi.fn(),
        listUsers: vi.fn(),
        createUser: vi.fn(),
        remove: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
      },
      db: {
        getEnvVars: vi.fn().mockReturnValue({}),
        getEnvVarsForService: vi.fn().mockReturnValue({}),
        getService: vi.fn(),
        hasAnyServiceMetrics: vi.fn(),
        listServiceMetricsSince: vi.fn(),
      },
      config: { gitProviders: { github: {} } },
      docker: {},
    } as unknown as Parameters<typeof createSystemRoutes>[0];

    app.route('/api', createSystemRoutes(mockCtx));
    const res = await app.request('/api/services/svc-pg-001');
    expect(res.status).toBe(200);

    const svc = (await res.json()) as Record<string, unknown>;
    // kind='postgres' + type=NULL → kindToLegacyType → 'postgresql'
    expect(svc.type).toBe('postgresql');
    expect(svc.type).not.toBe('postgres');
  });

  it('GET /services: kind=mongo + type=NULL → wire emits mongodb (CCG regression)', async () => {
    const { createSystemRoutes } = await import('../../src/web/api/system-routes.js');
    const app = new Hono();

    const mongoRow = makeCardSummary({
      id: 'svc-mongo-001',
      kind: 'mongo',
      // type absent — post-0012 fresh row
      image_url: 'mongo:7',
      assigned_port: 27017,
    });

    const mockCtx = {
      serviceManager: {
        listWithCardSummary: vi.fn().mockResolvedValue([mongoRow]),
        create: vi.fn(),
        getDetail: vi.fn(),
        getLogs: vi.fn(),
        getStats: vi.fn(),
        getInspectionHealth: vi.fn(),
        getConnectedProjects: vi.fn(),
        listDatabases: vi.fn(),
        createDatabase: vi.fn(),
        listUsers: vi.fn(),
        createUser: vi.fn(),
        remove: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
      },
      db: {
        getEnvVars: vi.fn().mockReturnValue({}),
        getEnvVarsForService: vi.fn().mockReturnValue({}),
        getService: vi.fn(),
        hasAnyServiceMetrics: vi.fn(),
        listServiceMetricsSince: vi.fn(),
      },
      config: { gitProviders: { github: {} } },
      docker: {},
    } as unknown as Parameters<typeof createSystemRoutes>[0];

    app.route('/api', createSystemRoutes(mockCtx));
    const res = await app.request('/api/services');
    expect(res.status).toBe(200);

    const body = (await res.json()) as Array<Record<string, unknown>>;
    // kind='mongo' + type=NULL → kindToLegacyType → 'mongodb'
    expect(body[0].type).toBe('mongodb');
    expect(body[0].type).not.toBe('mongo');
  });

  it('legacy rows with type/image/port already set: passthrough unchanged', async () => {
    const { createSystemRoutes } = await import('../../src/web/api/system-routes.js');
    const app = new Hono();

    // Row that still has the old columns (pre-0012 or bridged)
    const legacyRow = makeCanonicalServiceRow({
      type: 'postgres',
      image: 'postgres:16-alpine',
      port: 5432,
      env_vars: '{"PG_PASSWORD":"secret"}',
    });

    const mockCtx = {
      serviceManager: {
        listWithCardSummary: vi.fn().mockResolvedValue([
          {
            ...legacyRow,
            summary: { healthStatus: null, uptimeSeconds: null, restartCount: null },
          },
        ]),
        create: vi.fn(),
        getDetail: vi.fn(),
        getLogs: vi.fn(),
        getStats: vi.fn(),
        getInspectionHealth: vi.fn(),
        getConnectedProjects: vi.fn(),
        listDatabases: vi.fn(),
        createDatabase: vi.fn(),
        listUsers: vi.fn(),
        createUser: vi.fn(),
        remove: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
      },
      db: {
        getEnvVars: vi.fn().mockReturnValue({ PG_PASSWORD: 'secret' }),
        getEnvVarsForService: vi.fn().mockReturnValue({ PG_PASSWORD: 'secret' }),
        getService: vi.fn(),
        hasAnyServiceMetrics: vi.fn(),
        listServiceMetricsSince: vi.fn(),
      },
      config: { gitProviders: { github: {} } },
      docker: {},
    } as unknown as Parameters<typeof createSystemRoutes>[0];

    app.route('/api', createSystemRoutes(mockCtx));
    const res = await app.request('/api/services');
    const body = (await res.json()) as Array<Record<string, unknown>>;
    // Legacy values take precedence via `??`
    expect(body[0].type).toBe('postgres');
    expect(body[0].image).toBe('postgres:16-alpine');
    expect(body[0].port).toBe(5432);
    expect(body[0].env_vars).toBe('{"PG_PASSWORD":"secret"}');
  });
});

describe("system-routes /api/services/:id/health — 'deploying' projection", () => {
  // The /health endpoint must surface `deploying` BEFORE running
  // docker inspect when the owning project is mid-redeploy
  // (`building`). Otherwise a transient running
  // container during blue-green swap or late in a force redeploy gets
  // reported as `healthy` while the project is still building, which
  // shadows the topology `deploying` value via the ServiceDetail
  // header's `liveHealth.health ?? resolvedService?.health` chain.
  it("returns { health: 'deploying' } when owning project runtime status is 'building', regardless of docker inspect", async () => {
    const { createSystemRoutes } = await import('../../src/web/api/system-routes.js');
    const app = new Hono();

    const service = makeCanonicalServiceRow();
    const buildingProject = {
      id: service.project_id,
      name: 'test-redis',
      status: 'building' as const,
    };

    const mockCtx = {
      serviceManager: {
        // Even if docker inspect happens to think the container is
        // running healthy, the runtime project status MUST win.
        getInspectionHealth: vi
          .fn()
          .mockResolvedValue({ status: 'running', healthStatus: 'healthy' }),
        listWithCardSummary: vi.fn(),
        create: vi.fn(),
        getDetail: vi.fn(),
        getLogs: vi.fn(),
        getStats: vi.fn(),
        getConnectedProjects: vi.fn(),
        listDatabases: vi.fn(),
        createDatabase: vi.fn(),
        listUsers: vi.fn(),
        createUser: vi.fn(),
        remove: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
      },
      db: {
        getService: vi.fn().mockResolvedValue(service),
        getProject: vi.fn().mockResolvedValue(buildingProject),
        getEnvVars: vi.fn().mockReturnValue({}),
        getEnvVarsForService: vi.fn().mockReturnValue({}),
        hasAnyServiceMetrics: vi.fn(),
        listServiceMetricsSince: vi.fn(),
      },
      config: { gitProviders: { github: {} } },
      docker: {},
    } as unknown as Parameters<typeof createSystemRoutes>[0];

    app.route('/api', createSystemRoutes(mockCtx));
    const res = await app.request(`/api/services/${service.id}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { health: string };
    expect(body.health).toBe('deploying');
    // DB-status check must short-circuit docker inspect; the wire
    // contract guarantees we don't pay the inspection cost when the
    // answer is already known.
    expect(mockCtx.serviceManager.getInspectionHealth).not.toHaveBeenCalled();
  });
});
