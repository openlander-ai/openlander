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

const mockRunProbe = vi.fn();

vi.mock('../src/health/probe-runner.js', () => ({
  createLocalProbeRunner: vi.fn(() => ({
    runProbe: mockRunProbe,
  })),
  LocalProbeRunner: vi.fn(),
}));

type EnvLike = {
  getGlobalSecrets: () => Record<string, string>;
  getAll: (projectId: string, environmentId?: string) => Record<string, string>;
  getMergedForDeploy: (projectId: string, environmentId?: string) => Record<string, string>;
  getSecretFilesForDeploy: (
    projectId: string,
  ) => Array<{ filename: string; content: string; mountPath: string }>;
};

type DockerMockControls = {
  promotedRenameMock: ReturnType<typeof vi.fn>;
  blueInspectMock: ReturnType<typeof vi.fn>;
  blueRestartMock: ReturnType<typeof vi.fn>;
};

function createMockDocker(options?: { blueRunning?: boolean }): {
  docker: Docker;
  controls: DockerMockControls;
} {
  const promotedRenameMock = vi.fn().mockResolvedValue(undefined);
  const blueInspectMock = vi
    .fn()
    .mockResolvedValue({ State: { Running: options?.blueRunning ?? true } });
  const blueRestartMock = vi.fn().mockResolvedValue(undefined);

  const docker = {
    buildImage: vi.fn().mockResolvedValue(undefined),
    getImageExposedPort: vi.fn().mockResolvedValue(3000),
    runContainer: vi
      .fn()
      .mockResolvedValueOnce('container-green')
      .mockResolvedValueOnce('container-promoted'),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    inspectContainer: blueInspectMock.mockImplementation(async (containerId: string) => {
      if (containerId === 'container-blue') {
        return { State: { Running: options?.blueRunning ?? true } };
      }
      return { State: { Running: true } };
    }),
    renameContainer: promotedRenameMock,
    restartContainer: blueRestartMock,
  } as unknown as Docker;

  return {
    docker,
    controls: {
      promotedRenameMock,
      blueInspectMock,
      blueRestartMock,
    },
  };
}

describe('BUG-003: blue-green promotion avoids port conflicts', () => {
  let tmpDir: string;
  let clonePath: string;
  let db: Database;
  let docker: Docker;
  let dockerControls: DockerMockControls;
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
    const mockDocker = createMockDocker();
    docker = mockDocker.docker;
    dockerControls = mockDocker.controls;
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
    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', { strategy: 'blue-green' });

    expect(result.success).toBe(true);
    const runContainerMock = docker.runContainer as ReturnType<typeof vi.fn>;
    const stopContainerMock = docker.stopContainer as ReturnType<typeof vi.fn>;
    const safeRemoveContainerMock = docker.safeRemoveContainer as ReturnType<typeof vi.fn>;

    const renameCallOrder = dockerControls.promotedRenameMock.mock.invocationCallOrder[0];
    const stopBlueCallIndex = stopContainerMock.mock.calls.findIndex(
      ([containerId]) => containerId === 'container-blue',
    );
    const removeBlueCallIndex = safeRemoveContainerMock.mock.calls.findIndex(
      ([containerId]) => containerId === 'container-blue',
    );

    expect(stopBlueCallIndex).toBeGreaterThanOrEqual(0);
    expect(removeBlueCallIndex).toBeGreaterThanOrEqual(0);
    expect(stopContainerMock.mock.invocationCallOrder[stopBlueCallIndex]).toBeLessThan(
      renameCallOrder,
    );
    expect(safeRemoveContainerMock.mock.invocationCallOrder[removeBlueCallIndex]).toBeLessThan(
      renameCallOrder,
    );
    expect(mockRunProbe).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: 'http', failureThreshold: 10, intervalMs: 2000 }),
      expect.objectContaining({
        projectId: 'p1',
        containerId: 'container-green',
        assignedPort: 12001,
      }),
    );
    expect(runContainerMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: 'ol-demo-app-green' }),
    );
    expect(dockerControls.promotedRenameMock).toHaveBeenCalledWith(
      'container-green',
      'ol-demo-app',
    );
  });

  it('keeps blue running when promoted container fails post-promotion health check', async () => {
    mockRunProbe.mockResolvedValueOnce({ healthy: true, source: 'http' });
    dockerControls.promotedRenameMock.mockRejectedValueOnce(new Error('rename failed'));

    const result = await pipeline.redeploy('p1', { strategy: 'blue-green' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('previous version still serving');
    expect(result.error).toContain('rename failed');
    expect(docker.stopContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('container-blue');
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-blue',
    );
    expect(docker.safeRemoveContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'container-green',
    );
    expect(dockerControls.promotedRenameMock).toHaveBeenCalledTimes(1);
  });

  it('persists containerPort to environment after blue-green promotion', async () => {
    db.updateEnvironment('p1-production', {
      status: 'running',
      containerId: 'container-blue',
      imageTag: 'openlander/demo-app:old',
      assignedPort: 10010,
    });

    mockRunProbe.mockResolvedValue({ healthy: true, source: 'http' });

    const result = await pipeline.redeploy('p1', { strategy: 'blue-green' });

    expect(result.success).toBe(true);

    const environment = db.getEnvironment('p1-production');
    expect(environment?.container_port).toBe(3000);

    const project = db.getProject('p1');
    expect(project?.container_port).toBe(3000);
  });

  it('tries to restart blue when promoted container fails and blue is not running', async () => {
    const mockDocker = createMockDocker({ blueRunning: false });
    docker = mockDocker.docker;
    dockerControls = mockDocker.controls;
    pipeline = new DeployPipeline(docker, db, env as never, testConfig);

    mockRunProbe.mockResolvedValueOnce({ healthy: true, source: 'http' });
    dockerControls.promotedRenameMock.mockRejectedValueOnce(new Error('rename failed'));

    const result = await pipeline.redeploy('p1', { strategy: 'blue-green' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('previous version still serving');
    expect(dockerControls.blueInspectMock).toHaveBeenCalled();
    expect(dockerControls.blueRestartMock).toHaveBeenCalledTimes(1);
    expect(dockerControls.promotedRenameMock).toHaveBeenCalledTimes(1);
  });
});
