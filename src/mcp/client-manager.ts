import { createMCPClient } from '@ai-sdk/mcp';
import type { MCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';
import type { McpServerEntry } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('mcp-client');

/**
 * MCP Client Manager.
 *
 * Connects to external MCP servers and exposes their tools
 * as AI SDK ToolSet for the agent to consume.
 *
 * Design:
 * - One MCPClient per configured server
 * - Error isolation: one server failing doesn't break others
 * - Tool name prefixed with server name to avoid collisions with built-in tools
 * - Graceful lifecycle: connectAll() / disconnectAll()
 */
export class McpClientManager {
  private clients = new Map<string, MCPClient>();
  private serverNames = new Map<string, string>();

  /**
   * Connect to all enabled MCP servers.
   * Errors are logged and isolated — one failing server won't block others.
   */
  async connectAll(servers: McpServerEntry[]): Promise<void> {
    const enabled = servers.filter((s) => s.enabled);
    if (enabled.length === 0) {
      log.debug('No MCP servers configured');
      return;
    }

    const results = await Promise.allSettled(
      enabled.map(async (server) => {
        try {
          const client = await this.connectOne(server);
          this.clients.set(server.id, client);
          this.serverNames.set(server.id, server.name);
          log.info({ serverId: server.id, name: server.name }, 'MCP server connected');
        } catch (err) {
          log.error(
            { err, serverId: server.id, name: server.name },
            'MCP server connection failed',
          );
          throw err;
        }
      }),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    const connected = results.filter((r) => r.status === 'fulfilled').length;
    log.info({ connected, failed, total: enabled.length }, 'MCP client connections complete');
  }

  /**
   * Connect to a single MCP server.
   */
  private async connectOne(server: McpServerEntry): Promise<MCPClient> {
    if (server.transport === 'stdio') {
      if (!server.command) {
        throw new Error(`MCP server "${server.name}" uses stdio but has no command`);
      }

      // Dynamic import for stdio transport (Node.js only)
      const { Experimental_StdioMCPTransport } = await import('@ai-sdk/mcp/mcp-stdio');

      return createMCPClient({
        transport: new Experimental_StdioMCPTransport({
          command: server.command,
          args: server.args,
          env: server.env,
        }),
        name: `openlander-${server.name}`,
      });
    }

    // SSE or HTTP transport
    if (!server.url) {
      throw new Error(`MCP server "${server.name}" uses ${server.transport} but has no url`);
    }

    return createMCPClient({
      transport: {
        type: server.transport === 'sse' ? 'sse' : 'http',
        url: server.url,
        headers: server.headers,
      },
      name: `openlander-${server.name}`,
    });
  }

  /**
   * Get merged tools from all connected MCP servers.
   *
   * Tool names are prefixed with `{serverName}__` to avoid collisions
   * with the agent's built-in tools.
   */
  async getTools(): Promise<ToolSet> {
    const merged: ToolSet = {};

    for (const [serverId, client] of this.clients) {
      const name = this.serverNames.get(serverId) ?? serverId;
      const prefix = sanitizePrefix(name);

      try {
        const tools = await client.tools();
        for (const [toolName, tool] of Object.entries(tools)) {
          const prefixedName = `${prefix}__${toolName}`;
          merged[prefixedName] = tool;
        }
        log.debug(
          { serverId, toolCount: Object.keys(tools).length },
          'Tools loaded from MCP server',
        );
      } catch (err) {
        log.error({ err, serverId, name }, 'Failed to load tools from MCP server');
        // Continue with other servers
      }
    }

    return merged;
  }

  /**
   * Test connection to a single MCP server entry.
   * Returns tool count on success, throws on failure.
   */
  async testConnection(server: McpServerEntry): Promise<{ tools: number }> {
    const client = await this.connectOne(server);
    try {
      const tools = await client.tools();
      const count = Object.keys(tools).length;
      return { tools: count };
    } finally {
      await client.close().catch(() => {});
    }
  }

  /**
   * Disconnect all MCP clients gracefully.
   */
  async disconnectAll(): Promise<void> {
    const entries = [...this.clients.entries()];
    this.clients.clear();
    this.serverNames.clear();

    await Promise.allSettled(
      entries.map(async ([serverId, client]) => {
        try {
          await client.close();
          log.debug({ serverId }, 'MCP client disconnected');
        } catch (err) {
          log.debug({ err, serverId }, 'MCP client disconnect error (ignored)');
        }
      }),
    );
  }

  /** Number of connected servers. */
  get connectedCount(): number {
    return this.clients.size;
  }
}

/**
 * Helper: merge built-in agent tools with MCP tools.
 * If MCP client manager has connected servers, fetches their tools and merges.
 * Built-in tools take priority on name collision (MCP tools are prefixed, so unlikely).
 */
export async function mergeWithMcpTools(
  builtinTools: ToolSet,
  mcpClientManager: McpClientManager,
): Promise<ToolSet> {
  if (mcpClientManager.connectedCount === 0) {
    return builtinTools;
  }

  try {
    const mcpTools = await mcpClientManager.getTools();
    const mcpToolCount = Object.keys(mcpTools).length;
    if (mcpToolCount > 0) {
      log.info({ mcpToolCount }, 'Merging MCP tools with agent tools');
      return { ...mcpTools, ...builtinTools }; // built-in tools override on collision
    }
  } catch (err) {
    log.error({ err }, 'Failed to load MCP tools, using built-in tools only');
  }

  return builtinTools;
}

/**
 * Sanitize server name for use as tool name prefix.
 * Replaces non-alphanumeric chars with underscores, lowercases.
 */
function sanitizePrefix(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
