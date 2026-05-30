import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Database } from '../../../src/db/index.js';
import { eventBus } from '../../../src/events/index.js';
import { clearPortScanCache } from '../../../src/pipeline/port.js';
import { RollbackExecutor } from '../../../src/pipeline/deploy/rollback.js';
import type { Docker } from '../../../src/pipeline/docker.js';

function createMockDocker(): Docker {
  return {
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-rollback-new'),
    getImageExposedPort: vi.fn().mockResolvedValue(3000),
    listAllContainers: vi.fn().mockResolvedValue([]),
    inspectImage: vi.fn().mockResolvedValue({}),
    ensureProjectNetwork: vi.fn().mockResolvedValue('ol-env-app'),
    connectContainerToNetwork: vi.fn().mockResolvedValue(undefined),
  } as unknown as Docker;
}

describe('RollbackExecutor', () => {
  let tmpDir: string;
  let db: Database;
  let docker: Docker;
  let rollbackExecutor: RollbackExecutor;

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-rollback-executor-'));
    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();
    rollbackExecutor = new RollbackExecutor(docker, db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearPortScanCache();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rolls back an environment to its previous image', async () => {
    db.createProject({
      id: 'p1',
      name: 'env-app',
      repoUrl: 'https://github.com/openlander/env-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p1-development',
      projectId: 'p1',
      type: 'development',
      branch: 'develop',
      status: 'running',
      assignedPort: 11011,
      containerId: 'container-env-old',
      imageTag: 'openlander/env-app:dev-new',
      previousImageTag: 'openlander/env-app:dev-old',
    });
    const emitSpy = vi.spyOn(eventBus, 'emit');

    const result = await rollbackExecutor.rollbackToImage('p1', 'p1-development');

    expect(result.success).toBe(true);
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-env-old',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-env-old',
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: 'openlander/env-app:dev-old',
        name: 'ol-env-app',
        port: 11011,
      }),
    );
    expect(emitSpy).toHaveBeenCalledWith('deploy:rollback', {
      projectId: 'p1',
      fromImage: 'openlander/env-app:dev-new',
      toImage: 'openlander/env-app:dev-old',
    });

    const environment = db.getEnvironment('p1-development');
    expect(environment?.status).toBe('running');
    expect(environment?.image_tag).toBe('openlander/env-app:dev-old');
    expect(environment?.previous_image_tag).toBe('openlander/env-app:dev-new');
    expect(environment?.container_id).toBe('container-rollback-new');
  });

  it('rolls back a project to its previous image', async () => {
    db.createProject({
      id: 'p2',
      name: 'project-app',
      repoUrl: 'https://github.com/openlander/project-app',
      branch: 'main',
    });
    db.updateProject('p2', {
      status: 'running',
      containerId: 'container-project-old',
      imageTag: 'openlander/project-app:v2',
      previousImageTag: 'openlander/project-app:v1',
    });
    const emitSpy = vi.spyOn(eventBus, 'emit');

    const result = await rollbackExecutor.rollbackToImage('p2');

    expect(result.success).toBe(true);
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: 'openlander/project-app:v1',
        name: 'ol-project-app',
      }),
    );
    expect(emitSpy).toHaveBeenCalledWith('deploy:rollback', {
      projectId: 'p2',
      fromImage: 'openlander/project-app:v2',
      toImage: 'openlander/project-app:v1',
    });

    const project = db.getProject('p2');
    expect(project?.status).toBe('running');
    expect(project?.image_tag).toBe('openlander/project-app:v1');
    expect(project?.previous_image_tag).toBe('openlander/project-app:v2');
    expect(project?.container_id).toBe('container-rollback-new');
  });

  it('returns an error when previous image is missing', async () => {
    db.createProject({
      id: 'p3',
      name: 'no-prev-app',
      repoUrl: 'https://github.com/openlander/no-prev-app',
      branch: 'main',
    });

    const result = await rollbackExecutor.rollbackToImage('p3');

    expect(result.success).toBe(false);
    expect(result.error).toBe('No previous image available for rollback');
  });

  it('BUG-004: rollback succeeds after two timestamp-tagged deployments', async () => {
    db.createProject({
      id: 'p-bug-004',
      name: 'rollback-app',
      repoUrl: 'https://github.com/openlander/rollback-app',
      branch: 'main',
    });
    db.updateProject('p-bug-004', {
      status: 'running',
      containerId: 'container-current',
      imageTag: 'openlander/rollback-app:1712345679000',
      previousImageTag: 'openlander/rollback-app:1712345600000',
    });

    const result = await rollbackExecutor.rollbackToImage('p-bug-004');

    expect(result.success).toBe(true);
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: 'openlander/rollback-app:1712345600000',
      }),
    );
    expect(db.getProject('p-bug-004')?.image_tag).toBe('openlander/rollback-app:1712345600000');
    expect(db.getProject('p-bug-004')?.previous_image_tag).toBe(
      'openlander/rollback-app:1712345679000',
    );
  });

  it('BUG-004: returns clear error when rollback image was pruned', async () => {
    db.createProject({
      id: 'p-pruned',
      name: 'pruned-app',
      repoUrl: 'https://github.com/openlander/pruned-app',
      branch: 'main',
    });
    db.updateProject('p-pruned', {
      status: 'running',
      containerId: 'container-pruned',
      imageTag: 'openlander/pruned-app:1712345679000',
      previousImageTag: 'openlander/pruned-app:1712345600000',
    });

    (docker.inspectImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Image not found: openlander/pruned-app:1712345600000'),
    );

    const result = await rollbackExecutor.rollbackToImage('p-pruned');

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'No previous image available for rollback — the image may have been pruned',
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('persists containerPort to project and environment on rollback', async () => {
    db.createProject({
      id: 'p-port',
      name: 'port-app',
      repoUrl: 'https://github.com/openlander/port-app',
      branch: 'main',
    });
    db.updateProject('p-port', {
      status: 'running',
      containerId: 'container-port-old',
      imageTag: 'openlander/port-app:v2',
      previousImageTag: 'openlander/port-app:v1',
      assignedPort: 10050,
    });
    db.updateEnvironment('p-port-production', {
      status: 'running',
      containerId: 'container-port-old',
      imageTag: 'openlander/port-app:v2',
      previousImageTag: 'openlander/port-app:v1',
      assignedPort: 10050,
    });

    (docker.getImageExposedPort as ReturnType<typeof vi.fn>).mockResolvedValueOnce(8080);

    const result = await rollbackExecutor.rollbackToImage('p-port', 'p-port-production');

    expect(result.success).toBe(true);

    const project = db.getProject('p-port');
    expect(project?.container_port).toBe(8080);

    const environment = db.getEnvironment('p-port-production');
    expect(environment?.container_port).toBe(8080);
  });

  it('returns an error and marks status when container start fails', async () => {
    db.createProject({
      id: 'p4',
      name: 'fail-app',
      repoUrl: 'https://github.com/openlander/fail-app',
      branch: 'main',
    });
    db.updateProject('p4', {
      status: 'running',
      containerId: 'container-fail-old',
      imageTag: 'openlander/fail-app:v2',
      previousImageTag: 'openlander/fail-app:v1',
    });
    (docker.runContainer as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));

    const result = await rollbackExecutor.rollbackToImage('p4');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Rollback failed: boom');
    expect(db.getProject('p4')?.status).toBe('error');
  });
});
