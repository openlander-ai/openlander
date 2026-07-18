import { and, desc, eq, inArray } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { deployLogs, services } from '../schema.drizzle.js';
import { projectIdToDeployableServiceId } from '../service-ids.js';
import type { DeployLogRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

/**
 * Post-0012: deploy_logs is service-scoped. Callers still pass `projectId`
 * for vocabulary continuity; the repo translates to the canonical service id.
 */

export class DeployLogRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  private async resolveExistingCanonicalServiceId(projectId: string): Promise<string> {
    const serviceId = projectIdToDeployableServiceId(projectId);
    const [service] = await this.db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.id, serviceId))
      .limit(1);
    if (!service) {
      throw new RepoPersistenceError('service', serviceId);
    }
    return service.id;
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
    runtimeLog?: string;
    representativeTrafficJson?: string;
    durationMs?: number;
  }): Promise<void> {
    const serviceId = await this.resolveExistingCanonicalServiceId(log.projectId);
    await this.db.insert(deployLogs).values({
      id: log.id,
      service_id: serviceId,
      environment_id: log.environmentId ?? null,
      status: log.status,
      trigger: log.trigger,
      trigger_detail: log.triggerDetail ?? null,
      commit_sha: log.commitSha ?? null,
      commit_message: log.commitMessage ?? null,
      build_log: log.buildLog ?? null,
      runtime_log: log.runtimeLog ?? null,
      representative_traffic_json: log.representativeTrafficJson ?? null,
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
    const serviceId = projectIdToDeployableServiceId(projectId);
    return this.getDeployLogsForService(serviceId, limit, environmentId);
  }

  async getDeployLogsForService(
    serviceId: string,
    limit = 20,
    environmentId?: string,
  ): Promise<DeployLogRow[]> {
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
    const serviceId = projectIdToDeployableServiceId(projectId);
    return this.getLastDeployLogForService(serviceId, environmentId);
  }

  async getLastDeployLogForService(
    serviceId: string,
    environmentId?: string,
  ): Promise<DeployLogRow | undefined> {
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

  async getLastDeployLogsForServices(
    serviceIds: readonly string[],
  ): Promise<Map<string, DeployLogRow>> {
    if (serviceIds.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([deployLogs.service_id])
      .from(deployLogs)
      .where(inArray(deployLogs.service_id, [...serviceIds]))
      .orderBy(deployLogs.service_id, desc(deployLogs.created_at), desc(deployLogs.id));
    return new Map((rows as DeployLogRow[]).map((row) => [row.service_id, row]));
  }

  async updateRuntimeLog(deployId: string, runtimeLog: string): Promise<void> {
    await this.db
      .update(deployLogs)
      .set({ runtime_log: runtimeLog })
      .where(eq(deployLogs.id, deployId));
  }

  async updateRepresentativeTraffic(
    deployId: string,
    representativeTrafficJson: string,
  ): Promise<void> {
    await this.db
      .update(deployLogs)
      .set({ representative_traffic_json: representativeTrafficJson })
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
