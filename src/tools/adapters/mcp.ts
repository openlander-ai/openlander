import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { AppContext } from '../../app.js';
import type { CompositeTool } from '../../mcp/composite-tools.js';
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

function errorResponse(error: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: message }],
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

        const result = await composite.execute(parsed.data, { target: 'mcp', appCtx });
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

      const result = await def.execute(parsed.data, { target: 'mcp', appCtx });
      const transformed = def.mcp?.transformResult ? def.mcp.transformResult(result) : result;
      return successResponse(transformed);
    } catch (error) {
      return errorResponse(error);
    }
  });
}
