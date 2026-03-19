import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../src/pipeline/deploy.js';
import { Database } from '../src/db/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import * as gitPipeline from '../src/pipeline/git.js';
import { clearPortScanCache } from '../src/pipeline/port.js';

function createMockDocker(): Docker {
  return {
    buildImage: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-build-method-fallback'),
    waitForHealthy: vi.fn().mockResolvedValue({ healthy: true }),
    getLogs: vi.fn().mockResolvedValue(''),
    listAllContainers: vi.fn().mockResolvedValue([]),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    cleanupSecretFiles: vi.fn().mockResolvedValue(undefined),
  } as unknown as Docker;
}

describe('DeployPipeline build_method fallback', () => {
  let tmpDir: string;
  let clonePath: string;
  let db: Database;
  let docker: Docker;

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-build-method-fallback-test-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n', 'utf8');

    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();

    vi.spyOn(gitPipeline, 'cloneRepo').mockResolvedValue({
      path: clonePath,
      commitSha: 'aabbccddeeff0011',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearPortScanCache();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('continues deploy when build_method persistence fails', async () => {
    db.createProject({
      id: 'p-build-method-fallback',
      name: 'build-method-fallback-app',
      repoUrl: 'https://github.com/openlander/build-method-fallback-app',
      branch: 'main',
    });

    const pipeline = new DeployPipeline(docker, db, {
      getAll: vi.fn().mockReturnValue({}),
      getMergedForDeploy: vi.fn().mockReturnValue({}),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    } as never);

    const originalUpdateProject = db.updateProject.bind(db);
    vi.spyOn(db, 'updateProject').mockImplementation((projectId, updates) => {
      if (updates.buildMethod !== undefined) {
        throw new Error('no such column: build_method');
      }
      originalUpdateProject(projectId, updates);
    });

    const productionEnvironment = db
      .getEnvironmentsByProject('p-build-method-fallback')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();

    const result = await pipeline.deployEnvironment(
      'p-build-method-fallback',
      productionEnvironment!.id,
      {
        repoUrl: 'https://github.com/openlander/build-method-fallback-app',
        preferDockerfile: true,
      },
    );

    expect(result.success).toBe(true);
    expect(docker.buildImage).toHaveBeenCalled();
  });
});
