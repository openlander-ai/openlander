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
