import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { HttpBindings } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppContext } from '../app.js';
import { AuthService } from '../auth/auth-service.js';
import { createCorsOriginPolicy } from '../web/middleware/cors-policy.js';
import { createModuleLogger } from '../lib/logger.js';
import { VERSION } from '../version.js';
import { registerCompositeMcpTools } from '../tools/adapters/mcp.js';
import { registerMcpPrompts } from './prompts.js';
import { debugToolDefs } from '../tools/defs/debug.js';
import { deployToolDefs } from '../tools/defs/deploy.js';
import { deployPlanToolDefs } from '../tools/defs/deploy-plan.js';
import { envToolDefs } from '../tools/defs/env.js';
import { gitToolDefs } from '../tools/defs/git.js';
import { infraToolDefs } from '../tools/defs/infra.js';
import { monitoringToolDefs } from '../tools/defs/monitoring.js';
import { opsAutomationToolDefs } from '../tools/defs/ops-automation.js';
import { projectOpsToolDefs } from '../tools/defs/project-ops.js';
import { serviceToolDefs } from '../tools/defs/service.js';
import { volumeToolDefs } from '../tools/defs/volume.js';
import { webhookToolDefs } from '../tools/defs/webhook.js';
import { platformReadToolDefs } from '../tools/defs/platform-read.js';
import { platformDebugToolDefs } from '../tools/defs/platform-debug.js';
import { platformActionToolDefs } from '../tools/defs/platform-actions.js';
import type { ToolDef } from '../tools/defs/types.js';
import { buildIncidentBriefing } from '../llm/prompts.js';
import { createCompositeTools, type CompositeTool } from './composite-tools.js';

const log = createModuleLogger('mcp');

/**
 * Get MCP tool definitions, optionally including platform tools.
 * Platform tools are only registered when config.mcp.platformTools is true.
 */
function getMcpToolDefs(platformToolsEnabled: boolean): ToolDef[] {
  return [
    ...deployToolDefs,
    ...deployPlanToolDefs,
    ...projectOpsToolDefs,
    ...envToolDefs,
    ...serviceToolDefs,
    ...volumeToolDefs,
    ...infraToolDefs,
    ...gitToolDefs,
    ...monitoringToolDefs,
    ...opsAutomationToolDefs,
    ...debugToolDefs,
    ...webhookToolDefs,
    ...(platformToolsEnabled
      ? [...platformReadToolDefs, ...platformDebugToolDefs, ...platformActionToolDefs]
      : []),
  ];
}

function getPlatformToolDefs(): ToolDef[] {
  return [...platformReadToolDefs, ...platformDebugToolDefs, ...platformActionToolDefs];
}

function getCompositeTools(allToolDefs: ToolDef[]): CompositeTool[] {
  return createCompositeTools(allToolDefs);
}

const SERVER_INSTRUCTIONS = `You are connected to OpenLander — a self-hosted deployment platform.

CRITICAL: Use ONLY the 4 tools below. Each tool takes an { action, params } input.
Use action="help" on any tool to list available operations.
NEVER call docker CLI, curl localhost, or docker compose directly — use OpenLander tools instead.
Docker may run on a remote host. Always use tools, not local commands.

## openlander_deploy
Deploy & build operations: plans, execution, rollbacks, previews, build logs, Git, infrastructure.
Key actions: deploy, create_deploy_plan, execute_deploy_plan, get_deploy_status, rollback_project, get_build_log
All actions: action="help"

## openlander_project
Project management & config: lifecycle, env vars, secrets, domains, webhooks, public URLs.
Key actions: list_projects, redeploy_project, set_env_vars, archive_project, enable_webhook, expose_public
All actions: action="help"

## openlander_service
Infrastructure services & storage: databases, caches, backups, volumes, disk usage.
Key actions: create_service, get_service_credentials, backup_service, add_volume, get_disk_usage
All actions: action="help"

## openlander_monitor
Monitoring & operations: logs, alerts, system stats, recovery automation.
Key actions: get_logs, get_alerts, get_system_stats, get_project_stats, dismiss_alert
All actions: action="help"

## Usage
Example: openlander_deploy({ action: "deploy", params: { repo_url: "https://github.com/user/repo" } })
Example: openlander_project({ action: "help" })
Example: openlander_service({ action: "create_service", params: { name: "pg", type: "postgres" } })

## Deploy Flow (ALWAYS follow for new projects)
1. openlander_deploy({ action: "deploy", params: { repo_url: "...", name: "..." } })
2. openlander_deploy({ action: "get_deploy_status", params: { project_name: "..." } })  ← poll until done
3. openlander_project({ action: "list_projects" })  ← confirm running

## Networking
- All containers share the "openlander" Docker network
- Container-to-container: http://ol-{project-name}:{port}
- Never create Docker networks manually`;

