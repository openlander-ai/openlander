import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { runMcpStdioLifecycle } from '../../src/mcp/server.js';

function createServer() {
  let transport: Transport | null = null;
  const server = {
    onclose: undefined as (() => void) | undefined,
    connect: vi.fn(async (nextTransport: Transport) => {
      transport = nextTransport;
      nextTransport.onclose = () => server.onclose?.();
      await nextTransport.start();
    }),
    close: vi.fn(async () => {
      await transport?.close();
    }),
  };
  return server;
}

describe('runMcpStdioLifecycle', () => {
  it('closes the server when stdin reaches EOF', async () => {
    const input = new PassThrough();
    const transport = new PassThroughTransport();
    const server = createServer();

    input.resume();
    const lifecycle = runMcpStdioLifecycle(server, transport, input);
    await vi.waitFor(() => expect(server.connect).toHaveBeenCalledOnce());
    input.end();

    await lifecycle;

    expect(server.close).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
    expect(input.listenerCount('end')).toBe(0);
    expect(input.listenerCount('close')).toBe(0);
  });

  it('closes the server once when shutdown and stdin EOF race', async () => {
    const input = new PassThrough();
    const transport = new PassThroughTransport();
    const server = createServer();
    const controller = new AbortController();

    const lifecycle = runMcpStdioLifecycle(server, transport, input, controller.signal);
    await vi.waitFor(() => expect(server.connect).toHaveBeenCalledOnce());
    controller.abort();
    input.end();

    await lifecycle;

    expect(server.close).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('resolves when the transport closes independently', async () => {
    const input = new PassThrough();
    const transport = new PassThroughTransport();
    const server = createServer();

    const lifecycle = runMcpStdioLifecycle(server, transport, input);
    await vi.waitFor(() => expect(server.connect).toHaveBeenCalledOnce());
    await transport.close();

    await lifecycle;

    expect(server.close).not.toHaveBeenCalled();
  });
});

class PassThroughTransport implements Transport {
  onclose?: () => void;
  start = vi.fn(async () => {});
  send = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.onclose?.();
  });
}
