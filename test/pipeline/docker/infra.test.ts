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
