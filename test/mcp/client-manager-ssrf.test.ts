/**
 * Day 14 follow-up to Day 13 M4: the SSRF guard on `/setup/mcp/servers`
 * (registration time) is not enough. A registered MCP entry can be mutated
 * out-of-band — operator edits the config file, restores a backup, or runs
 * a migration — so the safety check has to also live on the path every
 * transport actually traverses.
 *
 * `connectOne()` is called from both `connectAll()` (boot path) and
 * `testConnection()` (admin "test connection" button). Both must refuse
 * an internal URL even when registration would have passed.
 *
 * One bad server must NOT prevent the other servers in the list from
 * connecting; that isolation is provided by `Promise.allSettled` in
 * `connectAll()`. We assert that property too.
 */
import { describe, expect, it, vi } from 'vitest';

import { McpClientManager } from '../../src/mcp/client-manager.js';
import type { McpServerEntry } from '../../src/config/index.js';

// Avoid actually creating a real MCP client — the @ai-sdk/mcp transport
// would try to open a network connection. We only care that the SSRF
// guard short-circuits before that happens.
vi.mock('@ai-sdk/mcp', () => ({
  createMCPClient: vi.fn(async () => ({
    tools: vi.fn(async () => ({})),
    close: vi.fn(async () => undefined),
  })),
}));

function makeServer(overrides: Partial<McpServerEntry>): McpServerEntry {
  return {
    id: overrides.id ?? 'server-id',
    name: overrides.name ?? 'test-server',
    transport: overrides.transport ?? 'http',
    enabled: overrides.enabled ?? true,
    url: overrides.url,
    command: overrides.command,
    args: overrides.args,
    headers: overrides.headers,
    env: overrides.env,
  };
}

describe('Day 14: McpClientManager runtime SSRF guard', () => {
  it('refuses to connect a server whose URL points at localhost', async () => {
    const mgr = new McpClientManager();
    const bad = makeServer({
      id: 'bad-1',
      name: 'localhost-leak',
      transport: 'http',
      url: 'http://localhost:9999/mcp',
    });

    await mgr.connectAll([bad]);
    expect(mgr.connectedCount).toBe(0);
    await mgr.disconnectAll();
  });

  it('refuses to connect a server whose URL points at RFC1918', async () => {
    const mgr = new McpClientManager();
    const bad = makeServer({
      id: 'bad-2',
      name: 'lan-leak',
      transport: 'sse',
      url: 'http://192.168.1.1/mcp',
    });

    await mgr.connectAll([bad]);
    expect(mgr.connectedCount).toBe(0);
    await mgr.disconnectAll();
  });

  it('refuses to connect a server whose URL is an IPv4-mapped IPv6 loopback', async () => {
    const mgr = new McpClientManager();
    const bad = makeServer({
      id: 'bad-3',
      name: 'mapped-loopback',
      transport: 'http',
      url: 'http://[::ffff:127.0.0.1]/mcp',
    });

    await mgr.connectAll([bad]);
    expect(mgr.connectedCount).toBe(0);
    await mgr.disconnectAll();
  });

  it('isolates failures: a bad URL does not prevent a good URL from connecting', async () => {
    const mgr = new McpClientManager();
    const bad = makeServer({
      id: 'bad-4',
      name: 'imds-leak',
      transport: 'http',
      url: 'http://169.254.169.254/latest/meta-data',
    });
    const good = makeServer({
      id: 'good-1',
      name: 'public-server',
      transport: 'http',
      url: 'https://mcp.example.com/v1',
    });

    await mgr.connectAll([bad, good]);

    // Only the public URL connected.
    expect(mgr.connectedCount).toBe(1);
    await mgr.disconnectAll();
  });

  it('refuses connect on testConnection() when URL is internal', async () => {
    const mgr = new McpClientManager();
    const bad = makeServer({
      id: 'bad-5',
      name: 'metadata-google',
      transport: 'http',
      url: 'http://metadata.google.internal./',
    });

    await expect(mgr.testConnection(bad)).rejects.toThrow(/refused at runtime/i);
  });

  it('still permits stdio transport (no URL to validate)', async () => {
    const mgr = new McpClientManager();
    const stdio = makeServer({
      id: 'stdio-1',
      name: 'local-cli',
      transport: 'stdio',
      command: 'echo',
      args: ['hello'],
    });

    // stdio bypasses URL parsing entirely; the mocked createMCPClient
    // resolves so this should report 1 connected.
    await mgr.connectAll([stdio]);
    expect(mgr.connectedCount).toBe(1);
    await mgr.disconnectAll();
  });
});
