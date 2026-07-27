import { z } from 'zod';

import { applicationOperationActorFromToolContext } from '../../operations/index.js';
import { agentDeliveryOperations } from '../../operations/definitions/delivery.js';
import {
  applyProjectManifestOperation,
  getProjectManifestOperation,
} from '../../operations/definitions/project-manifest.js';
import { projectUpdateOperations } from '../../operations/definitions/project-update.js';
import type { ApplicationOperationDefinition } from '../../operations/types.js';
import type { ToolDef } from './types.js';

function operationCallToMcp(value: unknown, composite: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const call = value as Record<string, unknown>;
  if (typeof call['operation'] !== 'string') return value;
  const input =
    call['input'] && typeof call['input'] === 'object' && !Array.isArray(call['input'])
      ? (call['input'] as Record<string, unknown>)
      : {};
  return {
    tool: composite,
    arguments: {
      action: call['operation'],
      params: input,
    },
  };
}

function resultForMcp(
  result: Record<string, unknown>,
  execution: { operation_id: string | null; version: number; replayed: boolean },
  composite: string,
): Record<string, unknown> {
  return {
    ...result,
    ...(result['status_call']
      ? { status_call: operationCallToMcp(result['status_call'], composite) }
      : {}),
    ...(result['suggested_call']
      ? { suggested_call: operationCallToMcp(result['suggested_call'], composite) }
      : {}),
    operation_id: execution.operation_id,
    operation_version: execution.version,
    replayed: execution.replayed,
  };
}

export function operationToolDef(
  definition: ApplicationOperationDefinition,
  composite = 'openlander_project',
  riskLevel: ToolDef['riskLevel'] = 'low',
): ToolDef {
  const operationInput = definition.inputSchema as z.ZodObject<z.ZodRawShape>;
  const inputSchema =
    definition.kind === 'command'
      ? operationInput.extend({
          idempotency_key: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .describe('Stable key for exact command retries'),
        })
      : operationInput;
  return {
    name: definition.name,
    description: definition.description,
    riskLevel,
    targets: ['mcp'],
    inputSchema,
    execute: async (args, context) => {
      const { idempotency_key: idempotencyKey, ...input } = args;
      const execution = await context.appCtx.operations.execute(
        context.appCtx,
        definition.name,
        input,
        {
          actor: applicationOperationActorFromToolContext(context),
          ...(typeof idempotencyKey === 'string' ? { idempotencyKey } : {}),
        },
      );
      return resultForMcp(execution.result, execution, composite);
    },
  };
}

export const agentDeliveryToolDefs: ToolDef[] = agentDeliveryOperations.map((definition) =>
  operationToolDef(definition),
);
export const projectManifestToolDefs: ToolDef[] = [
  applyProjectManifestOperation,
  getProjectManifestOperation,
  ...projectUpdateOperations,
].map((definition) => operationToolDef(definition));
