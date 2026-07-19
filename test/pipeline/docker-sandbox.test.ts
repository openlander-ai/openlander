import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { mockLogWarn, mockLogDebug } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
  mockLogDebug: vi.fn(),
}));

vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: vi.fn(() => ({
    warn: mockLogWarn,
    debug: mockLogDebug,
    info: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnValue({
      warn: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    }),
  })),
}));

const mockPing = vi.fn();
const mockListContainers = vi.fn();
const mockCreateContainer = vi.fn();
const mockGetContainer = vi.fn();
const mockGetNetwork = vi.fn();
const mockGetImage = vi.fn();
const mockBuildImage = vi.fn();
const mockFollowProgress = vi.fn();

const require = createRequire(import.meta.url);
const mockDockerodeClass = vi.fn(function (this: Record<string, unknown>) {
  this.ping = mockPing;
  this.listContainers = mockListContainers;
  this.createContainer = mockCreateContainer;
  this.getContainer = mockGetContainer;
  this.getNetwork = mockGetNetwork;
  this.getImage = mockGetImage;
  this.buildImage = mockBuildImage;
  this.modem = { followProgress: mockFollowProgress };
});

const dockerodePath = require.resolve('dockerode');
require.cache[dockerodePath] = {
  id: dockerodePath,
  filename: dockerodePath,
  loaded: true,
  exports: mockDockerodeClass,
} as unknown as NodeJS.Module;

import { Docker } from '../../src/pipeline/docker.js';

const resetMocks = () => {
  mockPing.mockReset().mockResolvedValue('OK');
  mockListContainers.mockReset().mockResolvedValue([]);
  mockCreateContainer.mockReset();
  mockGetContainer.mockReset();
  mockGetImage.mockReset();
  mockBuildImage.mockReset();
  mockFollowProgress.mockReset();
  mockLogWarn.mockReset();
  mockLogDebug.mockReset();
  mockGetNetwork.mockReset().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({}),
  });
};

