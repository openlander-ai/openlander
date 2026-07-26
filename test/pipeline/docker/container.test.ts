import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

import { Docker } from '../../../src/pipeline/docker.js';

// ---------------------------------------------------------------------------
// Mock setup (same pattern as test/docker.test.ts)
// ---------------------------------------------------------------------------

const mockPing = vi.fn();
const mockListContainers = vi.fn();
const mockBuildImage = vi.fn();
const mockCreateContainer = vi.fn();
const mockGetImage = vi.fn();
const mockGetContainer = vi.fn();
const mockFollowProgress = vi.fn();
const mockGetNetwork = vi.fn();
const mockDemuxStream = vi.fn();
const mockDf = vi.fn();
const mockGetVolume = vi.fn();
const mockListVolumes = vi.fn();
const mockCreateVolume = vi.fn();
const mockGetEvents = vi.fn();

const require = createRequire(import.meta.url);
const mockDockerodeClass = vi.fn(function (this: Record<string, unknown>) {
  this.ping = mockPing;
  this.listContainers = mockListContainers;
  this.buildImage = mockBuildImage;
  this.createContainer = mockCreateContainer;
  this.getImage = mockGetImage;
  this.getContainer = mockGetContainer;
  this.getNetwork = mockGetNetwork;
  this.df = mockDf;
  this.getVolume = mockGetVolume;
  this.listVolumes = mockListVolumes;
  this.createVolume = mockCreateVolume;
  this.getEvents = mockGetEvents;
  this.modem = {
    followProgress: mockFollowProgress,
    demuxStream: mockDemuxStream,
  };
});

const dockerodePath = require.resolve('dockerode');
require.cache[dockerodePath] = {
  id: dockerodePath,
  filename: dockerodePath,
  loaded: true,
  exports: mockDockerodeClass,
} as unknown as NodeJS.Module;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resetMocks = () => {
  mockPing.mockReset().mockResolvedValue('OK');
  mockListContainers.mockReset().mockResolvedValue([]);
  mockBuildImage.mockReset();
  mockCreateContainer.mockReset();
  mockGetImage.mockReset();
  mockGetContainer.mockReset();
  mockFollowProgress.mockReset();
  mockGetNetwork.mockReset();
  mockDemuxStream.mockReset();
  mockDf.mockReset();
  mockGetVolume.mockReset();
  mockListVolumes.mockReset();
  mockCreateVolume.mockReset();
  mockGetEvents.mockReset();
};

/** Creates a Docker "not found" error that matches isDockerNotFoundError. */
const notFoundError = (msg: string) => new Error(`No such container: ${msg}`);

// ---------------------------------------------------------------------------
// Tests: inspectContainer
// ---------------------------------------------------------------------------

describe('inspectContainer', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('returns container inspect info on success', async () => {
    const inspectData = {
      Id: 'abc123',
      State: { Running: true, Status: 'running' },
      Config: { Image: 'myapp:latest' },
    };
    mockGetContainer.mockReturnValueOnce({
      inspect: vi.fn().mockResolvedValueOnce(inspectData),
    });

    const docker = new Docker();
    const result = await docker.inspectContainer('abc123');

    expect(result).toEqual(inspectData);
    expect(mockGetContainer).toHaveBeenCalledWith('abc123');
  });

  it('throws ContainerNotFoundError when container does not exist', async () => {
    mockGetContainer.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValueOnce(notFoundError('missing-id')),
    });

    const docker = new Docker();
    await expect(docker.inspectContainer('missing-id')).rejects.toMatchObject({
      name: 'ContainerNotFoundError',
    });
  });

  it('re-throws non-404 errors as-is', async () => {
    mockGetContainer.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValueOnce(new Error('permission denied')),
    });

    const docker = new Docker();
    await expect(docker.inspectContainer('denied')).rejects.toThrow('permission denied');
  });
});

// ---------------------------------------------------------------------------
// Tests: restartContainer
// ---------------------------------------------------------------------------

describe('restartContainer', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('restarts container successfully', async () => {
    const restartFn = vi.fn().mockResolvedValueOnce(undefined);
    mockGetContainer.mockReturnValueOnce({ restart: restartFn });

    const docker = new Docker();
    await docker.restartContainer('c1');

    expect(mockGetContainer).toHaveBeenCalledWith('c1');
    expect(restartFn).toHaveBeenCalledTimes(1);
  });

  it('throws ContainerNotFoundError when container does not exist', async () => {
    mockGetContainer.mockReturnValueOnce({
      restart: vi.fn().mockRejectedValueOnce(notFoundError('gone')),
    });

    const docker = new Docker();
    await expect(docker.restartContainer('gone')).rejects.toMatchObject({
      name: 'ContainerNotFoundError',
    });
  });

  it('re-throws non-404 errors as-is', async () => {
    mockGetContainer.mockReturnValueOnce({
      restart: vi.fn().mockRejectedValueOnce(new Error('daemon busy')),
    });

    const docker = new Docker();
    await expect(docker.restartContainer('busy')).rejects.toThrow('daemon busy');
  });
});

// ---------------------------------------------------------------------------
// Tests: getContainerStats
// ---------------------------------------------------------------------------

