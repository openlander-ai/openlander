import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import { tcpProbe } from '../../../src/health/strategies/tcp.js';
import type { HealthCheckConfig } from '../../../src/health/types.js';

describe('tcpProbe', () => {
  let server: net.Server;
  let port: number;

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as net.AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('returns healthy=true when port is open', async () => {
    const config: HealthCheckConfig = {
      strategy: 'tcp',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
    };

    const result = await tcpProbe(config, port);

    expect(result.healthy).toBe(true);
    expect(result.source).toBe('tcp');
    expect(result.error).toBeUndefined();
    expect(result.responseTimeMs).toBeDefined();
    expect(typeof result.responseTimeMs).toBe('number');
    expect(result.responseTimeMs).toBeGreaterThan(0);
  });

  it('returns healthy=false when port is closed', async () => {
    const config: HealthCheckConfig = {
      strategy: 'tcp',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
    };

    // Use a port that is definitely not listening
    const closedPort = 54321;

    const result = await tcpProbe(config, closedPort);

    expect(result.healthy).toBe(false);
    expect(result.source).toBe('tcp');
    expect(result.error).toBeDefined();
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('respects timeout configuration', async () => {
    const config: HealthCheckConfig = {
      strategy: 'tcp',
      timeoutMs: 150,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
    };

    const startTime = Date.now();
    const result = await tcpProbe(config, 54321);
    const elapsed = Date.now() - startTime;

    expect(result.healthy).toBe(false);
    expect(result.source).toBe('tcp');
    expect(result.error).toBeDefined();
    expect(elapsed).toBeLessThan(config.timeoutMs + 100);
  });

  it('responseTimeMs is a non-negative number on success', async () => {
    const config: HealthCheckConfig = {
      strategy: 'tcp',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
    };

    const result = await tcpProbe(config, port);

    expect(result.healthy).toBe(true);
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.responseTimeMs).toBeLessThan(5000);
  });
});
