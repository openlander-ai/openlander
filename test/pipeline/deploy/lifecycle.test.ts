import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Database } from '../../../src/db/index.js';
import type { ProjectRow, ServiceRow } from '../../../src/db/types.js';
import { eventBus } from '../../../src/events/index.js';
import { ContainerLifecycle } from '../../../src/pipeline/deploy/lifecycle.js';
import type { Docker } from '../../../src/pipeline/docker.js';

function createMockDocker(): Docker {
  return {
    stopContainer: vi.fn().mockResolvedValue(undefined),
    startContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    removeProjectNetwork: vi.fn().mockResolvedValue(undefined),
    getLogs: vi.fn().mockResolvedValue(''),
    listAllContainers: vi.fn().mockResolvedValue([]),
    listManagedContainers: vi.fn().mockResolvedValue([]),
    cleanupSecretFiles: vi.fn(),
    removeImage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Docker;
}

describe('ContainerLifecycle', () => {
  let tmpDir: string;
  let db: Database;
  let docker: Docker;
  let lifecycle: ContainerLifecycle;

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-lifecycle-'));
    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();
    lifecycle = new ContainerLifecycle(docker, db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stop() stops parent and child projects recursively', async () => {
    db.createProject({
      id: 'parent',
      name: 'mono',
      repoUrl: 'https://github.com/openlander/mono',
      branch: 'main',
    });
    db.createProject({
      id: 'child',
      name: 'mono/api',
      repoUrl: 'https://github.com/openlander/mono',
      branch: 'main',
      parentProjectId: 'parent',
    });
    db.updateProject('parent', { containerId: 'container-parent', status: 'running' });
    db.updateProject('child', { containerId: 'container-child', status: 'running' });

    const emitSpy = vi.spyOn(eventBus, 'emit');

    await lifecycle.stop('parent');

    expect(docker.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-child',
    );
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-parent',
    );
    expect(db.getProject('child')?.status).toBe('stopped');
    expect(db.getProject('parent')?.status).toBe('stopped');
    expect(emitSpy).toHaveBeenCalledWith('container:stop', {
      projectId: 'child',
      containerId: 'container-child',
    });
    expect(emitSpy).toHaveBeenCalledWith('container:stop', {
      projectId: 'parent',
      containerId: 'container-parent',
    });
  });

  it('start() starts parent and child projects recursively', async () => {
    db.createProject({
      id: 'parent-start',
      name: 'mono-start',
      repoUrl: 'https://github.com/openlander/mono-start',
      branch: 'main',
    });
    db.createProject({
      id: 'child-start',
      name: 'mono-start/api',
      repoUrl: 'https://github.com/openlander/mono-start',
      branch: 'main',
      parentProjectId: 'parent-start',
    });
    db.updateProject('parent-start', { containerId: 'container-parent-start', status: 'stopped' });
    db.updateProject('child-start', { containerId: 'container-child-start', status: 'stopped' });

    const emitSpy = vi.spyOn(eventBus, 'emit');

    await lifecycle.start('parent-start');

    expect(docker.startContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-child-start',
    );
    expect(docker.startContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-parent-start',
    );
    expect(db.getProject('child-start')?.status).toBe('running');
    expect(db.getProject('parent-start')?.status).toBe('running');
    expect(emitSpy).toHaveBeenCalledWith('container:start', {
      projectId: 'child-start',
      containerId: 'container-child-start',
    });
    expect(emitSpy).toHaveBeenCalledWith('container:start', {
      projectId: 'parent-start',
      containerId: 'container-parent-start',
    });
  });

  it('remove() removes project and closes tunnel', async () => {
    db.createProject({
      id: 'remove-project',
      name: 'remove-app',
      repoUrl: 'https://github.com/openlander/remove-app',
      branch: 'main',
    });
    db.updateProject('remove-project', { containerId: 'container-remove' });

    const tunnelManager = {
      close: vi.fn(),
    };
    const emitSpy = vi.spyOn(eventBus, 'emit');

    await lifecycle.remove('remove-project', tunnelManager as never);

    expect(docker.removeContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-remove',
    );
    expect(tunnelManager.close).toHaveBeenCalledWith('remove-project');
    expect(db.getProject('remove-project')).toBeUndefined();
    expect(emitSpy).toHaveBeenCalledWith('container:remove', {
      projectId: 'remove-project',
      containerId: 'container-remove',
    });
  });

  it('cleanupProjectContainers() removes all managed containers for project', async () => {
    db.createProject({
      id: 'cleanup-project',
      name: 'cleanup-app',
      repoUrl: 'https://github.com/openlander/cleanup-app',
      branch: 'main',
    });
    db.updateProject('cleanup-project', { containerId: 'container-cleanup-project' });
    db.createEnvironment({
      id: 'cleanup-project-development',
      projectId: 'cleanup-project',
      type: 'development',
      branch: 'develop',
      containerId: 'container-cleanup-dev',
    });

    (docker.listManagedContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'container-cleanup-project',
        name: 'ol-cleanup-app',
        status: 'running',
      },
      {
        id: 'container-cleanup-dev',
        name: 'ol-cleanup-app-dev',
        status: 'running',
      },
      {
        id: 'container-unrelated',
        name: 'ol-other-app',
        status: 'running',
      },
    ]);

    await lifecycle.cleanupProjectContainers('cleanup-project');

    expect(docker.removeContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-cleanup-project',
    );
    expect(docker.removeContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-cleanup-dev',
    );
    expect(docker.removeContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'container-unrelated',
    );
  });

  it('archive() stops container, archives project, and preserves env vars', async () => {
    db.createProject({
      id: 'archive-project',
      name: 'archive-app',
      repoUrl: 'https://github.com/openlander/archive-app',
      branch: 'main',
    });
    db.updateProject('archive-project', {
      containerId: 'container-archive',
      imageTag: 'openlander/archive-app:latest',
      status: 'running',
      assignedPort: 12001,
    });
    db.setEnvVar('archive-project', 'API_KEY', 'value-123');
    const tunnelManager = {
      close: vi.fn(),
    };
    const emitSpy = vi.spyOn(eventBus, 'emit');

    await lifecycle.archive('archive-project', tunnelManager as never);

    expect(docker.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-archive',
    );
    expect(docker.removeContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-archive',
    );
    expect(docker.removeImage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'openlander/archive-app:latest',
    );
    expect(tunnelManager.close).toHaveBeenCalledWith('archive-project');
    expect(db.getEnvVars('archive-project')).toEqual({ API_KEY: 'value-123' });
    expect(db.getProject('archive-project')?.archived_at).toBeTruthy();
    expect(db.getProject('archive-project')?.assigned_port).toBeNull();
    expect(emitSpy).toHaveBeenCalledWith('project:archive', { projectId: 'archive-project' });
  });

  it('archive() auto-archives compose child projects', async () => {
    db.createProject({
      id: 'archive-parent',
      name: 'compose-parent',
      repoUrl: 'https://github.com/openlander/compose-parent',
      branch: 'main',
    });
    db.createProject({
      id: 'archive-child',
      name: 'compose-parent/api',
      repoUrl: 'https://github.com/openlander/compose-parent',
      branch: 'main',
      parentProjectId: 'archive-parent',
    });
    db.updateProject('archive-parent', { containerId: 'container-parent', status: 'running' });
    db.updateProject('archive-child', { containerId: 'container-child', status: 'running' });

    await lifecycle.archive('archive-parent');

    expect(db.getProject('archive-parent')?.archived_at).toBeTruthy();
    expect(db.getProject('archive-child')?.archived_at).toBeTruthy();
  });

  it('archive() fails for building project', async () => {
    db.createProject({
      id: 'building-project',
      name: 'building-app',
      repoUrl: 'https://github.com/openlander/building-app',
      branch: 'main',
    });
    db.updateProject('building-project', { status: 'building' });

    await expect(lifecycle.archive('building-project')).rejects.toMatchObject({
      code: 'ARCHIVE_BUILDING_PROJECT',
    });
  });

  it('archive() does not fail when image removal fails', async () => {
    db.createProject({
      id: 'image-fail-project',
      name: 'image-fail-app',
      repoUrl: 'https://github.com/openlander/image-fail-app',
      branch: 'main',
    });
    db.updateProject('image-fail-project', {
      containerId: 'container-image-fail',
      imageTag: 'openlander/image-fail-app:latest',
      status: 'running',
    });

    (docker.removeImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('image is referenced in multiple repositories'),
    );

    await expect(lifecycle.archive('image-fail-project')).resolves.toBeUndefined();
    expect(docker.removeImage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'openlander/image-fail-app:latest',
    );
    expect(db.getProject('image-fail-project')?.archived_at).toBeTruthy();
  });

  it('unarchive() restores project and allocates a new port', async () => {
    db.createProject({
      id: 'unarchive-project',
      name: 'unarchive-app',
      repoUrl: 'https://github.com/openlander/unarchive-app',
      branch: 'main',
    });
    db.archiveProject('unarchive-project');
    const emitSpy = vi.spyOn(eventBus, 'emit');

    await lifecycle.unarchive('unarchive-project');

    const restored = db.getProject('unarchive-project');
    expect(restored?.archived_at).toBeNull();
    expect(typeof restored?.assigned_port).toBe('number');
    expect((restored?.assigned_port ?? 0) > 0).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith(
      'project:unarchive',
      expect.objectContaining({
        projectId: 'unarchive-project',
        port: restored?.assigned_port,
      }),
    );
  });

  it('forceCleanConflicts() force-removes matching containers by name', async () => {
    (docker.listManagedContainers as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'container-conflict',
        name: 'ol-conflict-app',
        status: 'running',
      },
      {
        id: 'container-other',
        name: 'ol-other-app',
        status: 'running',
      },
    ]);

    await lifecycle.forceCleanConflicts('ol-conflict-app');

    expect(docker.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-conflict',
    );
    expect(docker.removeContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-conflict',
    );
    expect(docker.removeContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'container-other',
    );
  });

  it('getLogs() returns docker log output', async () => {
    db.createProject({
      id: 'logs-project',
      name: 'logs-app',
      repoUrl: 'https://github.com/openlander/logs-app',
      branch: 'main',
    });
    db.updateProject('logs-project', { containerId: 'container-logs' });
    (docker.getLogs as ReturnType<typeof vi.fn>).mockResolvedValueOnce('line-a\nline-b');

    const logs = await lifecycle.getLogs('logs-project', 20);

    expect(docker.getLogs as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('container-logs', 20);
    expect(logs).toBe('line-a\nline-b');
  });
});

