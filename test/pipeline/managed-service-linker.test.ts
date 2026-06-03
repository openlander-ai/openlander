import { afterEach, describe, expect, it, vi } from 'vitest';

import { ManagedServiceLinker } from '../../src/pipeline/managed-service-linker.js';
import { autoInjectServiceEnv, cleanupAutoInjectedEnv } from '../../src/pipeline/env-inject.js';
import type { Database } from '../../src/db/index.js';
import type { EnvManager } from '../../src/pipeline/env.js';

vi.mock('../../src/pipeline/env-inject.js', () => ({
  autoInjectServiceEnv: vi.fn().mockResolvedValue(['DATABASE_URL']),
  cleanupAutoInjectedEnv: vi.fn().mockResolvedValue(undefined),
}));

const POSTGRES_SERVICE = {
  id: 'svc-pg',
  name: 'app-postgres',
  kind: 'postgres',
  type: 'postgresql',
  container_name: 'ol-app-postgres',
};

function createMockDb(overrides?: Record<string, unknown>) {
  return {
    attachServiceToProject: vi
      .fn()
      .mockResolvedValue({ targetProjectId: 'p1', droppedEnvVarKeys: [], droppedSecretFiles: [] }),
    upsertServiceConnection: vi.fn().mockResolvedValue(undefined),
    getServiceConnectionByProjectAndService: vi.fn().mockResolvedValue({ id: 'conn-1' }),
    updateServiceConnection: vi.fn().mockResolvedValue(undefined),
    // Default: the group has a deployable workload (the canonical __svc row), so
    // the auto dependency edge is wired. The empty-group case overrides this to
    // undefined.
    getDeployableForProject: vi.fn().mockResolvedValue({ id: 'p1__svc' }),
    createProjectDependency: vi.fn().mockResolvedValue({}),
    deleteServiceConnectionByProjectAndService: vi.fn().mockResolvedValue(undefined),
    findDependenciesByProject: vi.fn().mockResolvedValue([]),
    deleteProjectDependency: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Database;
}

const mockEnv = {} as unknown as EnvManager;

describe('ManagedServiceLinker.connect', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs the full connect sequence and returns the resolved project + injected keys', async () => {
    const db = createMockDb();
    const linker = new ManagedServiceLinker(db, mockEnv);

    const result = await linker.connect({
      projectId: 'p1',
      service: POSTGRES_SERVICE,
      source: 'mcp',
      credentials: { connectionString: 'postgres://host/db' },
    });

    expect(db.attachServiceToProject).toHaveBeenCalledWith('svc-pg', 'p1');
    expect(db.upsertServiceConnection).toHaveBeenCalledWith({
      projectId: 'p1',
      serviceId: 'svc-pg',
    });
    expect(vi.mocked(autoInjectServiceEnv)).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        serviceId: 'svc-pg',
        serviceType: 'postgresql',
        credentials: { connectionString: 'postgres://host/db' },
      }),
    );
    expect(db.updateServiceConnection).toHaveBeenCalledWith('conn-1', {
      autoInjectedEnvKeys: JSON.stringify(['DATABASE_URL']),
    });
    expect(db.createProjectDependency).toHaveBeenCalledWith(
      expect.objectContaining({ target_service_id: 'svc-pg', dependency_type: 'database', source: 'auto' }),
    );

    expect(result).toEqual({
      resolvedProjectId: 'p1',
      autoInjectedEnvKeys: ['DATABASE_URL'],
      droppedEnvVarKeys: [],
      droppedSecretFiles: [],
    });
  });

  it('preserves saved auto_injected_env_keys on an idempotent re-connect (no clobber with [])', async () => {
    vi.mocked(autoInjectServiceEnv).mockResolvedValueOnce([]);
    const db = createMockDb();
    const linker = new ManagedServiceLinker(db, mockEnv);

    const result = await linker.connect({
      projectId: 'p1',
      service: POSTGRES_SERVICE,
      source: 'web',
    });

    expect(result.autoInjectedEnvKeys).toEqual([]);
    // Nothing new was injected, so the previously-saved keys must NOT be overwritten.
    expect(db.updateServiceConnection).not.toHaveBeenCalled();
  });

  it('treats dependency creation as best-effort (connect succeeds even if it throws)', async () => {
    const db = createMockDb({
      createProjectDependency: vi.fn().mockRejectedValue(new Error('dependency boom')),
    });
    const linker = new ManagedServiceLinker(db, mockEnv);

    const result = await linker.connect({ projectId: 'p1', service: POSTGRES_SERVICE, source: 'web' });

    expect(result.resolvedProjectId).toBe('p1');
    expect(result.autoInjectedEnvKeys).toEqual(['DATABASE_URL']);
    // The connection itself was still wired despite the dependency failure.
    expect(db.upsertServiceConnection).toHaveBeenCalledTimes(1);
    expect(db.updateServiceConnection).toHaveBeenCalledTimes(1);
  });

  it('wires the auto dependency edge from the actual deployable workload (not a synthesized id)', async () => {
    const db = createMockDb({
      getDeployableForProject: vi.fn().mockResolvedValue({ id: 'real-workload__svc' }),
    });
    const linker = new ManagedServiceLinker(db, mockEnv);

    await linker.connect({ projectId: 'p1', service: POSTGRES_SERVICE, source: 'deploy_plan' });

    expect(db.getDeployableForProject).toHaveBeenCalledWith('p1');
    // The dependency source is the real workload row id, looked up — never a
    // string-synthesized `<projectId>__svc`.
    expect(db.createProjectDependency).toHaveBeenCalledWith(
      expect.objectContaining({
        source_service_id: 'real-workload__svc',
        target_service_id: 'svc-pg',
      }),
    );
  });

  // The empty-group attach bug: connecting a managed service to a project group
  // that has no deployable workload yet must NOT create a dependency edge that
  // points at a phantom `<projectId>__svc` consumer. The connection row (the
  // group attachment record, project-scoped) is still upserted idempotently —
  // the linker remains the sole writer of service_connections — but no
  // workload→service dependency row is created until a workload exists.
  it('creates NO dependency row on an empty-group attach (no deployable workload yet)', async () => {
    const db = createMockDb({
      getDeployableForProject: vi.fn().mockResolvedValue(undefined),
    });
    const linker = new ManagedServiceLinker(db, mockEnv);

    const result = await linker.connect({
      projectId: 'empty-group',
      service: POSTGRES_SERVICE,
      source: 'mcp',
    });

    expect(db.getDeployableForProject).toHaveBeenCalledWith('p1');
    // No phantom dependency edge.
    expect(db.createProjectDependency).not.toHaveBeenCalled();
    // The group-attachment connection record is still written (idempotent).
    expect(db.upsertServiceConnection).toHaveBeenCalledWith({
      projectId: 'p1',
      serviceId: 'svc-pg',
    });
    // The attach itself still succeeds.
    expect(result.resolvedProjectId).toBe('p1');
  });

  it('is idempotent on a repeat empty-group attach — still no dependency row, connection upsert is conflict-safe', async () => {
    const db = createMockDb({
      getDeployableForProject: vi.fn().mockResolvedValue(undefined),
    });
    const linker = new ManagedServiceLinker(db, mockEnv);

    await linker.connect({ projectId: 'empty-group', service: POSTGRES_SERVICE, source: 'mcp' });
    await linker.connect({ projectId: 'empty-group', service: POSTGRES_SERVICE, source: 'mcp' });

    expect(db.createProjectDependency).not.toHaveBeenCalled();
    expect(db.upsertServiceConnection).toHaveBeenCalledTimes(2);
    expect(
      (db.upsertServiceConnection as unknown as { mock: { results: { type: string }[] } }).mock.results.every(
        (r) => r.type === 'return',
      ),
    ).toBe(true);
  });

  it('propagates dropped env/secret keys from the attach step', async () => {
    const db = createMockDb({
      attachServiceToProject: vi.fn().mockResolvedValue({
        targetProjectId: 'p1',
        droppedEnvVarKeys: ['OLD_URL'],
        droppedSecretFiles: ['old.pem'],
      }),
    });
    const linker = new ManagedServiceLinker(db, mockEnv);

    const result = await linker.connect({
      projectId: 'p1',
      service: POSTGRES_SERVICE,
      source: 'deploy_plan',
    });

    expect(result.droppedEnvVarKeys).toEqual(['OLD_URL']);
    expect(result.droppedSecretFiles).toEqual(['old.pem']);
  });
});

