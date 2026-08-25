import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { environments, services } from '../schema.drizzle.js';
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

  async createEnvironment(environment: {
    id: string;
    projectId: string;
    type: EnvironmentRow['type'];
    branch?: string | null;
    status?: EnvironmentRow['status'];
    assignedPort?: number | null;
    containerId?: string | null;
    imageTag?: string | null;
    previousImageTag?: string | null;
    publicUrl?: string | null;
  }): Promise<EnvironmentRow> {
    const serviceId = await this.resolveExistingCanonicalServiceId(environment.projectId);
    const existing = await this.getEnvironmentByServiceAndType(serviceId, environment.type);
    if (existing) {
      return { ...existing, project_id: environment.projectId };
    }
    const [created] = await this.db
      .insert(environments)
      .values({
        id: environment.id,
        service_id: serviceId,
        type: environment.type,
        branch: environment.branch ?? null,
        status: environment.status ?? 'idle',
        assigned_port: environment.assignedPort ?? null,
        container_id: environment.containerId ?? null,
        image_tag: environment.imageTag ?? null,
        previous_image_tag: environment.previousImageTag ?? null,
        public_url: environment.publicUrl ?? null,
      })
      .onConflictDoNothing()
      .returning();

    const row =
      ((created ?? null) as EnvironmentRow | null) ??
      (await this.getEnvironment(environment.id)) ??
      (await this.getEnvironmentByServiceAndType(serviceId, environment.type)) ??
      null;
    if (!row) throw new RepoPersistenceError('environment', environment.id);
    return { ...row, project_id: deployableServiceIdToProjectId(row.service_id) };
  }

  async createProjectEnvironmentRuntime(environment: {
    id: string;
    serviceId: string;
    projectEnvironmentId: string;
    type: EnvironmentRow['type'];
    branch?: string | null;
  }): Promise<EnvironmentRow> {
    const existing = await this.getEnvironmentByServiceAndProjectEnvironment(
      environment.serviceId,
      environment.projectEnvironmentId,
    );
    if (existing) return existing;
    const [created] = await this.db
      .insert(environments)
      .values({
        id: environment.id,
        service_id: environment.serviceId,
        project_environment_id: environment.projectEnvironmentId,
        type: environment.type,
        branch: environment.branch ?? null,
        status: 'idle',
      })
      .onConflictDoNothing()
      .returning();
    const row =
      created ??
      (await this.getEnvironmentByServiceAndProjectEnvironment(
        environment.serviceId,
        environment.projectEnvironmentId,
      ));
    if (!row) throw new RepoPersistenceError('environment', environment.id);
    return row as EnvironmentRow;
  }

  async getEnvironmentByServiceAndProjectEnvironment(
    serviceId: string,
    projectEnvironmentId: string,
  ): Promise<EnvironmentRow | undefined> {
    const [selected] = await this.db
      .select()
      .from(environments)
      .where(
        and(
          eq(environments.service_id, serviceId),
          eq(environments.project_environment_id, projectEnvironmentId),
        ),
      )
      .limit(1);
    return (selected ?? undefined) as EnvironmentRow | undefined;
  }

  private async getEnvironmentByServiceAndType(
    serviceId: string,
    type: EnvironmentRow['type'],
  ): Promise<EnvironmentRow | undefined> {
    const [selected] = await this.db
      .select()
      .from(environments)
      .where(and(eq(environments.service_id, serviceId), eq(environments.type, type)))
      .limit(1);
    return (selected ?? undefined) as EnvironmentRow | undefined;
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

  async getEnvironmentsByServiceId(serviceId: string): Promise<EnvironmentRow[]> {
    return (await this.db
      .select()
      .from(environments)
      .where(eq(environments.service_id, serviceId))
      .orderBy(asc(environments.created_at))) as EnvironmentRow[];
  }

  async getEnvironmentsByServiceIds(serviceIds: readonly string[]): Promise<EnvironmentRow[]> {
    if (serviceIds.length === 0) return [];
    return (await this.db
      .select()
      .from(environments)
      .where(inArray(environments.service_id, [...serviceIds]))
      .orderBy(asc(environments.created_at))) as EnvironmentRow[];
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
      branch: string | null;
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
