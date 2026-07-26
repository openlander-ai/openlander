import { createHash, randomUUID } from 'node:crypto';

import type { AppContext } from '../app.js';
import {
  ApplicationOperationIdempotencyConflictError,
  ApplicationOperationIdempotencyRequiredError,
  ApplicationOperationInProgressError,
  ApplicationOperationContractError,
  ApplicationOperationNotFoundError,
  ApplicationOperationScopeError,
  ApplicationOperationValidationError,
  OpenLanderError,
} from '../errors.js';
import { applicationOperationActorScopeKey } from './actor.js';
import { engagementOperations } from './definitions/engagement.js';
import { agentDeliveryOperations } from './definitions/delivery.js';
import {
  applyProjectManifestOperation,
  getProjectManifestOperation,
} from './definitions/project-manifest.js';
import { projectUpdateOperations } from './definitions/project-update.js';
import { releaseOperations } from './definitions/release.js';
import { reportingOperations } from './definitions/reporting.js';
import type {
  ApplicationOperationActor,
  ApplicationOperationDefinition,
  ApplicationOperationExecutionResult,
  ExecuteApplicationOperationOptions,
} from './types.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function requestSha256(input: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(input)))
    .digest('hex');
}

function serializeFailure(error: unknown): Record<string, unknown> {
  if (error instanceof OpenLanderError) return error.toJSON();
  return {
    error: 'OPERATION_FAILED',
    code: 'OPERATION_FAILED',
    message: 'Application operation failed.',
  };
}

async function assertScope(
  definition: ApplicationOperationDefinition,
  input: Record<string, unknown>,
  actor: ApplicationOperationActor,
  appCtx: AppContext,
): Promise<void> {
  if (!definition.allowedScopes.includes(actor.scope)) {
    throw new ApplicationOperationScopeError(definition.name, {
      actorScope: actor.scope,
      allowedScopes: definition.allowedScopes,
    });
  }
  const resolvedTarget =
    actor.scope === 'project' || actor.scope === 'service'
      ? await definition.resolveScopeTarget?.(input, appCtx)
      : undefined;
  if (actor.scope === 'project') {
    const field = definition.projectIdField;
    const directTarget = field ? input[field] : undefined;
    const target = typeof directTarget === 'string' ? directTarget : resolvedTarget?.projectId;
    if (typeof target !== 'string' || target !== actor.projectId) {
      throw new ApplicationOperationScopeError(definition.name, {
        actorScope: actor.scope,
        actorProjectId: actor.projectId ?? null,
        targetProjectId: typeof target === 'string' ? target : null,
      });
    }
  }
  if (actor.scope === 'service') {
    const field = definition.serviceIdField;
    const directTarget = field ? input[field] : undefined;
    const target = typeof directTarget === 'string' ? directTarget : resolvedTarget?.serviceId;
    if (typeof target !== 'string' || target !== actor.serviceId) {
      throw new ApplicationOperationScopeError(definition.name, {
        actorScope: actor.scope,
        actorServiceId: actor.serviceId ?? null,
        targetServiceId: typeof target === 'string' ? target : null,
      });
    }
  }
}

export class ApplicationOperationRegistry {
  private readonly definitions = new Map<string, ApplicationOperationDefinition>();

