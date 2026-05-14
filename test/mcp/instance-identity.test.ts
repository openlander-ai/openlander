import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import type { AppContext } from '../../src/app.js';
import { createCompositeTools } from '../../src/mcp/composite-tools.js';
import {
  getMcpEndpointFromRequestUrl,
  getMcpInstancePublicInfo,
  normalizeMcpInstanceName,
} from '../../src/mcp/instance-identity.js';
import { registerCompositeMcpTools } from '../../src/tools/adapters/mcp.js';
import { monitoringToolDefs } from '../../src/tools/defs/monitoring.js';
import { buildAllClientConfigs } from '../../web/src/lib/mcp-config-snippets.js';

function appCtx(overrides?: { instanceName?: string }) {
  return {
    config: {
      server: {
        port: 10114,
        host: '0.0.0.0',
        baseUrl: 'http://control.example.com',
      },
      mcp: {
        enabled: true,
        transport: 'sse',
        instanceId: 'olinst_test',
        instanceName: overrides?.instanceName ?? 'openlander-ais-prod',
        servers: [],
        platformTools: false,
      },
    },
  } as AppContext;
}

describe('MCP instance identity', () => {
  it('derives endpoint and a suggested name from the current request host', () => {
    const { endpoint, host } = getMcpEndpointFromRequestUrl('http://www.aqainc.biz/api/mcp/instance');
    const info = getMcpInstancePublicInfo(appCtx({ instanceName: '' }).config, {
      endpoint,
      host,
    });

    expect(info).toMatchObject({
      id: 'olinst_test',
      endpoint: 'http://www.aqainc.biz/mcp',
      host: 'www.aqainc.biz',
      suggestedName: 'openlander-www.aqainc.biz',
    });
  });

  it('validates slug-shaped instance names', () => {
    expect(normalizeMcpInstanceName('openlander-ais_prod.1')).toBe('openlander-ais_prod.1');
    expect(normalizeMcpInstanceName('my prod')).toBeNull();
    expect(normalizeMcpInstanceName('')).toBeNull();
  });

  it('uses the instance name as every generated MCP client server key', () => {
    const configs = buildAllClientConfigs({
      endpoint: 'http://www.aqainc.biz/mcp',
      token: 'olp_token',
      serverName: 'openlander-ais-prod',
    });

    expect(configs.find((item) => item.id === 'claude-code')?.snippet).toContain(
      'claude mcp add openlander-ais-prod',
    );
    expect(configs.find((item) => item.id === 'cursor')?.snippet).toContain(
      '"openlander-ais-prod"',
    );
    expect(configs.find((item) => item.id === 'windsurf')?.snippet).toContain(
      '"openlander-ais-prod"',
    );
    expect(configs.find((item) => item.id === 'claude-desktop')?.snippet).toContain(
      '"openlander-ais-prod"',
    );
    expect(configs.find((item) => item.id === 'vscode')?.snippet).toContain(
      '"openlander-ais-prod"',
    );
  });

  it('adds _instance to composite MCP success and error responses', async () => {
    const handlers = new Map<unknown, (request: { params: { name: string; arguments?: unknown } }) => unknown>();
    registerCompositeMcpTools(
      {
        setRequestHandler(schema, handler) {
          handlers.set(schema, handler);
        },
      },
      createCompositeTools(monitoringToolDefs),
      [],
      appCtx(),
    );

    const handler = handlers.get(CallToolRequestSchema);
    expect(handler).toBeDefined();
    const success = (await handler?.({
      params: {
        name: 'openlander_monitor',
        arguments: { action: 'get_instance_info' },
      },
    })) as { content: Array<{ text: string }> };
    expect(JSON.parse(success.content[0]?.text ?? '{}')).toMatchObject({
      name: 'openlander-ais-prod',
      endpoint: 'http://control.example.com/mcp',
      _instance: {
        id: 'olinst_test',
        name: 'openlander-ais-prod',
        endpoint: 'http://control.example.com/mcp',
      },
    });

    const failure = (await handler?.({
      params: {
        name: 'does_not_exist',
        arguments: {},
      },
    })) as { content: Array<{ text: string }>; isError: true };
    expect(failure.isError).toBe(true);
    expect(JSON.parse(failure.content[0]?.text ?? '{}')).toMatchObject({
      code: 'MCP_-32601',
      _instance: {
        id: 'olinst_test',
        name: 'openlander-ais-prod',
        endpoint: 'http://control.example.com/mcp',
      },
    });
  });
});
