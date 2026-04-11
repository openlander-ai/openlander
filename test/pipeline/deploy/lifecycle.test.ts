import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Database } from '../../../src/db/index.js';
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
