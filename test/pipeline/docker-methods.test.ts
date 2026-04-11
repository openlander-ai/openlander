import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';

import { Docker } from '../../src/pipeline/docker.js';

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
const networkNotFoundError = (msg: string) => new Error(`No such network: ${msg}`);

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
// Tests: connectContainerToNetwork
// ---------------------------------------------------------------------------

describe('connectContainerToNetwork', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('connects container to network successfully', async () => {
    const connectFn = vi.fn().mockResolvedValueOnce(undefined);
    mockGetNetwork.mockReturnValueOnce({ connect: connectFn });

    const docker = new Docker();
    await docker.connectContainerToNetwork('c1', 'openlander');

    expect(mockGetNetwork).toHaveBeenCalledWith('openlander');
    expect(connectFn).toHaveBeenCalledWith({
      Container: 'c1',
      EndpointConfig: undefined,
    });
  });

  it('passes aliases in EndpointConfig when provided', async () => {
    const connectFn = vi.fn().mockResolvedValueOnce(undefined);
    mockGetNetwork.mockReturnValueOnce({ connect: connectFn });

    const docker = new Docker();
    await docker.connectContainerToNetwork('c1', 'openlander', ['myapp', 'api']);

    expect(connectFn).toHaveBeenCalledWith({
      Container: 'c1',
      EndpointConfig: { Aliases: ['myapp', 'api'] },
    });
  });

  it('silently returns when container is already connected (already exists)', async () => {
    const connectFn = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('endpoint with name c1 already exists in network openlander'),
      );
    mockGetNetwork.mockReturnValueOnce({ connect: connectFn });

    const docker = new Docker();
    await expect(docker.connectContainerToNetwork('c1', 'openlander')).resolves.toBeUndefined();
  });

  it('silently returns when "already connected" message', async () => {
    const connectFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('container already connected to network'));
    mockGetNetwork.mockReturnValueOnce({ connect: connectFn });

    const docker = new Docker();
    await expect(docker.connectContainerToNetwork('c1', 'net1')).resolves.toBeUndefined();
  });

  it('re-throws unexpected errors', async () => {
    const connectFn = vi.fn().mockRejectedValueOnce(new Error('network driver failed'));
    mockGetNetwork.mockReturnValueOnce({ connect: connectFn });

    const docker = new Docker();
    await expect(docker.connectContainerToNetwork('c1', 'net1')).rejects.toThrow(
      'network driver failed',
    );
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
// Tests: execSimple
// ---------------------------------------------------------------------------

describe('execSimple', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('returns structured output with exitCode 0 on success', async () => {
    const execStream = new PassThrough();
    const execInspect = vi.fn().mockResolvedValueOnce({ ExitCode: 0 });
    const execStart = vi.fn().mockResolvedValueOnce(execStream);
    const containerExec = vi.fn().mockResolvedValueOnce({
      start: execStart,
      inspect: execInspect,
    });

    mockGetContainer.mockReturnValueOnce({ exec: containerExec });

    mockDemuxStream.mockImplementationOnce(
      (_stream: NodeJS.ReadableStream, stdout: PassThrough, stderr: PassThrough) => {
        stdout.write(Buffer.from('hello world'));
        stdout.end();
        stderr.end();
      },
    );

    // End the exec stream after a tick to let the promise resolve
    setTimeout(() => execStream.emit('end'), 5);

    const docker = new Docker();
    const result = await docker.execSimple('c1', ['echo', 'hello']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello world');
    expect(result.stderr).toBe('');

    expect(containerExec).toHaveBeenCalledWith({
      Cmd: ['echo', 'hello'],
      AttachStdout: true,
      AttachStderr: true,
    });
    expect(execStart).toHaveBeenCalledWith({ hijack: false, stdin: false });
  });

  it('returns non-zero exit code with stderr on failure', async () => {
    const execStream = new PassThrough();
    const execInspect = vi.fn().mockResolvedValueOnce({ ExitCode: 1 });
    const execStart = vi.fn().mockResolvedValueOnce(execStream);
    const containerExec = vi.fn().mockResolvedValueOnce({
      start: execStart,
      inspect: execInspect,
    });

    mockGetContainer.mockReturnValueOnce({ exec: containerExec });

    mockDemuxStream.mockImplementationOnce(
      (_stream: NodeJS.ReadableStream, stdout: PassThrough, stderr: PassThrough) => {
        stderr.write(Buffer.from('command not found'));
        stdout.end();
        stderr.end();
      },
    );

    setTimeout(() => execStream.emit('end'), 5);

    const docker = new Docker();
    const result = await docker.execSimple('c1', ['bad-cmd']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('command not found');
  });

  it('returns both stdout and stderr when both are populated', async () => {
    const execStream = new PassThrough();
    const execInspect = vi.fn().mockResolvedValueOnce({ ExitCode: 2 });
    const execStart = vi.fn().mockResolvedValueOnce(execStream);
    const containerExec = vi.fn().mockResolvedValueOnce({
      start: execStart,
      inspect: execInspect,
    });

    mockGetContainer.mockReturnValueOnce({ exec: containerExec });

    mockDemuxStream.mockImplementationOnce(
      (_stream: NodeJS.ReadableStream, stdout: PassThrough, stderr: PassThrough) => {
        stdout.write(Buffer.from('partial output'));
        stderr.write(Buffer.from('warning: something wrong'));
        stdout.end();
        stderr.end();
      },
    );

    setTimeout(() => execStream.emit('end'), 5);

    const docker = new Docker();
    const result = await docker.execSimple('c1', ['ls', '-la']);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('partial output');
    expect(result.stderr).toBe('warning: something wrong');
  });
});

// ---------------------------------------------------------------------------
// Tests: getNetworkInfo
// ---------------------------------------------------------------------------

describe('getNetworkInfo', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('returns network inspect info on success', async () => {
    const networkData = {
      Name: 'openlander',
      Id: 'net-abc123',
      Driver: 'bridge',
      Containers: { c1: { Name: 'myapp' } },
    };
    mockGetNetwork.mockReturnValueOnce({
      inspect: vi.fn().mockResolvedValueOnce(networkData),
    });

    const docker = new Docker();
    const result = await docker.getNetworkInfo('openlander');

    expect(result).toEqual(networkData);
    expect(mockGetNetwork).toHaveBeenCalledWith('openlander');
  });

  it('throws "Network not found" error when network does not exist', async () => {
    mockGetNetwork.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValueOnce(networkNotFoundError('missing-net')),
    });

    const docker = new Docker();
    await expect(docker.getNetworkInfo('missing-net')).rejects.toThrow(
      'Network not found: missing-net',
    );
  });

  it('re-throws non-404 errors as-is', async () => {
    mockGetNetwork.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValueOnce(new Error('driver error')),
    });

    const docker = new Docker();
    await expect(docker.getNetworkInfo('broken')).rejects.toThrow('driver error');
  });
});

