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
    runContainer: vi.fn().mockResolvedValue('container-build-method'),
    waitForHealthy: vi.fn().mockResolvedValue({ healthy: true }),
    getLogs: vi.fn().mockResolvedValue(''),
    listAllContainers: vi.fn().mockResolvedValue([]),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    cleanupSecretFiles: vi.fn().mockResolvedValue(undefined),
    ensureProjectNetwork: vi.fn().mockResolvedValue('ol-test-project'),
  } as unknown as Docker;
}

describe('redeploy build_method persistence', () => {
  let tmpDir: string;
  let clonePath: string;
  let db: Database;
  let docker: Docker;

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-build-method-test-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n', 'utf8');

    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();

    vi.spyOn(gitPipeline, 'cloneRepo').mockResolvedValue({
      path: clonePath,
      commitSha: 'deadbeefcafebabe',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearPortScanCache();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores build_method=dockerfile when preferDockerfile is true during deploy', async () => {
    db.createProject({
      id: 'p-dockerfile',
      name: 'dockerfile-app',
      repoUrl: 'https://github.com/openlander/dockerfile-app',
      branch: 'main',
    });

    const composePipeline = {
      detectComposeFile: vi.fn().mockReturnValue(join(clonePath, 'docker-compose.yml')),
      deployCompose: vi.fn(),
    };
    const pipeline = new DeployPipeline(
      docker,
      db,
      {
        getGlobalSecrets: vi.fn().mockReturnValue({}),
        getAll: vi.fn().mockReturnValue({}),
        getMergedForDeploy: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
        getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
      } as never,
      undefined,
      composePipeline as never,
    );

    const updateProjectSpy = vi.spyOn(db, 'updateProject');

    const productionEnvironment = db
      .getEnvironmentsByProject('p-dockerfile')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();

    const result = await pipeline.deployEnvironment('p-dockerfile', productionEnvironment!.id, {
      repoUrl: 'https://github.com/openlander/dockerfile-app',
      preferDockerfile: true,
    });

    expect(result.success).toBe(true);
    expect(updateProjectSpy).toHaveBeenCalledWith(
      'p-dockerfile',
      expect.objectContaining({ buildMethod: 'dockerfile' }),
    );
    expect(composePipeline.deployCompose).not.toHaveBeenCalled();
  });

  it('stores build_method=compose when compose file detected during deploy', async () => {
    db.createProject({
      id: 'p-compose',
      name: 'compose-app',
      repoUrl: 'https://github.com/openlander/compose-app',
      branch: 'main',
    });

    const composePipeline = {
      detectComposeFile: vi.fn().mockReturnValue(join(clonePath, 'docker-compose.yml')),
      deployCompose: vi.fn().mockResolvedValue({
        success: true,
        parentProjectId: 'p-compose',
        parentName: 'compose-app',
        buildDurationMs: 111,
      }),
    };
    const pipeline = new DeployPipeline(
      docker,
      db,
      {
        getGlobalSecrets: vi.fn().mockReturnValue({}),
        getAll: vi.fn().mockReturnValue({}),
        getMergedForDeploy: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
        getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
      } as never,
      undefined,
      composePipeline as never,
    );

    const updateProjectSpy = vi.spyOn(db, 'updateProject');

    const productionEnvironment = db
      .getEnvironmentsByProject('p-compose')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();

    const result = await pipeline.deployEnvironment('p-compose', productionEnvironment!.id, {
      repoUrl: 'https://github.com/openlander/compose-app',
    });

    expect(result.success).toBe(true);
    expect(updateProjectSpy).toHaveBeenCalledWith(
      'p-compose',
      expect.objectContaining({ buildMethod: 'compose' }),
    );
  });

  it('passes preferDockerfile=true on redeploy when build_method=dockerfile', async () => {
    db.createProject({
      id: 'p-redeploy',
      name: 'redeploy-app',
      repoUrl: 'https://github.com/openlander/redeploy-app',
      branch: 'main',
    });

    const pipeline = new DeployPipeline(docker, db, {
      getGlobalSecrets: vi.fn().mockReturnValue({}),
      getAll: vi.fn().mockReturnValue({}),
      getMergedForDeploy: vi.fn().mockReturnValue({}),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    } as never);

    const baseProject = db.getProject('p-redeploy');
    expect(baseProject).toBeDefined();

    vi.spyOn(db, 'getProject').mockReturnValue({
      ...baseProject,
      build_method: 'dockerfile',
    } as unknown as NonNullable<ReturnType<Database['getProject']>>);

    const deploySpy = vi.spyOn(pipeline, 'deploy').mockResolvedValue({
      success: true,
      projectId: 'p-redeploy',
      projectName: 'redeploy-app',
      url: 'http://localhost:3000',
    });

    await pipeline.redeploy('p-redeploy');

    expect(deploySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        preferDockerfile: true,
      }),
    );
  });
});