describe('ContainerLifecycle group archive semantics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeRuntimeProject(id: string, archivedAt: string | null = null): ProjectRow {
    return {
      id,
      name: id,
      archived_at: archivedAt,
      status: 'running',
    } as ProjectRow;
  }

  function makeDeployable(id: string, overrides: Partial<ServiceRow> = {}): ServiceRow {
    return {
      id,
      project_id: 'group-1',
      name: id,
      kind: 'git',
      status: 'running',
      container_id: `${id}-container`,
      image_tag: `${id}:latest`,
      archived_at: null,
      ...overrides,
    } as ServiceRow;
  }

  it('archiveGroup archives all active deployables with one restore marker', async () => {
    const web = makeDeployable('group-1__svc');
    const worker = makeDeployable('worker__svc');
    const alreadyArchived = makeDeployable('old-worker__svc', {
      archived_at: '2026-01-01T00:00:00.000Z',
      container_id: 'old-container',
    });
    const db = {
      getProject: vi.fn(async (id: string) => makeRuntimeProject(id)),
      getDeployablesByGroup: vi.fn(async () => [web, worker, alreadyArchived]),
      getDeployableForProject: vi.fn(async (id: string) =>
        id === 'group-1' ? web : id === 'worker' ? worker : alreadyArchived,
      ),
      getEnvironmentsByProject: vi.fn(async () => []),
      getComposeChildProjects: vi.fn(async () => []),
      archiveProject: vi.fn(async () => undefined),
      setProjectArchivedAt: vi.fn(async () => undefined),
    };
    const runtime = createMockDocker();
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);
    const lifecycle = new ContainerLifecycle(runtime, db as unknown as Database);

    await lifecycle.archiveGroup('group-1');

    expect(db.archiveProject).toHaveBeenCalledTimes(2);
    const marker = db.archiveProject.mock.calls[0]?.[1];
    expect(typeof marker).toBe('string');
    expect(db.archiveProject).toHaveBeenCalledWith('group-1', marker);
    expect(db.archiveProject).toHaveBeenCalledWith('worker', marker);
    expect(db.archiveProject).not.toHaveBeenCalledWith('old-worker', expect.anything());
    expect(db.setProjectArchivedAt).toHaveBeenCalledWith('group-1', marker);
    expect(runtime.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'group-1__svc-container',
    );
    expect(runtime.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'worker__svc-container',
    );
    expect(runtime.stopContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'old-container',
    );
    expect(emitSpy).toHaveBeenCalledWith('project:archive', { projectId: 'group-1' });
  });

  it('archive keeps a multi-service group active when only its primary service is archived', async () => {
    const primary = makeDeployable('group-1__svc');
    const primaryArchived = makeDeployable('group-1__svc', {
      archived_at: '2026-02-01T00:00:00.000Z',
      status: 'stopped',
      container_id: null,
    });
    const worker = makeDeployable('worker__svc');
    const db = {
      getProject: vi.fn(async (id: string) => makeRuntimeProject(id)),
      getDeployableForProject: vi.fn(async () => primary),
      getEnvironmentsByProject: vi.fn(async () => []),
      getComposeChildProjects: vi.fn(async () => []),
      getDeployablesByGroup: vi.fn(async () => [primaryArchived, worker]),
      archiveProject: vi.fn(async () => undefined),
      setProjectArchivedAt: vi.fn(async () => undefined),
    };
    const runtime = createMockDocker();
    const lifecycle = new ContainerLifecycle(runtime, db as unknown as Database);

    await lifecycle.archive('group-1');

    expect(db.archiveProject).toHaveBeenCalledWith('group-1', undefined);
    expect(db.setProjectArchivedAt).toHaveBeenCalledWith('group-1', null);
  });

  it('archiveGroup is a no-op when every deployable is already archived', async () => {
    const archivedAt = '2026-02-01T00:00:00.000Z';
    const web = makeDeployable('group-1__svc', { archived_at: archivedAt });
    const worker = makeDeployable('worker__svc', { archived_at: archivedAt });
    const db = {
      getProject: vi.fn(async (id: string) => makeRuntimeProject(id, archivedAt)),
      getDeployablesByGroup: vi.fn(async () => [web, worker]),
      archiveProject: vi.fn(async () => undefined),
      setProjectArchivedAt: vi.fn(async () => undefined),
    };
    const runtime = createMockDocker();
    const emitSpy = vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);
    const lifecycle = new ContainerLifecycle(runtime, db as unknown as Database);

    await lifecycle.archiveGroup('group-1');

    expect(db.archiveProject).not.toHaveBeenCalled();
    expect(db.setProjectArchivedAt).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalledWith('project:archive', { projectId: 'group-1' });
  });

  it('unarchiveGroup restores only services touched by the matching group archive marker', async () => {
    const marker = '2026-02-01T00:00:00.000Z';
    const web = makeDeployable('group-1__svc', { archived_at: marker });
    const worker = makeDeployable('worker__svc', {
      archived_at: '2026-01-01T00:00:00.000Z',
    });
    const db = {
      getProject: vi.fn(async (id: string) =>
        id === 'group-1'
          ? makeRuntimeProject(id, marker)
          : makeRuntimeProject(id, worker.archived_at),
      ),
      getDeployablesByGroup: vi.fn(async () => [web, worker]),
      getDeployableForProject: vi.fn(async (id: string) => (id === 'group-1' ? web : worker)),
      unarchiveProject: vi.fn(async () => undefined),
      updateProject: vi.fn(async () => undefined),
      setProjectArchivedAt: vi.fn(async () => undefined),
      getUsedPorts: vi.fn(async () => []),
    };
    const runtime = createMockDocker();
    const lifecycle = new ContainerLifecycle(runtime, db as unknown as Database);

    await lifecycle.unarchiveGroup('group-1');

    expect(db.unarchiveProject).toHaveBeenCalledTimes(1);
    expect(db.unarchiveProject).toHaveBeenCalledWith('group-1');
    expect(db.unarchiveProject).not.toHaveBeenCalledWith('worker');
    expect(db.updateProject).toHaveBeenCalledWith('group-1', {
      assignedPort: expect.any(Number),
    });
    expect(db.setProjectArchivedAt).toHaveBeenCalledWith('group-1', null);
  });

  it('unarchives a preserved Stateful Compose resource with the same container and volumes', async () => {
    const project = {
      ...makeRuntimeProject('db-child', '2026-07-30T00:00:00.000Z'),
      name: 'demo/db',
    };
    const service = makeDeployable('db-child__svc', {
      kind: 'compose-child',
      runtime_role: 'resource',
      archived_at: project.archived_at,
      container_id: 'db-container',
      container_name: 'ol-demo-db-preserved-action',
      assigned_port: null,
    });
    const db = {
      getProject: vi.fn(async () => project),
      getDeployableForProject: vi.fn(async () => service),
      unarchiveProject: vi.fn(async () => undefined),
      updateService: vi.fn(async () => undefined),
    };
    const runtime = {
      ...createMockDocker(),
      inspectContainer: vi.fn(async () => {
        throw new Error('No such container: ol-demo-db');
      }),
      renameContainer: vi.fn(async () => undefined),
      ensureProjectNetwork: vi.fn(async () => 'ol-demo'),
      connectContainerToNetwork: vi.fn(async () => undefined),
      disconnectContainerFromNetwork: vi.fn(async () => undefined),
    };
    const lifecycle = new ContainerLifecycle(
      runtime as unknown as Docker,
      db as unknown as Database,
    );

    await lifecycle.unarchive('db-child');

    expect(runtime.renameContainer).toHaveBeenCalledWith('db-container', 'ol-demo-db');
    expect(runtime.ensureProjectNetwork).toHaveBeenCalledWith('demo');
    expect(runtime.connectContainerToNetwork).toHaveBeenCalledWith('db-container', 'ol-demo', [
      'db',
    ]);
    expect(runtime.startContainer).toHaveBeenCalledWith('db-container');
    expect(db.unarchiveProject).toHaveBeenCalledWith('db-child');
    expect(db.updateService).toHaveBeenCalledWith('db-child__svc', {
      archivedAt: null,
      status: 'running',
      containerId: 'db-container',
      containerName: 'ol-demo-db',
    });
  });

  it('leaves a preserved Stateful Compose resource archived when its canonical name conflicts', async () => {
    const project = {
      ...makeRuntimeProject('db-child', '2026-07-30T00:00:00.000Z'),
      name: 'demo/db',
    };
    const service = makeDeployable('db-child__svc', {
      kind: 'compose-child',
      runtime_role: 'resource',
      archived_at: project.archived_at,
      container_id: 'db-container',
      container_name: 'ol-demo-db-preserved-action',
    });
    const db = {
      getProject: vi.fn(async () => project),
      getDeployableForProject: vi.fn(async () => service),
      unarchiveProject: vi.fn(async () => undefined),
      updateService: vi.fn(async () => undefined),
    };
    const runtime = {
      ...createMockDocker(),
      inspectContainer: vi.fn(async () => ({ Id: 'different-container' })),
      renameContainer: vi.fn(async () => undefined),
      ensureProjectNetwork: vi.fn(async () => 'ol-demo'),
      connectContainerToNetwork: vi.fn(async () => undefined),
      disconnectContainerFromNetwork: vi.fn(async () => undefined),
    };
    const lifecycle = new ContainerLifecycle(
      runtime as unknown as Docker,
      db as unknown as Database,
    );

    await expect(lifecycle.unarchive('db-child')).rejects.toMatchObject({
      code: 'SERVICE_OPERATION_FAILED',
    });
    expect(runtime.renameContainer).not.toHaveBeenCalled();
    expect(db.unarchiveProject).not.toHaveBeenCalled();
  });
});
