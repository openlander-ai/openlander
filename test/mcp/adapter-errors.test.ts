import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { AppContext } from '../../src/app.js';
import { OpenLanderError } from '../../src/errors.js';
import type { CompositeTool } from '../../src/mcp/composite-tools.js';
import { registerCompositeMcpTools } from '../../src/tools/adapters/mcp.js';

const mockAppCtx = {
  config: {
    server: {
      port: 10114,
      host: '0.0.0.0',
      baseUrl: 'http://localhost:10114',
    },
    mcp: {
      enabled: true,
      transport: 'sse',
      instanceId: 'olinst_test',
      instanceName: 'openlander-test',
      servers: [],
      platformTools: false,
    },
  },
} as AppContext;

function createServerHarness() {
  const handlers: Array<(request: { params: { name: string; arguments?: unknown } }) => unknown> =
    [];
  const server = {
    setRequestHandler: vi.fn(
      (
        _schema: unknown,
        handler: (request: { params: { name: string; arguments?: unknown } }) => unknown,
      ) => {
        handlers.push(handler);
      },
    ),
  };
  return { server, handlers };
}

describe('MCP adapter error responses', () => {
  it('returns structured sanitized errors instead of raw SQL text', async () => {
    const composite: CompositeTool = {
      name: 'openlander_project',
      description: 'test composite',
      inputSchema: z.object({}),
      execute: async () => {
        throw new OpenLanderError(
          'Failed query: insert into "env_vars" (...) values (...) params: sk-super-secret-token',
          'ENV_VAR_WRITE_FAILED',
          500,
          { key: 'DATABASE_URL' },
        );
      },
    };
    const { server, handlers } = createServerHarness();
    registerCompositeMcpTools(server, [composite], [], mockAppCtx);

    const callHandler = handlers[1];
    expect(callHandler).toBeDefined();
    const response = (await callHandler!({
      params: { name: 'openlander_project', arguments: {} },
    })) as { isError: true; content: Array<{ text: string }> };

    expect(response.isError).toBe(true);
    const payload = JSON.parse(response.content[0]!.text) as Record<string, unknown>;
    expect(payload).toEqual({
      error: 'ENV_VAR_WRITE_FAILED',
      code: 'ENV_VAR_WRITE_FAILED',
      message: 'Internal database error.',
      details: { key: 'DATABASE_URL' },
      _instance: {
        id: 'olinst_test',
        name: 'openlander-test',
        endpoint: 'http://localhost:10114/mcp',
      },
    });
    expect(response.content[0]!.text).not.toContain('insert into');
    expect(response.content[0]!.text).not.toContain('params:');
    expect(response.content[0]!.text).not.toContain('sk-super-secret-token');
  });
});
