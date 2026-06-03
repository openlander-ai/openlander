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
    // Default: the group has the canonical deployable workload (`p1__svc`), so the
    // consumer resolves and the full wiring (connection + env + dependency) runs.
    // The empty-group case overrides this to [] (no workload yet).
    getDeployablesByGroup: vi.fn().mockResolvedValue([{ id: 'p1__svc' }]),
    createProjectDependency: vi.fn().mockResolvedValue({}),
    deleteServiceConnectionByProjectAndService: vi.fn().mockResolvedValue(undefined),
    findDependenciesByProject: vi.fn().mockResolvedValue([]),
    findDependenciesBySourceAndTargetService: vi.fn().mockResolvedValue([]),
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
    // The connection consumer is the resolved workload id, passed explicitly.
    expect(db.upsertServiceConnection).toHaveBeenCalledWith({
      projectId: 'p1',
      serviceId: 'svc-pg',
      consumerServiceId: 'p1__svc',
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
      expect.objectContaining({
        source_service_id: 'p1__svc',
        target_service_id: 'svc-pg',
        dependency_type: 'database',
        source: 'auto',
      }),
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

    const result = await linker.connect({
      projectId: 'p1',
      service: POSTGRES_SERVICE,
      source: 'web',
    });

    expect(result.resolvedProjectId).toBe('p1');
    expect(result.autoInjectedEnvKeys).toEqual(['DATABASE_URL']);
    // The connection itself was still wired despite the dependency failure.
    expect(db.upsertServiceConnection).toHaveBeenCalledTimes(1);
    expect(db.updateServiceConnection).toHaveBeenCalledTimes(1);
  });

  it('uses the real attached workload id (not the derived <group>__svc) for both the connection consumer and the dependency source', async () => {
    // A workload attached into the group keeps its own runtime __svc id, which is
    // NOT the target group's `<group>__svc`. Resolving via getDeployablesByGroup
    // (rather than deriving) is what makes the consumer FK valid for this case.
    const db = createMockDb({
      getDeployablesByGroup: vi.fn().mockResolvedValue([{ id: 'real-workload__svc' }]),
    });
    const linker = new ManagedServiceLinker(db, mockEnv);

    await linker.connect({ projectId: 'p1', service: POSTGRES_SERVICE, source: 'deploy_plan' });

    expect(db.getDeployablesByGroup).toHaveBeenCalledWith('p1');
    expect(db.upsertServiceConnection).toHaveBeenCalledWith({
      projectId: 'p1',
      serviceId: 'svc-pg',
      consumerServiceId: 'real-workload__svc',
    });
    expect(db.createProjectDependency).toHaveBeenCalledWith(
      expect.objectContaining({
        source_service_id: 'real-workload__svc',
        target_service_id: 'svc-pg',
      }),
    );
  });

  // The empty-group attach bug (Codex finding #1): a STANDALONE attach
  // (deferIfNoWorkload) into a group with NO deployable workload must not create
  // the FK-bearing rows — the connection (`service_id_consumer`) and the
  // dependency edge (`source_service_id`) both reference services.id, and the
  // derived `<group>__svc` row does not exist. Env injection still runs (it is
  // project-scoped for a workload-less group), so a DB-first flow seeds the env
  // the app will read on its first deploy.
  it('skips the connection + dependency on a standalone empty-group attach, but still injects env', async () => {
    const db = createMockDb({
      getDeployablesByGroup: vi.fn().mockResolvedValue([]),
    });
    const linker = new ManagedServiceLinker(db, mockEnv);

    const result = await linker.connect({
      projectId: 'empty-group',
      service: POSTGRES_SERVICE,
      source: 'mcp',
      deferIfNoWorkload: true,
    });

    expect(db.getDeployablesByGroup).toHaveBeenCalledWith('p1');
    // No FK-violating connection row, no phantom dependency.
    expect(db.upsertServiceConnection).not.toHaveBeenCalled();
    expect(db.createProjectDependency).not.toHaveBeenCalled();
    // Env injection still happens (project-scoped) — its keys are still returned.
    expect(vi.mocked(autoInjectServiceEnv)).toHaveBeenCalled();
    expect(result.autoInjectedEnvKeys).toEqual(['DATABASE_URL']);
    // No connection row exists, so injected-key metadata is not written.
    expect(db.updateServiceConnection).not.toHaveBeenCalled();
    // The attach itself still succeeds (membership recorded by the move).
    expect(result.resolvedProjectId).toBe('p1');
  });

  // The deploy-plan path can also hit an empty group before the app workload row
  // exists. The FK is checked immediately, so it must defer FK-bearing rows just
  // like standalone attach.
  it('defers FK-bearing rows when deploy-plan attach runs before a workload exists', async () => {
    const db = createMockDb({
      getDeployablesByGroup: vi.fn().mockResolvedValue([]),
    });
    const linker = new ManagedServiceLinker(db, mockEnv);

    await linker.connect({ projectId: 'p1', service: POSTGRES_SERVICE, source: 'deploy_plan' });

    expect(db.upsertServiceConnection).not.toHaveBeenCalled();
    // Env is still injected on this path.
    expect(vi.mocked(autoInjectServiceEnv)).toHaveBeenCalled();
    // No workload resolved → no dependency edge.
    expect(db.createProjectDependency).not.toHaveBeenCalled();
  });

  it('is idempotent on a repeat standalone empty-group attach — still wires nothing', async () => {
    const db = createMockDb({
      getDeployablesByGroup: vi.fn().mockResolvedValue([]),
    });
    const linker = new ManagedServiceLinker(db, mockEnv);

    const params = {
      projectId: 'empty-group',
      service: POSTGRES_SERVICE,
      source: 'mcp' as const,
      deferIfNoWorkload: true,
    };
    await linker.connect(params);
    await linker.connect(params);

    expect(db.upsertServiceConnection).not.toHaveBeenCalled();
    expect(db.createProjectDependency).not.toHaveBeenCalled();
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
        service_id_consumer: 'real-workload__svc',
        auto_injected_env_keys: JSON.stringify(['DATABASE_URL']),
      }),
      findDependenciesBySourceAndTargetService: vi
        .fn()
        .mockResolvedValue([{ id: 'dep-1', target_service_id: 'svc-pg', source: 'auto' }]),
    });
    const linker = new ManagedServiceLinker(db, mockEnv);

    await linker.disconnect({ projectId: 'p1', serviceId: 'svc-pg' });

    expect(vi.mocked(cleanupAutoInjectedEnv)).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', autoInjectedEnvKeys: ['DATABASE_URL'] }),
    );
    expect(db.deleteServiceConnectionByProjectAndService).toHaveBeenCalledWith('p1', 'svc-pg');
    expect(db.findDependenciesBySourceAndTargetService).toHaveBeenCalledWith(
      'real-workload__svc',
      'svc-pg',
    );
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
