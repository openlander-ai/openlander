/**
 * MCP status route — exposes a snapshot of currently-connected MCP sessions
 * to the UI's MCPServer page so the "Connected agents" panel can render
 * something accurate instead of a permanent empty state.
 *
 * Source: `getMcpSessionsSnapshot()` reads the module-scope session
 * registries inside `src/mcp/server.ts`. Session IDs are returned truncated
 * (first 12 chars) — the full UUID never reaches the client.
 *
 * Stats (call counts, tool usage histogram) are intentionally NOT exposed
 * here; that requires a persistent counter and is deferred to 1.1.
 */
import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { getMcpSessionsSnapshot, terminateMcpSession } from '../../mcp/server.js';
import {
  COMPOSITE_REGISTRY,
  DEPLOY_ACTIONS,
  PROJECT_ACTIONS,
  SERVICE_ACTIONS,
  MANAGED_SERVICE_ACTIONS,
  MONITOR_ACTIONS,
} from '../../mcp/composite-tools.js';

export interface McpStatusSession {
  id: string; // truncated session ID (first 12 chars)
  transport: 'http' | 'sse';
  connectedAt: string; // ISO 8601
  lastActivityAt: string; // ISO 8601
  /** clientInfo from the MCP initialize handshake. Optional — older
   *  clients may not send clientInfo, and pre-handshake sessions
   *  haven't received it yet. */
  clientName?: string;
  clientVersion?: string;
}

export interface McpStatusResponse {
  endpoint: string;
  totalConnected: number;
  sessions: McpStatusSession[];
  /** Composite tool names registered with the MCP server. These are what
   *  an MCP client sees from `tools/list`. Each composite dispatches N
   *  underlying actions (see `actions` for the total). */
  tools: string[];
  /** Total underlying action count across all composites (excludes the
   *  platform admin set, which is gated separately). */
  actions: number;
}

export function createMcpStatusRoutes(_ctx: AppContext): Hono {
  const api = new Hono();

  const tools = Object.keys(COMPOSITE_REGISTRY);
  const actions =
    DEPLOY_ACTIONS.length +
    PROJECT_ACTIONS.length +
    SERVICE_ACTIONS.length +
    MANAGED_SERVICE_ACTIONS.length +
    MONITOR_ACTIONS.length;

  api.get('/mcp/status', (c) => {
    const snapshot = getMcpSessionsSnapshot();
    const sessions: McpStatusSession[] = snapshot.map((s) => ({
      id: s.id.slice(0, 12),
      transport: s.transport,
      connectedAt: new Date(s.connectedAt).toISOString(),
      lastActivityAt: new Date(s.lastActivityAt).toISOString(),
      clientName: s.clientName,
      clientVersion: s.clientVersion,
    }));

    const body: McpStatusResponse = {
      endpoint: '/mcp',
      totalConnected: sessions.length,
      sessions,
      tools,
      actions,
    };
    return c.json(body);
  });

  api.delete('/mcp/sessions/:id', (c) => {
    const sid = c.req.param('id');
    const ok = terminateMcpSession(sid);
    if (!ok) {
      return c.json({ error: 'NOT_FOUND', message: 'MCP session not found' }, 404);
    }
    return c.json({ status: 'terminated', id: sid });
  });

  return api;
}
