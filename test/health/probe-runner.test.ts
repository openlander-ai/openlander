import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/health/strategies/http.js', () => ({
  httpProbe: vi.fn(),
}));

vi.mock('../../src/health/strategies/tcp.js', () => ({
  tcpProbe: vi.fn(),
}));

vi.mock('../../src/health/strategies/exec.js', () => ({
  execProbe: vi.fn(),
}));

import { createLocalProbeRunner, LocalProbeRunner } from '../../src/health/probe-runner.js';
import { execProbe } from '../../src/health/strategies/exec.js';
import { httpProbe } from '../../src/health/strategies/http.js';
import { tcpProbe } from '../../src/health/strategies/tcp.js';
import type { HealthCheckConfig, ProbeContext } from '../../src/health/types.js';
import type { Docker } from '../../src/pipeline/docker.js';

const mockHttpProbe = httpProbe as ReturnType<typeof vi.fn>;
const mockTcpProbe = tcpProbe as ReturnType<typeof vi.fn>;
const mockExecProbe = execProbe as ReturnType<typeof vi.fn>;

function createConfig(overrides: Partial<HealthCheckConfig> = {}): HealthCheckConfig {
  return {
    strategy: 'http',
    timeoutMs: 5000,
    intervalMs: 10000,
    failureThreshold: 3,
    dockerHealthPolicy: 'ignore',
    ...overrides,
  };
}

function createContext(overrides: Partial<ProbeContext> = {}): ProbeContext {
  return {
    projectId: 'project-123',
    containerId: 'container-123',
    assignedPort: 3000,
    ...overrides,
  };
}

function createInspectResult(
  status?: 'healthy' | 'unhealthy' | 'starting' | 'none',
  running = true,
  restarting = false,
) {
  if (status === undefined) {
    return {
      State: {
        Running: running,
        Restarting: restarting,
        ExitCode: restarting ? 1 : 0,
      },
    } as Awaited<ReturnType<Docker['inspectContainer']>>;
  }

  return {
    State: {
      Running: running,
      Restarting: restarting,
      ExitCode: restarting ? 1 : 0,
      Health: {
        Status: status,
      },
    },
  } as Awaited<ReturnType<Docker['inspectContainer']>>;
}

