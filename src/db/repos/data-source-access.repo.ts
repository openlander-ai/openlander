import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { RepoPersistenceError } from '../../errors.js';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { dataSourceAccess } from '../schema.drizzle.js';
import type { DataSourceAccessMode, DataSourceAccessRow } from '../types.js';

export class DataSourceAccessRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async findByProject(projectId: string): Promise<DataSourceAccessRow[]> {
    return await this.db
      .select()
      .from(dataSourceAccess)
      .where(eq(dataSourceAccess.project_id, projectId));
  }

  async findByProjectAndServices(
    projectId: string,
    serviceIds: readonly string[],
  ): Promise<DataSourceAccessRow[]> {
    if (serviceIds.length === 0) return [];
    return await this.db
      .select()
      .from(dataSourceAccess)
      .where(
        and(
          eq(dataSourceAccess.project_id, projectId),
          inArray(dataSourceAccess.service_id, [...serviceIds]),
        ),
      );
  }

  async findByProjectAndService(
    projectId: string,
    serviceId: string,
  ): Promise<DataSourceAccessRow | undefined> {
    const [row] = await this.db
      .select()
      .from(dataSourceAccess)
      .where(
        and(eq(dataSourceAccess.project_id, projectId), eq(dataSourceAccess.service_id, serviceId)),
      )
      .limit(1);
    return row;
  }

  async upsert(input: {
    projectId: string;
    serviceId: string;
    environmentId?: string | null;
    mode: DataSourceAccessMode;
    readerUsername?: string | null;
    readerPasswordEncrypted?: string | null;
    readerPasswordIv?: string | null;
  }): Promise<DataSourceAccessRow> {
    const now = new Date().toISOString();
    const id = `dsa_${randomUUID()}`;
    const [row] = await this.db
      .insert(dataSourceAccess)
      .values({
        id,
        project_id: input.projectId,
        service_id: input.serviceId,
        environment_id: input.environmentId ?? null,
        mode: input.mode,
        reader_username: input.readerUsername ?? null,
        reader_password_encrypted: input.readerPasswordEncrypted ?? null,
        reader_password_iv: input.readerPasswordIv ?? null,
        enabled_at: input.mode === 'read' ? now : null,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [dataSourceAccess.project_id, dataSourceAccess.service_id],
        set: {
          environment_id: input.environmentId ?? null,
          mode: input.mode,
          reader_username: input.readerUsername ?? null,
          reader_password_encrypted: input.readerPasswordEncrypted ?? null,
          reader_password_iv: input.readerPasswordIv ?? null,
          enabled_at: input.mode === 'read' ? now : null,
          updated_at: now,
        },
      })
      .returning();

    if (!row) {
      throw new RepoPersistenceError('data source access', `${input.projectId}:${input.serviceId}`);
    }
    return row;
  }
}
