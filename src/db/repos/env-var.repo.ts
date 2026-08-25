import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { envVars } from '../schema.drizzle.js';
import { OpenLanderError } from '../../errors.js';

export type EnvVarChangeOp = 'insert' | 'update' | 'noop';

export interface EnvVarChange {
  key: string;
  op: EnvVarChangeOp;
}

export interface EnvVarMetadataRow {
  project_id: string;
  service_id: string | null;
  environment_id: string | null;
  key: string;
}

interface EnvScope {
  projectId: string;
  serviceId?: string;
  environmentId?: string;
}

export class EnvVarRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {}

  private projectWhere(projectId: string, environmentId?: string) {
    return and(
      eq(envVars.project_id, projectId),
      isNull(envVars.service_id),
      environmentId === undefined
        ? isNull(envVars.environment_id)
        : eq(envVars.environment_id, environmentId),
    );
  }

  private projectKeyWhere(projectId: string, key: string, environmentId?: string) {
    return and(this.projectWhere(projectId, environmentId), eq(envVars.key, key));
  }

  private serviceWhere(_projectId: string, serviceId: string, environmentId?: string) {
    return and(
      eq(envVars.service_id, serviceId),
      environmentId === undefined
        ? isNull(envVars.environment_id)
        : eq(envVars.environment_id, environmentId),
    );
  }

  private serviceKeyWhere(
    projectId: string,
    serviceId: string,
    key: string,
    environmentId?: string,
  ) {
    return and(this.serviceWhere(projectId, serviceId, environmentId), eq(envVars.key, key));
  }

  private scopeKeyWhere(scope: EnvScope, key: string) {
    return scope.serviceId === undefined
      ? this.projectKeyWhere(scope.projectId, key, scope.environmentId)
      : this.serviceKeyWhere(scope.projectId, scope.serviceId, key, scope.environmentId);
  }

  private conflictTarget(scope: EnvScope) {
    if (scope.serviceId === undefined) {
      return scope.environmentId === undefined
        ? {
            target: [envVars.project_id, envVars.key],
            targetWhere: sql`${envVars.service_id} IS NULL AND ${envVars.environment_id} IS NULL`,
          }
        : {
            target: [envVars.project_id, envVars.environment_id, envVars.key],
            targetWhere: sql`${envVars.service_id} IS NULL AND ${envVars.environment_id} IS NOT NULL`,
          };
    }

    return scope.environmentId === undefined
      ? {
          target: [envVars.service_id, envVars.key],
          targetWhere: sql`${envVars.service_id} IS NOT NULL AND ${envVars.environment_id} IS NULL`,
        }
      : {
          target: [envVars.service_id, envVars.environment_id, envVars.key],
          targetWhere: sql`${envVars.service_id} IS NOT NULL AND ${envVars.environment_id} IS NOT NULL`,
        };
  }

  private rowValues(scope: EnvScope, key: string, value: string) {
    return {
      id: crypto.randomUUID(),
      project_id: scope.projectId,
      service_id: scope.serviceId ?? null,
      environment_id: scope.environmentId ?? null,
      key,
      value,
    };
  }

  private rowUpdateValues(scope: EnvScope, value: string) {
    return {
      value,
      project_id: scope.projectId,
      service_id: scope.serviceId ?? null,
      environment_id: scope.environmentId ?? null,
    };
  }

  private async upsertEnvVarDetailed(scope: EnvScope, key: string, value: string) {
    const [selected] = await this.db
      .select({
        id: envVars.id,
        value: envVars.value,
      })
      .from(envVars)
      .where(this.scopeKeyWhere(scope, key))
      .limit(1);
    const existing = selected ?? null;

    if (existing) {
      if (existing.value === value) {
        return { key, op: 'noop' } satisfies EnvVarChange;
      }
      await this.db
        .update(envVars)
        .set(this.rowUpdateValues(scope, value))
        .where(eq(envVars.id, existing.id));
      return { key, op: 'update' } satisfies EnvVarChange;
    }

    const conflict = this.conflictTarget(scope);
    await this.db
      .insert(envVars)
      .values(this.rowValues(scope, key, value))
      .onConflictDoUpdate({
        target: conflict.target,
        targetWhere: conflict.targetWhere,
        set: this.rowUpdateValues(scope, value),
      });
    return { key, op: 'insert' } satisfies EnvVarChange;
  }

  private async mergeEnvVarsForScopeDetailed(
    scope: EnvScope,
    vars: Record<string, string>,
  ): Promise<EnvVarChange[]> {
    return await this.db.transaction(async (tx) => {
      const changes: EnvVarChange[] = [];
      for (const [key, value] of Object.entries(vars)) {
        const [selected] = await tx
          .select({
            id: envVars.id,
            value: envVars.value,
          })
          .from(envVars)
          .where(this.scopeKeyWhere(scope, key))
          .limit(1);
        const existing = selected ?? null;

        if (existing) {
          if (existing.value === value) {
            changes.push({ key, op: 'noop' });
            continue;
          }
          await tx
            .update(envVars)
            .set(this.rowUpdateValues(scope, value))
            .where(eq(envVars.id, existing.id));
          changes.push({ key, op: 'update' });
        } else {
          const conflict = this.conflictTarget(scope);
          await tx
            .insert(envVars)
            .values(this.rowValues(scope, key, value))
            .onConflictDoUpdate({
              target: conflict.target,
              targetWhere: conflict.targetWhere,
              set: this.rowUpdateValues(scope, value),
            });
          changes.push({ key, op: 'insert' });
        }
      }
      return changes;
    });
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
        indexDef.includes('service_idisnull') &&
        indexDef.includes('environment_idisnull')
      );
    });
    const hasProjectEnvironmentKeyUnique = indexRows.some((row) => {
      const indexDef = row.indexdef.replace(/["\s]/g, '').toLowerCase();
      return (
        indexDef.includes('uniqueindex') &&
        indexDef.includes('(project_id,environment_id,key)') &&
        indexDef.includes('where') &&
        indexDef.includes('service_idisnull') &&
        indexDef.includes('environment_idisnotnull')
      );
    });
    const hasServiceKeyUnique = indexRows.some((row) => {
      const indexDef = row.indexdef.replace(/["\s]/g, '').toLowerCase();
      return (
        indexDef.includes('uniqueindex') &&
        indexDef.includes('(service_id,key)') &&
        indexDef.includes('where') &&
        indexDef.includes('service_idisnotnull') &&
        indexDef.includes('environment_idisnull')
      );
    });
    const hasServiceEnvironmentKeyUnique = indexRows.some((row) => {
      const indexDef = row.indexdef.replace(/["\s]/g, '').toLowerCase();
      return (
        indexDef.includes('uniqueindex') &&
        indexDef.includes('(service_id,environment_id,key)') &&
        indexDef.includes('where') &&
        indexDef.includes('service_idisnotnull') &&
        indexDef.includes('environment_idisnotnull')
      );
    });

    const tableRows = (await this.client.unsafe(
      "select exists (select 1 from information_schema.tables where table_schema = current_schema() and table_name = 'activity_log') as exists",
    )) as Array<{ exists: boolean }>;
    const hasActivityLog = tableRows[0]?.exists === true;

    if (
      !hasProjectGroupKeyUnique ||
      !hasProjectEnvironmentKeyUnique ||
      !hasServiceKeyUnique ||
      !hasServiceEnvironmentKeyUnique ||
      !hasActivityLog
    ) {
      throw new OpenLanderError(
        'OpenLander database schema drift detected for env MCP tools.',
        'SCHEMA_DRIFT',
        500,
        {
          envVarsProjectGroupKeyUnique: hasProjectGroupKeyUnique,
          envVarsProjectEnvironmentKeyUnique: hasProjectEnvironmentKeyUnique,
          envVarsServiceKeyUnique: hasServiceKeyUnique,
          envVarsServiceEnvironmentKeyUnique: hasServiceEnvironmentKeyUnique,
          activityLogTable: hasActivityLog,
        },
      );
    }
  }

  async getEnvVars(projectId: string, environmentId?: string): Promise<Record<string, string>> {
    const rows = await this.db
      .select({ key: envVars.key, value: envVars.value })
      .from(envVars)
      .where(this.projectWhere(projectId, environmentId));

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  async getEnvVarsForService(
    projectId: string,
    serviceId: string,
    environmentId?: string,
  ): Promise<Record<string, string>> {
    const rows = await this.db
      .select({ key: envVars.key, value: envVars.value })
      .from(envVars)
      .where(this.serviceWhere(projectId, serviceId, environmentId));

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  /**
   * Project migration/read-model query. Intentionally omits `value` so
   * callers cannot accidentally serialize secret or configuration values.
   */
  async listMetadataByProject(projectId: string): Promise<EnvVarMetadataRow[]> {
    return await this.db
      .select({
        project_id: envVars.project_id,
        service_id: envVars.service_id,
        environment_id: envVars.environment_id,
        key: envVars.key,
      })
      .from(envVars)
      .where(eq(envVars.project_id, projectId));
  }

  async setEnvVar(
    projectId: string,
    key: string,
    value: string,
    environmentId?: string,
  ): Promise<void> {
    await this.setEnvVarDetailed(projectId, key, value, environmentId);
  }

  async setEnvVarDetailed(
    projectId: string,
    key: string,
    value: string,
    environmentId?: string,
  ): Promise<EnvVarChange> {
    return await this.upsertEnvVarDetailed({ projectId, environmentId }, key, value);
  }

  async setEnvVarForService(
    projectId: string,
    serviceId: string,
    key: string,
    value: string,
    environmentId?: string,
  ): Promise<void> {
    await this.setEnvVarForServiceDetailed(projectId, serviceId, key, value, environmentId);
  }

  async setEnvVarForServiceDetailed(
    projectId: string,
    serviceId: string,
    key: string,
    value: string,
    environmentId?: string,
  ): Promise<EnvVarChange> {
    return await this.upsertEnvVarDetailed({ projectId, serviceId, environmentId }, key, value);
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
        .where(this.projectWhere(projectId, environmentId));

      for (const row of existingRows) {
        if (!(row.key in vars)) {
          await tx.delete(envVars).where(this.projectKeyWhere(projectId, row.key, environmentId));
        }
      }

      for (const [key, value] of Object.entries(vars)) {
        const [selected] = await tx
          .select({ id: envVars.id })
          .from(envVars)
          .where(this.projectKeyWhere(projectId, key, environmentId))
          .limit(1);
        const existing = selected ?? null;

        if (existing) {
          await tx
            .update(envVars)
            .set(this.rowUpdateValues({ projectId, environmentId }, value))
            .where(eq(envVars.id, existing.id));
        } else {
          const conflict = this.conflictTarget({ projectId, environmentId });
          await tx
            .insert(envVars)
            .values(this.rowValues({ projectId, environmentId }, key, value))
            .onConflictDoUpdate({
              target: conflict.target,
              targetWhere: conflict.targetWhere,
              set: this.rowUpdateValues({ projectId, environmentId }, value),
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
    await this.mergeEnvVarsDetailed(projectId, vars, environmentId);
  }

  async mergeEnvVarsDetailed(
    projectId: string,
    vars: Record<string, string>,
    environmentId?: string,
  ): Promise<EnvVarChange[]> {
    return await this.mergeEnvVarsForScopeDetailed({ projectId, environmentId }, vars);
  }

  async deleteEnvVar(projectId: string, key: string, environmentId?: string): Promise<void> {
    await this.db.delete(envVars).where(this.projectKeyWhere(projectId, key, environmentId));
  }

  async mergeEnvVarsForServiceDetailed(
    projectId: string,
    serviceId: string,
    vars: Record<string, string>,
    environmentId?: string,
  ): Promise<EnvVarChange[]> {
    return await this.mergeEnvVarsForScopeDetailed({ projectId, serviceId, environmentId }, vars);
  }

  async deleteEnvVarForService(
    projectId: string,
    serviceId: string,
    key: string,
    environmentId?: string,
  ): Promise<void> {
    await this.db
      .delete(envVars)
      .where(this.serviceKeyWhere(projectId, serviceId, key, environmentId));
  }

  async findProjectsByEnvKey(key: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ project_id: envVars.project_id })
      .from(envVars)
      .where(and(eq(envVars.key, key), isNull(envVars.service_id)));
    return rows.map((r) => r.project_id);
  }

  async findServicesByEnvKey(key: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ service_id: envVars.service_id })
      .from(envVars)
      .where(and(eq(envVars.key, key), isNotNull(envVars.service_id)));
    return rows.flatMap((r) => (r.service_id ? [r.service_id] : []));
  }
}
