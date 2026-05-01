import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { deploy_configs } from '../schema.drizzle.js';
import type { DeployConfigRow } from '../types.js';

/**
 * Post-0012: deploy_configs is service-scoped. Callers still pass `projectId`
 * for vocabulary continuity; the repo translates to `${projectId}__svc`
 * (the canonical deployable service id) at the FK layer.
 */
function projectIdToServiceId(projectId: string): string {
  return projectId.endsWith('__svc') ? projectId : `${projectId}__svc`;
}

export class DeployConfigRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  save(projectId: string, configJson: string, configVersion: number): void {
    const updatedAt = new Date().toISOString();
    const serviceId = projectIdToServiceId(projectId);

    this.db
      .insert(deploy_configs)
      .values({
        id: randomUUID(),
        service_id: serviceId,
        config_json: configJson,
        config_version: configVersion,
        updated_at: updatedAt,
      })
      .onConflictDoUpdate({
        target: deploy_configs.service_id,
        set: {
          config_json: configJson,
          config_version: configVersion,
          updated_at: updatedAt,
        },
      })
      .run();
  }

  load(projectId: string): DeployConfigRow | undefined {
    const row = this.db
      .select()
      .from(deploy_configs)
      .where(eq(deploy_configs.service_id, projectIdToServiceId(projectId)))
      .get() as DeployConfigRow | undefined;
    if (!row) return undefined;
    // Back-compat: hydrate deprecated project_id from service_id (strip __svc suffix).
    return {
      ...row,
      project_id: row.service_id.endsWith('__svc')
        ? row.service_id.replace(/__svc$/, '')
        : row.service_id,
    };
  }

  delete(projectId: string): void {
    this.db
      .delete(deploy_configs)
      .where(eq(deploy_configs.service_id, projectIdToServiceId(projectId)))
      .run();
  }

  exists(projectId: string): boolean {
    return (
      this.db
        .select({ id: deploy_configs.id })
        .from(deploy_configs)
        .where(eq(deploy_configs.service_id, projectIdToServiceId(projectId)))
        .get() !== undefined
    );
  }
}
