import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';

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

  it('passes optional stdin through a hijacked non-TTY exec stream', async () => {
    const execStream = new PassThrough();
    const writeSpy = vi.spyOn(execStream, 'write');
    const endSpy = vi.spyOn(execStream, 'end');
    const execInspect = vi.fn().mockResolvedValueOnce({ ExitCode: 0 });
    const execStart = vi.fn().mockResolvedValueOnce(execStream);
    const containerExec = vi.fn().mockResolvedValueOnce({
      start: execStart,
      inspect: execInspect,
    });

    mockGetContainer.mockReturnValueOnce({ exec: containerExec });
    mockDemuxStream.mockImplementationOnce(
      (_stream: NodeJS.ReadableStream, stdout: PassThrough, stderr: PassThrough) => {
        stdout.write(Buffer.from('1'));
        stdout.end();
        stderr.end();
      },
    );

    setTimeout(() => execStream.emit('end'), 5);

    const docker = new Docker();
    const result = await docker.execSimple('c1', ['psql', '-f', '-'], { stdin: 'SELECT 1' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('1');
    expect(containerExec).toHaveBeenCalledWith({
      Cmd: ['psql', '-f', '-'],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
    });
    expect(execStart).toHaveBeenCalledWith({ hijack: true, stdin: true });
    expect(writeSpy).toHaveBeenCalledWith('SELECT 1');
    expect(endSpy).toHaveBeenCalled();
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
