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
// Tests: buildImage
// ---------------------------------------------------------------------------

describe('buildImage', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('uses BuildKit for standalone Dockerfiles', async () => {
    const stream = { stream: true } as unknown as NodeJS.ReadableStream;
    mockBuildImage.mockResolvedValueOnce(stream);
    mockFollowProgress.mockImplementationOnce(
      (_stream: NodeJS.ReadableStream, done: (err: Error | null) => void) => done(null),
    );

    const docker = new Docker();
    await docker.buildImage('/tmp/app', 'incar-api:dev', {
      dockerfile: 'infra/Dockerfile.api',
    });

    expect(mockBuildImage).toHaveBeenCalledWith(
      { context: '/tmp/app', src: ['.'] },
      expect.objectContaining({
        t: 'incar-api:dev',
        dockerfile: 'infra/Dockerfile.api',
        version: '2',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: buildComposeService
// ---------------------------------------------------------------------------

describe('buildComposeService', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('uses BuildKit for Compose Dockerfiles', async () => {
    const stream = { stream: true } as unknown as NodeJS.ReadableStream;
    mockBuildImage.mockResolvedValueOnce(stream);
    mockFollowProgress.mockImplementationOnce(
      (_stream: NodeJS.ReadableStream, done: (err: Error | null) => void) => done(null),
    );

    const docker = new Docker();
    await docker.buildComposeService({
      contextPath: '/tmp/compose-app',
      dockerfile: 'infra/Dockerfile.api',
      tag: 'incar-api:dev',
      cacheFrom: ['incar-api:dev'],
    });

    expect(mockBuildImage).toHaveBeenCalledWith(
      { context: '/tmp/compose-app', src: ['.'] },
      expect.objectContaining({
        t: 'incar-api:dev',
        dockerfile: 'infra/Dockerfile.api',
        version: '2',
      }),
    );
  });

  it('retries transient registry network failures', async () => {
    const firstStream = { stream: 'first' } as unknown as NodeJS.ReadableStream;
    const secondStream = { stream: 'second' } as unknown as NodeJS.ReadableStream;
    mockBuildImage.mockResolvedValueOnce(firstStream).mockResolvedValueOnce(secondStream);
    mockFollowProgress
      .mockImplementationOnce((_stream: NodeJS.ReadableStream, done: (err: Error | null) => void) =>
        done(new Error('context deadline exceeded')),
      )
      .mockImplementationOnce((_stream: NodeJS.ReadableStream, done: (err: Error | null) => void) =>
        done(null),
      );

    const docker = new Docker();
    await docker.buildComposeService({
      contextPath: '/tmp/compose-app',
      dockerfile: 'Dockerfile',
      tag: 'example/web:latest',
    });

    expect(mockBuildImage).toHaveBeenCalledTimes(2);
  });

  it('does not retry deterministic Dockerfile failures', async () => {
    const stream = { stream: true } as unknown as NodeJS.ReadableStream;
    mockBuildImage.mockResolvedValueOnce(stream);
    mockFollowProgress.mockImplementationOnce(
      (_stream: NodeJS.ReadableStream, done: (err: Error | null) => void) =>
        done(new Error('process exited with code 1')),
    );

    const docker = new Docker();
    await expect(
      docker.buildComposeService({
        contextPath: '/tmp/compose-app',
        dockerfile: 'Dockerfile',
        tag: 'example/web:latest',
      }),
    ).rejects.toMatchObject({ code: 'DOCKER_BUILD_FAILED' });

    expect(mockBuildImage).toHaveBeenCalledTimes(1);
  });
});
