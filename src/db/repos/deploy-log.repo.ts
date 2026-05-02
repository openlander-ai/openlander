import { and, desc, eq } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { deployLogs } from '../schema.drizzle.js';
import type { DeployLogRow } from '../types.js';

/**
 * Post-0012: deploy_logs is service-scoped. Callers still pass `projectId`
 * for vocabulary continuity; the repo translates to the canonical service id.
 */
export function projectIdToServiceId(projectId: string): string {
  return projectId.endsWith('__svc') ? projectId : `${projectId}__svc`;
}

export class DeployLogRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async createDeployLog(log: {
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
  }): Promise<void> {
    await this.db.insert(deployLogs).values({
      id: log.id,
      service_id: projectIdToServiceId(log.projectId),
      environment_id: log.environmentId ?? null,
      status: log.status,
      trigger: log.trigger,
      trigger_detail: log.triggerDetail ?? null,
      commit_sha: log.commitSha ?? null,
      commit_message: log.commitMessage ?? null,
      build_log: log.buildLog ?? null,
      duration_ms: log.durationMs ?? null,
    });
  }

  /** @param _serverId - Reserved for future server-side filtering. Currently ignored. */
  async getDeployLogs(
    projectId: string,
    limit = 20,
    environmentId?: string,
    _serverId?: string,
  ): Promise<DeployLogRow[]> {
    const serviceId = projectIdToServiceId(projectId);
    const whereClause = environmentId
      ? and(eq(deployLogs.service_id, serviceId), eq(deployLogs.environment_id, environmentId))
      : eq(deployLogs.service_id, serviceId);

    const rows = await this.db
      .select()
      .from(deployLogs)
      .where(whereClause)
      .orderBy(desc(deployLogs.created_at), desc(deployLogs.id))
      .limit(limit);
    return rows as DeployLogRow[];
  }

  async getLastDeployLog(
    projectId: string,
    environmentId?: string,
  ): Promise<DeployLogRow | undefined> {
    const serviceId = projectIdToServiceId(projectId);
    const whereClause = environmentId
      ? and(eq(deployLogs.service_id, serviceId), eq(deployLogs.environment_id, environmentId))
      : eq(deployLogs.service_id, serviceId);

    const [row] = await this.db
      .select()
      .from(deployLogs)
      .where(whereClause)
      .orderBy(desc(deployLogs.created_at), desc(deployLogs.id))
      .limit(1);
    return (row as DeployLogRow | undefined) ?? undefined;
  }

  async updateRuntimeLog(deployId: string, runtimeLog: string): Promise<void> {
    await this.db
      .update(deployLogs)
      .set({ runtime_log: runtimeLog })
      .where(eq(deployLogs.id, deployId));
  }

  async getDeployLog(deployId: string): Promise<DeployLogRow | undefined> {
    const [row] = await this.db
      .select()
      .from(deployLogs)
      .where(eq(deployLogs.id, deployId))
      .limit(1);
    return (row as DeployLogRow | undefined) ?? undefined;
  }

  /**
   * Cross-project recency query. Used by the v4 /api/activity feed to merge
   * deploy events from all projects without per-project caps that would
   * otherwise drop hot-project rows.
   */
  async listRecentAcrossProjects(limit = 100): Promise<DeployLogRow[]> {
    const rows = await this.db
      .select()
      .from(deployLogs)
      .orderBy(desc(deployLogs.created_at), desc(deployLogs.id))
      .limit(limit);
    return rows as DeployLogRow[];
  }
}
