import { z } from 'zod';
import type { ToolDef } from '../tools/defs/types.js';

export type JsonObject = Record<string, unknown>;

export interface ToolInputContract {
  name: string;
  description: string;
  input_schema: JsonObject;
  allowed_params: string[];
  required_params: string[];
  optional_params: string[];
}

function asObject(value: unknown): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

export function toolSchemaToJson(schema: z.ZodType): JsonObject {
  const jsonSchema = z.toJSONSchema(schema) as JsonObject;
  delete jsonSchema['$schema'];
  return jsonSchema;
}

export function buildToolInputContract(input: {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}): ToolInputContract {
  const inputSchema = toolSchemaToJson(input.inputSchema);
  const properties = asObject(inputSchema['properties']) ?? {};
  const allowedParams = Object.keys(properties).sort();
  const requiredParams = stringList(inputSchema['required'])
    .filter((name) => allowedParams.includes(name))
    .sort();
  const optionalParams = allowedParams.filter((name) => !requiredParams.includes(name)).sort();

  return {
    name: input.name,
    description: input.description,
    input_schema: inputSchema,
    allowed_params: allowedParams,
    required_params: requiredParams,
    optional_params: optionalParams,
  };
}

export function buildActionContract(def: ToolDef): ToolInputContract {
  return buildToolInputContract({
    name: def.name,
    description: def.mcpDescription ?? def.description,
    inputSchema: def.inputSchema,
  });
}

function shouldRejectUnknownTopLevelParams(contract: ToolInputContract): boolean {
  return (
    contract.input_schema['type'] === 'object' &&
    contract.input_schema['additionalProperties'] === false
  );
}

export function unknownTopLevelParams(
  params: Record<string, unknown>,
  contract: ToolInputContract,
): string[] {
  if (!shouldRejectUnknownTopLevelParams(contract)) {
    return [];
  }

  return Object.keys(params)
    .filter((name) => !contract.allowed_params.includes(name))
    .sort();
}

export function requiredParamsTemplate(contract: ToolInputContract): Record<string, unknown> {
  const properties = asObject(contract.input_schema['properties']) ?? {};
  const template: Record<string, unknown> = {};

  for (const name of contract.required_params) {
    const property = asObject(properties[name]);
    const type = property?.['type'];
    const enumValues = Array.isArray(property?.['enum']) ? property['enum'] : undefined;

    if (enumValues?.[0] !== undefined) {
      template[name] = enumValues[0];
    } else if (type === 'boolean') {
      template[name] = true;
    } else if (type === 'number' || type === 'integer') {
      template[name] = 1;
    } else {
      template[name] = `<${name}>`;
    }
  }

  return template;
}

export function suggestedParamsForRetry(
  params: Record<string, unknown>,
  contract: ToolInputContract,
): Record<string, unknown> {
  const suggested = requiredParamsTemplate(contract);

  for (const [name, value] of Object.entries(params)) {
    if (contract.allowed_params.includes(name)) {
      suggested[name] = value;
    }
  }

  return suggested;
}
