import type { z } from 'zod';

import type { AppContext } from '../app.js';

export type ApplicationOperationKind = 'query' | 'command';
export type ApplicationOperationScope = 'instance' | 'org' | 'project' | 'service';
export type ApplicationOperationExecution = 'sync' | 'async';
export type ApplicationOperationIdempotency = 'none' | 'optional' | 'required';

export interface ApplicationOperationActor {
  source: 'web' | 'rest' | 'mcp' | 'internal';
  scope: ApplicationOperationScope;
  instanceId: string;
  projectId?: string;
  serviceId?: string;
  label: string;
}

export interface ApplicationOperationContext {
  appCtx: AppContext;
  actor: ApplicationOperationActor;
  operationId: string | null;
}

export interface ApplicationOperationDefinition {
  name: string;
  version: number;
  description: string;
  kind: ApplicationOperationKind;
  execution: ApplicationOperationExecution;
  idempotency: ApplicationOperationIdempotency;
  allowedScopes: readonly ApplicationOperationScope[];
  projectIdField?: string;
  serviceIdField?: string;
  resolveScopeTarget?: (
    input: Record<string, unknown>,
    appCtx: AppContext,
  ) => Promise<{ projectId?: string; serviceId?: string }>;
  inputSchema: z.ZodType<Record<string, unknown>>;
  outputSchema: z.ZodType<Record<string, unknown>>;
  activity: {
    recordsActivity: boolean;
    recordsEvidence: boolean;
  };
  execute: (
    input: Record<string, unknown>,
    context: ApplicationOperationContext,
  ) => Promise<Record<string, unknown>>;
}

export interface ExecuteApplicationOperationOptions {
  actor: ApplicationOperationActor;
  idempotencyKey?: string;
  version?: number;
}

export interface ApplicationOperationExecutionResult {
  operation_id: string | null;
  operation: string;
  version: number;
  status: 'succeeded';
  replayed: boolean;
  result: Record<string, unknown>;
}
