import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppContext } from '../app.js';
import { createModuleLogger } from '../lib/logger.js';
import { registerMcpTools } from '../tools/adapters/mcp.js';
import { registerMcpPrompts } from './prompts.js';
import { debugToolDefs } from '../tools/defs/debug.js';
import { deployToolDefs } from '../tools/defs/deploy.js';
import { envToolDefs } from '../tools/defs/env.js';
import { gitToolDefs } from '../tools/defs/git.js';
import { infraToolDefs } from '../tools/defs/infra.js';
import { monitoringToolDefs } from '../tools/defs/monitoring.js';
import { projectOpsToolDefs } from '../tools/defs/project-ops.js';
import { serviceToolDefs } from '../tools/defs/service.js';
import type { ToolDef } from '../tools/defs/types.js';

const log = createModuleLogger('mcp');

const mcpToolDefs: ToolDef[] = [
  ...deployToolDefs,
  ...projectOpsToolDefs,
  ...envToolDefs,
  ...serviceToolDefs,
  ...infraToolDefs,
  ...gitToolDefs,
  ...monitoringToolDefs,
  ...debugToolDefs,
];

const SERVER_INSTRUCTIONS = `You are connected to OpenLander — a self-hosted deployment platform.
You have MCP tools to deploy, manage services, set env vars, and debug builds.

IMPORTANT: Always use the provided MCP tools. NEVER write HTTP request code, curl commands, or API client code to interact with OpenLander.

Quick reference:
- deploy_project: Deploy from a git repo URL
- create_service: Create PostgreSQL/MySQL/Redis/MongoDB (returns suggested_env for auto-linking)
- set_env_vars: Set environment variables on a project
- get_deploy_status: Check build progress
- get_build_log / debug_build_error: Diagnose failures
- redeploy_project: Redeploy after config changes

Typical flow:
1. create_service → get suggested_env → set_env_vars on project → deploy_project
2. get_deploy_status to monitor → get_build_log if failed → debug_build_error for analysis

Connection strings use container names (ol-svc-*) as hostnames, not localhost.
Use deploy_project(force=true) to auto-clean stale containers.`;

// eslint-disable-next-line @typescript-eslint/no-deprecated -- SDK v1 uses Server class
function createMcpServerInstance(ctx: AppContext): Server {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- SDK v1 uses Server class
  const server = new Server(
    { name: 'openlander', version: '0.4.1' },
    { capabilities: { tools: {}, prompts: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  registerMcpTools(server, mcpToolDefs, ctx);
  registerMcpPrompts(server);

  return server;
}

export async function startMcpServer(ctx: AppContext): Promise<void> {
  const server = createMcpServerInstance(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('OpenLander MCP server started on stdio transport');
}

interface McpSession {
  server: Server; // eslint-disable-line @typescript-eslint/no-deprecated
  transport: WebStandardStreamableHTTPServerTransport;
}

export function createMcpHttpRoutes(ctx: AppContext): Hono {
  const app = new Hono();
  const sessions = new Map<string, McpSession>();

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'DELETE'],
      allowHeaders: [
        'Content-Type',
        'Accept',
        'mcp-session-id',
        'mcp-protocol-version',
        'Last-Event-ID',
      ],
      exposeHeaders: ['mcp-session-id'],
    }),
  );

  app.all('/', async (c) => {
    const sessionId = c.req.header('mcp-session-id');

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null },
          404,
        );
      }
      return session.transport.handleRequest(c.req.raw);
    }

    const server = createMcpServerInstance(ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { server, transport });
        log.info({ sessionId: sid }, 'MCP HTTP session created');
      },
      onsessionclosed: (sid) => {
        sessions.delete(sid);
        log.info({ sessionId: sid }, 'MCP HTTP session closed');
      },
    });

    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  return app;
}