  constructor(definitions: readonly ApplicationOperationDefinition[]) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.name)) {
        throw new ApplicationOperationContractError(definition.name, {
          reason: 'duplicate_registration',
        });
      }
      this.definitions.set(definition.name, definition);
    }
  }

  list(): Array<
    Omit<ApplicationOperationDefinition, 'execute' | 'inputSchema' | 'outputSchema'> & {
      input_schema: Record<string, unknown>;
      output_schema: Record<string, unknown>;
    }
  > {
    return [...this.definitions.values()].map((definition) => ({
      name: definition.name,
      version: definition.version,
      description: definition.description,
      kind: definition.kind,
      execution: definition.execution,
      idempotency: definition.idempotency,
      allowedScopes: definition.allowedScopes,
      projectIdField: definition.projectIdField,
      serviceIdField: definition.serviceIdField,
      activity: definition.activity,
      input_schema: definition.inputSchema.toJSONSchema(),
      output_schema: definition.outputSchema.toJSONSchema(),
    }));
  }

  get(name: string): ApplicationOperationDefinition {
    const definition = this.definitions.get(name);
    if (!definition) throw new ApplicationOperationNotFoundError(name);
    return definition;
  }

  async execute(
    appCtx: AppContext,
    name: string,
    rawInput: unknown,
    options: ExecuteApplicationOperationOptions,
  ): Promise<ApplicationOperationExecutionResult> {
    const definition = this.get(name);
    if (options.version !== undefined && options.version !== definition.version) {
      throw new ApplicationOperationValidationError(name, [
        { path: ['version'], message: `Expected version ${String(definition.version)}` },
      ]);
    }
    const parsed = definition.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ApplicationOperationValidationError(name, parsed.error.issues);
    }
    const input = parsed.data;
    await assertScope(definition, input, options.actor, appCtx);

    if (definition.kind === 'query') {
      const result = await definition.execute(input, {
        appCtx,
        actor: options.actor,
        operationId: null,
      });
      const output = definition.outputSchema.safeParse(result);
      if (!output.success) {
        throw new ApplicationOperationContractError(name, {
          reason: 'output_schema_mismatch',
          issues: output.error.issues,
        });
      }
      return {
        operation_id: null,
        operation: name,
        version: definition.version,
        status: 'succeeded',
        replayed: false,
        result: output.data,
      };
    }

    const idempotencyKey = options.idempotencyKey?.trim();
    if (definition.idempotency === 'required' && !idempotencyKey) {
      throw new ApplicationOperationIdempotencyRequiredError(name);
    }
    const effectiveKey = idempotencyKey || `ephemeral:${randomUUID()}`;
    const hash = requestSha256(input);
    const claim = await appCtx.db.claimApplicationOperation({
      operationName: name,
      operationVersion: definition.version,
      actorScopeKey: applicationOperationActorScopeKey(options.actor),
      idempotencyKey: effectiveKey,
      requestSha256: hash,
    });
    let invocation = claim.invocation;
    if (!claim.claimed) {
      if (invocation.request_sha256 !== hash) {
        throw new ApplicationOperationIdempotencyConflictError(name, effectiveKey);
      }
      if (invocation.status === 'succeeded' && invocation.response_json) {
        return {
          operation_id: invocation.id,
          operation: name,
          version: definition.version,
          status: 'succeeded',
          replayed: true,
          result: invocation.response_json,
        };
      }
      if (invocation.status === 'running') {
        throw new ApplicationOperationInProgressError(name, invocation.id);
      }
      invocation = await appCtx.db.retryFailedApplicationOperation(invocation.id);
    }

    try {
      const result = await definition.execute(input, {
        appCtx,
        actor: options.actor,
        operationId: invocation.id,
      });
      const output = definition.outputSchema.safeParse(result);
      if (!output.success) {
        throw new ApplicationOperationContractError(name, {
          reason: 'output_schema_mismatch',
          issues: output.error.issues,
        });
      }
      await appCtx.db.succeedApplicationOperation(invocation.id, output.data);
      return {
        operation_id: invocation.id,
        operation: name,
        version: definition.version,
        status: 'succeeded',
        replayed: false,
        result: output.data,
      };
    } catch (error) {
      await appCtx.db.failApplicationOperation(invocation.id, serializeFailure(error));
      throw error;
    }
  }

  async status(
    appCtx: AppContext,
    operationId: string,
    actor: ApplicationOperationActor,
  ): Promise<Record<string, unknown>> {
    const invocation = await appCtx.db.getApplicationOperationById(operationId);
    if (!invocation) throw new ApplicationOperationNotFoundError(operationId);
    const actorScopeKey = applicationOperationActorScopeKey(actor);
    if (actor.scope !== 'instance' && invocation.actor_scope_key !== actorScopeKey) {
      throw new ApplicationOperationScopeError(invocation.operation_name, {
        actorScope: actor.scope,
        operationId,
      });
    }
    return {
      operation_id: invocation.id,
      operation: invocation.operation_name,
      version: invocation.operation_version,
      status: invocation.status,
      result: invocation.response_json,
      error: invocation.error_json,
      created_at: invocation.created_at,
      updated_at: invocation.updated_at,
    };
  }
}

export function createApplicationOperationRegistry(): ApplicationOperationRegistry {
  return new ApplicationOperationRegistry([
    ...engagementOperations,
    applyProjectManifestOperation,
    getProjectManifestOperation,
    ...projectUpdateOperations,
    ...agentDeliveryOperations,
    ...releaseOperations,
    ...reportingOperations,
  ]);
}
