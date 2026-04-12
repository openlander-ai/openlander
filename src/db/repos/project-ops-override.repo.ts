import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { project_ops_overrides } from '../schema.drizzle.js';
import type { ProjectOpsOverride } from '../../monitor/ops-types.js';

export class ProjectOpsOverrideRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  save(projectId: string, overrides: ProjectOpsOverride): void {
    const now = new Date().toISOString();

    this.db
      .insert(project_ops_overrides)
      .values({
        id: randomUUID(),
        project_id: projectId,
        overrides_json: JSON.stringify(overrides),
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: project_ops_overrides.project_id,
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
      .where(eq(project_ops_overrides.project_id, projectId))
      .get();
    if (!row) return undefined;
    return JSON.parse(row.overrides_json) as ProjectOpsOverride;
  }

  delete(projectId: string): void {
    this.db
      .delete(project_ops_overrides)
      .where(eq(project_ops_overrides.project_id, projectId))
      .run();
  }
}
