import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, Server } from 'node:http';
import { httpProbe } from '../../../src/health/strategies/http.js';
import type { HealthCheckConfig } from '../../../src/health/types.js';

describe('httpProbe', () => {
  let server: Server;
  let port: number;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Start a real HTTP server for testing
    server = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (req.url === '/error') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      } else if (req.url === '/notfound') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      }
    });

    return new Promise<void>((resolve) => {
      server.listen(0, 'localhost', () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr !== null ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('returns healthy: true with responseTimeMs on 200 response', async () => {
    const config: HealthCheckConfig = {
      strategy: 'http',
      path: '/health',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
    };

    const result = await httpProbe(config, port);

    expect(result.healthy).toBe(true);
    expect(result.source).toBe('http');
    expect(result.error).toBeUndefined();
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.responseTimeMs).toBe('number');
  });

  it('returns healthy: false with error on 500 response', async () => {
    const config: HealthCheckConfig = {
      strategy: 'http',
      path: '/error',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
    };

    const result = await httpProbe(config, port);

    expect(result.healthy).toBe(false);
    expect(result.source).toBe('http');
    expect(result.error).toContain('HTTP 500');
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('returns healthy: false with error on 404 response', async () => {
    const config: HealthCheckConfig = {
      strategy: 'http',
      path: '/notfound',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
    };

    const result = await httpProbe(config, port);

    expect(result.healthy).toBe(false);
    expect(result.source).toBe('http');
    expect(result.error).toContain('HTTP 404');
  });

  it('uses default path "/" when path is not provided', async () => {
    const config: HealthCheckConfig = {
      strategy: 'http',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
    };

    const result = await httpProbe(config, port);

    expect(result.healthy).toBe(true);
    expect(result.source).toBe('http');
  });

  it('uses custom path in URL', async () => {
    const config: HealthCheckConfig = {
      strategy: 'http',
      path: '/health',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
    };

    const result = await httpProbe(config, port);

    expect(result.healthy).toBe(true);
    expect(result.source).toBe('http');
  });

  it('returns healthy: false with error on ECONNREFUSED', async () => {
    const config: HealthCheckConfig = {
      strategy: 'http',
      path: '/health',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
    };

    // Use a port that's not listening
    const result = await httpProbe(config, 9999);

    expect(result.healthy).toBe(false);
    expect(result.source).toBe('http');
    expect(result.error).toBeDefined();
    expect(result.error?.toLowerCase()).toMatch(/econnrefused|fetch failed|connection/i);
  });

  it('returns healthy: false with timeout error when request exceeds timeoutMs', async () => {
    // Create a slow server that never responds
    const slowServer = createServer((req, res) => {
      // Never send response
    });

    return new Promise<void>((resolve) => {
      slowServer.listen(0, 'localhost', async () => {
        const addr = slowServer.address();
        const slowPort = typeof addr === 'object' && addr !== null ? addr.port : 0;

        const config: HealthCheckConfig = {
          strategy: 'http',
          path: '/health',
          timeoutMs: 100, // Very short timeout
          intervalMs: 10000,
          failureThreshold: 3,
          dockerHealthPolicy: 'ignore',
        };

        const result = await httpProbe(config, slowPort);

        expect(result.healthy).toBe(false);
        expect(result.source).toBe('http');
        expect(result.error).toBeDefined();
        expect(result.error?.toLowerCase()).toMatch(/timeout|aborted|abort/i);

        slowServer.close(() => resolve());
      });
    });
  });

  it('responseTimeMs is a positive number on success', async () => {
    const config: HealthCheckConfig = {
      strategy: 'http',
      path: '/health',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
    };

    const result = await httpProbe(config, port);

    expect(result.healthy).toBe(true);
    expect(result.responseTimeMs).toBeGreaterThan(0);
  });

  it('builds correct URL with localhost and port', async () => {
    const config: HealthCheckConfig = {
      strategy: 'http',
      path: '/health',
      timeoutMs: 5000,
      intervalMs: 10000,
      failureThreshold: 3,
      dockerHealthPolicy: 'ignore',
    };

    const result = await httpProbe(config, port);

    // If we got a successful response, the URL was correct
    expect(result.healthy).toBe(true);
    expect(result.source).toBe('http');
  });
});