describe('Docker sandbox race prevention', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('safeRemoveContainer resolves when container is already gone (404)', async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mockInspect = vi.fn().mockRejectedValue(new Error('No such container: sandbox-test'));

    mockGetContainer.mockReturnValue({
      remove: mockRemove,
      inspect: mockInspect,
    });

    const docker = new Docker();
    await expect(docker.safeRemoveContainer('sandbox-test')).resolves.toBeUndefined();

    expect(mockRemove).toHaveBeenCalledOnce();
    expect(mockInspect).toHaveBeenCalledOnce();
  });

  it('safeRemoveContainer treats ECONNREFUSED as container gone', async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mockInspect = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:2375'));

    mockGetContainer.mockReturnValue({
      remove: mockRemove,
      inspect: mockInspect,
    });

    const docker = new Docker();
    await expect(docker.safeRemoveContainer('sandbox-econnrefused')).resolves.toBeUndefined();

    expect(mockRemove).toHaveBeenCalledOnce();
    expect(mockInspect).toHaveBeenCalledOnce();
  });

  it('safeRemoveContainer timeout logs warning but does not throw', async () => {
    vi.useFakeTimers();

    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mockInspect = vi.fn().mockResolvedValue({ State: { Running: false } });

    mockGetContainer.mockReturnValue({
      remove: mockRemove,
      inspect: mockInspect,
    });

    const docker = new Docker();
    const promise = docker.safeRemoveContainer('sandbox-stuck');

    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(200);
    }

    await expect(promise).resolves.toBeUndefined();
    expect(mockInspect).toHaveBeenCalledTimes(5);
    expect(mockLogWarn).toHaveBeenCalledOnce();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ containerId: 'sandbox-stuck' }),
      expect.stringContaining('timed out'),
    );
  });

  it('runContainer skips post-start network attach when NetworkMode is shared', async () => {
    const container = { id: 'ctr-shared-net', start: vi.fn().mockResolvedValue(undefined) };
    mockCreateContainer.mockResolvedValueOnce(container);

    const connect = vi.fn().mockResolvedValue(undefined);
    mockGetNetwork.mockReturnValue({
      connect,
      disconnect: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({}),
    });

    const docker = new Docker('/var/run/docker.sock', 'openlander');
    await docker.runContainer({
      imageTag: 'app:v1',
      name: 'ol-myapp',
      port: 10001,
      containerPort: 3000,
      envVars: { NODE_ENV: 'production' },
      traefikLabels: {},
    });

    expect(container.start).toHaveBeenCalledOnce();
    expect(connect).not.toHaveBeenCalled();
  });

  it('ensureSharedNetworkAttachment silently returns on already-connected error', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('endpoint with name already connected to network openlander'),
      );
    const disconnect = vi.fn().mockResolvedValue(undefined);

    mockGetNetwork.mockReturnValue({
      connect,
      disconnect,
      inspect: vi.fn().mockResolvedValue({}),
    });

    const docker = new Docker('/var/run/docker.sock', 'openlander');
    await expect(
      docker.ensureSharedNetworkAttachment('ctr-already', 'myapp'),
    ).resolves.toBeUndefined();

    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith({
      Container: 'ctr-already',
      EndpointConfig: { Aliases: ['myapp'] },
    });
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('runContainer does not attach isolated containers back to the shared network', async () => {
    const container = { id: 'ctr-custom-net', start: vi.fn().mockResolvedValue(undefined) };
    mockCreateContainer.mockResolvedValueOnce(container);

    const connect = vi.fn().mockResolvedValue(undefined);
    mockGetNetwork.mockReturnValue({
      connect,
      disconnect: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({}),
    });

    const docker = new Docker('/var/run/docker.sock', 'traefik-web');
    await docker.runContainer({
      imageTag: 'worker:v1',
      name: 'ol-worker',
      port: 10002,
      containerPort: 3000,
      envVars: { NODE_ENV: 'production' },
      traefikLabels: {},
    });

    expect(container.start).toHaveBeenCalledOnce();
    expect(connect).not.toHaveBeenCalled();
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        NetworkingConfig: {
          EndpointsConfig: {
            'traefik-web': {
              Aliases: ['worker'],
            },
          },
        },
        HostConfig: expect.objectContaining({
          NetworkMode: 'traefik-web',
        }),
      }),
    );
  });

  it('runComposeService does not strictly reconnect the shared network after alias attach', async () => {
    const container = {
      id: 'ctr-compose',
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateContainer.mockResolvedValueOnce(container);

    const connect = vi.fn().mockResolvedValue(undefined);
    mockGetNetwork.mockReturnValue({
      connect,
      disconnect: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({}),
    });

    const docker = new Docker('/var/run/docker.sock', 'openlander');
    await docker.runComposeService({
      imageTag: 'postgres:16',
      name: 'ol-demo-stack-postgres',
      port: 10003,
      containerPort: 5432,
      additionalPorts: [{ hostPort: 10004, containerPort: 5433 }],
      memoryLimitBytes: 4 * 1024 ** 3,
      envVars: {},
      traefikLabels: {},
      networks: ['ol-demo-stack', 'openlander'],
      aliases: ['postgres'],
    });

    expect(container.start).toHaveBeenCalledOnce();
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        NetworkingConfig: {
          EndpointsConfig: {
            'ol-demo-stack': {
              Aliases: ['demo-stack-postgres', 'postgres'],
            },
          },
        },
        HostConfig: expect.objectContaining({
          NetworkMode: 'ol-demo-stack',
          Memory: 4 * 1024 ** 3,
          PortBindings: {
            '5432/tcp': [{ HostPort: '10003' }],
            '5433/tcp': [{ HostPort: '10004' }],
          },
        }),
        ExposedPorts: { '5432/tcp': {}, '5433/tcp': {} },
      }),
    );
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith({
      Container: 'ctr-compose',
    });
  });

  it('runComposeService supports internal-only containers without host port bindings', async () => {
    const container = { id: 'ctr-resource', start: vi.fn().mockResolvedValue(undefined) };
    mockCreateContainer.mockResolvedValueOnce(container);

    const docker = new Docker('/var/run/docker.sock', 'openlander');
    await docker.runComposeService({
      imageTag: 'postgres:16',
      name: 'ol-demo-stack-db',
      containerPort: 5432,
      exposedPorts: [5432],
      envVars: {},
      traefikLabels: {},
      networks: ['ol-demo-stack'],
      aliases: ['db'],
    });

    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        ExposedPorts: { '5432/tcp': {} },
        HostConfig: expect.objectContaining({
          PortBindings: undefined,
          NetworkMode: 'ol-demo-stack',
        }),
      }),
    );
  });

  it('copies imported Compose files before starting the container', async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'openlander-compose-file-copy-test-'));
    try {
      const sourcePath = join(sourceDir, 'migrate.sh');
      writeFileSync(sourcePath, '#!/bin/sh\nexit 0\n', 'utf8');
      chmodSync(sourcePath, 0o755);
      const archiveChunks: Buffer[] = [];
      const putArchive = vi.fn().mockImplementation(async (stream: NodeJS.ReadableStream) => {
        for await (const chunk of stream) {
          archiveChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
      });
      const container = {
        id: 'ctr-job',
        putArchive,
        start: vi.fn().mockResolvedValue(undefined),
      };
      mockCreateContainer.mockResolvedValueOnce(container);

      const docker = new Docker('/var/run/docker.sock', 'openlander');
      await docker.runComposeService({
        imageTag: 'app:latest',
        name: 'ol-demo-stack-migrate',
        envVars: {},
        traefikLabels: {},
        networks: ['ol-demo-stack'],
        aliases: ['migrate'],
        fileCopies: [
          {
            sourcePath,
            targetPath: '/app/infra/migrate.sh',
            readOnly: true,
          },
        ],
      });

      expect(putArchive).toHaveBeenCalledWith(expect.anything(), { path: '/' });
      expect(putArchive.mock.invocationCallOrder[0]).toBeLessThan(
        container.start.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
      expect(Buffer.concat(archiveChunks).toString('utf8')).toContain('app/infra/migrate.sh');
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  });
});
