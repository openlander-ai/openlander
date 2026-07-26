import { and, eq } from 'drizzle-orm';

import { RepoPersistenceError } from '../../errors.js';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import {
  applicationOperationInvocations,
  type ApplicationOperationInvocationRow,
} from '../schema.drizzle.js';
import { ulid } from './activity-log.repo.js';

export interface ClaimApplicationOperationInput {
  operationName: string;
  operationVersion: number;
  actorScopeKey: string;
  idempotencyKey: string;
  requestSha256: string;
}

export class ApplicationOperationRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async claim(input: ClaimApplicationOperationInput): Promise<{
    claimed: boolean;
    invocation: ApplicationOperationInvocationRow;
  }> {
    const id = ulid();
    const [created] = await this.db
      .insert(applicationOperationInvocations)
      .values({
        id,
        operation_name: input.operationName,
        operation_version: input.operationVersion,
        actor_scope_key: input.actorScopeKey,
        idempotency_key: input.idempotencyKey,
        request_sha256: input.requestSha256,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return { claimed: true, invocation: created };

    const existing = await this.findByKey(input);
    if (!existing) {
      throw new RepoPersistenceError('application operation invocation', id);
    }
    return { claimed: false, invocation: existing };
  }

  async findByKey(
    input: Omit<ClaimApplicationOperationInput, 'requestSha256'>,
  ): Promise<ApplicationOperationInvocationRow | null> {
    const [row] = await this.db
      .select()
      .from(applicationOperationInvocations)
      .where(
        and(
          eq(applicationOperationInvocations.operation_name, input.operationName),
          eq(applicationOperationInvocations.operation_version, input.operationVersion),
          eq(applicationOperationInvocations.actor_scope_key, input.actorScopeKey),
          eq(applicationOperationInvocations.idempotency_key, input.idempotencyKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<ApplicationOperationInvocationRow | null> {
    const [row] = await this.db
      .select()
      .from(applicationOperationInvocations)
      .where(eq(applicationOperationInvocations.id, id))
      .limit(1);
    return row ?? null;
  }

  async retryFailed(id: string): Promise<ApplicationOperationInvocationRow> {
    const [row] = await this.db
      .update(applicationOperationInvocations)
      .set({
        status: 'running',
        response_json: null,
        error_json: null,
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(applicationOperationInvocations.id, id),
          eq(applicationOperationInvocations.status, 'failed'),
        ),
      )
      .returning();
    if (!row) throw new RepoPersistenceError('application operation invocation retry', id);
    return row;
  }

  async succeed(
    id: string,
    response: Record<string, unknown>,
  ): Promise<ApplicationOperationInvocationRow> {
    const [row] = await this.db
      .update(applicationOperationInvocations)
      .set({
        status: 'succeeded',
        response_json: response,
        error_json: null,
        updated_at: new Date().toISOString(),
      })
      .where(eq(applicationOperationInvocations.id, id))
      .returning();
    if (!row) throw new RepoPersistenceError('application operation invocation success', id);
    return row;
  }

  async fail(
    id: string,
    error: Record<string, unknown>,
  ): Promise<ApplicationOperationInvocationRow> {
    const [row] = await this.db
      .update(applicationOperationInvocations)
      .set({
        status: 'failed',
        error_json: error,
        updated_at: new Date().toISOString(),
      })
      .where(eq(applicationOperationInvocations.id, id))
      .returning();
    if (!row) throw new RepoPersistenceError('application operation invocation failure', id);
    return row;
  }

  async markRunningAsFailedOnStartup(): Promise<number> {
    const rows = await this.db
      .update(applicationOperationInvocations)
      .set({
        status: 'failed',
        error_json: {
          code: 'OPERATION_INTERRUPTED',
          message: 'OpenLander restarted before the operation adapter recorded completion.',
        },
        updated_at: new Date().toISOString(),
      })
      .where(eq(applicationOperationInvocations.status, 'running'))
      .returning({ id: applicationOperationInvocations.id });
    return rows.length;
  }
}
