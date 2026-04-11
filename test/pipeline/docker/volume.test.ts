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
