import { and, eq, inArray, sql } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { aiOpsPendingInputs } from '../schema.drizzle.js';
import type { AiOpsPendingInputRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

export interface UpsertAiOpsPendingInputData {
  projectId: string;
  serviceId: string;
  briefingId?: string | null;
  field: string;
  reason: string;
}

function normalizedFields(fields: readonly string[]): string[] {
  return [...new Set(fields.map((field) => field.trim()).filter(Boolean))];
}

export class AiOpsPendingInputRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async upsertPending(data: UpsertAiOpsPendingInputData): Promise<AiOpsPendingInputRow> {
    const id = crypto.randomUUID();
    const row =
      (
        await this.db
          .insert(aiOpsPendingInputs)
          .values({
            id,
            project_id: data.projectId,
            service_id: data.serviceId,
            briefing_id: data.briefingId ?? null,
            field: data.field,
            reason: data.reason,
            source_required: 'user',
            status: 'pending',
          })
          .onConflictDoUpdate({
            target: [aiOpsPendingInputs.service_id, aiOpsPendingInputs.field],
            targetWhere: sql`${aiOpsPendingInputs.status} = 'pending'`,
            set: {
              project_id: data.projectId,
              briefing_id: sql`coalesce(excluded.briefing_id, ${aiOpsPendingInputs.briefing_id})`,
              reason: data.reason,
              updated_at: sql`now()::text`,
            },
          })
          .returning()
      )[0] ?? null;

    if (!row) throw new RepoPersistenceError('ai ops pending input', id);
    return row;
  }

  async listPendingForServiceKeys(
    serviceId: string,
    fields: readonly string[],
  ): Promise<AiOpsPendingInputRow[]> {
    const keys = normalizedFields(fields);
    if (keys.length === 0) return [];
    return await this.db
      .select()
      .from(aiOpsPendingInputs)
      .where(
        and(
          eq(aiOpsPendingInputs.service_id, serviceId),
          eq(aiOpsPendingInputs.status, 'pending'),
          inArray(aiOpsPendingInputs.field, keys),
        ),
      );
  }

  async listPendingForProjectKeys(
    projectId: string,
    fields: readonly string[],
  ): Promise<AiOpsPendingInputRow[]> {
    const keys = normalizedFields(fields);
    if (keys.length === 0) return [];
    return await this.db
      .select()
      .from(aiOpsPendingInputs)
      .where(
        and(
          eq(aiOpsPendingInputs.project_id, projectId),
          eq(aiOpsPendingInputs.status, 'pending'),
          inArray(aiOpsPendingInputs.field, keys),
        ),
      );
  }

  async resolveForServiceKeys(serviceId: string, fields: readonly string[]): Promise<number> {
    const keys = normalizedFields(fields);
    if (keys.length === 0) return 0;
    const rows = await this.db
      .update(aiOpsPendingInputs)
      .set({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(aiOpsPendingInputs.service_id, serviceId),
          eq(aiOpsPendingInputs.status, 'pending'),
          inArray(aiOpsPendingInputs.field, keys),
        ),
      )
      .returning({ id: aiOpsPendingInputs.id });
    return rows.length;
  }

  async resolveForProjectKeys(projectId: string, fields: readonly string[]): Promise<number> {
    const keys = normalizedFields(fields);
    if (keys.length === 0) return 0;
    const rows = await this.db
      .update(aiOpsPendingInputs)
      .set({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(aiOpsPendingInputs.project_id, projectId),
          eq(aiOpsPendingInputs.status, 'pending'),
          inArray(aiOpsPendingInputs.field, keys),
        ),
      )
      .returning({ id: aiOpsPendingInputs.id });
    return rows.length;
  }

  async resolveForBriefing(briefingId: string): Promise<number> {
    const rows = await this.db
      .update(aiOpsPendingInputs)
      .set({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(aiOpsPendingInputs.briefing_id, briefingId),
          eq(aiOpsPendingInputs.status, 'pending'),
        ),
      )
      .returning({ id: aiOpsPendingInputs.id });
    return rows.length;
  }
}
