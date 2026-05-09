import { and, eq, isNull, sql } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { envVars } from '../schema.drizzle.js';
import { OpenLanderError } from '../../errors.js';

export type EnvVarChangeOp = 'insert' | 'update' | 'noop';

export interface EnvVarChange {
  key: string;
  op: EnvVarChangeOp;
}

export class EnvVarRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {}

  private projectWhere(projectId: string) {
    return and(eq(envVars.project_id, projectId), isNull(envVars.service_id));
  }

  private projectKeyWhere(projectId: string, key: string) {
    return and(eq(envVars.project_id, projectId), isNull(envVars.service_id), eq(envVars.key, key));
  }

  private serviceWhere(projectId: string, serviceId: string) {
    return and(eq(envVars.project_id, projectId), eq(envVars.service_id, serviceId));
  }

  private serviceKeyWhere(projectId: string, serviceId: string, key: string) {
    return and(
      eq(envVars.project_id, projectId),
      eq(envVars.service_id, serviceId),
      eq(envVars.key, key),
    );
  }

  async assertEnvToolSchemaReady(): Promise<void> {
    const indexRows = (await this.client.unsafe(
      "select indexdef from pg_indexes where schemaname = current_schema() and tablename = 'env_vars'",
    )) as Array<{ indexdef: string }>;
    const hasProjectGroupKeyUnique = indexRows.some((row) => {
      const indexDef = row.indexdef.replace(/["\s]/g, '').toLowerCase();
      return (
        indexDef.includes('uniqueindex') &&
        indexDef.includes('(project_id,key)') &&
        indexDef.includes('where') &&
        indexDef.includes('service_idisnull')
      );
    });
    const hasServiceKeyUnique = indexRows.some((row) => {
      const indexDef = row.indexdef.replace(/["\s]/g, '').toLowerCase();
      return (
        indexDef.includes('uniqueindex') &&
        indexDef.includes('(service_id,key)') &&
        indexDef.includes('where') &&
        indexDef.includes('service_idisnotnull')
      );
    });

    const tableRows = (await this.client.unsafe(
      "select exists (select 1 from information_schema.tables where table_schema = current_schema() and table_name = 'activity_log') as exists",
    )) as Array<{ exists: boolean }>;
    const hasActivityLog = tableRows[0]?.exists === true;

    if (!hasProjectGroupKeyUnique || !hasServiceKeyUnique || !hasActivityLog) {
      throw new OpenLanderError(
        'OpenLander database schema drift detected for env MCP tools.',
        'SCHEMA_DRIFT',
        500,
        {
          envVarsProjectGroupKeyUnique: hasProjectGroupKeyUnique,
          envVarsServiceKeyUnique: hasServiceKeyUnique,
          activityLogTable: hasActivityLog,
        },
      );
    }
  }

  async getEnvVars(projectId: string, environmentId?: string): Promise<Record<string, string>> {
    void environmentId;
    const rows = await this.db
      .select({ key: envVars.key, value: envVars.value })
      .from(envVars)
      .where(this.projectWhere(projectId));

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  async getEnvVarsForService(
    projectId: string,
    serviceId: string,
  ): Promise<Record<string, string>> {
    const rows = await this.db
      .select({ key: envVars.key, value: envVars.value })
      .from(envVars)
      .where(this.serviceWhere(projectId, serviceId));

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
    void environmentId;
    await this.setEnvVarDetailed(projectId, key, value);
  }

  async setEnvVarDetailed(projectId: string, key: string, value: string): Promise<EnvVarChange> {
    const [selected] = await this.db
      .select({
        id: envVars.id,
        value: envVars.value,
        environment_id: envVars.environment_id,
        service_id: envVars.service_id,
      })
      .from(envVars)
      .where(this.projectKeyWhere(projectId, key))
      .limit(1);
    const existing = selected ?? null;

    if (existing) {
      const needsNormalize = existing.environment_id !== null || existing.service_id !== null;
      if (existing.value === value && !needsNormalize) {
        return { key, op: 'noop' };
      }
      await this.db
        .update(envVars)
        .set({ value, environment_id: null, service_id: null })
        .where(eq(envVars.id, existing.id));
      return { key, op: 'update' };
    }

    await this.db
      .insert(envVars)
      .values({
        id: crypto.randomUUID(),
        project_id: projectId,
        environment_id: null,
        service_id: null,
        key,
        value,
      })
      .onConflictDoUpdate({
        target: [envVars.project_id, envVars.key],
        targetWhere: sql`${envVars.service_id} IS NULL`,
        set: { value, environment_id: null, service_id: null },
      });
    return { key, op: 'insert' };
  }

  async setEnvVarForService(
    projectId: string,
    serviceId: string,
    key: string,
    value: string,
  ): Promise<void> {
    await this.setEnvVarForServiceDetailed(projectId, serviceId, key, value);
  }

  async setEnvVarForServiceDetailed(
    projectId: string,
    serviceId: string,
    key: string,
    value: string,
  ): Promise<EnvVarChange> {
    const [selected] = await this.db
      .select({
        id: envVars.id,
        value: envVars.value,
        environment_id: envVars.environment_id,
      })
      .from(envVars)
      .where(this.serviceKeyWhere(projectId, serviceId, key))
      .limit(1);
    const existing = selected ?? null;

    if (existing) {
      const needsNormalize = existing.environment_id !== null;
      if (existing.value === value && !needsNormalize) {
        return { key, op: 'noop' };
      }
      await this.db
        .update(envVars)
        .set({ value, project_id: projectId, environment_id: null, service_id: serviceId })
        .where(eq(envVars.id, existing.id));
      return { key, op: 'update' };
    }

    await this.db
      .insert(envVars)
      .values({
        id: crypto.randomUUID(),
        project_id: projectId,
        environment_id: null,
        service_id: serviceId,
        key,
        value,
      })
      .onConflictDoUpdate({
        target: [envVars.service_id, envVars.key],
        targetWhere: sql`${envVars.service_id} IS NOT NULL`,
        set: { value, project_id: projectId, environment_id: null },
      });
    return { key, op: 'insert' };
  }

  async setEnvVarsBulk(
    projectId: string,
    vars: Record<string, string>,
    environmentId?: string,
  ): Promise<void> {
    void environmentId;
    await this.db.transaction(async (tx) => {
      const existingRows = await tx
        .select({ key: envVars.key })
        .from(envVars)
        .where(this.projectWhere(projectId));

      for (const row of existingRows) {
        if (!(row.key in vars)) {
          await tx.delete(envVars).where(this.projectKeyWhere(projectId, row.key));
        }
      }

      for (const [key, value] of Object.entries(vars)) {
        const [selected] = await tx
          .select({ id: envVars.id })
          .from(envVars)
          .where(this.projectKeyWhere(projectId, key))
          .limit(1);
        const existing = selected ?? null;

        if (existing) {
          await tx
            .update(envVars)
            .set({ value, environment_id: null, service_id: null })
            .where(eq(envVars.id, existing.id));
        } else {
          await tx
            .insert(envVars)
            .values({
              id: crypto.randomUUID(),
              project_id: projectId,
              environment_id: null,
              service_id: null,
              key,
              value,
            })
            .onConflictDoUpdate({
              target: [envVars.project_id, envVars.key],
              targetWhere: sql`${envVars.service_id} IS NULL`,
              set: { value, environment_id: null, service_id: null },
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
    void environmentId;
    await this.mergeEnvVarsDetailed(projectId, vars);
  }

  async mergeEnvVarsDetailed(
    projectId: string,
    vars: Record<string, string>,
  ): Promise<EnvVarChange[]> {
    return await this.db.transaction(async (tx) => {
      const changes: EnvVarChange[] = [];
      for (const [key, value] of Object.entries(vars)) {
        const [selected] = await tx
          .select({
            id: envVars.id,
            value: envVars.value,
            environment_id: envVars.environment_id,
            service_id: envVars.service_id,
          })
          .from(envVars)
          .where(this.projectKeyWhere(projectId, key))
          .limit(1);
        const existing = selected ?? null;

        if (existing) {
          const needsNormalize = existing.environment_id !== null || existing.service_id !== null;
          if (existing.value === value && !needsNormalize) {
            changes.push({ key, op: 'noop' });
            continue;
          }
          await tx
            .update(envVars)
            .set({ value, environment_id: null, service_id: null })
            .where(eq(envVars.id, existing.id));
          changes.push({ key, op: 'update' });
        } else {
          await tx
            .insert(envVars)
            .values({
              id: crypto.randomUUID(),
              project_id: projectId,
              environment_id: null,
              service_id: null,
              key,
              value,
            })
            .onConflictDoUpdate({
              target: [envVars.project_id, envVars.key],
              targetWhere: sql`${envVars.service_id} IS NULL`,
              set: { value, environment_id: null, service_id: null },
            });
          changes.push({ key, op: 'insert' });
        }
      }
      return changes;
    });
  }

  async deleteEnvVar(projectId: string, key: string, environmentId?: string): Promise<void> {
    void environmentId;
    await this.db.delete(envVars).where(this.projectKeyWhere(projectId, key));
  }

  async mergeEnvVarsForServiceDetailed(
    projectId: string,
    serviceId: string,
    vars: Record<string, string>,
  ): Promise<EnvVarChange[]> {
    return await this.db.transaction(async (tx) => {
      const changes: EnvVarChange[] = [];
      for (const [key, value] of Object.entries(vars)) {
        const [selected] = await tx
          .select({
            id: envVars.id,
            value: envVars.value,
            environment_id: envVars.environment_id,
          })
          .from(envVars)
          .where(this.serviceKeyWhere(projectId, serviceId, key))
          .limit(1);
        const existing = selected ?? null;

        if (existing) {
          const needsNormalize = existing.environment_id !== null;
          if (existing.value === value && !needsNormalize) {
            changes.push({ key, op: 'noop' });
            continue;
          }
          await tx
            .update(envVars)
            .set({ value, project_id: projectId, environment_id: null, service_id: serviceId })
            .where(eq(envVars.id, existing.id));
          changes.push({ key, op: 'update' });
        } else {
          await tx
            .insert(envVars)
            .values({
              id: crypto.randomUUID(),
              project_id: projectId,
              environment_id: null,
              service_id: serviceId,
              key,
              value,
            })
            .onConflictDoUpdate({
              target: [envVars.service_id, envVars.key],
              targetWhere: sql`${envVars.service_id} IS NOT NULL`,
              set: { value, project_id: projectId, environment_id: null },
            });
          changes.push({ key, op: 'insert' });
        }
      }
      return changes;
    });
  }

  async deleteEnvVarForService(projectId: string, serviceId: string, key: string): Promise<void> {
    await this.db.delete(envVars).where(this.serviceKeyWhere(projectId, serviceId, key));
  }

  async findProjectsByEnvKey(key: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ project_id: envVars.project_id })
      .from(envVars)
      .where(eq(envVars.key, key));
    return rows.map((r) => r.project_id);
  }

  async findServicesByEnvKey(key: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ service_id: envVars.service_id })
      .from(envVars)
      .where(and(eq(envVars.key, key), sql`${envVars.service_id} IS NOT NULL`));
    return rows.flatMap((r) => (r.service_id ? [r.service_id] : []));
  }
}
