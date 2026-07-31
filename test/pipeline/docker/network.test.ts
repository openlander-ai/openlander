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
const mockCreateNetwork = vi.fn();
const mockListNetworks = vi.fn();
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
  this.createNetwork = mockCreateNetwork;
  this.listNetworks = mockListNetworks;
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
  mockCreateNetwork.mockReset();
  mockListNetworks.mockReset().mockResolvedValue([]);
  mockDemuxStream.mockReset();
  mockDf.mockReset();
  mockGetVolume.mockReset();
  mockListVolumes.mockReset();
  mockCreateVolume.mockReset();
  mockGetEvents.mockReset();
};

const networkNotFoundError = (msg: string) => new Error(`No such network: ${msg}`);

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

describe('network cleanup inventory', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('classifies current, other-instance, legacy, external, and system networks', async () => {
    mockListNetworks.mockResolvedValueOnce([
      {
        Id: 'current-id',
        Name: 'ol-current',
        Driver: 'bridge',
        Scope: 'local',
        Labels: { 'openlander.managed': 'true', 'openlander.instance': 'olinst_a' },
        Containers: {},
        IPAM: { Config: [{ Subnet: '172.30.0.0/16' }] },
      },
      {
        Id: 'other-id',
        Name: 'ol-other',
        Driver: 'bridge',
        Scope: 'local',
        Labels: { 'openlander.managed': 'true', 'openlander.instance': 'olinst_b' },
        Containers: {},
        IPAM: { Config: [] },
      },
      {
        Id: 'legacy-id',
        Name: 'ol-legacy',
        Driver: 'bridge',
        Scope: 'local',
        Labels: {},
        Containers: {},
        IPAM: { Config: [] },
      },
      {
        Id: 'external-id',
        Name: 'compose_default',
        Driver: 'bridge',
        Scope: 'local',
        Labels: { 'com.docker.compose.network': 'default' },
        Containers: {},
        IPAM: { Config: [] },
      },
      {
        Id: 'system-id',
        Name: 'bridge',
        Driver: 'bridge',
        Scope: 'local',
        Labels: {},
        Containers: { c1: { Name: 'runtime' } },
        IPAM: { Config: [{ Subnet: '172.17.0.0/16' }] },
      },
    ]);
    mockListContainers.mockResolvedValueOnce([
      {
        Id: 'container-1',
        NetworkSettings: {
          Networks: {
            bridge: {
              NetworkID: 'system-id',
            },
          },
        },
      },
    ]);

    const docker = new Docker(undefined, undefined, 'olinst_a');
    await expect(docker.listNetworks()).resolves.toEqual([
      expect.objectContaining({
        id: 'current-id',
        ownership: 'current_instance',
        cleanupEligible: true,
        cleanupBlocker: null,
        subnets: ['172.30.0.0/16'],
      }),
      expect.objectContaining({
        id: 'other-id',
        ownership: 'other_instance',
        cleanupEligible: false,
        cleanupBlocker: 'different_instance',
      }),
      expect.objectContaining({
        id: 'legacy-id',
        ownership: 'legacy_unlabeled',
        cleanupEligible: false,
        cleanupBlocker: 'legacy_confirmation_required',
      }),
      expect.objectContaining({
        id: 'external-id',
        ownership: 'external',
        cleanupBlocker: 'unmanaged_network',
      }),
      expect.objectContaining({
        id: 'system-id',
        ownership: 'system',
        cleanupBlocker: 'system_network',
        endpointCount: 1,
      }),
    ]);
    expect(mockListContainers).toHaveBeenCalledOnce();
    expect(mockListContainers).toHaveBeenCalledWith({ all: true });
  });

  it('counts endpoints from all containers when NetworkList omits Containers', async () => {
    mockListNetworks.mockResolvedValueOnce([
      {
        Id: 'active-id',
        Name: 'ol-active',
        Driver: 'bridge',
        Scope: 'local',
        Labels: { 'openlander.managed': 'true', 'openlander.instance': 'olinst_a' },
        IPAM: { Config: [{ Subnet: '172.30.0.0/16' }] },
      },
      {
        Id: 'unused-id',
        Name: 'ol-unused',
        Driver: 'bridge',
        Scope: 'local',
        Labels: { 'openlander.managed': 'true', 'openlander.instance': 'olinst_a' },
        IPAM: { Config: [{ Subnet: '172.31.0.0/16' }] },
      },
    ]);
    mockListContainers.mockResolvedValueOnce([
      {
        Id: 'running-container',
        NetworkSettings: {
          Networks: {
            'ol-active': {
              NetworkID: 'active-id',
            },
          },
        },
      },
      {
        Id: 'stopped-container',
        NetworkSettings: {
          Networks: {
            'ol-active': {
              NetworkID: 'active-id',
            },
          },
        },
      },
    ]);

    const docker = new Docker(undefined, undefined, 'olinst_a');
    await expect(docker.listNetworks()).resolves.toEqual([
      expect.objectContaining({
        id: 'active-id',
        endpointCount: 2,
        cleanupEligible: false,
        cleanupBlocker: 'active_endpoints',
      }),
      expect.objectContaining({
        id: 'unused-id',
        endpointCount: 0,
        cleanupEligible: true,
        cleanupBlocker: null,
      }),
    ]);
  });

  it('removes an exact current-instance network only while it has zero endpoints', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mockGetNetwork.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'network-id',
        Name: 'ol-demo',
        Driver: 'bridge',
        Scope: 'local',
        Labels: { 'openlander.managed': 'true', 'openlander.instance': 'olinst_a' },
        Containers: {},
        IPAM: { Config: [] },
      }),
      remove,
    });

    const docker = new Docker(undefined, undefined, 'olinst_a');
    await expect(
      docker.removeUnusedNetwork({
        networkName: 'ol-demo',
        expectedNetworkId: 'network-id',
      }),
    ).resolves.toMatchObject({ id: 'network-id', endpointCount: 0 });
    expect(remove).toHaveBeenCalledOnce();
  });

  it('requires the inspected network id to match before removal', async () => {
    const remove = vi.fn();
    mockGetNetwork.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Id: 'replacement-id',
        Name: 'ol-demo',
        Driver: 'bridge',
        Scope: 'local',
        Labels: { 'openlander.instance': 'olinst_a' },
        Containers: {},
        IPAM: { Config: [] },
      }),
      remove,
    });

    const docker = new Docker(undefined, undefined, 'olinst_a');
    await expect(
      docker.removeUnusedNetwork({
        networkName: 'ol-demo',
        expectedNetworkId: 'old-id',
      }),
    ).rejects.toMatchObject({
      code: 'NETWORK_CLEANUP_BLOCKED',
      details: { reason: 'network_id_changed' },
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses active and other-instance networks', async () => {
    const remove = vi.fn();
    mockGetNetwork
      .mockReturnValueOnce({
        inspect: vi.fn().mockResolvedValue({
          Id: 'active-id',
          Name: 'ol-active',
          Driver: 'bridge',
          Scope: 'local',
          Labels: { 'openlander.instance': 'olinst_a' },
          Containers: { c1: { Name: 'app' } },
          IPAM: { Config: [] },
        }),
        remove,
      })
      .mockReturnValueOnce({
        inspect: vi.fn().mockResolvedValue({
          Id: 'other-id',
          Name: 'ol-other',
          Driver: 'bridge',
          Scope: 'local',
          Labels: { 'openlander.instance': 'olinst_b' },
          Containers: {},
          IPAM: { Config: [] },
        }),
        remove,
      });

    const docker = new Docker(undefined, undefined, 'olinst_a');
    await expect(
      docker.removeUnusedNetwork({
        networkName: 'ol-active',
        expectedNetworkId: 'active-id',
      }),
    ).rejects.toMatchObject({ details: { reason: 'active_endpoints' } });
    await expect(
      docker.removeUnusedNetwork({
        networkName: 'ol-other',
        expectedNetworkId: 'other-id',
      }),
    ).rejects.toMatchObject({ details: { reason: 'different_instance' } });
    expect(remove).not.toHaveBeenCalled();
  });

  it('requires explicit legacy opt-in and never removes external networks', async () => {
    const legacyRemove = vi.fn().mockResolvedValue(undefined);
    const externalRemove = vi.fn();
    const sharedRemove = vi.fn();
    const legacyInfo = {
      Id: 'legacy-id',
      Name: 'ol-legacy',
      Driver: 'bridge',
      Scope: 'local',
      Labels: {},
      Containers: {},
      IPAM: { Config: [] },
    };
    mockGetNetwork
      .mockReturnValueOnce({ inspect: vi.fn().mockResolvedValue(legacyInfo), remove: legacyRemove })
      .mockReturnValueOnce({ inspect: vi.fn().mockResolvedValue(legacyInfo), remove: legacyRemove })
      .mockReturnValueOnce({
        inspect: vi.fn().mockResolvedValue({
          ...legacyInfo,
          Id: 'external-id',
          Name: 'compose_default',
        }),
        remove: externalRemove,
      })
      .mockReturnValueOnce({
        inspect: vi.fn().mockResolvedValue({
          ...legacyInfo,
          Id: 'shared-id',
          Name: 'openlander',
          Labels: { 'openlander.managed': 'true' },
        }),
        remove: sharedRemove,
      });

    const docker = new Docker(undefined, undefined, 'olinst_a');
    await expect(
      docker.removeUnusedNetwork({
        networkName: 'ol-legacy',
        expectedNetworkId: 'legacy-id',
      }),
    ).rejects.toMatchObject({ details: { reason: 'legacy_confirmation_required' } });
    await expect(
      docker.removeUnusedNetwork({
        networkName: 'ol-legacy',
        expectedNetworkId: 'legacy-id',
        allowLegacyUnlabeled: true,
      }),
    ).resolves.toMatchObject({ ownership: 'legacy_unlabeled' });
    await expect(
      docker.removeUnusedNetwork({
        networkName: 'compose_default',
        expectedNetworkId: 'external-id',
        allowLegacyUnlabeled: true,
      }),
    ).rejects.toMatchObject({ details: { reason: 'unmanaged_network' } });
    await expect(
      docker.removeUnusedNetwork({
        networkName: 'openlander',
        expectedNetworkId: 'shared-id',
        allowLegacyUnlabeled: true,
      }),
    ).rejects.toMatchObject({ details: { reason: 'shared_network' } });
    expect(legacyRemove).toHaveBeenCalledOnce();
    expect(externalRemove).not.toHaveBeenCalled();
    expect(sharedRemove).not.toHaveBeenCalled();
  });
});

