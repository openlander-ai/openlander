import { afterEach, describe, expect, it } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createMcpHttpRoutes } from '../../src/mcp/server.js';

const JSON_RPC_HEADERS = {
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json',
};

function createContext(): AppContext {
  return {
    config: {
      mcp: { platformTools: false },
      server: { baseUrl: 'http://localhost:10114' },
    },
    db: {
      isPasswordSet: async () => false,
      listUnresolvedRuntimeIncidents: async () => [],
    },
  } as unknown as AppContext;
}

describe('MCP streamable HTTP JSON responses', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('completes a composite tool call as a finite JSON response', async () => {
    const routes = createMcpHttpRoutes(createContext());
    cleanup = routes.cleanup;

    const initialize = await routes.request('/', {
      method: 'POST',
      headers: JSON_RPC_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'http-json-response-test', version: '1.0.0' },
        },
      }),
    });

    expect(initialize.status).toBe(200);
    expect(initialize.headers.get('content-type')).toContain('application/json');
    const sessionId = initialize.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();

    const initialized = await routes.request('/', {
      method: 'POST',
      headers: {
        ...JSON_RPC_HEADERS,
        'mcp-protocol-version': '2025-03-26',
        'mcp-session-id': sessionId ?? '',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });
    expect(initialized.status).toBe(202);

    const toolResponse = await routes.request('/', {
      method: 'POST',
      headers: {
        ...JSON_RPC_HEADERS,
        'mcp-protocol-version': '2025-03-26',
        'mcp-session-id': sessionId ?? '',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'openlander_project',
          arguments: { action: 'help', params: { action_name: 'list_projects' } },
        },
      }),
    });

    expect(toolResponse.status).toBe(200);
    expect(toolResponse.headers.get('content-type')).toContain('application/json');

    const payload = (await toolResponse.json()) as {
      result?: { content?: Array<{ text?: string }> };
    };
    const text = payload.result?.content?.[0]?.text ?? '';
    expect(text).toContain('list_projects');
    expect(text).toContain('input_schema');
  });
});
