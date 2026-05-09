import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { AppContext } from '../../app.js';
import { OpenLanderError } from '../../errors.js';
import type { CompositeTool } from '../../mcp/composite-tools.js';
import { maybeHandleMcpSafety } from '../../mcp/destructive-safety.js';
import type { RequestIdentity } from '../../types/identity.js';
import type { ToolDef } from '../defs/types.js';

function toInputSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  if ('$schema' in jsonSchema) {
    delete jsonSchema['$schema'];
  }
  return jsonSchema;
}

function successResponse(result: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

function sanitizeErrorText(message: string): string {
  if (/failed query|params:|insert into|update\s+".+"|select\s+.+\s+from/i.test(message)) {
    return 'Internal database error.';
  }
  return message.replace(
    /(sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_]*TOKEN[A-Za-z0-9_]*=)[^\s,}]+/gi,
    '$1***',
  );
}

function inferErrorCode(message: string): string {
  const match = /^([A-Z][A-Z0-9_]+):/.exec(message);
  return match?.[1] ?? 'TOOL_ERROR';
}

function errorResponse(error: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  let payload: Record<string, unknown>;

  if (error instanceof OpenLanderError) {
    payload = {
      error: error.code,
      code: error.code,
      message: sanitizeErrorText(error.message),
      ...(error.details ? { details: error.details } : {}),
    };
  } else if (error instanceof McpError) {
    const code = `MCP_${String(error.code)}`;
    payload = {
      error: code,
      code,
      message: sanitizeErrorText(error.message),
    };
  } else {
    const message = error instanceof Error ? error.message : String(error);
    const code = inferErrorCode(message);
    payload = {
      error: code,
      code,
      message: sanitizeErrorText(message.replace(/^([A-Z][A-Z0-9_]+):\s*/, '')),
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

function isMcpTargeted(def: ToolDef): boolean {
  return !def.targets || def.targets.includes('mcp');
}

interface McpRequestHandlerServer {
  setRequestHandler(
    schema: unknown,
    handler: (request: { params: { name: string; arguments?: unknown } }) => unknown,
  ): void;
}

export function registerCompositeMcpTools(
  server: McpRequestHandlerServer,
  composites: CompositeTool[],
  platformDefs: ToolDef[],
  appCtx: AppContext,
  identity?: RequestIdentity,
): void {
  const mcpPlatformDefs = platformDefs.filter(isMcpTargeted);

  server.setRequestHandler(ListToolsRequestSchema, () => {
    const tools = [
      ...composites.map((composite) => ({
        name: composite.name,
        description: composite.description,
        inputSchema: toInputSchema(composite.inputSchema),
      })),
      ...mcpPlatformDefs.map((def) => ({
        name: def.name,
        description: def.mcpDescription ?? def.description,
        inputSchema: toInputSchema(def.inputSchema),
      })),
    ];

    return Promise.resolve({ tools });
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const toolName = request.params.name;
      const rawArgs = request.params.arguments ?? {};

      const composite = composites.find((item) => item.name === toolName);
      if (composite) {
        const parsed = composite.inputSchema.safeParse(rawArgs);
        if (!parsed.success) {
          throw new McpError(ErrorCode.InvalidParams, parsed.error.message);
        }

        const result = await composite.execute(parsed.data, { target: 'mcp', appCtx, identity });
        return successResponse(result);
      }

      const def = mcpPlatformDefs.find((item) => item.name === toolName);
      if (!def) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
      }

      const parsed = def.inputSchema.safeParse(rawArgs);
      if (!parsed.success) {
        throw new McpError(ErrorCode.InvalidParams, parsed.error.message);
      }

      const context = { target: 'mcp' as const, appCtx, identity };
      const safetyResult = await maybeHandleMcpSafety(def, parsed.data, context);
      if (safetyResult !== undefined) {
        return successResponse(safetyResult);
      }

      const result = await def.execute(parsed.data, context);
      const transformed = def.mcp?.transformResult ? def.mcp.transformResult(result) : result;
      return successResponse(transformed);
    } catch (error) {
      return errorResponse(error);
    }
  });
}