describe('ensureProjectNetwork', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('labels a new network with the owning OpenLander instance', async () => {
    mockGetNetwork.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValueOnce(networkNotFoundError('ol-demo')),
    });
    mockCreateNetwork.mockResolvedValueOnce({ id: 'network-id' });

    const docker = new Docker(undefined, undefined, 'olinst_a');
    await expect(docker.ensureProjectNetwork('demo')).resolves.toBe('ol-demo');

    expect(mockCreateNetwork).toHaveBeenCalledWith({
      Name: 'ol-demo',
      Driver: 'bridge',
      IPAM: { Config: [{ Subnet: '10.240.0.0/24' }] },
      Labels: {
        'openlander.managed': 'true',
        'openlander.project': 'demo',
        'openlander.instance': 'olinst_a',
      },
    });
  });

  it('returns a typed action-required error when the configured pool is exhausted', async () => {
    mockGetNetwork.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValueOnce(networkNotFoundError('ol-demo')),
    });
    mockCreateNetwork.mockRejectedValueOnce(
      new Error('all predefined address pools have been fully subnetted'),
    );

    const docker = new Docker(undefined, undefined, 'olinst_a');
    await expect(docker.ensureProjectNetwork('demo')).rejects.toMatchObject({
      code: 'NETWORK_ADDRESS_POOL_EXHAUSTED',
      statusCode: 503,
      details: {
        networkName: 'ol-demo',
        poolCidr: '10.240.0.0/12',
        subnetPrefix: 24,
        retryable: false,
        actionRequired: 'free_or_reconfigure_network_pool',
      },
    });
  });

  it('skips every overlapping Docker CIDR when selecting a Project subnet', async () => {
    mockGetNetwork.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValueOnce(networkNotFoundError('ol-demo')),
    });
    mockListNetworks.mockResolvedValueOnce([
      { IPAM: { Config: [{ Subnet: '10.240.0.0/24' }] } },
      { IPAM: { Config: [{ Subnet: '10.240.2.0/23' }] } },
      { IPAM: { Config: [{ Subnet: '172.17.0.0/16' }] } },
    ]);
    mockCreateNetwork.mockResolvedValueOnce({ id: 'network-id' });

    const docker = new Docker(undefined, undefined, 'olinst_a', '10.240.0.0/22');
    await expect(docker.ensureProjectNetwork('demo')).resolves.toBe('ol-demo');

    expect(mockCreateNetwork).toHaveBeenCalledWith(
      expect.objectContaining({
        IPAM: { Config: [{ Subnet: '10.240.1.0/24' }] },
      }),
    );
  });

  it('re-lists networks and picks another subnet after a concurrent allocation collision', async () => {
    mockGetNetwork.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValueOnce(networkNotFoundError('ol-demo')),
    });
    mockListNetworks.mockResolvedValue([]);
    mockCreateNetwork
      .mockRejectedValueOnce(new Error('Pool overlaps with other one on this address space'))
      .mockResolvedValueOnce({ id: 'network-id' });

    const docker = new Docker(undefined, undefined, 'olinst_a', '10.240.0.0/22');
    await expect(docker.ensureProjectNetwork('demo')).resolves.toBe('ol-demo');

    expect(mockCreateNetwork).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ IPAM: { Config: [{ Subnet: '10.240.0.0/24' }] } }),
    );
    expect(mockCreateNetwork).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ IPAM: { Config: [{ Subnet: '10.240.1.0/24' }] } }),
    );
  });

  it('does not reinterpret unrelated Docker address-space errors as allocation races', async () => {
    mockGetNetwork.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValueOnce(networkNotFoundError('ol-demo')),
    });
    mockCreateNetwork.mockRejectedValueOnce(
      new Error('custom driver address space is unavailable'),
    );

    const docker = new Docker(undefined, undefined, 'olinst_a', '10.240.0.0/22');
    await expect(docker.ensureProjectNetwork('demo')).rejects.toThrow(
      'custom driver address space is unavailable',
    );

    expect(mockCreateNetwork).toHaveBeenCalledOnce();
  });

  it('rejects non-canonical project pools before listing or mutating Docker networks', async () => {
    mockGetNetwork.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValueOnce(networkNotFoundError('ol-demo')),
    });

    const docker = new Docker(undefined, undefined, 'olinst_a', '10.240.1.0/22');
    await expect(docker.preflightProjectNetwork('demo')).rejects.toMatchObject({
      code: 'SERVICE_CONFIG_INVALID',
      statusCode: 400,
    });

    expect(mockListNetworks).not.toHaveBeenCalled();
    expect(mockCreateNetwork).not.toHaveBeenCalled();
  });

  it('accepts an existing project network without consuming allocator capacity', async () => {
    mockGetNetwork.mockReturnValueOnce({
      inspect: vi.fn().mockResolvedValueOnce({ Id: 'existing-network' }),
    });

    const docker = new Docker(undefined, undefined, 'olinst_a', '10.240.0.0/24');
    await expect(docker.preflightProjectNetwork('demo')).resolves.toBeUndefined();

    expect(mockListNetworks).not.toHaveBeenCalled();
    expect(mockCreateNetwork).not.toHaveBeenCalled();
  });

  it('preflights capacity without creating a network or mutating Docker', async () => {
    mockGetNetwork.mockReturnValueOnce({
      inspect: vi.fn().mockRejectedValueOnce(networkNotFoundError('ol-demo')),
    });
    mockListNetworks.mockResolvedValueOnce([{ IPAM: { Config: [{ Subnet: '10.240.0.0/24' }] } }]);

    const docker = new Docker(undefined, undefined, 'olinst_a', '10.240.0.0/24');
    await expect(docker.preflightProjectNetwork('demo')).rejects.toMatchObject({
      code: 'NETWORK_ADDRESS_POOL_EXHAUSTED',
      details: { poolCidr: '10.240.0.0/24' },
    });
    expect(mockCreateNetwork).not.toHaveBeenCalled();
  });

  it('reports configured pool capacity from the same network inventory', () => {
    const docker = new Docker(undefined, undefined, 'olinst_a', '10.240.0.0/22');
    expect(
      docker.getProjectNetworkPoolStatus([
        {
          subnets: ['10.240.0.0/24', '10.240.2.0/23'],
        } as Awaited<ReturnType<typeof docker.listNetworks>>[number],
      ]),
    ).toEqual({
      cidr: '10.240.0.0/22',
      subnetPrefix: 24,
      totalSubnets: 4,
      unavailableSubnets: 3,
      availableSubnets: 1,
      pressure: 'low',
    });
  });
});

