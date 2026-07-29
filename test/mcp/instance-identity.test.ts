import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
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
import {
  buildAgentInstruction,
  buildAllClientConfigs,
  buildClaudeDesktopConfig,
} from '../../web/src/lib/mcp-config-snippets.js';

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
    const { endpoint, host } = getMcpEndpointFromRequestUrl(
      'http://www.aqainc.biz/api/mcp/instance',
    );
    const info = getMcpInstancePublicInfo(appCtx({ instanceName: '' }).config, {
      endpoint,
      host,
    });

    expect(info).toMatchObject({
      id: 'olinst_test',
      endpoint: 'http://www.aqainc.biz/mcp',
      host: 'www.aqainc.biz',
      suggestedName: 'ol-aqainc-biz',
    });
  });

  it('builds an agent instruction that makes MCP the default deploy path', () => {
    const instruction = buildAgentInstruction({
      endpoint: 'http://www.aqainc.biz/mcp',
      serverName: 'ol-ais',
    });

    expect(instruction).toContain('Use the MCP server "ol-ais"');
    expect(instruction).toContain('Do not use local Docker, SSH');
    expect(instruction).toContain('get_instance_info');
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

    const snippetById = new Map(configs.map((item) => [item.id, item.snippet]));
    const claudeCode = snippetById.get('claude-code');
    expect(claudeCode).toContain('claude mcp add --transport http');
    expect(claudeCode).toContain('--header "Authorization: Bearer olp_token"');
    expect(claudeCode).toContain('openlander-ais-prod http://www.aqainc.biz/mcp');

    const cursor = JSON.parse(snippetById.get('cursor') ?? '{}');
    expect(cursor.mcpServers['openlander-ais-prod']).toMatchObject({
      url: 'http://www.aqainc.biz/mcp',
      headers: { Authorization: 'Bearer olp_token' },
    });

    const windsurf = JSON.parse(snippetById.get('windsurf') ?? '{}');
    expect(windsurf.mcpServers['openlander-ais-prod']).toMatchObject({
      serverUrl: 'http://www.aqainc.biz/mcp',
      headers: { Authorization: 'Bearer olp_token' },
    });

    const claudeDesktop = JSON.parse(snippetById.get('claude-desktop') ?? '{}');
    expect(claudeDesktop.mcpServers['openlander-ais-prod']).toMatchObject({
      command: 'npx',
      args: [
        '-y',
        'mcp-remote@latest',
        'http://www.aqainc.biz/mcp',
        '--header',
        'Authorization:${OPENLANDER_MCP_AUTH}',
        '--allow-http',
      ],
      env: { OPENLANDER_MCP_AUTH: 'Bearer olp_token' },
    });

    const vscode = JSON.parse(snippetById.get('vscode') ?? '{}');
    expect(vscode.servers['openlander-ais-prod']).toMatchObject({
      type: 'http',
      url: 'http://www.aqainc.biz/mcp',
      headers: { Authorization: 'Bearer olp_token' },
    });
  });

  it('only adds the mcp-remote HTTP escape hatch for non-TLS Claude Desktop endpoints', () => {
    const config = JSON.parse(
      buildClaudeDesktopConfig({
        endpoint: 'https://openlander.example.com/mcp',
        token: 'olp_token',
        serverName: 'openlander-prod',
      }),
    );

    expect(config.mcpServers['openlander-prod'].args).not.toContain('--allow-http');
  });

  it('adds _instance to composite MCP success and error responses', async () => {
    const handlers = new Map<
      unknown,
      (request: { params: { name: string; arguments?: unknown } }) => unknown
    >();
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

  it('returns upload capabilities on the active MCP transport origin', async () => {
    const handlers = new Map<
      unknown,
      (request: { params: { name: string; arguments?: unknown } }) => unknown
    >();
    registerCompositeMcpTools(
      {
        setRequestHandler(schema, handler) {
          handlers.set(schema, handler);
        },
      },
      [
        {
          name: 'openlander_project',
          description: 'Project operations',
          inputSchema: z.object({ action: z.string() }),
          execute: async () => ({
            upload_capabilities: [
              { item_id: 'item-1', upload_url: '/api/review-package-uploads/item-1?token=x' },
            ],
          }),
        },
      ],
      [],
      appCtx(),
      undefined,
      {
        id: 'olinst_test',
        name: 'openlander-ais-prod',
        endpoint: 'http://127.0.0.1:10116/mcp',
      },
    );

    const response = (await handlers.get(CallToolRequestSchema)?.({
      params: { name: 'openlander_project', arguments: { action: 'status' } },
    })) as { content: Array<{ text: string }> };
    expect(JSON.parse(response.content[0]?.text ?? '{}')).toMatchObject({
      upload_capabilities: [
        {
          upload_url: 'http://127.0.0.1:10116/api/review-package-uploads/item-1?token=x',
        },
      ],
      _instance: { endpoint: 'http://127.0.0.1:10116/mcp' },
    });
  });
});