describe('LocalProbeRunner', () => {
  let mockDocker: Docker;
  let runner: LocalProbeRunner;

  beforeEach(() => {
    mockDocker = {
      inspectContainer: vi.fn(),
      execSimple: vi.fn(),
    } as unknown as Docker;

    runner = new LocalProbeRunner(mockDocker);

    vi.clearAllMocks();
    mockHttpProbe.mockReset();
    mockTcpProbe.mockReset();
    mockExecProbe.mockReset();
  });

  it('returns Docker health result when policy prefers a healthy HEALTHCHECK', async () => {
    (mockDocker.inspectContainer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createInspectResult('healthy'),
    );

    const result = await runner.runProbe(
      createConfig({ dockerHealthPolicy: 'prefer', strategy: 'http', failureThreshold: 1 }),
      createContext(),
    );

    expect(result).toEqual({ healthy: true, source: 'docker' });
    expect(mockDocker.inspectContainer).toHaveBeenCalledWith('container-123');
    expect(httpProbe).not.toHaveBeenCalled();
    expect(tcpProbe).not.toHaveBeenCalled();
    expect(execProbe).not.toHaveBeenCalled();
  });

  it('returns unhealthy Docker health result when HEALTHCHECK reports unhealthy', async () => {
    (mockDocker.inspectContainer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createInspectResult('unhealthy'),
    );

    const result = await runner.runProbe(
      createConfig({ dockerHealthPolicy: 'prefer', strategy: 'http', failureThreshold: 1 }),
      createContext(),
    );

    expect(result.healthy).toBe(false);
    expect(result.source).toBe('docker');
    expect(result.error).toContain('unhealthy');
    expect(httpProbe).not.toHaveBeenCalled();
  });

  it('falls through to http probe when Docker HEALTHCHECK is not defined', async () => {
    (mockDocker.inspectContainer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createInspectResult(),
    );
    mockHttpProbe.mockResolvedValueOnce({
      healthy: true,
      source: 'http',
      responseTimeMs: 12,
    });

    const result = await runner.runProbe(
      createConfig({ dockerHealthPolicy: 'prefer', strategy: 'http', failureThreshold: 1 }),
      createContext({ assignedPort: 8080 }),
    );

    expect(result).toEqual({ healthy: true, source: 'http', responseTimeMs: 12 });
    expect(mockDocker.inspectContainer).toHaveBeenCalledWith('container-123');
    expect(httpProbe).toHaveBeenCalledWith(expect.objectContaining({ strategy: 'http' }), 8080);
  });

  it('returns unhealthy Docker state when the container is restarting', async () => {
    (mockDocker.inspectContainer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createInspectResult(undefined, true, true),
    );

    const result = await runner.runProbe(
      createConfig({ dockerHealthPolicy: 'prefer', strategy: 'http', failureThreshold: 1 }),
      createContext({ assignedPort: 8080 }),
    );

    expect(result).toEqual({
      healthy: false,
      source: 'docker',
      error: 'Container is restarting (exit code: 1)',
    });
    expect(mockDocker.inspectContainer).toHaveBeenCalledWith('container-123');
    expect(httpProbe).not.toHaveBeenCalled();
    expect(tcpProbe).not.toHaveBeenCalled();
  });

  it('falls back to container running state when an HTTP probe has no port', async () => {
    (mockDocker.inspectContainer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createInspectResult(undefined, true),
    );

    const result = await runner.runProbe(
      createConfig({ dockerHealthPolicy: 'prefer', strategy: 'http', failureThreshold: 1 }),
      createContext({ assignedPort: undefined }),
    );

    expect(result).toEqual({ healthy: true, source: 'docker' });
    expect(mockDocker.inspectContainer).toHaveBeenCalledWith('container-123');
    expect(httpProbe).not.toHaveBeenCalled();
    expect(tcpProbe).not.toHaveBeenCalled();
  });

  it('returns container-state failure when a portless HTTP target is not running', async () => {
    (mockDocker.inspectContainer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createInspectResult(undefined, false),
    );

    const result = await runner.runProbe(
      createConfig({ dockerHealthPolicy: 'prefer', strategy: 'http', failureThreshold: 1 }),
      createContext({ assignedPort: undefined }),
    );

    expect(result).toEqual({
      healthy: false,
      source: 'docker',
      error: 'Container is not running',
    });
    expect(httpProbe).not.toHaveBeenCalled();
  });

  it('does not call HTTP probe with port 0 when no port or Docker state is available', async () => {
    const result = await runner.runProbe(
      createConfig({ dockerHealthPolicy: 'ignore', strategy: 'http', failureThreshold: 1 }),
      createContext({ assignedPort: undefined }),
    );

    expect(result).toEqual({
      healthy: false,
      source: 'http',
      error: 'No assigned port available for HTTP health probe',
    });
    expect(mockDocker.inspectContainer).not.toHaveBeenCalled();
    expect(httpProbe).not.toHaveBeenCalled();
  });

  it('does not call TCP probe with port 0 when no port or Docker state is available', async () => {
    const result = await runner.runProbe(
      createConfig({ dockerHealthPolicy: 'ignore', strategy: 'tcp', failureThreshold: 1 }),
      createContext({ assignedPort: undefined }),
    );

    expect(result).toEqual({
      healthy: false,
      source: 'tcp',
      error: 'No assigned port available for TCP health probe',
    });
    expect(mockDocker.inspectContainer).not.toHaveBeenCalled();
    expect(tcpProbe).not.toHaveBeenCalled();
  });

  it('skips Docker inspection when dockerHealthPolicy is ignore', async () => {
    mockHttpProbe.mockResolvedValueOnce({
      healthy: true,
      source: 'http',
      responseTimeMs: 8,
    });

    const result = await runner.runProbe(
      createConfig({ dockerHealthPolicy: 'ignore', strategy: 'http' }),
      createContext({ assignedPort: 9000 }),
    );

    expect(result).toEqual({ healthy: true, source: 'http', responseTimeMs: 8 });
    expect(mockDocker.inspectContainer).not.toHaveBeenCalled();
    expect(httpProbe).toHaveBeenCalledWith(expect.objectContaining({ strategy: 'http' }), 9000);
  });

  it('returns healthy none result without Docker inspection for strategy none with ignore policy', async () => {
    const result = await runner.runProbe(
      createConfig({ dockerHealthPolicy: 'ignore', strategy: 'none' }),
      createContext(),
    );

    expect(result).toEqual({ healthy: true, source: 'none' });
    expect(mockDocker.inspectContainer).not.toHaveBeenCalled();
    expect(httpProbe).not.toHaveBeenCalled();
    expect(tcpProbe).not.toHaveBeenCalled();
    expect(execProbe).not.toHaveBeenCalled();
  });

  it('delegates to httpProbe for http strategy', async () => {
    mockHttpProbe.mockResolvedValueOnce({
      healthy: true,
      source: 'http',
      responseTimeMs: 15,
    });

    const config = createConfig({ strategy: 'http', port: 7000 });
    const result = await runner.runProbe(config, createContext({ assignedPort: 3000 }));

    expect(result).toEqual({ healthy: true, source: 'http', responseTimeMs: 15 });
    expect(httpProbe).toHaveBeenCalledWith(config, 7000);
  });

  it('delegates to tcpProbe for tcp strategy', async () => {
    mockTcpProbe.mockResolvedValueOnce({ healthy: true, source: 'tcp', responseTimeMs: 6 });

    const config = createConfig({ strategy: 'tcp', port: 4321 });
    const result = await runner.runProbe(config, createContext({ assignedPort: 3000 }));

    expect(result).toEqual({ healthy: true, source: 'tcp', responseTimeMs: 6 });
    expect(tcpProbe).toHaveBeenCalledWith(config, 4321);
  });

  it('delegates to execProbe for exec strategy', async () => {
    mockExecProbe.mockResolvedValueOnce({
      healthy: true,
      source: 'exec',
      responseTimeMs: 4,
    });

    const config = createConfig({ strategy: 'exec', command: ['echo', 'ok'] });
    const context = createContext({ containerId: 'container-exec' });
    const result = await runner.runProbe(config, context);

    expect(result).toEqual({ healthy: true, source: 'exec', responseTimeMs: 4 });
    expect(execProbe).toHaveBeenCalledWith('container-exec', config, mockDocker);
  });

  it('retries a failing http probe up to failureThreshold and returns the last failure', async () => {
    mockHttpProbe
      .mockResolvedValueOnce({ healthy: false, source: 'http', error: 'HTTP 500' })
      .mockResolvedValueOnce({ healthy: false, source: 'http', error: 'HTTP 502' })
      .mockResolvedValueOnce({ healthy: false, source: 'http', error: 'HTTP 503' });

    const config = createConfig({ strategy: 'http', failureThreshold: 3, intervalMs: 10000 });
    const result = await runner.runProbe(config, createContext({ assignedPort: 8081 }));

    expect(result).toEqual({ healthy: false, source: 'http', error: 'HTTP 503' });
    expect(httpProbe).toHaveBeenCalledTimes(3);
    expect(mockDocker.inspectContainer).not.toHaveBeenCalled();
  });

  it('returns immediately on first successful retry result', async () => {
    mockHttpProbe
      .mockResolvedValueOnce({ healthy: false, source: 'http', error: 'HTTP 500' })
      .mockResolvedValueOnce({ healthy: true, source: 'http', responseTimeMs: 10 });

    const config = createConfig({ strategy: 'http', failureThreshold: 4 });
    const result = await runner.runProbe(config, createContext({ assignedPort: 8082 }));

    expect(result).toEqual({ healthy: true, source: 'http', responseTimeMs: 10 });
    expect(httpProbe).toHaveBeenCalledTimes(2);
  });

  it('createLocalProbeRunner returns a LocalProbeRunner instance', () => {
    const instance = createLocalProbeRunner(mockDocker);

    expect(instance).toBeInstanceOf(LocalProbeRunner);
  });
});
