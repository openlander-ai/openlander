import { and, eq, isNull, sql } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { envVars } from '../schema.drizzle.js';

export class EnvVarRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {}

  getEnvVars(projectId: string, environmentId?: string): Record<string, string> {
    const whereClause =
      environmentId === undefined
        ? and(eq(envVars.project_id, projectId), isNull(envVars.environment_id))
        : and(eq(envVars.project_id, projectId), eq(envVars.environment_id, environmentId));

    const rows = this.db
      .select({ key: envVars.key, value: envVars.value })
      .from(envVars)
      .where(whereClause)
      .all();

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  setEnvVar(projectId: string, key: string, value: string, environmentId?: string): void {
    const whereClause =
      environmentId === undefined
        ? and(
            eq(envVars.project_id, projectId),
            isNull(envVars.environment_id),
            eq(envVars.key, key),
          )
        : and(
            eq(envVars.project_id, projectId),
            eq(envVars.environment_id, environmentId),
            eq(envVars.key, key),
          );

    const existing = this.db.select({ id: envVars.id }).from(envVars).where(whereClause).get();

    if (existing) {
      this.db.update(envVars).set({ value }).where(eq(envVars.id, existing.id)).run();
      return;
    }

    this.db
      .insert(envVars)
      .values({
        id: sql<string>`lower(hex(randomblob(8)))`,
        project_id: projectId,
        environment_id: environmentId ?? null,
        key,
        value,
      })
      .run();
  }

  setEnvVarsBulk(projectId: string, vars: Record<string, string>, environmentId?: string): void {
    const transaction = this.sqlite.transaction(() => {
      const existing = this.getEnvVars(projectId, environmentId);
      for (const key of Object.keys(existing)) {
        if (!(key in vars)) {
          this.deleteEnvVar(projectId, key, environmentId);
        }
      }
      for (const [key, value] of Object.entries(vars)) {
        this.setEnvVar(projectId, key, value, environmentId);
      }
    });

    transaction();
  }

  mergeEnvVars(projectId: string, vars: Record<string, string>, environmentId?: string): void {
    const transaction = this.sqlite.transaction(() => {
      for (const [key, value] of Object.entries(vars)) {
        this.setEnvVar(projectId, key, value, environmentId);
      }
    });

    transaction();
  }

  deleteEnvVar(projectId: string, key: string, environmentId?: string): void {
    const whereClause =
      environmentId === undefined
        ? and(
            eq(envVars.project_id, projectId),
            isNull(envVars.environment_id),
            eq(envVars.key, key),
          )
        : and(
            eq(envVars.project_id, projectId),
            eq(envVars.environment_id, environmentId),
            eq(envVars.key, key),
          );

    this.db.delete(envVars).where(whereClause).run();
  }

  findProjectsByEnvKey(key: string): string[] {
    const rows = this.db
      .selectDistinct({ project_id: envVars.project_id })
      .from(envVars)
      .where(eq(envVars.key, key))
      .all();
    return rows.map((r: { project_id: string }) => r.project_id);
  }
}