describe('getContainerStats', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('returns container stats on success', async () => {
    const statsData = {
      cpu_stats: { cpu_usage: { total_usage: 100 } },
      memory_stats: { usage: 50_000_000 },
    };
    mockGetContainer.mockReturnValueOnce({
      stats: vi.fn().mockResolvedValueOnce(statsData),
    });

    const docker = new Docker();
    const result = await docker.getContainerStats('c1');

    expect(result).toEqual(statsData);
    expect(mockGetContainer).toHaveBeenCalledWith('c1');
  });

  it('throws ContainerNotFoundError when container does not exist', async () => {
    mockGetContainer.mockReturnValueOnce({
      stats: vi.fn().mockRejectedValueOnce(notFoundError('missing')),
    });

    const docker = new Docker();
    await expect(docker.getContainerStats('missing')).rejects.toMatchObject({
      name: 'ContainerNotFoundError',
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: renameContainer
// ---------------------------------------------------------------------------

describe('renameContainer', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('renames container successfully', async () => {
    const renameFn = vi.fn().mockResolvedValueOnce(undefined);
    mockGetContainer.mockReturnValueOnce({ rename: renameFn });

    const docker = new Docker();
    await docker.renameContainer('c1', 'new-name');

    expect(mockGetContainer).toHaveBeenCalledWith('c1');
    expect(renameFn).toHaveBeenCalledWith({ name: 'new-name' });
  });

  it('throws ContainerNotFoundError when container does not exist', async () => {
    mockGetContainer.mockReturnValueOnce({
      rename: vi.fn().mockRejectedValueOnce(notFoundError('missing')),
    });

    const docker = new Docker();
    await expect(docker.renameContainer('missing', 'new-name')).rejects.toMatchObject({
      name: 'ContainerNotFoundError',
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: waitForContainer
// ---------------------------------------------------------------------------

describe('waitForContainer', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('returns StatusCode 0 on successful exit', async () => {
    const waitFn = vi.fn().mockResolvedValueOnce({ StatusCode: 0 });
    mockGetContainer.mockReturnValueOnce({ wait: waitFn });

    const docker = new Docker();
    const result = await docker.waitForContainer('c1');

    expect(result).toEqual({ StatusCode: 0 });
    expect(mockGetContainer).toHaveBeenCalledWith('c1');
  });

  it('returns non-zero StatusCode on container failure', async () => {
    const waitFn = vi.fn().mockResolvedValueOnce({ StatusCode: 137 });
    mockGetContainer.mockReturnValueOnce({ wait: waitFn });

    const docker = new Docker();
    const result = await docker.waitForContainer('crashed');

    expect(result).toEqual({ StatusCode: 137 });
  });
});

// ---------------------------------------------------------------------------
// Tests: runEphemeralContainer
// ---------------------------------------------------------------------------

describe('runEphemeralContainer', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('runs argv directly in a bounded disposable workspace and removes the container', async () => {
    const containerHandle = {
      start: vi.fn().mockResolvedValueOnce(undefined),
      wait: vi.fn().mockResolvedValueOnce({ StatusCode: 0 }),
      logs: vi.fn().mockResolvedValueOnce(Buffer.from('2 tests passed')),
      remove: vi.fn().mockResolvedValueOnce(undefined),
    };
    mockCreateContainer.mockResolvedValueOnce(containerHandle);

    const docker = new Docker(undefined, undefined, 'olinst_quality');
    const result = await docker.runEphemeralContainer({
      imageTag: 'node:22',
      name: 'ol-quality-run-1-unit',
      projectId: 'project-1',
      workspacePath: '/tmp/openlander-repo',
      command: ['npm', 'test', '--', '--run'],
      timeoutMs: 30_000,
    });

    expect(result).toMatchObject({ exitCode: 0, logs: '2 tests passed', timedOut: false });
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: ['npm', 'test', '--', '--run'],
        WorkingDir: '/workspace',
        Tty: true,
        Labels: expect.objectContaining({
          'openlander.instance': 'olinst_quality',
          'openlander.project': 'project-1',
          'openlander.purpose': 'delivery-quality-check',
        }),
        HostConfig: expect.objectContaining({
          AutoRemove: false,
          Binds: ['/tmp/openlander-repo:/workspace:rw'],
          RestartPolicy: { Name: 'no' },
        }),
      }),
    );
    expect(containerHandle.remove).toHaveBeenCalledWith({ force: true });
  });
});

// ---------------------------------------------------------------------------
// Tests: runServiceContainer
// ---------------------------------------------------------------------------

describe('runServiceContainer', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('creates and starts a service container, returns container id', async () => {
    const containerHandle = {
      id: 'svc-container-id',
      start: vi.fn().mockResolvedValueOnce(undefined),
    };
    mockCreateContainer.mockResolvedValueOnce(containerHandle);

    const docker = new Docker(undefined, undefined, 'olinst_a');
    const id = await docker.runServiceContainer({
      imageTag: 'postgres:15',
      name: 'ol-svc-postgres',
      port: 5432,
      envVars: { POSTGRES_PASSWORD: 'secret' },
      serviceName: 'postgres',
    });

    expect(id).toBe('svc-container-id');
    expect(containerHandle.start).toHaveBeenCalledTimes(1);
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'postgres:15',
        name: 'ol-svc-postgres',
        Labels: expect.objectContaining({
          'openlander.managed': 'true',
          'openlander.role': 'service',
          'openlander.service': 'postgres',
          'openlander.instance': 'olinst_a',
        }),
      }),
    );
  });

  it('propagates errors from createContainer', async () => {
    mockCreateContainer.mockRejectedValueOnce(new Error('image not found'));

    const docker = new Docker();
    await expect(
      docker.runServiceContainer({
        imageTag: 'bad:image',
        name: 'ol-svc-bad',
        port: 5432,
        envVars: {},
        serviceName: 'bad',
      }),
    ).rejects.toThrow('image not found');
  });
});