describe('ManagedServiceLinker.disconnect', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('cleans injected env, deletes the connection row, and drops the auto dependency', async () => {
    const db = createMockDb({
      getServiceConnectionByProjectAndService: vi.fn().mockResolvedValue({
        id: 'conn-1',
        auto_injected_env_keys: JSON.stringify(['DATABASE_URL']),
      }),
      findDependenciesByProject: vi
        .fn()
        .mockResolvedValue([{ id: 'dep-1', target_service_id: 'svc-pg', source: 'auto' }]),
    });
    const linker = new ManagedServiceLinker(db, mockEnv);

    await linker.disconnect({ projectId: 'p1', serviceId: 'svc-pg' });

    expect(vi.mocked(cleanupAutoInjectedEnv)).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', autoInjectedEnvKeys: ['DATABASE_URL'] }),
    );
    expect(db.deleteServiceConnectionByProjectAndService).toHaveBeenCalledWith('p1', 'svc-pg');
    expect(db.deleteProjectDependency).toHaveBeenCalledWith('dep-1');
  });

  it('is a no-op when the service is not connected to the project', async () => {
    const db = createMockDb({
      getServiceConnectionByProjectAndService: vi.fn().mockResolvedValue(undefined),
    });
    const linker = new ManagedServiceLinker(db, mockEnv);

    await linker.disconnect({ projectId: 'p1', serviceId: 'svc-pg' });

    expect(vi.mocked(cleanupAutoInjectedEnv)).not.toHaveBeenCalled();
    expect(db.deleteServiceConnectionByProjectAndService).not.toHaveBeenCalled();
  });
});
