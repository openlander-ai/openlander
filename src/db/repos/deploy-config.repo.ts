import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { deploy_configs } from '../schema.drizzle.js';
import type { DeployConfigRow } from '../types.js';

export class DeployConfigRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  save(projectId: string, configJson: string, configVersion: number): void {
    const updatedAt = new Date().toISOString();

    this.db
      .insert(deploy_configs)
      .values({
        id: randomUUID(),
        project_id: projectId,
        config_json: configJson,
        config_version: configVersion,
        updated_at: updatedAt,
      })
      .onConflictDoUpdate({
        target: deploy_configs.project_id,
        set: {
          config_json: configJson,
          config_version: configVersion,
          updated_at: updatedAt,
        },
      })
      .run();
  }

  load(projectId: string): DeployConfigRow | undefined {
    return this.db
      .select()
      .from(deploy_configs)
      .where(eq(deploy_configs.project_id, projectId))
      .get() as DeployConfigRow | undefined;
  }

  delete(projectId: string): void {
    this.db.delete(deploy_configs).where(eq(deploy_configs.project_id, projectId)).run();
  }

  exists(projectId: string): boolean {
    return (
      this.db
        .select({ id: deploy_configs.id })
        .from(deploy_configs)
        .where(eq(deploy_configs.project_id, projectId))
        .get() !== undefined
    );
  }
}
