import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { environments } from '../schema.drizzle.js';
import { deployableServiceIdToProjectId, projectIdToDeployableServiceId } from '../service-ids.js';
import type { EnvironmentRow } from '../types.js';
import { RepoPersistenceError } from '../../errors.js';

export class EnvironmentRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async createEnvironment(environment: {
    id: string;
    projectId: string;
    type: EnvironmentRow['type'];
    branch: string;
    status?: EnvironmentRow['status'];
    assignedPort?: number | null;
    containerId?: string | null;
    imageTag?: string | null;
    previousImageTag?: string | null;
    publicUrl?: string | null;
  }): Promise<EnvironmentRow> {
    const [created] = await this.db
      .insert(environments)
      .values({
        id: environment.id,
        service_id: projectIdToDeployableServiceId(environment.projectId),
        type: environment.type,
        branch: environment.branch,
        status: environment.status ?? 'idle',
        assigned_port: environment.assignedPort ?? null,
        container_id: environment.containerId ?? null,
        image_tag: environment.imageTag ?? null,
        previous_image_tag: environment.previousImageTag ?? null,
        public_url: environment.publicUrl ?? null,
      })
      .returning();

    const row = (created ?? null) as EnvironmentRow | null;
    if (!row) throw new RepoPersistenceError('environment', environment.id);
    return { ...row, project_id: deployableServiceIdToProjectId(row.service_id) };
  }

  async getEnvironment(id: string): Promise<EnvironmentRow | undefined> {
    const [selected] = await this.db
      .select()
      .from(environments)
      .where(eq(environments.id, id))
      .limit(1);
    const row = (selected ?? null) as EnvironmentRow | null;
    if (!row) return undefined;
    // Back-compat: hydrate deprecated project_id from the canonical service_id.
    return { ...row, project_id: deployableServiceIdToProjectId(row.service_id) };
  }

  async getEnvironmentsByProject(projectId: string): Promise<EnvironmentRow[]> {
    const rows = (await this.db
      .select()
      .from(environments)
      .where(eq(environments.service_id, projectIdToDeployableServiceId(projectId)))
      .orderBy(asc(environments.created_at))) as EnvironmentRow[];
    // Back-compat: hydrate deprecated project_id from projectId parameter so
    // callers that read env.project_id continue to work through 1.0.
    return rows.map((r) => ({ ...r, project_id: projectId }));
  }

  async getEnvironmentsByProjectIds(projectIds: string[]): Promise<Map<string, EnvironmentRow[]>> {
    if (projectIds.length === 0) {
      return new Map();
    }

    const uniqueProjectIds = [...new Set(projectIds)];
    const projectIdByServiceId = new Map(
      uniqueProjectIds.map((projectId) => [projectIdToDeployableServiceId(projectId), projectId]),
    );
    const rows = (await this.db
      .select()
      .from(environments)
      .where(inArray(environments.service_id, [...projectIdByServiceId.keys()]))
      .orderBy(asc(environments.created_at))) as EnvironmentRow[];

    const byProjectId = new Map<string, EnvironmentRow[]>(
      uniqueProjectIds.map((projectId) => [projectId, []]),
    );
    for (const row of rows) {
      const projectId = projectIdByServiceId.get(row.service_id);
      if (!projectId) continue;
      byProjectId.get(projectId)?.push({ ...row, project_id: projectId });
    }

    return byProjectId;
  }

  async updateEnvironment(
    id: string,
    updates: Partial<{
      branch: string;
      status: EnvironmentRow['status'];
      assignedPort: number | null;
      containerId: string | null;
      imageTag: string | null;
      previousImageTag: string | null;
      publicUrl: string | null;
      containerPort: number | null;
    }>,
  ): Promise<void> {
    const setValues: Partial<typeof environments.$inferInsert> = {};

    if (updates.branch !== undefined) {
      setValues.branch = updates.branch;
    }
    if (updates.status !== undefined) {
      setValues.status = updates.status;
    }
    if (updates.assignedPort !== undefined) {
      setValues.assigned_port = updates.assignedPort;
    }
    if (updates.containerId !== undefined) {
      setValues.container_id = updates.containerId;
    }
    if (updates.imageTag !== undefined) {
      setValues.image_tag = updates.imageTag;
    }
    if (updates.previousImageTag !== undefined) {
      setValues.previous_image_tag = updates.previousImageTag;
    }
    if (updates.publicUrl !== undefined) {
      setValues.public_url = updates.publicUrl;
    }
    if (updates.containerPort !== undefined) {
      setValues.container_port = updates.containerPort;
    }

    if (Object.keys(setValues).length === 0) return;

    await this.db
      .update(environments)
      .set({ ...setValues, updated_at: sql`now()::text` })
      .where(eq(environments.id, id));
  }

  async deleteEnvironment(id: string): Promise<void> {
    await this.db.delete(environments).where(eq(environments.id, id));
  }
}
