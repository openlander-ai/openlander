import { and, desc, eq, sql } from 'drizzle-orm';

import type { DrizzleClient, SqliteDatabase } from '../drizzle.js';
import { deployLogs } from '../schema.drizzle.js';
import type { DeployLogRow } from '../types.js';

export class DeployLogRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly sqlite: SqliteDatabase,
  ) {
    void this.sqlite;
  }

  createDeployLog(log: {
    id: string;
    projectId: string;
    environmentId?: string;
    status: DeployLogRow['status'];
    trigger: DeployLogRow['trigger'];
    triggerDetail?: string;
    commitSha?: string;
    commitMessage?: string;
    buildLog?: string;
    durationMs?: number;
  }): void {
    this.db
      .insert(deployLogs)
      .values({
        id: log.id,
        project_id: log.projectId,
        environment_id: log.environmentId ?? null,
        status: log.status,
        trigger: log.trigger,
        trigger_detail: log.triggerDetail ?? null,
        commit_sha: log.commitSha ?? null,
        commit_message: log.commitMessage ?? null,
        build_log: log.buildLog ?? null,
        duration_ms: log.durationMs ?? null,
      })
      .run();
  }

  /** @param _serverId - Reserved for future server-side filtering. Currently ignored. */
  getDeployLogs(
    projectId: string,
    limit = 20,
    environmentId?: string,
    _serverId?: string,
  ): DeployLogRow[] {
    const whereClause = environmentId
      ? and(eq(deployLogs.project_id, projectId), eq(deployLogs.environment_id, environmentId))
      : eq(deployLogs.project_id, projectId);

    return this.db
      .select()
      .from(deployLogs)
      .where(whereClause)
      .orderBy(desc(sql`rowid`))
      .limit(limit)
      .all() as DeployLogRow[];
  }

  getLastDeployLog(projectId: string, environmentId?: string): DeployLogRow | undefined {
    const whereClause = environmentId
      ? and(eq(deployLogs.project_id, projectId), eq(deployLogs.environment_id, environmentId))
      : eq(deployLogs.project_id, projectId);

    return this.db
      .select()
      .from(deployLogs)
      .where(whereClause)
      .orderBy(desc(sql`rowid`))
      .limit(1)
      .get() as DeployLogRow | undefined;
  }

  updateRuntimeLog(deployId: string, runtimeLog: string): void {
    this.db
      .update(deployLogs)
      .set({ runtime_log: runtimeLog })
      .where(eq(deployLogs.id, deployId))
      .run();
  }

  getDeployLog(deployId: string): DeployLogRow | undefined {
    return this.db.select().from(deployLogs).where(eq(deployLogs.id, deployId)).get() as
      | DeployLogRow
      | undefined;
  }
}
