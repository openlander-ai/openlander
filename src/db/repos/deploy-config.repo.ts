import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { deploy_configs } from '../schema.drizzle.js';
import type { DeployConfigRow } from '../types.js';

type DeployConfigSelect = typeof deploy_configs.$inferSelect;

/**
 * Post-0012: deploy_configs is service-scoped. Project-based methods are
 * compatibility shims that translate to the canonical `${projectId}__svc`
 * deployable service id.
 */
function projectIdToServiceId(projectId: string): string {
  return projectId.endsWith('__svc') ? projectId : `${projectId}__svc`;
}

function serviceIdToProjectId(serviceId: string): string {
  return serviceId.endsWith('__svc') ? serviceId.replace(/__svc$/, '') : serviceId;
}

function toDeployConfigRow(row: DeployConfigSelect): DeployConfigRow {
  return {
    ...row,
    created_at: row.created_at ?? '',
    updated_at: row.updated_at ?? '',
    project_id: serviceIdToProjectId(row.service_id),
  };
}

export class DeployConfigRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async save(projectId: string, configJson: string, configVersion: number): Promise<void> {
    await this.saveByServiceId(projectIdToServiceId(projectId), configJson, configVersion);
  }

  async saveByServiceId(
    serviceId: string,
    configJson: string,
    configVersion: number,
  ): Promise<void> {
    const updatedAt = new Date().toISOString();

    await this.db
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
      });
  }

  async load(projectId: string): Promise<DeployConfigRow | null> {
    return this.loadByServiceId(projectIdToServiceId(projectId));
  }

  async loadByServiceId(serviceId: string): Promise<DeployConfigRow | null> {
    const [row] = await this.db
      .select()
      .from(deploy_configs)
      .where(eq(deploy_configs.service_id, serviceId))
      .limit(1);
    return row ? toDeployConfigRow(row) : null;
  }

  async delete(projectId: string): Promise<void> {
    await this.deleteByServiceId(projectIdToServiceId(projectId));
  }

  async deleteByServiceId(serviceId: string): Promise<void> {
    await this.db.delete(deploy_configs).where(eq(deploy_configs.service_id, serviceId));
  }

  async exists(projectId: string): Promise<boolean> {
    return this.existsByServiceId(projectIdToServiceId(projectId));
  }

  async existsByServiceId(serviceId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: deploy_configs.id })
      .from(deploy_configs)
      .where(eq(deploy_configs.service_id, serviceId))
      .limit(1);
    return (row ?? null) !== null;
  }
}
