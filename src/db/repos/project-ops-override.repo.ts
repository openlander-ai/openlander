import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
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
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  save(projectId: string, overrides: ProjectOpsOverride): void {
    const now = new Date().toISOString();
    const serviceId = projectIdToServiceId(projectId);

    this.db
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
      })
      .run();
  }

  load(projectId: string): ProjectOpsOverride | undefined {
    const row = this.db
      .select()
      .from(project_ops_overrides)
      .where(eq(project_ops_overrides.service_id, projectIdToServiceId(projectId)))
      .get();
    if (!row) return undefined;
    return JSON.parse(row.overrides_json) as ProjectOpsOverride;
  }

  delete(projectId: string): void {
    this.db
      .delete(project_ops_overrides)
      .where(eq(project_ops_overrides.service_id, projectIdToServiceId(projectId)))
      .run();
  }
}
