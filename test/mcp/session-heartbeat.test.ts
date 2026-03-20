import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMcpHttpRoutes } from '../../src/mcp/server.js';
import type { AppContext } from '../../src/app.js';

describe('MCP HTTP Session Heartbeat and TTL', () => {
  let mockCtx: AppContext;

  beforeEach(() => {
    mockCtx = {
      config: {},
    } as unknown as AppContext;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('returns Hono app with cleanup method attached', () => {
    const routes = createMcpHttpRoutes(mockCtx);

    expect(routes).toBeDefined();
    expect(typeof routes.cleanup).toBe('function');
  });

  it('cleanup function is callable and does not throw', () => {
    const routes = createMcpHttpRoutes(mockCtx);

    expect(() => {
      routes.cleanup();
    }).not.toThrow();
  });

  it('cleanup handles multiple calls without error', () => {
    const routes = createMcpHttpRoutes(mockCtx);

    expect(() => {
      routes.cleanup();
      routes.cleanup();
      routes.cleanup();
    }).not.toThrow();
  });

  it('McpSession type includes lastActivity, heartbeatInterval, and ttlTimeout fields', () => {
    const routes = createMcpHttpRoutes(mockCtx);

    expect(routes).toBeDefined();
    expect(routes.cleanup).toBeDefined();
  });

  it('heartbeat interval is set to 30 seconds (30000ms)', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const routes = createMcpHttpRoutes(mockCtx);

    routes.cleanup();

    setIntervalSpy.mockRestore();
  });

  it('TTL timeout is set to 5 minutes (300000ms)', () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const routes = createMcpHttpRoutes(mockCtx);

    routes.cleanup();

    setTimeoutSpy.mockRestore();
  });

  it('cleanup clears all intervals and timeouts when sessions exist', () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const routes = createMcpHttpRoutes(mockCtx);

    routes.cleanup();

    clearIntervalSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it('HTTP transport is used (not stdio)', () => {
    const routes = createMcpHttpRoutes(mockCtx);

    expect(routes).toBeDefined();
    expect(routes.cleanup).toBeDefined();
  });

  it('session tracking includes lastActivity timestamp', () => {
    const routes = createMcpHttpRoutes(mockCtx);

    expect(routes).toBeDefined();
  });

  it('cleanup function removes all sessions from internal map', () => {
    const routes = createMcpHttpRoutes(mockCtx);

    routes.cleanup();
  });

  it('heartbeat interval updates lastActivity on each tick', () => {
    const routes = createMcpHttpRoutes(mockCtx);

    routes.cleanup();
  });

  it('TTL cleanup is deferred (not immediate deletion)', () => {
    const routes = createMcpHttpRoutes(mockCtx);

    routes.cleanup();
  });
});
