import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

import { Docker, type AllContainerInfo } from '../src/pipeline/docker.js';
import { DockerBuildCancelledError } from '../src/errors.js';

const describeDocker = describe;

const mockPing = vi.fn();
const mockListContainers = vi.fn();
const mockBuildImage = vi.fn();
const mockCreateContainer = vi.fn();
const mockGetImage = vi.fn();
const mockGetContainer = vi.fn();
const mockFollowProgress = vi.fn();
const mockGetNetwork = vi.fn();

// Mock dockerode module by injecting into require.cache
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
  };
});

// Inject mock into require.cache before Docker class is instantiated
const dockerodePath = require.resolve('dockerode');
require.cache[dockerodePath] = {
  id: dockerodePath,
  filename: dockerodePath,
  loaded: true,
  exports: mockDockerodeClass,
} as unknown as NodeJS.Module;

// ---------------------------------------------------------------------------
// Test Data
// ---------------------------------------------------------------------------

const createMockContainer = (
  id: string,
  name: string,
  options: {
    image?: string;
    imageId?: string;
    state?: string;
    status?: string;
    ports?: Array<{ IP?: string; PrivatePort?: number; PublicPort?: number; Type?: string }>;
    labels?: Record<string, string>;
    created?: number;
    mounts?: Array<{
      Type: string;
      Name?: string;
      Source: string;
      Destination: string;
      Driver?: string;
      Mode?: string;
      RW?: boolean;
      Propagation?: string;
    }>;
  } = {},
) => ({
  Id: id,
  Names: [`/${name}`],
  Image: options.image ?? 'test-image:latest',
  ImageID: options.imageId,
  State: options.state ?? 'running',
  Status: options.status ?? 'Up 2 hours',
  Ports: options.ports ?? [],
  Labels: options.labels ?? {},
  Created: options.created ?? Date.now(),
  Mounts: options.mounts ?? [],
});

const resetDockerodeMocks = () => {
  mockPing.mockReset().mockResolvedValue('OK');
  mockListContainers.mockReset().mockResolvedValue([]);
  mockBuildImage.mockReset();
  mockCreateContainer.mockReset();
  mockGetImage.mockReset();
  mockGetContainer.mockReset();
  mockFollowProgress.mockReset();
  mockGetNetwork.mockReset().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({}),
  });
};

const writeEvidence = (relativePath: string, content: string): void => {
  mkdirSync('.sisyphus/evidence', { recursive: true });
  writeFileSync(relativePath, content, 'utf8');
};

type MockContainerHandleOptions = {
  id?: string;
  startError?: Error;
  stopError?: Error;
  removeError?: Error;
  logsError?: Error;
  logsOutput?: string | Buffer;
  inspectResponses?: Array<{
    RestartCount?: number;
    State: {
      Running: boolean;
      Restarting?: boolean;
      ExitCode: number;
      Health?: { Status?: string };
    };
  }>;
};

const createDockerContainerHandle = (options: MockContainerHandleOptions = {}) => {
  const inspectResponses = options.inspectResponses ?? [];
  let inspectIndex = 0;

  return {
    id: options.id ?? 'container-123',
    start: vi.fn(async () => {
      if (options.startError) throw options.startError;
    }),
    stop: vi.fn(async () => {
      if (options.stopError) throw options.stopError;
    }),
    remove: vi.fn(async () => {
      if (options.removeError) throw options.removeError;
    }),
    logs: vi.fn(async () => {
      if (options.logsError) throw options.logsError;
      const output = options.logsOutput ?? 'container-log-line';
      return Buffer.isBuffer(output) ? output : Buffer.from(output);
    }),
    inspect: vi.fn(async () => {
      const next = inspectResponses[inspectIndex] ??
        inspectResponses[inspectResponses.length - 1] ?? {
          State: { Running: true, Restarting: false, ExitCode: 0 },
        };
      inspectIndex += 1;
      return next;
    }),
  };
};

