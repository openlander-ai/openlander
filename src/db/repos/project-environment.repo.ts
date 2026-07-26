import { asc, eq } from 'drizzle-orm';

import { RepoPersistenceError } from '../../errors.js';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import {
  projectEnvironments,
  projectManifestStates,
  type ProjectEnvironmentRow,
  type ProjectManifestStateRow,
} from '../schema.drizzle.js';
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
    manifestState?: {
      manifestPath: string;
      definition: Record<string, unknown>;
      appliedBy: string;
    },
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
      if (manifestState) {
        await tx
          .insert(projectManifestStates)
          .values({
            project_id: projectId,
            manifest_path: manifestState.manifestPath,
            manifest_sha256: manifestSha256,
            definition_json: manifestState.definition,
            applied_by: manifestState.appliedBy,
          })
          .onConflictDoUpdate({
            target: projectManifestStates.project_id,
            set: {
              manifest_path: manifestState.manifestPath,
              manifest_sha256: manifestSha256,
              definition_json: manifestState.definition,
              applied_by: manifestState.appliedBy,
              applied_at: new Date().toISOString(),
            },
          });
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

  async getManifestState(projectId: string): Promise<ProjectManifestStateRow | null> {
    const [row] = await this.db
      .select()
      .from(projectManifestStates)
      .where(eq(projectManifestStates.project_id, projectId))
      .limit(1);
    return row ?? null;
  }
}
