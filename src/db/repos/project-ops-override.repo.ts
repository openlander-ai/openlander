import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { project_ops_overrides } from '../schema.drizzle.js';
import type { ProjectOpsOverride } from '../../monitor/ops-types.js';

/**
 * Post-0012: service_ops_overrides is service-scoped (table renamed from
 * project_ops_overrides in 0009; FK fully repointed in 0012). Callers still
 * pass `projectId` for vocabulary continuity; the repo translates to the
 * canonical deployable service id.
 */
function projectIdToServiceId(projectId: string): string {
  return projectId.endsWith('__svc') ? projectId : `${projectId}__svc`;
}

export class ProjectOpsOverrideRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async save(projectId: string, overrides: ProjectOpsOverride): Promise<void> {
    const now = new Date().toISOString();
    const serviceId = projectIdToServiceId(projectId);

    await this.db
      .insert(project_ops_overrides)
      .values({
        id: randomUUID(),
        service_id: serviceId,
        overrides_json: JSON.stringify(overrides),
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: project_ops_overrides.service_id,
        set: {
          overrides_json: JSON.stringify(overrides),
          updated_at: now,
        },
      });
  }

  async load(projectId: string): Promise<ProjectOpsOverride | undefined> {
    const row =
      (
        await this.db
          .select()
          .from(project_ops_overrides)
          .where(eq(project_ops_overrides.service_id, projectIdToServiceId(projectId)))
          .limit(1)
      )[0] ?? null;
    if (!row) return undefined;
    return JSON.parse(row.overrides_json) as ProjectOpsOverride;
  }

  async delete(projectId: string): Promise<void> {
    await this.db
      .delete(project_ops_overrides)
      .where(eq(project_ops_overrides.service_id, projectIdToServiceId(projectId)));
  }
}
