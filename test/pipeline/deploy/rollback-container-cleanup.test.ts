import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Database, EnvironmentRow, ProjectRow, ServiceRow } from '../../../src/db/index.js';
import { RollbackExecutor } from '../../../src/pipeline/deploy/rollback.js';
import type { Docker } from '../../../src/pipeline/docker.js';
import { serializeConfig } from '../../../src/pipeline/config-snapshot.js';

function createMockDocker(): Docker {
  return {
    stopContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    inspectImage: vi.fn().mockResolvedValue({}),
    getImageExposedPort: vi.fn().mockResolvedValue(3000),
    ensureProjectNetwork: vi.fn().mockResolvedValue('ol-test-rollback-moo7jly1'),
    connectContainerToNetwork: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-rollback-new'),
  } as unknown as Docker;
}

function createProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'test-rollback',
    name: 'test-rollback-moo7jly1',
    repo_url: 'https://github.com/openlander/test-rollback',
    branch: 'main',
    archived_at: null,
    created_at: '2026-05-02T00:00:00.000Z',
    updated_at: '2026-05-02T00:00:00.000Z',
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    status: 'running',
    container_id: null,
    image_tag: 'openlander/test-rollback:new',
    previous_image_tag: 'openlander/test-rollback:old',
    assigned_port: null,
    ...overrides,
  };
}

function createProductionEnvironment(overrides: Partial<EnvironmentRow> = {}): EnvironmentRow {
  return {
    id: 'test-rollback-production',
    service_id: 'test-rollback__svc',
    project_id: 'test-rollback',
    type: 'production',
    branch: 'main',
    status: 'running',
    assigned_port: 18080,
    container_id: null,
    image_tag: 'openlander/test-rollback:new',
    previous_image_tag: 'openlander/test-rollback:old',
    public_url: null,
    container_port: null,
    created_at: '2026-05-02T00:00:00.000Z',
    updated_at: '2026-05-02T00:00:00.000Z',
    ...overrides,
  };
}

function createDeployable(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'test-rollback__svc',
    project_id: 'test-rollback',
    name: 'test-rollback',
    kind: 'app',
    status: 'running',
    assigned_port: 18080,
    container_id: null,
    ...overrides,
  } as ServiceRow;
}

function createMockDb(params: {
  project: ProjectRow;
  productionEnvironment?: EnvironmentRow;
  deployable?: ServiceRow;
}): Database {
  return {
    getProject: vi.fn().mockResolvedValue(params.project),
    getEnvironmentsByProject: vi
      .fn()
      .mockResolvedValue(params.productionEnvironment ? [params.productionEnvironment] : []),
    getDeployableForProject: vi.fn().mockResolvedValue(params.deployable),
    loadDeployConfig: vi.fn().mockResolvedValue(undefined),
    loadDeployConfigForService: vi.fn().mockResolvedValue(undefined),
    getEnvVars: vi.fn().mockResolvedValue({}),
    updateProject: vi.fn().mockResolvedValue(undefined),
    updateEnvironment: vi.fn().mockResolvedValue(undefined),
    createDeployLog: vi.fn().mockResolvedValue(undefined),
  } as unknown as Database;
}

describe('RollbackExecutor container cleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes the canonical container name before starting the rollback container', async () => {
    const docker = createMockDocker();
    const db = createMockDb({
      project: createProject({ container_id: null }),
      productionEnvironment: createProductionEnvironment({ container_id: null }),
      deployable: createDeployable({ container_id: null }),
    });
    const stateManager = { transition: vi.fn().mockResolvedValue(true) };
    const executor = new RollbackExecutor(docker, db, stateManager);

    const result = await executor.rollbackToImage('test-rollback');

    expect(result.success).toBe(true);
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'ol-test-rollback-moo7jly1',
    );
    expect(
      (docker.safeRemoveContainer as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    ).toBeLessThan((docker.runContainer as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
  });

  it('uses production environment metadata for project-level rollback cleanup', async () => {
    const docker = createMockDocker();
    const db = createMockDb({
      project: createProject({ container_id: null }),
      productionEnvironment: createProductionEnvironment({ container_id: 'container-env-old' }),
      deployable: createDeployable({ container_id: null }),
    });
    const stateManager = { transition: vi.fn().mockResolvedValue(true) };
    const executor = new RollbackExecutor(docker, db, stateManager);

    const result = await executor.rollbackToImage('test-rollback');

    expect(result.success).toBe(true);
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-env-old',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-env-old',
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ol-test-rollback-moo7jly1',
        port: 18080,
      }),
    );
  });

  it('uses service-scoped resource limits when rolling back a deployable service', async () => {
    const docker = createMockDocker();
    const db = createMockDb({
      project: createProject({ container_id: null }),
      productionEnvironment: createProductionEnvironment({ container_id: 'container-env-old' }),
      deployable: createDeployable({ container_id: null }),
    });
    vi.mocked(db.loadDeployConfigForService).mockResolvedValue({
      service_id: 'test-rollback__svc',
      project_id: null,
      config_json: serializeConfig({ resourceProfile: 'medium' }),
      config_version: 1,
      updated_at: '2026-05-02T00:00:00.000Z',
    });
    const stateManager = { transition: vi.fn().mockResolvedValue(true) };
    const executor = new RollbackExecutor(docker, db, stateManager);

    const result = await executor.rollbackToImage('test-rollback');

    expect(result.success).toBe(true);
    expect(db.loadDeployConfigForService).toHaveBeenCalledWith('test-rollback__svc');
    expect(db.loadDeployConfig).not.toHaveBeenCalled();
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceLimits: expect.objectContaining({ profile: 'medium' }),
      }),
    );
  });
});
