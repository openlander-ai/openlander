import { asc, eq } from 'drizzle-orm';

import { RepoPersistenceError } from '../../errors.js';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { projectEnvironments, type ProjectEnvironmentRow } from '../schema.drizzle.js';
import { ulid } from './activity-log.repo.js';

export class ProjectEnvironmentRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async sync(
    projectId: string,
    manifestSha256: string,
    inputs: Array<{
      key: string;
      displayName: string;
      tier: 'development' | 'validation' | 'production';
      promotionOrder: number;
      healthTimeoutSeconds?: number;
      smokePath?: string | null;
      soakSeconds?: number;
    }>,
  ): Promise<ProjectEnvironmentRow[]> {
    return await this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(projectEnvironments)
        .where(eq(projectEnvironments.project_id, projectId));
      const existingByKey = new Map(existing.map((row) => [row.key, row]));
      for (const input of inputs) {
        const current = existingByKey.get(input.key);
        if (current) {
          await tx
            .update(projectEnvironments)
            .set({
              display_name: input.displayName,
              tier: input.tier,
              promotion_order: input.promotionOrder,
              health_timeout_seconds: input.healthTimeoutSeconds ?? 30,
              smoke_path: input.smokePath ?? null,
              soak_seconds: input.soakSeconds ?? 0,
              manifest_sha256: manifestSha256,
              updated_at: new Date().toISOString(),
            })
            .where(eq(projectEnvironments.id, current.id));
        } else {
          const [created] = await tx
            .insert(projectEnvironments)
            .values({
              id: `penv_${ulid()}`,
              project_id: projectId,
              key: input.key,
              display_name: input.displayName,
              tier: input.tier,
              promotion_order: input.promotionOrder,
              health_timeout_seconds: input.healthTimeoutSeconds ?? 30,
              smoke_path: input.smokePath ?? null,
              soak_seconds: input.soakSeconds ?? 0,
              manifest_sha256: manifestSha256,
            })
            .returning();
          if (!created) throw new RepoPersistenceError('project environment', input.key);
        }
      }
      return await tx
        .select()
        .from(projectEnvironments)
        .where(eq(projectEnvironments.project_id, projectId))
        .orderBy(asc(projectEnvironments.promotion_order));
    });
  }

  async get(id: string): Promise<ProjectEnvironmentRow | null> {
    const [row] = await this.db
      .select()
      .from(projectEnvironments)
      .where(eq(projectEnvironments.id, id))
      .limit(1);
    return row ?? null;
  }

  async list(projectId: string): Promise<ProjectEnvironmentRow[]> {
    return await this.db
      .select()
      .from(projectEnvironments)
      .where(eq(projectEnvironments.project_id, projectId))
      .orderBy(asc(projectEnvironments.promotion_order));
  }
}
