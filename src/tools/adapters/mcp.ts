import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AppContext } from '../../app.js';
import type { ToolDef } from '../defs/types.js';

const agentExecuteGoalSchema = z.object({
  goal: z.string().min(1).describe('The goal for the agent to accomplish using available tools'),
});

const agentExecuteGoalDescription =
  'Run the AI agent to accomplish a complex goal. The agent reasons about steps and chains multiple tools (deploy, configure, debug, etc.) automatically. Use this for multi-step tasks instead of calling individual tools.';

function toInputSchema(schema: z.ZodType) {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema['$schema'];
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

export function registerMcpTools(
  server: McpRequestHandlerServer,
  defs: ToolDef[],
  appCtx: AppContext,
): void {
  const mcpDefs = defs.filter(isMcpTargeted);

  server.setRequestHandler(ListToolsRequestSchema, () => {
    const tools = mcpDefs.map((def) => ({
      name: def.name,
      description: def.mcpDescription ?? def.description,
      inputSchema: toInputSchema(def.inputSchema),
    }));

    tools.push({
      name: 'agent_execute_goal',
      description: agentExecuteGoalDescription,
      inputSchema: toInputSchema(agentExecuteGoalSchema),
    });

    return Promise.resolve({ tools });
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const toolName = request.params.name;
      const rawArgs = request.params.arguments ?? {};

      if (toolName === 'agent_execute_goal') {
        const parsed = agentExecuteGoalSchema.safeParse(rawArgs);
        if (!parsed.success) {
          throw new McpError(ErrorCode.InvalidParams, parsed.error.message);
        }

        if (!appCtx.agent) {
          return successResponse({
            error: 'Agent requires an LLM provider. Configure one in OpenLander settings first.',
          });
        }

        const sessionId = `mcp-${String(Date.now())}`;
        const response = await appCtx.agent.chat(parsed.data.goal, sessionId);
        return successResponse({
          message: response.message,
          toolResults: response.toolResults ?? [],
          sessionId,
        });
      }

      const def = mcpDefs.find((item) => item.name === toolName);
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
