import { Hono } from 'hono';

import type { AppContext } from '../../../app.js';
import { loadConfig, saveConfig } from '../../../config/index.js';
import type { McpServerEntry } from '../../../config/index.js';
import { createTools } from '../../../tools/index.js';
import { mergeToolsIfMcpEnabled } from './shared.js';
import { checkUrlSafety, MCP_ALLOWED_SCHEMES } from '../../../lib/url-safety.js';

export function createMcpSetupRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/setup/mcp/servers', (c) => {
    const config = loadConfig();
    return c.json({
      enabled: config.mcp.enabled,
      servers: config.mcp.servers,
      connectedCount: ctx.mcpClientManager.connectedCount,
    });
  });

  api.post('/setup/mcp/servers', async (c) => {
    const body = await c.req.json<{
      name: string;
      transport: 'stdio' | 'sse' | 'http';
      url?: string;
      command?: string;
      args?: string[];
      headers?: Record<string, string>;
      env?: Record<string, string>;
      enabled?: boolean;
    }>();

    if (!body.name || !body.name.trim()) {
      return c.json({ error: 'MISSING_FIELD', message: 'name is required' }, 400);
    }
    if (!['stdio', 'sse', 'http'].includes(body.transport)) {
      return c.json(
        { error: 'INVALID_TRANSPORT', message: 'transport must be stdio, sse, or http' },
        400,
      );
    }
    if (body.transport === 'stdio' && !body.command?.trim()) {
      return c.json(
        { error: 'MISSING_FIELD', message: 'command is required for stdio transport' },
        400,
      );
    }
    if ((body.transport === 'sse' || body.transport === 'http') && !body.url?.trim()) {
      return c.json(
        { error: 'MISSING_FIELD', message: 'url is required for sse/http transport' },
        400,
      );
    }

    // Day 13 M4 (SSRF): refuse to register an MCP endpoint that targets
    // localhost / RFC1918 / cloud metadata. Same allow-list as the git
    // clone path, minus ssh (MCP HTTP transports only).
    if (body.url) {
      const safety = checkUrlSafety(body.url.trim(), { allowedSchemes: MCP_ALLOWED_SCHEMES });
      if (!safety.ok) {
        return c.json(
          { error: 'UNSAFE_URL', message: `Refusing MCP server URL: ${safety.reason ?? 'unsafe'}` },
          400,
        );
      }
    }

    const { nanoid } = await import('nanoid');
    const config = loadConfig();
    const server: McpServerEntry = {
      id: nanoid(12),
      name: body.name.trim(),
      transport: body.transport,
      url: body.url?.trim(),
      command: body.command?.trim(),
      args: body.args,
      headers: body.headers,
      env: body.env,
      enabled: body.enabled !== false,
    };

    config.mcp.servers.push(server);
    config.mcp.enabled = true;
    saveConfig(config);
    ctx.config.mcp = config.mcp;

    return c.json({ status: 'created', server });
  });

  api.delete('/setup/mcp/servers/:id', (c) => {
    const id = c.req.param('id');
    const config = loadConfig();
    const idx = config.mcp.servers.findIndex((s) => s.id === id);

    if (idx === -1) {
      return c.json({ error: 'NOT_FOUND', message: 'Server not found' }, 404);
    }

    config.mcp.servers.splice(idx, 1);
    if (config.mcp.servers.length === 0) {
      config.mcp.enabled = false;
    }
    saveConfig(config);
    ctx.config.mcp = config.mcp;

    return c.json({ status: 'deleted' });
  });

  api.post('/setup/mcp/servers/:id/test', async (c) => {
    const id = c.req.param('id');
    const config = loadConfig();
    const server = config.mcp.servers.find((s) => s.id === id);

    if (!server) {
      return c.json({ error: 'NOT_FOUND', message: 'Server not found' }, 404);
    }

    // Day 13 M4: re-check the stored URL even though POST already validated
    // it — config files can be edited out-of-band, and a connection test
    // hitting an internal endpoint is exactly the SSRF primitive we want to
    // refuse.
    if (server.url && (server.transport === 'sse' || server.transport === 'http')) {
      const safety = checkUrlSafety(server.url, { allowedSchemes: MCP_ALLOWED_SCHEMES });
      if (!safety.ok) {
        return c.json(
          { error: 'UNSAFE_URL', message: `Refusing MCP server URL: ${safety.reason ?? 'unsafe'}` },
          400,
        );
      }
    }

    try {
      const result = await ctx.mcpClientManager.testConnection(server);
      return c.json({ status: 'ok', tools: result.tools });
    } catch (error) {
      return c.json(
        {
          status: 'failed',
          message: error instanceof Error ? error.message : 'Connection failed',
        },
        500,
      );
    }
  });

  api.post('/setup/mcp/reconnect', async (c) => {
    const config = loadConfig();
    ctx.config.mcp = config.mcp;

    await ctx.mcpClientManager.disconnectAll();

    if (!config.mcp.enabled || config.mcp.servers.length === 0) {
      if (ctx.agent) {
        ctx.agent.setTools(createTools(ctx, ctx.questionBridge));
      }
      return c.json({ status: 'disconnected', connected: 0 });
    }

    const enabled = config.mcp.servers.filter((s) => s.enabled);
    await ctx.mcpClientManager.connectAll(enabled);

    if (ctx.agent) {
      const tools = await mergeToolsIfMcpEnabled(ctx, createTools(ctx, ctx.questionBridge));
      ctx.agent.setTools(tools);
    }

    return c.json({
      status: 'connected',
      connected: ctx.mcpClientManager.connectedCount,
    });
  });

  return api;
}
