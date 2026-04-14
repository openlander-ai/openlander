import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execProbe } from '../../../src/health/strategies/exec.js';
import type { HealthCheckConfig } from '../../../src/health/types.js';
import type { Docker } from '../../../src/pipeline/docker.js';

describe('execProbe', () => {
  let mockDocker: Docker;

  beforeEach(() => {
    mockDocker = {
      execSimple: vi.fn(),
    } as unknown as Docker;
    vi.clearAllMocks();
  });

  it('returns { healthy: true, source: "none" } when config.command is undefined', async () => {
    const config: HealthCheckConfig = {
      strategy: 'exec',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
      command: undefined,
    };

    const result = await execProbe('container-123', config, mockDocker);

    expect(result.healthy).toBe(true);
    expect(result.source).toBe('none');
    expect(result.error).toBeUndefined();
    expect(mockDocker.execSimple).not.toHaveBeenCalled();
  });

  it('returns { healthy: true, source: "none" } when config.command is empty array', async () => {
    const config: HealthCheckConfig = {
      strategy: 'exec',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
      command: [],
    };

    const result = await execProbe('container-123', config, mockDocker);

    expect(result.healthy).toBe(true);
    expect(result.source).toBe('none');
    expect(result.error).toBeUndefined();
    expect(mockDocker.execSimple).not.toHaveBeenCalled();
  });

  it('returns { healthy: true, source: "exec" } when execSimple returns exit code 0', async () => {
    const config: HealthCheckConfig = {
      strategy: 'exec',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
      command: ['test', '-f', '/app/ready'],
    };

    (mockDocker.execSimple as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });

    const result = await execProbe('container-123', config, mockDocker);

    expect(result.healthy).toBe(true);
    expect(result.source).toBe('exec');
    expect(result.error).toBeUndefined();
    expect(result.responseTimeMs).toBeDefined();
    expect(typeof result.responseTimeMs).toBe('number');
    expect(mockDocker.execSimple).toHaveBeenCalledWith('container-123', [
      'test',
      '-f',
      '/app/ready',
    ]);
  });

  it('returns { healthy: false, source: "exec", error includes "exit code 1" } when execSimple returns exit code 1', async () => {
    const config: HealthCheckConfig = {
      strategy: 'exec',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
      command: ['test', '-f', '/app/ready'],
    };

    (mockDocker.execSimple as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'File not found',
    });

    const result = await execProbe('container-123', config, mockDocker);

    expect(result.healthy).toBe(false);
    expect(result.source).toBe('exec');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('exit code 1');
    expect(mockDocker.execSimple).toHaveBeenCalledWith('container-123', [
      'test',
      '-f',
      '/app/ready',
    ]);
  });

  it('returns { healthy: false, source: "exec", error includes "exit code 2" } when execSimple returns exit code 2', async () => {
    const config: HealthCheckConfig = {
      strategy: 'exec',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
      command: ['curl', 'http://localhost:3000/health'],
    };

    (mockDocker.execSimple as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exitCode: 2,
      stdout: '',
      stderr: 'Connection refused',
    });

    const result = await execProbe('container-123', config, mockDocker);

    expect(result.healthy).toBe(false);
    expect(result.source).toBe('exec');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('exit code 2');
  });

  it('returns { healthy: false, source: "exec", error contains error message } when execSimple throws error', async () => {
    const config: HealthCheckConfig = {
      strategy: 'exec',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
      command: ['test', '-f', '/app/ready'],
    };

    const testError = new Error('Container not found');
    (mockDocker.execSimple as ReturnType<typeof vi.fn>).mockRejectedValueOnce(testError);

    const result = await execProbe('container-123', config, mockDocker);

    expect(result.healthy).toBe(false);
    expect(result.source).toBe('exec');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Container not found');
  });

  it('includes responseTimeMs in result when execSimple succeeds', async () => {
    const config: HealthCheckConfig = {
      strategy: 'exec',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
      command: ['echo', 'ok'],
    };

    (mockDocker.execSimple as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    });

    const result = await execProbe('container-123', config, mockDocker);

    expect(result.responseTimeMs).toBeDefined();
    expect(typeof result.responseTimeMs).toBe('number');
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });
});
