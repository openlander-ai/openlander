import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerCompositeMcpTools } from '../../src/tools/adapters/mcp.js';
import type { AppContext } from '../../src/app.js';
import type { CompositeTool } from '../../src/mcp/composite-tools.js';
import type { ToolDef } from '../../src/tools/defs/types.js';

interface MockServer {
  listHandler?: () => unknown;
  callHandler?: (request: { params: { name: string; arguments?: unknown } }) => unknown;
  setRequestHandler: (
    schema: unknown,
    handler:
      | ((request: { params: { name: string; arguments?: unknown } }) => unknown)
      | (() => unknown),
  ) => void;
}

function createMockServer(): MockServer {
  return {
    setRequestHandler(schema, handler) {
      if (schema === ListToolsRequestSchema) {
        this.listHandler = handler as () => unknown;
        return;
      }

      if (schema === CallToolRequestSchema) {
        this.callHandler = handler as (request: {
          params: { name: string; arguments?: unknown };
        }) => unknown;
      }
    },
  };
}

function createComposite(name: string, execute: CompositeTool['execute']): CompositeTool {
  return {
    name,
    description: `${name} composite tool`,
    inputSchema: z.object({
      action: z.string(),
      params: z.record(z.string(), z.unknown()).optional(),
    }),
    execute,
  };
}

function createPlatformTool(name: string, targets?: ToolDef['targets']): ToolDef {
  return {
    name,
    description: `${name} platform tool`,
    inputSchema: z.object({ value: z.string().optional() }),
    execute: (args) => ({ source: name, args }),
    targets,
    mcp: {
      transformResult: (result) => ({ wrapped: result }),
    },
  };
}

describe('registerCompositeMcpTools', () => {
  it('lists composite tools plus MCP-targeted platform tools', async () => {
    const server = createMockServer();
    const composites = [
      createComposite('openlander_deploy', async () => ({ group: 'deploy' })),
      createComposite('openlander_project', async () => ({ group: 'project' })),
      createComposite('openlander_service', async () => ({ group: 'service' })),
      createComposite('openlander_monitor', async () => ({ group: 'monitor' })),
    ];
    const platformDefs = [
      createPlatformTool('platform_health', ['mcp']),
      createPlatformTool('agent_only_platform', ['agent']),
    ];

    registerCompositeMcpTools(server, composites, platformDefs, {} as AppContext);

    const response = (await server.listHandler?.()) as {
      tools: Array<{ name: string }>;
    };

    expect(response.tools.map((tool) => tool.name)).toEqual([
      'openlander_deploy',
      'openlander_project',
      'openlander_service',
      'openlander_monitor',
      'platform_health',
    ]);
  });

  it('routes composite tool calls through the composite executor', async () => {
    const server = createMockServer();
    const execute = vi.fn(async (args: unknown, context: { target: string }) => ({
      args,
      target: context.target,
    }));

    registerCompositeMcpTools(
      server,
      [createComposite('openlander_deploy', execute)],
      [],
      {} as AppContext,
    );

    const response = (await server.callHandler?.({
      params: {
        name: 'openlander_deploy',
        arguments: { action: 'help', params: { verbose: true } },
      },
    })) as {
      content: Array<{ type: 'text'; text: string }>;
    };

    expect(execute).toHaveBeenCalledWith(
      { action: 'help', params: { verbose: true } },
      expect.objectContaining({ target: 'mcp' }),
    );
    expect(JSON.parse(response.content[0]?.text ?? '{}')).toEqual({
      args: { action: 'help', params: { verbose: true } },
      target: 'mcp',
    });
  });

  it('returns structured guidance for invalid composite wrapper arguments', async () => {
    const server = createMockServer();
    const execute = vi.fn(async () => ({ ok: true }));

    registerCompositeMcpTools(
      server,
      [createComposite('openlander_deploy', execute)],
      [],
      {} as AppContext,
    );

    const response = (await server.callHandler?.({
      params: {
        name: 'openlander_deploy',
        arguments: { repo_url: 'https://github.com/acme/app' },
      },
    })) as {
      content: Array<{ type: 'text'; text: string }>;
      isError?: boolean;
    };

    expect(execute).not.toHaveBeenCalled();
    expect(response.isError).toBeUndefined();
    expect(JSON.parse(response.content[0]?.text ?? '{}')).toMatchObject({
      error: 'INVALID_PARAMS',
      tool: 'openlander_deploy',
      allowed_params: ['action', 'params'],
      required_params: ['action'],
      optional_params: ['params'],
      unknown_params: ['repo_url'],
      suggested_call: {
        tool: 'openlander_deploy',
        arguments: { action: 'help' },
      },
    });
  });

  it('routes platform tool calls through ToolDef execution and transformResult', async () => {
    const server = createMockServer();

    registerCompositeMcpTools(
      server,
      [createComposite('openlander_monitor', async () => ({ composite: true }))],
      [createPlatformTool('platform_health', ['mcp'])],
      {} as AppContext,
    );

    const response = (await server.callHandler?.({
      params: {
        name: 'platform_health',
        arguments: { value: 'ok' },
      },
    })) as {
      content: Array<{ type: 'text'; text: string }>;
    };

    expect(JSON.parse(response.content[0]?.text ?? '{}')).toEqual({
      wrapped: {
        source: 'platform_health',
        args: { value: 'ok' },
      },
    });
  });
});