// ---------------------------------------------------------------------------
// Tests: inspectImage
// ---------------------------------------------------------------------------

describe('inspectImage', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('returns image inspect info on success', async () => {
    const imageData = { Id: 'sha256:abc123', RepoTags: ['myapp:latest'], Size: 150_000_000 };
    mockGetImage.mockReturnValueOnce({
      inspect: vi.fn().mockResolvedValueOnce(imageData),
    });

    const docker = new Docker();
    const result = await docker.inspectImage('myapp:latest');

    expect(result).toEqual(imageData);
    expect(mockGetImage).toHaveBeenCalledWith('myapp:latest');
  });

  it('throws "Image not found" error when image does not exist', async () => {
    mockGetImage.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValueOnce(new Error('No such image: missing:latest')),
    });

    const docker = new Docker();
    await expect(docker.inspectImage('missing:latest')).rejects.toThrow(
      'Image not found: missing:latest',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: removeImage
// ---------------------------------------------------------------------------

describe('removeImage', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('removes image successfully', async () => {
    const removeFn = vi.fn().mockResolvedValueOnce(undefined);
    mockGetImage.mockReturnValueOnce({ remove: removeFn });

    const docker = new Docker();
    await expect(docker.removeImage('old:v1')).resolves.toBeUndefined();

    expect(mockGetImage).toHaveBeenCalledWith('old:v1');
    expect(removeFn).toHaveBeenCalledWith({ force: false });
  });

  it('silently returns when image is not found (404)', async () => {
    mockGetImage.mockReturnValueOnce({
      remove: vi.fn().mockRejectedValueOnce(new Error('No such image: gone:v1')),
    });

    const docker = new Docker();
    await expect(docker.removeImage('gone:v1')).resolves.toBeUndefined();
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
// Tests: getDiskUsage
// ---------------------------------------------------------------------------

describe('getDiskUsage', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('returns disk usage data on success', async () => {
    const diskData = {
      LayersSize: 1_000_000_000,
      Images: [{ Id: 'sha256:abc' }],
      Containers: [],
      Volumes: [],
    };
    mockDf.mockResolvedValueOnce(diskData);

    const docker = new Docker();
    const result = await docker.getDiskUsage();

    expect(result).toEqual(diskData);
  });

  it('propagates errors from Docker daemon', async () => {
    mockDf.mockRejectedValueOnce(new Error('daemon unavailable'));

    const docker = new Docker();
    await expect(docker.getDiskUsage()).rejects.toThrow('daemon unavailable');
  });
});

// ---------------------------------------------------------------------------
// Tests: inspectVolume
// ---------------------------------------------------------------------------

describe('inspectVolume', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('returns volume inspect info on success', async () => {
    const volumeData = {
      Name: 'my-vol',
      Driver: 'local',
      Mountpoint: '/var/lib/docker/volumes/my-vol/_data',
    };
    mockGetVolume.mockReturnValueOnce({
      inspect: vi.fn().mockResolvedValueOnce(volumeData),
    });

    const docker = new Docker();
    const result = await docker.inspectVolume('my-vol');

    expect(result).toEqual(volumeData);
    expect(mockGetVolume).toHaveBeenCalledWith('my-vol');
  });

  it('propagates Docker 404 error when volume does not exist', async () => {
    mockGetVolume.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValueOnce(new Error('No such volume: missing-vol')),
    });

    const docker = new Docker();
    await expect(docker.inspectVolume('missing-vol')).rejects.toThrow(
      'No such volume: missing-vol',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: listVolumes
// ---------------------------------------------------------------------------

describe('listVolumes', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('returns array of volumes', async () => {
    const volumes = [
      { Name: 'vol-a', Driver: 'local' },
      { Name: 'vol-b', Driver: 'local' },
    ];
    mockListVolumes.mockResolvedValueOnce({ Volumes: volumes });

    const docker = new Docker();
    const result = await docker.listVolumes();

    expect(result).toEqual(volumes);
  });

  it('returns empty array when no volumes exist', async () => {
    mockListVolumes.mockResolvedValueOnce({ Volumes: undefined });

    const docker = new Docker();
    const result = await docker.listVolumes();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: createVolume
// ---------------------------------------------------------------------------

describe('createVolume', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('creates volume with MANAGED=true label and extra labels', async () => {
    mockCreateVolume.mockResolvedValueOnce(undefined);

    const docker = new Docker();
    await docker.createVolume({ name: 'my-data', labels: { custom: 'value' } });

    expect(mockCreateVolume).toHaveBeenCalledWith(
      expect.objectContaining({
        Name: 'my-data',
        Labels: expect.objectContaining({
          'openlander.managed': 'true',
          custom: 'value',
        }),
      }),
    );
  });

  it('creates volume with only MANAGED label when no extra labels provided', async () => {
    mockCreateVolume.mockResolvedValueOnce(undefined);

    const docker = new Docker();
    await docker.createVolume({ name: 'plain-vol' });

    expect(mockCreateVolume).toHaveBeenCalledWith(
      expect.objectContaining({
        Name: 'plain-vol',
        Labels: expect.objectContaining({
          'openlander.managed': 'true',
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: removeVolume
// ---------------------------------------------------------------------------

describe('removeVolume', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('removes volume successfully', async () => {
    const removeFn = vi.fn().mockResolvedValueOnce(undefined);
    mockGetVolume.mockReturnValueOnce({ remove: removeFn });

    const docker = new Docker();
    await expect(docker.removeVolume('my-vol')).resolves.toBeUndefined();

    expect(mockGetVolume).toHaveBeenCalledWith('my-vol');
    expect(removeFn).toHaveBeenCalledTimes(1);
  });

  it('silently returns when volume is not found (404)', async () => {
    mockGetVolume.mockReturnValueOnce({
      remove: vi.fn().mockRejectedValueOnce(new Error('No such volume: gone-vol')),
    });

    const docker = new Docker();
    await expect(docker.removeVolume('gone-vol')).resolves.toBeUndefined();
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

    const docker = new Docker();
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

// ---------------------------------------------------------------------------
// Tests: execStream
// ---------------------------------------------------------------------------

describe('execStream', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('returns a readable/writable stream with default tty=true', async () => {
    const mockStream = new PassThrough();
    const execStart = vi.fn().mockResolvedValueOnce(mockStream);
    const containerExec = vi.fn().mockResolvedValueOnce({ start: execStart });
    mockGetContainer.mockReturnValueOnce({ exec: containerExec });

    const docker = new Docker();
    const result = await docker.execStream('c1', ['/bin/bash']);

    expect(result).toBe(mockStream);
    expect(containerExec).toHaveBeenCalledWith({
      Cmd: ['/bin/bash'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    expect(execStart).toHaveBeenCalledWith({ hijack: true, stdin: true });
  });

  it('respects tty option when set to false', async () => {
    const mockStream = new PassThrough();
    const execStart = vi.fn().mockResolvedValueOnce(mockStream);
    const containerExec = vi.fn().mockResolvedValueOnce({ start: execStart });
    mockGetContainer.mockReturnValueOnce({ exec: containerExec });

    const docker = new Docker();
    await docker.execStream('c1', ['ls', '-la'], { tty: false });

    expect(containerExec).toHaveBeenCalledWith(expect.objectContaining({ Tty: false }));
  });
});

// ---------------------------------------------------------------------------
// Tests: getEventStream
// ---------------------------------------------------------------------------

describe('getEventStream', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('returns event stream with filters applied', async () => {
    const mockStream = new PassThrough();
    mockGetEvents.mockResolvedValueOnce(mockStream);

    const docker = new Docker();
    const filters = { type: ['container'], event: ['start', 'die'] };
    const result = await docker.getEventStream(filters);

    expect(result).toBe(mockStream);
    expect(mockGetEvents).toHaveBeenCalledWith({ filters });
  });

  it('propagates errors from Docker daemon', async () => {
    mockGetEvents.mockRejectedValueOnce(new Error('connection refused'));

    const docker = new Docker();
    await expect(docker.getEventStream({ type: ['container'] })).rejects.toThrow(
      'connection refused',
    );
  });
});
