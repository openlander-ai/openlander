import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AppContext } from '../../src/app.js';
import type { ApplicationOperationInvocationRow } from '../../src/db/schema.drizzle.js';
import { ApplicationOperationRegistry } from '../../src/operations/registry.js';
import { operationToolDef } from '../../src/tools/defs/operation.js';
import type { ApplicationOperationDefinition } from '../../src/operations/types.js';

function createHarness() {
  let invocation: ApplicationOperationInvocationRow | null = null;
  const db = {
    claimApplicationOperation: vi.fn(
      async (input: {
        operationName: string;
        operationVersion: number;
        actorScopeKey: string;
        idempotencyKey: string;
        requestSha256: string;
      }) => {
        if (invocation) return { claimed: false, invocation };
        const now = new Date().toISOString();
        invocation = {
          id: 'operation-1',
          operation_name: input.operationName,
          operation_version: input.operationVersion,
          actor_scope_key: input.actorScopeKey,
          idempotency_key: input.idempotencyKey,
          request_sha256: input.requestSha256,
          status: 'running',
          response_json: null,
          error_json: null,
          created_at: now,
          updated_at: now,
        };
        return { claimed: true, invocation };
      },
    ),
    retryFailedApplicationOperation: vi.fn(async () => {
      if (!invocation) throw new Error('missing invocation');
      invocation = { ...invocation, status: 'running', response_json: null, error_json: null };
      return invocation;
    }),
    succeedApplicationOperation: vi.fn(async (_id: string, response: Record<string, unknown>) => {
      if (!invocation) throw new Error('missing invocation');
      invocation = { ...invocation, status: 'succeeded', response_json: response };
      return invocation;
    }),
    failApplicationOperation: vi.fn(async (_id: string, error: Record<string, unknown>) => {
      if (!invocation) throw new Error('missing invocation');
      invocation = { ...invocation, status: 'failed', error_json: error };
      return invocation;
    }),
    getApplicationOperationById: vi.fn(async (id: string) =>
      invocation?.id === id ? invocation : null,
    ),
  };

  const execute = vi.fn(async (input: Record<string, unknown>) => ({
    status: 'done',
    value: input['value'],
  }));
  const definition: ApplicationOperationDefinition = {
    name: 'test_operation',
    version: 1,
    description: 'Test operation',
    kind: 'command',
    execution: 'sync',
    idempotency: 'required',
    allowedScopes: ['instance', 'org'],
    activity: { recordsActivity: false, recordsEvidence: false },
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ status: z.string(), value: z.string() }),
    execute,
  };
  const operations = new ApplicationOperationRegistry([definition]);
  const ctx = { db, operations, config: { mcp: { instanceId: 'test' } } } as unknown as AppContext;
  const actor = {
    source: 'mcp' as const,
    scope: 'org' as const,
    label: 'operator',
    instanceId: 'test',
  };
  return { db, ctx, operations, actor, execute, definition };
}

describe('Application Operation contract', () => {
  it('replays identical commands without running the handler twice', async () => {
    const h = createHarness();
    const options = { actor: h.actor, idempotencyKey: 'once' };
    expect(
      await h.operations.execute(h.ctx, 'test_operation', { value: 'one' }, options),
    ).toMatchObject({ replayed: false });
    expect(
      await h.operations.execute(h.ctx, 'test_operation', { value: 'one' }, options),
    ).toMatchObject({ replayed: true });
    expect(h.execute).toHaveBeenCalledOnce();
    await expect(
      h.operations.execute(h.ctx, 'test_operation', { value: 'changed' }, options),
    ).rejects.toMatchObject({ code: 'OPERATION_IDEMPOTENCY_CONFLICT' });
  });
  it('rejects insufficient scope before claiming or executing a command', async () => {
    const h = createHarness();
    await expect(
      h.operations.execute(
        h.ctx,
        'test_operation',
        { value: 'one' },
        { actor: { ...h.actor, scope: 'project', projectId: 'a' }, idempotencyKey: 'once' },
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_VIOLATION' });
    expect(h.db.claimApplicationOperation).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('preserves idempotency through the generic MCP adapter', async () => {
    const h = createHarness();
    const tool = operationToolDef(h.definition, 'openlander_monitor');
    expect(
      await tool.execute(
        { value: 'one', idempotency_key: 'once' },
        { target: 'mcp', appCtx: h.ctx },
      ),
    ).toMatchObject({ status: 'done', operation_id: 'operation-1', replayed: false });
  });
});