describe('removeProjectNetwork', () => {
  beforeEach(resetMocks);
  afterEach(() => vi.restoreAllMocks());

  it('disconnects only the owning managed Traefik endpoint before removing its network', async () => {
    const inspect = vi.fn().mockResolvedValue({
      Labels: { 'openlander.instance': 'olinst_a' },
      Containers: { 'traefik-id': { Name: 'traefik-ol' } },
    });
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    mockGetNetwork.mockReturnValue({ inspect, disconnect, remove });
    mockGetContainer.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({
        Config: {
          Labels: {
            'openlander.managed': 'true',
            'openlander.role': 'traefik',
            'openlander.instance': 'olinst_a',
          },
        },
      }),
    });

    const docker = new Docker(undefined, undefined, 'olinst_a');
    await expect(docker.removeProjectNetwork('demo')).resolves.toBeUndefined();

    expect(disconnect).toHaveBeenCalledWith({ Container: 'traefik-id', Force: true });
    expect(remove).toHaveBeenCalledOnce();
  });

  it('refuses to remove a network without an exact instance ownership match', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mockGetNetwork.mockReturnValue({
      inspect: vi.fn().mockResolvedValue({ Labels: {}, Containers: {} }),
      remove,
    });

    const docker = new Docker(undefined, undefined, 'olinst_a');
    await expect(docker.removeProjectNetwork('legacy')).resolves.toBeUndefined();

    expect(remove).not.toHaveBeenCalled();
  });
});
