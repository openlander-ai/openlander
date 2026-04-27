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
import { getMcpSessionsSnapshot } from '../../mcp/server.js';

export interface McpStatusSession {
  id: string; // truncated session ID (first 12 chars)
  transport: 'http' | 'sse';
  connectedAt: string; // ISO 8601
  lastActivityAt: string; // ISO 8601
}

export interface McpStatusResponse {
  endpoint: string;
  totalConnected: number;
  sessions: McpStatusSession[];
}

export function createMcpStatusRoutes(_ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/mcp/status', (c) => {
    const snapshot = getMcpSessionsSnapshot();
    const sessions: McpStatusSession[] = snapshot.map((s) => ({
      id: s.id.slice(0, 12),
      transport: s.transport,
      connectedAt: new Date(s.connectedAt).toISOString(),
      lastActivityAt: new Date(s.lastActivityAt).toISOString(),
    }));

    const body: McpStatusResponse = {
      endpoint: '/mcp',
      totalConnected: sessions.length,
      sessions,
    };
    return c.json(body);
  });

  return api;
}
