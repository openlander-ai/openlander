import { describe, expect, it, vi } from 'vitest';

import type { Database, EnvironmentRow, ProjectRow } from '../../src/db/index.js';
import type { Docker } from '../../src/pipeline/docker.js';
import { RollbackExecutor } from '../../src/pipeline/deploy/rollback.js';

describe('RollbackExecutor trigger attribution', () => {
  it('persists the caller trigger in rollback deploy logs', async () => {
    const project = {
      id: 'p-rollback-trigger',
      name: 'rollback-app',
      status: 'running',
      image_tag: 'openlander/rollback-app:v2',
      previous_image_tag: 'openlander/rollback-app:v1',
    } as ProjectRow;
    const productionEnvironment = {
      id: 'p-rollback-trigger-production',
      project_id: project.id,
      type: 'production',
      status: 'running',
      container_id: 'container-old',
      assigned_port: 11012,
      image_tag: 'openlander/rollback-app:v2',
      previous_image_tag: 'openlander/rollback-app:v1',
    } as EnvironmentRow;
    const createDeployLog = vi.fn(async () => undefined);
    const db = {
      getProject: vi.fn(async () => project),
      getDeployableForProject: vi.fn(async () => undefined),
      getEnvironmentsByProject: vi.fn(async () => [productionEnvironment]),
      getEnvVars: vi.fn(async () => ({})),
      updateProject: vi.fn(async () => undefined),
      updateEnvironment: vi.fn(async () => undefined),
      loadDeployConfig: vi.fn(async () => null),
      createDeployLog,
    } as unknown as Database;
    const docker = {
      inspectImage: vi.fn(async () => ({})),
      getImageExposedPort: vi.fn(async () => 3000),
      ensureProjectNetwork: vi.fn(async () => 'ol-rollback-app'),
      connectContainerToNetwork: vi.fn(async () => undefined),
      stopContainer: vi.fn(async () => undefined),
      safeRemoveContainer: vi.fn(async () => undefined),
      runContainer: vi.fn(async () => 'container-new'),
    } as unknown as Docker;
    const executor = new RollbackExecutor(docker, db, {
      transition: vi.fn(async () => true),
    });

    const result = await executor.rollbackToImage(project.id, undefined, 'chat');

    expect(result.success).toBe(true);
    expect(createDeployLog).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: project.id,
        status: 'success',
        trigger: 'chat',
      }),
    );
  });
});
