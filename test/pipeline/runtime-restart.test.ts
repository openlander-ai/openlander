import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenLanderConfig } from '../../src/config/index.js';
import type { Database, ProjectRow, ServiceRow } from '../../src/db/index.js';
import {
  DeployLockedError,
  ProjectArchivedError,
  ServiceContainerStateError,
  ServiceOperationUnsupportedError,
} from '../../src/errors.js';
import { DeployPipeline } from '../../src/pipeline/deploy.js';
import type { RuntimeBackend } from '../../src/pipeline/runtime/index.js';

function project(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'group-1',
    name: 'incar',
    status: 'running',
    archived_at: null,
    visibility: 'internal',
    ...overrides,
  } as unknown as ProjectRow;
}

function service(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'api__svc',
    project_id: 'group-1',
    name: 'api',
    kind: 'compose-child',
    runtime_role: 'application',
    status: 'running',
    container_id: 'container-1',
    archived_at: null,
    ...overrides,
  } as unknown as ServiceRow;
}

describe('DeployPipeline.restartServiceRuntime', () => {
  let owner: ProjectRow;
  let runtimeProject: ProjectRow;
  let target: ServiceRow;
  let runtime: RuntimeBackend;
  let db: Database;
  let transition: ReturnType<typeof vi.fn>;
  let pipeline: DeployPipeline;

  beforeEach(async () => {
    owner = project();
    runtimeProject = project({ id: 'api', name: 'api' });
    target = service();
    let lockAvailable = true;

    runtime = {
      listManagedContainers: vi.fn().mockResolvedValue([]),
      restartContainer: vi.fn().mockResolvedValue(undefined),
      inspectContainer: vi.fn().mockResolvedValue({
        Id: 'container-1',
        State: { Running: true },
      }),
      runContainer: vi.fn(),
      safeRemoveContainer: vi.fn(),
      buildImage: vi.fn(),
    } as unknown as RuntimeBackend;

    db = {
      getService: vi.fn(async () => target),
      getProject: vi.fn(async (id: string) => {
        if (id === owner.id) return owner;
        if (id === runtimeProject.id) return runtimeProject;
        return null;
      }),
      getDeployableForProject: vi.fn(async (id: string) =>
        id === runtimeProject.id ? target : null,
      ),
      isCircuitBreakerOpen: vi.fn().mockResolvedValue(false),
      acquireDeployLock: vi.fn(async () => {
        if (!lockAvailable) return false;
        lockAvailable = false;
        return true;
      }),
      releaseDeployLock: vi.fn(async () => {
        lockAvailable = true;
      }),
      getDeployLockInfo: vi.fn().mockResolvedValue({ session: 'active-deploy' }),
      updateService: vi.fn().mockResolvedValue(undefined),
      listProjects: vi.fn().mockResolvedValue([]),
      listServices: vi.fn().mockResolvedValue([]),
      getEnvironmentsByProject: vi.fn().mockResolvedValue([]),
    } as unknown as Database;

    transition = vi.fn().mockResolvedValue(true);
    pipeline = new DeployPipeline(
      runtime,
      db,
      {} as never,
      { traefik: { mode: 'managed' } } as OpenLanderConfig,
      { transition },
    );
    await Promise.resolve();
  });

  it('restarts the existing container without build, create, or removal', async () => {
    const result = await pipeline.restartServiceRuntime(target.id);

    expect(runtime.restartContainer).toHaveBeenCalledWith('container-1');
    expect(runtime.buildImage).not.toHaveBeenCalled();
    expect(runtime.runContainer).not.toHaveBeenCalled();
    expect(runtime.safeRemoveContainer).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'restarted',
      projectId: owner.id,
      serviceId: target.id,
      containerId: 'container-1',
    });
    expect(transition).toHaveBeenCalledWith(runtimeProject.id, 'running', 'runtime-restarted');
    expect(db.releaseDeployLock).toHaveBeenCalledOnce();
  });

  it('rejects jobs and missing containers before touching Docker', async () => {
    target = service({ runtime_role: 'job' });
    await expect(pipeline.restartServiceRuntime(target.id)).rejects.toBeInstanceOf(
      ServiceOperationUnsupportedError,
    );

    target = service({ container_id: null });
    runtimeProject = project({ id: 'api', name: 'api', container_id: null });
    await expect(pipeline.restartServiceRuntime(target.id)).rejects.toBeInstanceOf(
      ServiceContainerStateError,
    );
    expect(runtime.restartContainer).not.toHaveBeenCalled();
  });

  it('keeps the lock policy and validates the post-restart state', async () => {
    vi.mocked(db.acquireDeployLock).mockResolvedValueOnce(false);
    await expect(pipeline.restartServiceRuntime(target.id)).rejects.toBeInstanceOf(
      DeployLockedError,
    );

    vi.mocked(runtime.inspectContainer).mockResolvedValueOnce({
      Id: 'container-1',
      State: { Running: false },
    } as Awaited<ReturnType<RuntimeBackend['inspectContainer']>>);
    await expect(pipeline.restartServiceRuntime(target.id)).rejects.toBeInstanceOf(
      ServiceContainerStateError,
    );
    expect(db.releaseDeployLock).toHaveBeenCalledOnce();
  });

  it('enforces project mutation policy before acquiring a deploy lock', async () => {
    owner = project({ archived_at: new Date().toISOString() });

    await expect(pipeline.restartServiceRuntime(target.id)).rejects.toBeInstanceOf(
      ProjectArchivedError,
    );
    expect(db.acquireDeployLock).not.toHaveBeenCalled();
    expect(runtime.restartContainer).not.toHaveBeenCalled();
  });
});
