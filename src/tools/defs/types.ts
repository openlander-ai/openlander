import type { z } from 'zod';
import type { AppContext } from '../../app.js';
import type { RiskLevel } from '../../llm/decision.js';
import type { RequestIdentity } from '../../types/identity.js';

/**
 * Target platform for tool execution.
 * - 'agent': Vercel AI SDK tool calling (chat-driven)
 * - 'mcp': MCP server (external client)
 */
export type ToolTarget = 'agent' | 'mcp';

/**
 * Execution context passed to tool execute functions.
 * Allows target-aware behavior (e.g., different response shapes, triggers).
 */
export interface ToolContext {
  target: ToolTarget;
  appCtx: AppContext;
  identity?: RequestIdentity;
}

/**
 * MCP-specific result transformation hook.
 * Applied after tool execution to shape response for MCP clients.
 */
export interface McpResultTransform {
  transformResult?: (result: unknown) => unknown;
}

/**
 * Unified tool definition interface.
 * Single source of truth for both AI SDK and MCP adapters.
 *
 * Fields:
 * - name: Tool identifier (snake_case, immutable for MCP compatibility)
 * - description: Human-readable description (used by both adapters)
 * - mcpDescription: Optional MCP-specific description (overrides description if provided)
 * - inputSchema: Zod schema for input validation
 * - execute: Tool execution function (target-aware via context)
 * - targets: Optional list of targets this tool is exposed to (default: ['agent', 'mcp'])
 * - mcp: Optional MCP-specific metadata (result transformation, etc.)
 * - riskLevel: Risk classification for Decision Engine (low/medium/high)
 */
export interface ToolDef {
  name: string;
  description: string;
  mcpDescription?: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  execute: (args: Record<string, unknown>, context: ToolContext) => unknown;
  riskLevel?: RiskLevel;
  targets?: ToolTarget[];
  mcp?: McpResultTransform;
}