// eslint-disable-next-line @typescript-eslint/no-deprecated -- SDK v1 uses Server class
function createMcpServerInstance(ctx: AppContext): Server {
  const unresolvedIncidents = ctx.db.listUnresolvedRuntimeIncidents();
  const incidentBriefing = buildIncidentBriefing(unresolvedIncidents, ctx.db);
  const instructions = incidentBriefing
    ? `${SERVER_INSTRUCTIONS}\n\n${incidentBriefing}`
    : SERVER_INSTRUCTIONS;

  // eslint-disable-next-line @typescript-eslint/no-deprecated -- SDK v1 uses Server class
  const server = new Server(
    { name: 'openlander', version: VERSION },
    { capabilities: { tools: {}, prompts: {} }, instructions },
  );

  const platformToolsEnabled = ctx.config.mcp.platformTools === true;
  const toolDefs = getMcpToolDefs(platformToolsEnabled);
  const compositeTools = getCompositeTools(toolDefs);
  const platformDefs = platformToolsEnabled ? getPlatformToolDefs() : [];

  registerCompositeMcpTools(server, compositeTools, platformDefs, ctx);
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
  connectedAt: number;
  lastActivity: number;
  heartbeatInterval?: ReturnType<typeof setInterval>;
  ttlTimeout?: ReturnType<typeof setTimeout>;
  /** Set when `recordMcpSessionClose` has been called for this session.
   *  Guards against the close event firing twice (initial DELETE +
   *  TTL-driven transport.close()) which would write a duplicate
   *  `mcp_session_log` row. Codex CCG HIGH. */
  closeRecorded?: boolean;
  /** clientInfo.name from the MCP initialize handshake (e.g. "Claude
   *  Code", "Cursor", "Cline"). Captured via `server.oninitialized` →
   *  `server.getClientVersion()`. Undefined if the client never sent
   *  it or initialize hasn't completed yet. */
  clientName?: string;
  clientVersion?: string;
}

interface McpSseSession {
  server: Server; // eslint-disable-line @typescript-eslint/no-deprecated
  transport: SSEServerTransport; // eslint-disable-line @typescript-eslint/no-deprecated
  connectedAt: number;
  lastActivity: number;
  clientName?: string;
  clientVersion?: string;
}

// Module-scope session registries so /api/mcp/status can enumerate active
// sessions without reaching into createMcpHttpRoutes' closure. Single MCP
// instance per process (one boot of createMcpHttpRoutes), so the global
// registries are safe.
const sessions = new Map<string, McpSession>();
const sseSessions = new Map<string, McpSseSession>();

export interface McpSessionSnapshot {
  id: string;
  transport: 'http' | 'sse';
  connectedAt: number;
  lastActivityAt: number;
  /** clientInfo.name from MCP initialize handshake (e.g. "Claude Code",
   *  "Cursor"). Undefined for sessions that connected before this field
   *  shipped or for clients that don't send clientInfo. */
  clientName?: string;
  clientVersion?: string;
}

