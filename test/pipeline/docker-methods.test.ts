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

const require = createRequire(import.meta.url);
const mockDockerodeClass = vi.fn(function (this: Record<string, unknown>) {
  this.ping = mockPing;
  this.listContainers = mockListContainers;
  this.buildImage = mockBuildImage;
  this.createContainer = mockCreateContainer;
  this.getImage = mockGetImage;
  this.getContainer = mockGetContainer;
  this.getNetwork = mockGetNetwork;
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
