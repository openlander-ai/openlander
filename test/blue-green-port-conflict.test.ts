import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../src/pipeline/deploy.js';
import { Database } from '../src/db/index.js';
import type { OpenLanderConfig } from '../src/config/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import * as gitPipeline from '../src/pipeline/git.js';
import * as portPipeline from '../src/pipeline/port.js';
import { clearPortScanCache } from '../src/pipeline/port.js';

type EnvLike = {
  getGlobalSecrets: () => Record<string, string>;
  getAll: (projectId: string, environmentId?: string) => Record<string, string>;
  getMergedForDeploy: (projectId: string, environmentId?: string) => Record<string, string>;
  getSecretFilesForDeploy: (
    projectId: string,
  ) => Array<{ filename: string; content: string; mountPath: string }>;
};

function createMockDocker(): Docker {
  return {
    buildImage: vi.fn().mockResolvedValue(undefined),
    getImageExposedPort: vi.fn().mockResolvedValue(3000),
    runContainer: vi
      .fn()
      .mockResolvedValueOnce('container-green')
      .mockResolvedValueOnce('container-promoted'),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    getClient: vi.fn().mockReturnValue({
      getContainer: vi.fn().mockReturnValue({
        inspect: vi.fn().mockResolvedValue({ State: { Running: true } }),
      }),
    }),
  } as unknown as Docker;
}

describe('BUG-003: blue-green promotion avoids port conflicts', () => {
  let tmpDir: string;
  let clonePath: string;
  let db: Database;
  let docker: Docker;
  let env: EnvLike;
  let pipeline: DeployPipeline;
  const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-bug-003-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n', 'utf8');

    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();
    env = {
      getGlobalSecrets: vi.fn().mockReturnValue({}),
      getAll: vi.fn().mockReturnValue({}),
      getMergedForDeploy: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    };
    pipeline = new DeployPipeline(docker, db, env as never, testConfig);

    db.createProject({
      id: 'p1',
      name: 'demo-app',
      repoUrl: 'https://github.com/openlander/demo-app',
      branch: 'main',
    });
    db.updateProject('p1', {
      status: 'running',
      containerId: 'container-blue',
      imageTag: 'openlander/demo-app:old',
      assignedPort: 10010,
    });

    vi.spyOn(gitPipeline, 'cloneRepo').mockResolvedValue({
      path: clonePath,
      branch: 'main',
      commitSha: 'deadbeefcafebabe',
    });
    vi.spyOn(portPipeline, 'allocatePort').mockResolvedValue(12001);
  });

  afterEach(() => {
    clearPortScanCache();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('cleans green container before starting promoted container on same port', async () => {
    const healthCheckSpy = vi
      .spyOn(pipeline as unknown as { healthCheck: () => Promise<boolean> }, 'healthCheck')
      .mockResolvedValue(true);

    const result = await pipeline.redeploy('p1', { strategy: 'blue-green' });

    expect(result.success).toBe(true);
    const runContainerMock = docker.runContainer as ReturnType<typeof vi.fn>;
    const stopContainerMock = docker.stopContainer as ReturnType<typeof vi.fn>;
    const safeRemoveContainerMock = docker.safeRemoveContainer as ReturnType<typeof vi.fn>;

    const promotedRunOrder = runContainerMock.mock.invocationCallOrder[1];
    const stopGreenCallIndex = stopContainerMock.mock.calls.findIndex(
      ([containerId]) => containerId === 'container-green',
    );
    const removeGreenCallIndex = safeRemoveContainerMock.mock.calls.findIndex(
      ([containerId]) => containerId === 'container-green',
    );

    expect(stopGreenCallIndex).toBeGreaterThanOrEqual(0);
    expect(removeGreenCallIndex).toBeGreaterThanOrEqual(0);
    expect(stopContainerMock.mock.invocationCallOrder[stopGreenCallIndex]).toBeLessThan(
      promotedRunOrder,
    );
    expect(safeRemoveContainerMock.mock.invocationCallOrder[removeGreenCallIndex]).toBeLessThan(
      promotedRunOrder,
    );
    expect(healthCheckSpy).toHaveBeenNthCalledWith(2, 12001, '/', 3, 1000);
  });

  it('keeps blue running when promoted container fails post-promotion health check', async () => {
    vi.spyOn(pipeline as unknown as { healthCheck: () => Promise<boolean> }, 'healthCheck')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const result = await pipeline.redeploy('p1', { strategy: 'blue-green' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('previous version still serving');
    expect(result.error).toContain(
      'Promoted container failed health check after blue-green promotion',
    );
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'container-blue',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).not.toHaveBeenCalledWith(
      'container-blue',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-promoted',
    );
  });
});
