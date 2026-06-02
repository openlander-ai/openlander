import { z } from 'zod';
import type { ToolDef } from '../tools/defs/types.js';

export interface ToolCallLink {
  tool: string;
  arguments: {
    action?: string;
    params?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface ToolInputContract {
  input_schema: Record<string, unknown>;
  allowed_params: string[];
  required_params: string[];
  optional_params: string[];
  required_one_of?: string[][];
}

export interface ActionContract extends ToolInputContract {
  name: string;
  description: string;
}

const REQUIRED_ONE_OF_BY_ACTION: Record<string, string[][]> = {
  create_deploy_plan: [['repo_url'], ['source', 'image']],
  deploy: [['repo_url'], ['source', 'image']],
  cancel_deploy: [['deploy_id'], ['project_id'], ['project_name'], ['id']],
  update_project_config: [['dockerfile_path'], ['docker_target'], ['build_context']],
};

function toInputSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  if ('$schema' in jsonSchema) {
    delete jsonSchema['$schema'];
  }
  return jsonSchema;
}

function schemaProperties(inputSchema: Record<string, unknown>): Record<string, unknown> {
  const properties = inputSchema['properties'];
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    return properties as Record<string, unknown>;
  }
  return {};
}

function schemaRequired(inputSchema: Record<string, unknown>): string[] {
  const required = inputSchema['required'];
  if (Array.isArray(required)) {
    return required.filter((item): item is string => typeof item === 'string').sort();
  }
  return [];
}

function compactSchema(inputSchema: Record<string, unknown>): Record<string, unknown> {
  const properties = schemaProperties(inputSchema);
  const required = schemaRequired(inputSchema);
  return {
    type: inputSchema['type'] ?? 'object',
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
    ...(required.length > 0 ? { required } : {}),
    ...(inputSchema['additionalProperties'] !== undefined
      ? { additionalProperties: inputSchema['additionalProperties'] }
      : {}),
  };
}

export function buildToolInputContract(def: ToolDef): ToolInputContract {
  const inputSchema = compactSchema(toInputSchema(def.inputSchema));
  const allowedParams = Object.keys(schemaProperties(inputSchema)).sort();
  const requiredParams = schemaRequired(inputSchema);
  const optionalParams = allowedParams.filter((name) => !requiredParams.includes(name));
  const requiredOneOf = REQUIRED_ONE_OF_BY_ACTION[def.name];

  return {
    input_schema: inputSchema,
    allowed_params: allowedParams,
    required_params: requiredParams,
    optional_params: optionalParams,
    ...(requiredOneOf ? { required_one_of: requiredOneOf } : {}),
  };
}

export function buildActionContract(def: ToolDef): ActionContract {
  return {
    name: def.name,
    description: def.mcpDescription ?? def.description,
    ...buildToolInputContract(def),
  };
}

export function suggestedParamsForRetry(def: ToolDef): Record<string, unknown> {
  const contract = buildToolInputContract(def);
  const required = contract.required_params.length
    ? contract.required_params
    : (contract.required_one_of?.[0] ?? []);
  return Object.fromEntries(required.map((name) => [name, `<${name}>`]));
}

export function buildHelpCall(toolName: string, actionName?: string): ToolCallLink {
  return {
    tool: toolName,
    arguments: {
      action: 'help',
      ...(actionName ? { params: { action_name: actionName } } : {}),
    },
  };
}

export function buildActionCall(
  toolName: string,
  actionName: string,
  params?: Record<string, unknown>,
): ToolCallLink {
  return {
    tool: toolName,
    arguments: {
      action: actionName,
      ...(params ? { params } : {}),
    },
  };
}

export function unknownTopLevelParams(
  args: Record<string, unknown>,
  allowed: readonly string[],
): string[] {
  const allowedSet = new Set(allowed);
  return Object.keys(args)
    .filter((name) => !allowedSet.has(name))
    .sort();
}