/**
 * Snapshot of currently-connected MCP sessions. Returned to /api/mcp/status
 * so the UI can show "who is connected" without leaking internal session
 * objects (Server / Transport refs).
 */
export function getMcpSessionsSnapshot(): McpSessionSnapshot[] {
  const out: McpSessionSnapshot[] = [];
  for (const [id, s] of sessions.entries()) {
    out.push({
      id,
      transport: 'http',
      connectedAt: s.connectedAt,
      lastActivityAt: s.lastActivity,
      clientName: s.clientName,
      clientVersion: s.clientVersion,
    });
  }
  for (const [id, s] of sseSessions.entries()) {
    out.push({
      id,
      transport: 'sse',
      connectedAt: s.connectedAt,
      lastActivityAt: s.lastActivity,
      clientName: s.clientName,
      clientVersion: s.clientVersion,
    });
  }
  return out.sort((a, b) => b.connectedAt - a.connectedAt);
}

export function createMcpHttpRoutes(ctx: AppContext): Hono & { cleanup: () => void } {
  const app = new Hono();
  const authService = new AuthService(ctx.db);

  app.use(
    '*',
    cors({
      origin: createCorsOriginPolicy(ctx.config.server.corsOrigin, ctx.config.server.baseUrl),
      credentials: false,
      allowMethods: ['GET', 'POST', 'DELETE'],
      allowHeaders: [
        'Content-Type',
        'Accept',
        'mcp-session-id',
        'mcp-protocol-version',
        'Last-Event-ID',
        'Authorization',
      ],
      exposeHeaders: ['mcp-session-id'],
    }),
  );

  app.all('/', async (c) => {
    // Bearer token auth for HTTP MCP
    if (authService.isPasswordSet()) {
      const authHeader = c.req.header('authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null },
          401,
        );
      }
      const token = authHeader.slice(7);
      if (!authService.validateApiToken(token)) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Invalid token' }, id: null },
          401,
        );
      }
    }

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
    let httpSessionId: string | null = null;
    server.oninitialized = () => {
      // MCP `initialize` handshake completed — `getClientVersion()` now
      // returns the agent's `Implementation` (clientInfo.name + version).
      // Persist on the session record so /api/mcp/status can surface a
      // friendly identity instead of the opaque session UUID.
      const info = server.getClientVersion();
      if (!info || !httpSessionId) return;
      const session = sessions.get(httpSessionId);
      if (!session) return;
      session.clientName = info.name;
      session.clientVersion = info.version;
      log.info(
        { sessionId: httpSessionId, clientName: info.name, clientVersion: info.version },
        'MCP HTTP session client identified',
      );
    };
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        httpSessionId = sid;
        const now = Date.now();
        const session: McpSession = {
          server,
          transport,
          connectedAt: now,
          lastActivity: now,
        };

        session.heartbeatInterval = setInterval(() => {
          session.lastActivity = Date.now();
        }, 30_000);

        sessions.set(sid, session);
        log.info({ sessionId: sid }, 'MCP HTTP session created');
      },
      onsessionclosed: (sid) => {
        const session = sessions.get(sid);
        if (session) {
          // Audit log persistence — record the disconnect moment so the
          // /api/activity feed can synthesize mcp_disconnected events that
          // survive process restarts. Best-effort: a DB error here must not
          // break the close flow. Guarded by `closeRecorded` so re-entrant
          // close events (DELETE + TTL-driven transport.close()) write at
          // most one row per session lifetime.
          if (!session.closeRecorded) {
            session.closeRecorded = true;
            try {
              ctx.db.recordMcpSessionClose({
                sessionId: sid,
                transport: 'http',
                connectedAt: session.connectedAt,
                disconnectedAt: Date.now(),
              });
            } catch (err) {
              log.warn({ sessionId: sid, err }, 'Failed to persist MCP HTTP session close');
            }
          }

          if (session.heartbeatInterval) {
            clearInterval(session.heartbeatInterval);
          }

          session.ttlTimeout = setTimeout(
            () => {
              void session.transport.close();
              sessions.delete(sid);
              log.info({ sessionId: sid }, 'MCP HTTP session TTL expired, removed from map');
            },
            5 * 60 * 1000,
          );

          log.info({ sessionId: sid }, 'MCP HTTP session closed, TTL cleanup scheduled');
        }
      },
    });

    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // Legacy SSE transport (protocol 2024-11-05) — needed by OpenCode, Cline for remote connections

  app.get('/sse', async (c) => {
    if (authService.isPasswordSet()) {
      const authHeader = c.req.header('authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null },
          401,
        );
      }
      const token = authHeader.slice(7);
      if (!authService.validateApiToken(token)) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Invalid token' }, id: null },
          401,
        );
      }
    }

    const { outgoing } = c.env as HttpBindings;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- backward compat
    const transport = new SSEServerTransport('/mcp/messages', outgoing);
    const server = createMcpServerInstance(ctx);

    sseSessions.set(transport.sessionId, {
      server,
      transport,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
    });

    // Capture clientInfo on initialize. See HTTP transport above.
    server.oninitialized = () => {
      const info = server.getClientVersion();
      if (!info) return;
      const session = sseSessions.get(transport.sessionId);
      if (!session) return;
      session.clientName = info.name;
      session.clientVersion = info.version;
      log.info(
        {
          sessionId: transport.sessionId,
          clientName: info.name,
          clientVersion: info.version,
        },
        'MCP SSE session client identified',
      );
    };

    outgoing.on('close', () => {
      const session = sseSessions.get(transport.sessionId);
      if (session) {
        try {
          ctx.db.recordMcpSessionClose({
            sessionId: transport.sessionId,
            transport: 'sse',
            connectedAt: session.connectedAt,
            disconnectedAt: Date.now(),
          });
        } catch (err) {
          log.warn(
            { sessionId: transport.sessionId, err },
            'Failed to persist MCP SSE session close',
          );
        }
      }
      sseSessions.delete(transport.sessionId);
      log.info({ sessionId: transport.sessionId }, 'MCP SSE session closed');
    });

    await server.connect(transport);
    await transport.start();

    log.info({ sessionId: transport.sessionId }, 'MCP SSE session created');
    return RESPONSE_ALREADY_SENT;
  });

  app.post('/messages', async (c) => {
    if (authService.isPasswordSet()) {
      const authHeader = c.req.header('authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null },
          401,
        );
      }
      const token = authHeader.slice(7);
      if (!authService.validateApiToken(token)) {
        return c.json(
          { jsonrpc: '2.0', error: { code: -32001, message: 'Invalid token' }, id: null },
          401,
        );
      }
    }

    const sessionId = c.req.query('sessionId');
    if (!sessionId) {
      return c.json(
        {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Missing sessionId query parameter' },
          id: null,
        },
        400,
      );
    }

    const session = sseSessions.get(sessionId);
    if (!session) {
      return c.json(
        { jsonrpc: '2.0', error: { code: -32001, message: 'SSE session not found' }, id: null },
        404,
      );
    }

    session.lastActivity = Date.now();

    const { incoming, outgoing } = c.env as HttpBindings;
    const body: unknown = await c.req.json();
    await session.transport.handlePostMessage(incoming, outgoing, body);

    return RESPONSE_ALREADY_SENT;
  });

  (app as Hono & { cleanup: () => void }).cleanup = () => {
    for (const [sid, session] of sessions.entries()) {
      if (session.heartbeatInterval) {
        clearInterval(session.heartbeatInterval);
      }
      if (session.ttlTimeout) {
        clearTimeout(session.ttlTimeout);
      }
      sessions.delete(sid);
    }
    for (const [sid, session] of sseSessions.entries()) {
      void session.transport.close();
      sseSessions.delete(sid);
    }
    log.info('MCP HTTP sessions cleanup completed');
  };

  return app as Hono & { cleanup: () => void };
}
