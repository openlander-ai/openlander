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
import { getMcpInstanceContext, type McpInstanceContext } from '../../mcp/instance-identity.js';
import {
  buildToolInputContract,
  requiredParamsTemplate,
  suggestedParamsForRetry,
  unknownTopLevelParams,
  type ToolInputContract,
} from '../../mcp/schema-guidance.js';
import type { RequestIdentity } from '../../types/identity.js';
import type { ToolDef } from '../defs/types.js';

function toInputSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  if ('$schema' in jsonSchema) {
    delete jsonSchema['$schema'];
  }
  return jsonSchema;
}

function attachInstance(result: unknown, instance: McpInstanceContext): unknown {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), _instance: instance };
  }
  return { result, _instance: instance };
}

function successResponse(
  result: unknown,
  instance: McpInstanceContext,
): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(attachInstance(result, instance), null, 2) }],
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

function errorResponse(
  error: unknown,
  instance: McpInstanceContext,
): {
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
    content: [{ type: 'text', text: JSON.stringify({ ...payload, _instance: instance }, null, 2) }],
    isError: true,
  };
}

function isMcpTargeted(def: ToolDef): boolean {
  return !def.targets || def.targets.includes('mcp');
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function nestedParamsSuggestion(
  rawArgs: unknown,
  contract: ToolInputContract,
): Record<string, unknown> | undefined {
  const args = asObject(rawArgs);
  const nestedParams = asObject(args?.['params']);
  if (!nestedParams) {
    return undefined;
  }

  const nestedKeys = Object.keys(nestedParams);
  if (nestedKeys.length === 0) {
    return undefined;
  }

  if (nestedKeys.every((key) => contract.allowed_params.includes(key))) {
    return suggestedParamsForRetry(nestedParams, contract);
  }

  return undefined;
}

function invalidMcpToolParamsResponse(
  toolName: string,
  contract: ToolInputContract,
  details: string,
  rawArgs: unknown,
  unknownParams: string[] = [],
): Record<string, unknown> {
  const suggestedArguments =
    nestedParamsSuggestion(rawArgs, contract) ??
    (contract.allowed_params.includes('action')
      ? { action: 'help' }
      : requiredParamsTemplate(contract));
  const hasNestedParams = unknownParams.includes('params');

  return {
    error: 'INVALID_PARAMS',
    tool: toolName,
    details,
    unknown_params: unknownParams,
    allowed_params: contract.allowed_params,
    required_params: contract.required_params,
    optional_params: contract.optional_params,
    ...(contract.required_one_of ? { required_one_of: contract.required_one_of } : {}),
    input_schema: contract.input_schema,
    suggested_call: {
      tool: toolName,
      arguments: suggestedArguments,
    },
    _agent_guidance: {
      message: hasNestedParams
        ? `${toolName} is a direct MCP tool. Pass ${contract.allowed_params.join(', ') || 'its arguments'} at the top level; do not wrap them in params.`
        : `Invalid parameters for ${toolName}. Use input_schema and allowed_params from this response and retry.`,
      next_steps: [
        hasNestedParams
          ? `Retry ${toolName} with the nested params object flattened into top-level arguments.`
          : `Retry ${toolName} with only top-level arguments from allowed_params.`,
      ],
    },
  };
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
    const instance = getMcpInstanceContext(appCtx.config);
    try {
      const toolName = request.params.name;
      const rawArgs = request.params.arguments ?? {};

      const composite = composites.find((item) => item.name === toolName);
      if (composite) {
        const contract = buildToolInputContract({
          name: composite.name,
          description: composite.description,
          inputSchema: composite.inputSchema,
        });
        const rawArgsObject = asObject(rawArgs) ?? {};
        const unknownParams = unknownTopLevelParams(rawArgsObject, contract);
        if (unknownParams.length > 0) {
          return successResponse(
            invalidMcpToolParamsResponse(
              toolName,
              contract,
              `Unknown top-level parameter(s): ${unknownParams.join(', ')}`,
              rawArgs,
              unknownParams,
            ),
            instance,
          );
        }

        const parsed = composite.inputSchema.safeParse(rawArgs);
        if (!parsed.success) {
          return successResponse(
            invalidMcpToolParamsResponse(toolName, contract, parsed.error.message, rawArgs),
            instance,
          );
        }

        const result = await composite.execute(parsed.data, { target: 'mcp', appCtx, identity });
        return successResponse(result, instance);
      }

      const def = mcpPlatformDefs.find((item) => item.name === toolName);
      if (!def) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
      }

      const contract = buildToolInputContract({
        name: def.name,
        description: def.mcpDescription ?? def.description,
        inputSchema: def.inputSchema,
      });
      const rawArgsObject = asObject(rawArgs) ?? {};
      const unknownParams = unknownTopLevelParams(rawArgsObject, contract);
      if (unknownParams.length > 0) {
        return successResponse(
          invalidMcpToolParamsResponse(
            toolName,
            contract,
            `Unknown top-level parameter(s): ${unknownParams.join(', ')}`,
            rawArgs,
            unknownParams,
          ),
          instance,
        );
      }

      const parsed = def.inputSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return successResponse(
          invalidMcpToolParamsResponse(toolName, contract, parsed.error.message, rawArgs),
          instance,
        );
      }

      const context = { target: 'mcp' as const, appCtx, identity };
      const safetyResult = await maybeHandleMcpSafety(def, parsed.data, context);
      if (safetyResult !== undefined) {
        return successResponse(safetyResult, instance);
      }

      const result = await def.execute(parsed.data, context);
      const transformed = def.mcp?.transformResult ? def.mcp.transformResult(result) : result;
      return successResponse(transformed, instance);
    } catch (error) {
      return errorResponse(error, instance);
    }
  });
}