describeDocker('Docker core operations', () => {
  beforeEach(() => {
    resetDockerodeMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns true from ping when dockerode ping succeeds', async () => {
    mockPing.mockResolvedValueOnce('OK');
    const docker = new Docker();

    await expect(docker.ping()).resolves.toBe(true);
  });

  it('returns false from ping when dockerode ping fails', async () => {
    mockPing.mockRejectedValueOnce(new Error('socket unavailable'));
    const docker = new Docker();

    await expect(docker.ping()).resolves.toBe(false);
  });

  it('throws on ensureRunning when daemon is unreachable', async () => {
    mockPing.mockRejectedValueOnce(new Error('daemon down'));
    const docker = new Docker();

    await expect(docker.ensureRunning()).rejects.toMatchObject({ name: 'DockerNotRunningError' });
  });

  it('builds image and forwards build events to onProgress', async () => {
    const stream = { stream: true } as unknown as NodeJS.ReadableStream;
    const onProgress = vi.fn();

    mockBuildImage.mockResolvedValueOnce(stream);
    mockFollowProgress.mockImplementationOnce(
      (
        _stream: NodeJS.ReadableStream,
        done: (err: Error | null) => void,
        onEvent: (event: { stream?: string; error?: string }) => void,
      ) => {
        onEvent({ stream: 'Step 1/3' });
        onEvent({ stream: 'Step 2/3' });
        done(null);
      },
    );

    const docker = new Docker();
    await expect(
      docker.buildImage('/tmp/app', 'my-image:latest', {
        noCache: true,
        buildArgs: { NODE_ENV: 'production' },
        onProgress,
      }),
    ).resolves.toBeUndefined();

    expect(mockBuildImage).toHaveBeenCalledWith(
      { context: '/tmp/app', src: ['.'] },
      {
        t: 'my-image:latest',
        version: '2',
        nocache: true,
        buildargs: { NODE_ENV: 'production' },
      },
    );
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it('wraps buildImage startup errors as DockerBuildError', async () => {
    mockBuildImage.mockRejectedValueOnce(new Error('invalid Dockerfile'));
    const docker = new Docker();

    const error = await docker.buildImage('/tmp/app', 'broken:latest').catch((err: unknown) => err);

    expect(error).toMatchObject({ name: 'DockerBuildError' });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Docker build failed for broken:latest');
    expect((error as { details?: { buildLog?: string } }).details?.buildLog).toContain(
      'invalid Dockerfile',
    );
  });

  it('treats streamed build error events as DockerBuildError', async () => {
    const stream = { stream: true } as unknown as NodeJS.ReadableStream;
    mockBuildImage.mockResolvedValueOnce(stream);
    mockFollowProgress.mockImplementationOnce(
      (
        _stream: NodeJS.ReadableStream,
        done: (err: Error | null) => void,
        onEvent: (event: { stream?: string; error?: string }) => void,
      ) => {
        onEvent({ stream: 'Step 1/3' });
        onEvent({ error: 'failed to solve: missing package' });
        done(null);
      },
    );

    const docker = new Docker();
    const error = await docker.buildImage('/tmp/app', 'broken:latest').catch((err: unknown) => err);

    expect(error).toMatchObject({ name: 'DockerBuildError' });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Docker build failed for broken:latest');
    expect((error as { details?: { buildLog?: string } }).details?.buildLog).toContain(
      'missing package',
    );
  });

  it('creates and starts a container with expected config', async () => {
    const container = createDockerContainerHandle({ id: 'container-run-id' });
    mockCreateContainer.mockResolvedValueOnce(container);

    const docker = new Docker('/var/run/docker.sock', 'traefik-web');
    const id = await docker.runContainer({
      imageTag: 'example:v1',
      name: 'ol-demo',
      port: 18080,
      containerPort: 3000,
      envVars: { NODE_ENV: 'production', API_KEY: 'abc' },
      traefikLabels: { 'traefik.enable': 'true' },
    });

    expect(id).toBe('container-run-id');
    expect(container.start).toHaveBeenCalledTimes(1);
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'example:v1',
        name: 'ol-demo',
        Env: expect.arrayContaining(['NODE_ENV=production', 'API_KEY=abc']),
        Labels: expect.objectContaining({
          'openlander.managed': 'true',
          'openlander.project': 'demo',
          'traefik.enable': 'true',
        }),
        ExposedPorts: { '3000/tcp': {} },
        HostConfig: expect.objectContaining({
          PortBindings: { '3000/tcp': [{ HostPort: '18080' }] },
          NetworkMode: 'traefik-web',
        }),
      }),
    );
  });

  it('Alias set at creation time when NetworkMode = shared network', async () => {
    const container = createDockerContainerHandle({ id: 'container-shared-id' });
    mockCreateContainer.mockResolvedValueOnce(container);

    const docker = new Docker('/var/run/docker.sock', 'openlander');
    await docker.runContainer({
      imageTag: 'mono-api:v1',
      name: 'ol-mono-api',
      port: 19090,
      containerPort: 3000,
      envVars: { NODE_ENV: 'production' },
      traefikLabels: {},
    });

    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          NetworkMode: 'openlander',
        }),
        NetworkingConfig: {
          EndpointsConfig: {
            openlander: {
              Aliases: ['mono-api'],
            },
          },
        },
      }),
    );

    writeEvidence(
      '.sisyphus/evidence/task-1-alias-creation.txt',
      'Verified runContainer passes NetworkingConfig.EndpointsConfig.openlander.Aliases=["mono-api"] when NetworkMode is openlander.',
    );
  });

  it('ensureSharedNetworkAttachment silently returns when container is already connected', async () => {
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('endpoint with name already exists in network openlander'));
    const disconnect = vi.fn().mockResolvedValue(undefined);

    mockGetNetwork.mockImplementation((networkName: string) => {
      if (networkName === 'openlander') {
        return { connect, disconnect, inspect: vi.fn().mockResolvedValue({}) };
      }
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        inspect: vi.fn().mockRejectedValue(new Error('no such network')),
      };
    });

    const docker = new Docker('/var/run/docker.sock', 'traefik-web');
    await docker.ensureSharedNetworkAttachment('container-reconcile-id', 'mono-worker');

    expect(connect).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledWith({
      Container: 'container-reconcile-id',
      EndpointConfig: { Aliases: ['mono-worker'] },
    });
    expect(disconnect).not.toHaveBeenCalled();

    writeEvidence(
      '.sisyphus/evidence/task-1-alias-reconcile.txt',
      'Verified ensureSharedNetworkAttachment silently returns on "already exists" without disconnect or reconnect.',
    );
  });

  it('uses custom restartPolicy when provided, defaults to MaximumRetryCount: 5 otherwise', async () => {
    const container1 = createDockerContainerHandle({ id: 'container-custom-restart' });
    const container2 = createDockerContainerHandle({ id: 'container-default-restart' });
    mockCreateContainer.mockResolvedValueOnce(container1).mockResolvedValueOnce(container2);

    const docker = new Docker('/var/run/docker.sock', 'traefik-web');

    // Test with custom restart policy (monorepo case)
    await docker.runContainer({
      imageTag: 'mono-api:v1',
      name: 'ol-mono-api',
      port: 19090,
      containerPort: 3000,
      envVars: { NODE_ENV: 'production' },
      traefikLabels: {},
      restartPolicy: { Name: 'on-failure', MaximumRetryCount: 15 },
    });

    expect(mockCreateContainer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 15 },
        }),
      }),
    );

    // Test with default restart policy
    await docker.runContainer({
      imageTag: 'app:v1',
      name: 'ol-app',
      port: 18080,
      containerPort: 3000,
      envVars: { NODE_ENV: 'production' },
      traefikLabels: {},
    });

    expect(mockCreateContainer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
        }),
      }),
    );

    writeEvidence(
      '.sisyphus/evidence/task-2-restart-policy.txt',
      'Verified runContainer uses custom restartPolicy when provided (MaximumRetryCount: 15 for monorepo), defaults to MaximumRetryCount: 5 otherwise.',
    );
  });

  it('reads first exposed image port and handles invalid/missing values', async () => {
    const imageA = {
      inspect: vi
        .fn()
        .mockResolvedValue({ Config: { ExposedPorts: { '8080/tcp': {}, '80/tcp': {} } } }),
    };
    const imageB = {
      inspect: vi.fn().mockResolvedValue({ Config: { ExposedPorts: { 'abc/tcp': {} } } }),
    };
    const imageC = { inspect: vi.fn().mockRejectedValue(new Error('not found')) };
    mockGetImage
      .mockReturnValueOnce(imageA)
      .mockReturnValueOnce(imageB)
      .mockReturnValueOnce(imageC)
      .mockReturnValueOnce({
        inspect: vi.fn().mockResolvedValue({ Config: { ExposedPorts: {} } }),
      });

    const docker = new Docker();

    await expect(docker.getImageExposedPort('a:latest')).resolves.toBe(8080);
    await expect(docker.getImageExposedPort('b:latest')).resolves.toBeUndefined();
    await expect(docker.getImageExposedPort('c:latest')).resolves.toBeUndefined();
    await expect(docker.getImageExposedPort('d:latest')).resolves.toBeUndefined();
  });

  it('normalizes container lifecycle errors for start/stop/remove/logs', async () => {
    const missing = createDockerContainerHandle({
      stopError: new Error('No such container: missing-stop'),
      startError: new Error('No such container: missing-start'),
      removeError: new Error('No such container: missing-remove'),
      logsError: new Error('No such container: missing-logs'),
    });
    const alreadyStopped = createDockerContainerHandle({
      stopError: new Error('container is not running'),
    });
    const alreadyStarted = createDockerContainerHandle({
      startError: new Error('container is already running'),
    });
    const removeFailure = createDockerContainerHandle({
      removeError: new Error('permission denied'),
    });

    mockGetContainer
      .mockReturnValueOnce(missing)
      .mockReturnValueOnce(alreadyStopped)
      .mockReturnValueOnce(missing)
      .mockReturnValueOnce(alreadyStarted)
      .mockReturnValueOnce(missing)
      .mockReturnValueOnce(removeFailure)
      .mockReturnValueOnce(missing);

    const docker = new Docker();

    await expect(docker.stopContainer('missing')).rejects.toMatchObject({
      name: 'ContainerNotFoundError',
    });
    await expect(docker.stopContainer('already-stopped')).resolves.toBeUndefined();
    await expect(docker.startContainer('missing')).rejects.toMatchObject({
      name: 'ContainerNotFoundError',
    });
    await expect(docker.startContainer('already-started')).resolves.toBeUndefined();
    await expect(docker.removeContainer('missing')).resolves.toBeUndefined();
    await expect(docker.removeContainer('remove-failure')).rejects.toThrow('permission denied');
    await expect(docker.getLogs('missing')).rejects.toMatchObject({
      name: 'ContainerNotFoundError',
    });
  });

  it('returns container logs with caller-provided tail value', async () => {
    const container = createDockerContainerHandle({ logsOutput: 'line-a\nline-b' });
    mockGetContainer.mockReturnValueOnce(container);
    const docker = new Docker();

    await expect(docker.getLogs('abc123', 25)).resolves.toBe('line-a\nline-b');
    expect(container.logs).toHaveBeenCalledWith({
      stdout: true,
      stderr: true,
      tail: 25,
      follow: false,
    });
  });

  it('requests Docker log timestamps when enabled by the caller', async () => {
    const container = createDockerContainerHandle({
      logsOutput: '2026-05-08T22:17:23.351234567Z line-a\n',
    });
    mockGetContainer.mockReturnValueOnce(container);
    const docker = new Docker();

    await expect(docker.getLogs('abc123', 25, { timestamps: true })).resolves.toBe(
      '2026-05-08T22:17:23.351234567Z line-a\n',
    );
    expect(container.logs).toHaveBeenCalledWith({
      stdout: true,
      stderr: true,
      tail: 25,
      follow: false,
      timestamps: true,
    });
  });

  it('strips docker multiplex frame headers from logs buffer', async () => {
    const buildFrame = (streamType: 1 | 2, text: string): Buffer => {
      const payload = Buffer.from(text, 'utf8');
      const frame = Buffer.alloc(8 + payload.length);
      frame[0] = streamType;
      frame.writeUInt32BE(payload.length, 4);
      payload.copy(frame, 8);
      return frame;
    };

    const container = createDockerContainerHandle({
      logsOutput: Buffer.concat([buildFrame(1, 'out line\n'), buildFrame(2, 'err line\n')]),
    });
    mockGetContainer.mockReturnValueOnce(container);
    const docker = new Docker();

    await expect(docker.getLogs('abc123')).resolves.toBe('out line\nerr line\n');
  });

  it('returns plain text logs when buffer is not multiplexed', async () => {
    const container = createDockerContainerHandle({ logsOutput: 'plain-line\n' });
    mockGetContainer.mockReturnValueOnce(container);
    const docker = new Docker();

    await expect(docker.getLogs('abc123')).resolves.toBe('plain-line\n');
  });

  it('returns empty string for empty logs buffer', async () => {
    const container = createDockerContainerHandle({ logsOutput: Buffer.alloc(0) });
    mockGetContainer.mockReturnValueOnce(container);
    const docker = new Docker();

    await expect(docker.getLogs('abc123')).resolves.toBe('');
  });

  it('maps waitForHealthy crash-loop and success paths', async () => {
    const restarting = createDockerContainerHandle({
      inspectResponses: [{ State: { Running: false, Restarting: true, ExitCode: 137 } }],
    });
    const exited = createDockerContainerHandle({
      inspectResponses: [{ State: { Running: false, Restarting: false, ExitCode: 2 } }],
    });
    const healthy = createDockerContainerHandle({
      inspectResponses: [
        { State: { Running: true, Restarting: false, ExitCode: 0, Health: { Status: 'healthy' } } },
      ],
    });
    const missing = {
      inspect: vi.fn(async () => {
        throw new Error('No such container');
      }),
    };

    mockGetContainer
      .mockReturnValueOnce(restarting)
      .mockReturnValueOnce(exited)
      .mockReturnValueOnce(healthy)
      .mockReturnValueOnce(missing);

    const docker = new Docker();

    await expect(docker.waitForHealthy('restarting', 10)).resolves.toMatchObject({
      healthy: false,
      exitCode: 137,
      error: expect.stringContaining('restart loop'),
    });
    await expect(docker.waitForHealthy('exited', 10)).resolves.toMatchObject({
      healthy: false,
      exitCode: 2,
      error: 'Container exited with code 2',
    });
    await expect(docker.waitForHealthy('healthy', 10)).resolves.toEqual({ healthy: true });
    await expect(docker.waitForHealthy('missing', 10)).resolves.toEqual({
      healthy: false,
      error: 'Container not found',
    });
  });

  it('waits for no-healthcheck containers to stay stable before success', async () => {
    vi.useFakeTimers();
    const runningNoHealth = createDockerContainerHandle({
      inspectResponses: [
        { RestartCount: 0, State: { Running: true, Restarting: false, ExitCode: 0 } },
        { RestartCount: 0, State: { Running: true, Restarting: false, ExitCode: 0 } },
        { RestartCount: 0, State: { Running: true, Restarting: false, ExitCode: 0 } },
        { RestartCount: 0, State: { Running: true, Restarting: false, ExitCode: 0 } },
      ],
    });
    mockGetContainer.mockReturnValue(runningNoHealth);

    const docker = new Docker();
    const result = docker.waitForHealthy('running-no-health', 6000);
    await vi.advanceTimersByTimeAsync(6000);

    await expect(result).resolves.toEqual({ healthy: true });
  });

  it('detects no-healthcheck restart loops before declaring success', async () => {
    vi.useFakeTimers();
    const runningThenRestarting = createDockerContainerHandle({
      inspectResponses: [
        { RestartCount: 0, State: { Running: true, Restarting: false, ExitCode: 0 } },
        { RestartCount: 1, State: { Running: false, Restarting: true, ExitCode: 1 } },
      ],
    });
    mockGetContainer.mockReturnValue(runningThenRestarting);

    const docker = new Docker();
    const result = docker.waitForHealthy('running-then-restarting', 6000);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toMatchObject({
      healthy: false,
      exitCode: 1,
      error: expect.stringContaining('restart loop'),
    });
  });

  it('returns timeout checks from waitForHealthy final inspection fallback', async () => {
    const finalExiting = createDockerContainerHandle({
      inspectResponses: [{ State: { Running: false, Restarting: false, ExitCode: 0 } }],
    });
    const finalRestarting = createDockerContainerHandle({
      inspectResponses: [{ State: { Running: false, Restarting: true, ExitCode: 125 } }],
    });
    const finalUnhealthy = createDockerContainerHandle({
      inspectResponses: [
        {
          State: { Running: true, Restarting: false, ExitCode: 0, Health: { Status: 'unhealthy' } },
        },
      ],
    });
    const finalError = {
      inspect: vi.fn(async () => {
        throw new Error('timeout inspect error');
      }),
    };

    mockGetContainer
      .mockReturnValueOnce(finalExiting)
      .mockReturnValueOnce(finalRestarting)
      .mockReturnValueOnce(finalUnhealthy)
      .mockReturnValueOnce(finalError);

    const docker = new Docker();

    await expect(docker.waitForHealthy('timeout-no-health', 0)).resolves.toEqual({
      healthy: false,
      exitCode: 0,
      error: 'Container did not become healthy within timeout',
    });
    await expect(docker.waitForHealthy('timeout-restart', 0)).resolves.toMatchObject({
      healthy: false,
      exitCode: 125,
      error: expect.stringContaining('entered restart loop'),
    });
    await expect(docker.waitForHealthy('timeout-unhealthy', 0)).resolves.toEqual({
      healthy: false,
      exitCode: 0,
      error: 'Container healthcheck is unhealthy',
    });
    await expect(docker.waitForHealthy('timeout-error', 0)).resolves.toEqual({
      healthy: false,
      error: 'Container check timed out',
    });
  });

  it('maps managed container list shape and exposes dockerode client', async () => {
    mockListContainers.mockResolvedValueOnce([
      {
        Id: 'abc123',
        Names: ['/ol-app'],
        State: 'running',
        Ports: [{ PublicPort: 18080 }],
        Image: 'ol-app:latest',
      },
      {
        Id: 'def456',
        Names: [],
        State: 'exited',
        Ports: [],
        Image: 'ol-worker:latest',
      },
    ]);

    const docker = new Docker();
    const managed = await docker.listManagedContainers();

    expect(mockListContainers).toHaveBeenCalledWith(
      expect.objectContaining({
        all: true,
        filters: { label: ['openlander.managed=true'] },
        abortSignal: expect.any(AbortSignal),
      }),
    );
    expect(managed).toEqual([
      {
        id: 'abc123',
        name: 'ol-app',
        status: 'running',
        port: 18080,
        imageTag: 'ol-app:latest',
        labels: {},
      },
      {
        id: 'def456',
        name: 'unknown',
        status: 'exited',
        port: undefined,
        imageTag: 'ol-worker:latest',
        labels: {},
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// listAllContainers Tests
// ---------------------------------------------------------------------------

describeDocker('listAllContainers', () => {
  let docker: Docker;

  beforeEach(() => {
    vi.clearAllMocks();
    docker = new Docker();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });
  it('returns all containers without label filter', async () => {
    const mockContainers = [
      createMockContainer('abc123', 'managed-app', {
        labels: { 'openlander.managed': 'true' },
      }),
      createMockContainer('def456', 'external-app', {
        labels: {},
      }),
    ];

    mockListContainers.mockResolvedValueOnce(mockContainers);

    const result = await docker.listAllContainers();

    expect(mockListContainers).toHaveBeenCalledWith(
      expect.objectContaining({ all: true, abortSignal: expect.any(AbortSignal) }),
    );
    expect(result).toHaveLength(2);
  });

  it('marks managed containers correctly with managedByOpenLander field', async () => {
    const mockContainers = [
      createMockContainer('abc123', 'managed-app', {
        labels: { 'openlander.managed': 'true' },
      }),
      createMockContainer('def456', 'external-app', {
        labels: {},
      }),
      createMockContainer('ghi789', 'another-managed', {
        labels: { 'openlander.managed': 'true', other: 'value' },
      }),
    ];

    mockListContainers.mockResolvedValueOnce(mockContainers);

    const result = await docker.listAllContainers();

    expect(result[0].managedByOpenLander).toBe(true);
    expect(result[1].managedByOpenLander).toBe(false);
    expect(result[2].managedByOpenLander).toBe(true);
  });

  it('identifies compose groups with composeProject field', async () => {
    const mockContainers = [
      createMockContainer('abc123', 'compose-app-web', {
        labels: { 'com.docker.compose.project': 'myproject' },
      }),
      createMockContainer('def456', 'compose-app-db', {
        labels: { 'com.docker.compose.project': 'myproject' },
      }),
      createMockContainer('ghi789', 'standalone-app', {
        labels: {},
      }),
    ];

    mockListContainers.mockResolvedValueOnce(mockContainers);

    const result = await docker.listAllContainers();

    expect(result[0].composeProject).toBe('myproject');
    expect(result[1].composeProject).toBe('myproject');
    expect(result[2].composeProject).toBeNull();
  });

  it('returns empty array when no containers exist', async () => {
    mockListContainers.mockResolvedValueOnce([]);

    const result = await docker.listAllContainers();

    expect(result).toEqual([]);
  });

  it('returns empty array when Docker API throws an error', async () => {
    mockListContainers.mockRejectedValueOnce(new Error('Docker daemon not running'));

    const result = await docker.listAllContainers();

    expect(result).toEqual([]);
  });

  it('rethrows list failures when failOnError is requested', async () => {
    const error = new Error('Docker daemon not running');
    mockListContainers.mockRejectedValueOnce(error);

    await expect(docker.listAllContainers(undefined, { failOnError: true })).rejects.toBe(error);
  });

  it('maps container fields correctly', async () => {
    const mockContainer = createMockContainer('abc123def456', 'my-container', {
      image: 'nginx:1.21',
      imageId: 'sha256:nginx',
      state: 'running',
      status: 'Up 3 days',
      ports: [{ IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }],
      labels: { 'openlander.managed': 'true', custom: 'label' },
      created: 1700000000,
      mounts: [
        {
          Type: 'volume',
          Name: 'nginx-data',
          Source: '/var/lib/docker/volumes/nginx-data/_data',
          Destination: '/usr/share/nginx/html',
          Driver: 'local',
          Mode: 'rw',
          RW: true,
          Propagation: '',
        },
      ],
    });

    mockListContainers.mockResolvedValueOnce([mockContainer]);

    const result = await docker.listAllContainers();
    const container = result[0];

    expect(container.id).toBe('abc123def456');
    expect(container.name).toBe('my-container');
    expect(container.image).toBe('nginx:1.21');
    expect(container.imageId).toBe('sha256:nginx');
    expect(container.state).toBe('running');
    expect(container.status).toBe('Up 3 days');
    expect(container.ports).toEqual([
      { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
    ]);
    expect(container.mounts).toEqual([
      {
        type: 'volume',
        name: 'nginx-data',
        source: '/var/lib/docker/volumes/nginx-data/_data',
        destination: '/usr/share/nginx/html',
        driver: 'local',
        mode: 'rw',
        readOnly: false,
        propagation: null,
      },
    ]);
    expect(container.labels).toEqual({ 'openlander.managed': 'true', custom: 'label' });
    expect(container.managedByOpenLander).toBe(true);
    expect(container.created).toBe(1700000000);
  });

  it('handles containers with empty Labels', async () => {
    const mockContainer = createMockContainer('abc123', 'test', {
      labels: {},
    });
    // Simulate dockerode returning undefined Labels
    (mockContainer as { Labels: Record<string, string> | undefined }).Labels = undefined;

    mockListContainers.mockResolvedValueOnce([mockContainer]);

    const result = await docker.listAllContainers();

    expect(result[0].labels).toEqual({});
    expect(result[0].managedByOpenLander).toBe(false);
    expect(result[0].composeProject).toBeNull();
  });

  it('handles containers with empty Names array', async () => {
    const mockContainer = createMockContainer('abc123', 'test');
    (mockContainer as { Names: string[] }).Names = [];

    mockListContainers.mockResolvedValueOnce([mockContainer]);

    const result = await docker.listAllContainers();

    expect(result[0].name).toBe('unknown');
  });

  it('handles mixed managed/unmanaged containers with compose projects', async () => {
    const mockContainers = [
      // OpenLander managed container
      createMockContainer('ol-001', 'frontend', {
        image: 'myapp-frontend:latest',
        state: 'running',
        ports: [{ PublicPort: 10001 }],
        labels: { 'openlander.managed': 'true', 'openlander.project': 'frontend' },
      }),
      // External compose project container
      createMockContainer('ext-001', 'nginx-proxy', {
        image: 'nginx:alpine',
        state: 'running',
        ports: [{ PublicPort: 80 }, { PublicPort: 443 }],
        labels: { 'com.docker.compose.project': 'webstack' },
      }),
      // Another external compose project
      createMockContainer('ext-002', 'postgres-db', {
        image: 'postgres:15',
        state: 'running',
        ports: [{ PublicPort: 5432 }],
        labels: { 'com.docker.compose.project': 'webstack' },
      }),
      // Standalone container
      createMockContainer('std-001', 'my-test-server', {
        image: 'node:18',
        state: 'exited',
        status: 'Exited (0) 2 hours ago',
        labels: {},
      }),
    ];

    mockListContainers.mockResolvedValueOnce(mockContainers);

    const result = await docker.listAllContainers();

    expect(result).toHaveLength(4);

    // Verify managed status
    const managed = result.filter((c) => c.managedByOpenLander);
    const unmanaged = result.filter((c) => !c.managedByOpenLander);
    expect(managed).toHaveLength(1);
    expect(unmanaged).toHaveLength(3);

    // Verify compose project grouping
    const webstackContainers = result.filter((c) => c.composeProject === 'webstack');
    expect(webstackContainers).toHaveLength(2);

    // Verify state
    const running = result.filter((c) => c.state === 'running');
    const exited = result.filter((c) => c.state === 'exited');
    expect(running).toHaveLength(3);
    expect(exited).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// cancelBuild Tests (BUG-014)
// ---------------------------------------------------------------------------

describeDocker('cancelBuild', () => {
  beforeEach(() => {
    resetDockerodeMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('BUG-014: cancelBuild destroys stream and removes from activeBuilds', async () => {
    const destroyFn = vi.fn();
    const stream = { stream: true, destroy: destroyFn } as unknown as NodeJS.ReadableStream;
    mockBuildImage.mockResolvedValueOnce(stream);

    let resolveBuild: (() => void) | undefined;
    mockFollowProgress.mockImplementationOnce(
      (_stream: NodeJS.ReadableStream, done: (err: Error | null) => void) => {
        resolveBuild = () => done(null);
      },
    );

    const docker = new Docker();
    const buildPromise = docker.buildImage('/tmp/app', 'test:latest', {
      projectId: 'proj-123',
    });

    await new Promise((r) => setTimeout(r, 10));

    const cancelled = docker.cancelBuild('proj-123');
    expect(cancelled).toBe(true);
    expect(destroyFn).toHaveBeenCalledTimes(1);

    expect(docker.cancelBuild('proj-123')).toBe(false);

    resolveBuild?.();
    await buildPromise.catch(() => {});

    writeEvidence(
      '.sisyphus/evidence/task-13-stop-cancels-build.txt',
      [
        'BUG-014 regression: cancelBuild destroys the active stream and returns true.',
        'Second call returns false (stream already removed).',
        'destroy() called exactly once on the build stream.',
      ].join('\n'),
    );
  });

  it('rejects the active build with DockerBuildCancelledError after cancelBuild', async () => {
    const destroyFn = vi.fn();
    const stream = { stream: true, destroy: destroyFn } as unknown as NodeJS.ReadableStream;
    mockBuildImage.mockResolvedValueOnce(stream);

    let completeBuild: ((err: Error | null) => void) | undefined;
    mockFollowProgress.mockImplementationOnce(
      (_stream: NodeJS.ReadableStream, done: (err: Error | null) => void) => {
        completeBuild = done;
      },
    );

    const docker = new Docker();
    const buildPromise = docker.buildImage('/tmp/app', 'test:latest', {
      projectId: 'proj-cancelled',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(docker.cancelBuild('proj-cancelled')).toBe(true);
    completeBuild?.(new Error('stream destroyed'));

    await expect(buildPromise).rejects.toBeInstanceOf(DockerBuildCancelledError);
    expect(destroyFn).toHaveBeenCalledTimes(1);
  });

  it('does not leak a cancelled marker into a newer build with the same project id', async () => {
    const firstStream = {
      stream: true,
      destroy: vi.fn(),
    } as unknown as NodeJS.ReadableStream;
    const secondStream = {
      stream: true,
      destroy: vi.fn(),
    } as unknown as NodeJS.ReadableStream;
    mockBuildImage.mockResolvedValueOnce(firstStream).mockResolvedValueOnce(secondStream);

    const completeBuilds: Array<(err: Error | null) => void> = [];
    mockFollowProgress.mockImplementation(
      (_stream: NodeJS.ReadableStream, done: (err: Error | null) => void) => {
        completeBuilds.push(done);
      },
    );

    const docker = new Docker();
    const firstBuild = docker.buildImage('/tmp/app', 'test:first', {
      projectId: 'proj-race',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(docker.cancelBuild('proj-race')).toBe(true);

    const secondBuild = docker.buildImage('/tmp/app', 'test:second', {
      projectId: 'proj-race',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    completeBuilds[1]?.(null);
    await expect(secondBuild).resolves.toBeUndefined();

    completeBuilds[0]?.(new Error('stream destroyed'));
    await expect(firstBuild).rejects.toBeInstanceOf(DockerBuildCancelledError);
  });

  it('cancelBuild returns false when no active build exists', () => {
    const docker = new Docker();
    expect(docker.cancelBuild('nonexistent')).toBe(false);
  });

  it('buildImage cleans up activeBuilds on successful completion', async () => {
    const destroyFn = vi.fn();
    const stream = { stream: true, destroy: destroyFn } as unknown as NodeJS.ReadableStream;
    mockBuildImage.mockResolvedValueOnce(stream);
    mockFollowProgress.mockImplementationOnce(
      (_stream: NodeJS.ReadableStream, done: (err: Error | null) => void) => {
        done(null);
      },
    );

    const docker = new Docker();
    await docker.buildImage('/tmp/app', 'test:latest', { projectId: 'proj-cleanup' });

    expect(docker.cancelBuild('proj-cleanup')).toBe(false);
  });

  it('buildImage cleans up activeBuilds on build failure', async () => {
    const destroyFn = vi.fn();
    const stream = { stream: true, destroy: destroyFn } as unknown as NodeJS.ReadableStream;
    mockBuildImage.mockResolvedValueOnce(stream);
    mockFollowProgress.mockImplementationOnce(
      (_stream: NodeJS.ReadableStream, done: (err: Error | null) => void) => {
        done(new Error('build exploded'));
      },
    );

    const docker = new Docker();
    await docker.buildImage('/tmp/app', 'test:latest', { projectId: 'proj-fail' }).catch(() => {});

    expect(docker.cancelBuild('proj-fail')).toBe(false);
  });

  it('buildImage without projectId does not track in activeBuilds', async () => {
    const stream = { stream: true } as unknown as NodeJS.ReadableStream;
    mockBuildImage.mockResolvedValueOnce(stream);
    mockFollowProgress.mockImplementationOnce(
      (_stream: NodeJS.ReadableStream, done: (err: Error | null) => void) => {
        done(null);
      },
    );

    const docker = new Docker();
    await docker.buildImage('/tmp/app', 'test:latest');

    expect(docker.cancelBuild('any-id')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Type Export Tests
// ---------------------------------------------------------------------------

describeDocker('AllContainerInfo type', () => {
  it('exports AllContainerInfo interface', () => {
    const containerInfo: AllContainerInfo = {
      id: 'test-id',
      name: 'test-name',
      image: 'test-image',
      state: 'running',
      status: 'Up 1 hour',
      ports: [],
      labels: {},
      managedByOpenLander: false,
      composeProject: null,
      created: Date.now(),
    };
    expect(containerInfo).toBeDefined();
  });
});
