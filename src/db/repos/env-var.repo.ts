import { and, eq, isNull } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { envVars } from '../schema.drizzle.js';

export class EnvVarRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  private scopeWhere(projectId: string, environmentId?: string) {
    return environmentId === undefined
      ? and(eq(envVars.project_id, projectId), isNull(envVars.environment_id))
      : and(eq(envVars.project_id, projectId), eq(envVars.environment_id, environmentId));
  }

  private scopedKeyWhere(projectId: string, key: string, environmentId?: string) {
    return environmentId === undefined
      ? and(eq(envVars.project_id, projectId), isNull(envVars.environment_id), eq(envVars.key, key))
      : and(
          eq(envVars.project_id, projectId),
          eq(envVars.environment_id, environmentId),
          eq(envVars.key, key),
        );
  }

  async getEnvVars(projectId: string, environmentId?: string): Promise<Record<string, string>> {
    const rows = await this.db
      .select({ key: envVars.key, value: envVars.value })
      .from(envVars)
      .where(this.scopeWhere(projectId, environmentId));

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  async setEnvVar(
    projectId: string,
    key: string,
    value: string,
    environmentId?: string,
  ): Promise<void> {
    const [selected] = await this.db
      .select({ id: envVars.id })
      .from(envVars)
      .where(this.scopedKeyWhere(projectId, key, environmentId))
      .limit(1);
    const existing = selected ?? null;

    if (existing) {
      await this.db.update(envVars).set({ value }).where(eq(envVars.id, existing.id));
      return;
    }

    await this.db.insert(envVars).values({
      id: crypto.randomUUID(),
      project_id: projectId,
      environment_id: environmentId ?? null,
      key,
      value,
    });
  }

  async setEnvVarsBulk(
    projectId: string,
    vars: Record<string, string>,
    environmentId?: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existingRows = await tx
        .select({ key: envVars.key })
        .from(envVars)
        .where(this.scopeWhere(projectId, environmentId));

      for (const row of existingRows) {
        if (!(row.key in vars)) {
          await tx.delete(envVars).where(this.scopedKeyWhere(projectId, row.key, environmentId));
        }
      }

      for (const [key, value] of Object.entries(vars)) {
        const [selected] = await tx
          .select({ id: envVars.id })
          .from(envVars)
          .where(this.scopedKeyWhere(projectId, key, environmentId))
          .limit(1);
        const existing = selected ?? null;

        if (existing) {
          await tx.update(envVars).set({ value }).where(eq(envVars.id, existing.id));
        } else {
          await tx.insert(envVars).values({
            id: crypto.randomUUID(),
            project_id: projectId,
            environment_id: environmentId ?? null,
            key,
            value,
          });
        }
      }
    });
  }

  async mergeEnvVars(
    projectId: string,
    vars: Record<string, string>,
    environmentId?: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(vars)) {
        const [selected] = await tx
          .select({ id: envVars.id })
          .from(envVars)
          .where(this.scopedKeyWhere(projectId, key, environmentId))
          .limit(1);
        const existing = selected ?? null;

        if (existing) {
          await tx.update(envVars).set({ value }).where(eq(envVars.id, existing.id));
        } else {
          await tx.insert(envVars).values({
            id: crypto.randomUUID(),
            project_id: projectId,
            environment_id: environmentId ?? null,
            key,
            value,
          });
        }
      }
    });
  }

  async deleteEnvVar(projectId: string, key: string, environmentId?: string): Promise<void> {
    await this.db.delete(envVars).where(this.scopedKeyWhere(projectId, key, environmentId));
  }

  async findProjectsByEnvKey(key: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ project_id: envVars.project_id })
      .from(envVars)
      .where(eq(envVars.key, key));
    return rows.map((r) => r.project_id);
  }
}
