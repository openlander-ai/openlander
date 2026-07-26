import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  EngagementNotFoundError,
  EngagementProjectConflictError,
  EngagementProjectNotLinkedError,
  EngagementStateError,
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
  RepoPersistenceError,
} from '../../errors.js';
import type { EngagementStatus, EngagementSystemEventType } from '../../engagement/types.js';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import {
  activityLog,
  deliveries,
  deliveryGates,
  deliveryWorkItems,
  engagementProjects,
  engagements,
  projects,
  services,
  type EngagementProjectRow,
  type EngagementRow,
} from '../schema.drizzle.js';
import { ulid } from './activity-log.repo.js';

type EngagementTransaction = Parameters<Parameters<DrizzleClient['transaction']>[0]>[0];

export interface CreateEngagementInput {
  id?: string;
  customerName: string;
  title: string;
  summary?: string;
  status?: Exclude<EngagementStatus, 'archived'>;
  createdBy?: string;
}

export interface UpdateEngagementInput {
  customerName?: string;
  title?: string;
  summary?: string;
  status?: Exclude<EngagementStatus, 'archived'>;
  updatedBy?: string;
}

export interface BootstrapEngagementInput extends CreateEngagementInput {
  id: string;
  project: {
    id: string;
    name: string;
    displayName?: string;
    description?: string | null;
    tags?: string | null;
  };
}

export interface EngagementPortfolioRows {
  memberships: Array<{
    engagement_id: string;
    project_id: string;
    linked_by: string;
    linked_at: string;
    project_name: string;
    project_display_name: string;
    project_archived_at: string | null;
    project_updated_at: string | null;
  }>;
  serviceRows: Array<{
    project_id: string;
    kind: string;
    status: 'running' | 'stopped' | 'error' | 'recovering' | null;
    runtime_role: 'application' | 'job' | 'resource';
    archived_at: string | null;
  }>;
  deliveryRows: Array<{
    id: string;
    project_id: string;
    title: string;
    delivery_type: 'software_release' | 'artifact_delivery';
    maturity:
      'concept' | 'functional_preview' | 'customer_review' | 'release_candidate' | 'production';
    status:
      | 'draft'
      | 'in_review'
      | 'revision_requested'
      | 'approved'
      | 'ready'
      | 'delivered'
      | 'cancelled';
    updated_at: string;
  }>;
  gateRows: Array<{
    id: string;
    delivery_id: string;
    gate_key: string;
    label: string;
    required: boolean;
    status: 'pending' | 'passed' | 'warning' | 'failed' | 'waived';
    summary: string | null;
    warning_accepted: boolean;
  }>;
  workItemRows: Array<{
    id: string;
    delivery_id: string;
    kind: 'decision' | 'change_request' | 'question' | 'note';
    title: string;
    detail: string;
    status: 'proposed' | 'confirmed' | 'rejected' | 'resolved' | 'superseded';
  }>;
  activityRows: Array<{
    project_id: string;
    correlation_id: string | null;
    latest_at: string;
  }>;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === '23505' ||
    (typeof candidate.message === 'string' &&
      candidate.message.toLowerCase().includes('unique constraint'))
  );
}

async function insertEngagementActivity(
  tx: EngagementTransaction,
  input: {
    engagementId: string;
    eventType: EngagementSystemEventType;
    title: string;
    description: string;
    status: string;
    actor: string;
    projectId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const [created] = await tx
    .insert(activityLog)
    .values({
      id: ulid(),
      event_type: input.eventType,
      activity_type: 'engagement',
      severity: 'info',
      project_id: input.projectId ?? `engagement:${input.engagementId}`,
      correlation_id: input.engagementId,
      title: input.title,
      description: input.description,
      status: input.status,
      metadata: JSON.stringify({
        schema_version: 1,
        ...input.metadata,
        actor: input.actor,
        engagement_id: input.engagementId,
      }),
      created_at: new Date().toISOString(),
    })
    .returning({ id: activityLog.id });
  if (!created) throw new RepoPersistenceError('engagement activity', input.engagementId);
}

export class EngagementRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async list(includeArchived = false): Promise<EngagementRow[]> {
    return await this.db
      .select()
      .from(engagements)
      .where(includeArchived ? undefined : ne(engagements.status, 'archived'))
      .orderBy(desc(engagements.updated_at), desc(engagements.id));
  }

  async get(id: string): Promise<EngagementRow | null> {
    const [row] = await this.db.select().from(engagements).where(eq(engagements.id, id)).limit(1);
    return row ?? null;
  }

  async require(id: string): Promise<EngagementRow> {
    const row = await this.get(id);
    if (!row) throw new EngagementNotFoundError(id);
    return row;
  }

  private async requireForUpdate(tx: EngagementTransaction, id: string): Promise<EngagementRow> {
    const [row] = await tx
      .select()
      .from(engagements)
      .where(eq(engagements.id, id))
      .limit(1)
      .for('update');
    if (!row) throw new EngagementNotFoundError(id);
    return row;
  }

  async create(input: CreateEngagementInput): Promise<EngagementRow> {
    const id = input.id ?? ulid();
    const actor = input.createdBy ?? 'admin';
    return await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(engagements)
        .values({
          id,
          customer_name: input.customerName,
          title: input.title,
          summary: input.summary ?? '',
          status: input.status ?? 'active',
          created_by: actor,
        })
        .returning();
      if (!created) throw new RepoPersistenceError('engagement', id);
      await insertEngagementActivity(tx, {
        engagementId: id,
        eventType: 'engagement:created',
        title: `Engagement created: ${created.title}`,
        description: `Created for ${created.customer_name}.`,
        status: created.status,
        actor,
        metadata: {
          engagement_title: created.title,
          customer_name: created.customer_name,
          engagement_status: created.status,
        },
      });
      return created;
    });
  }

  async bootstrap(input: BootstrapEngagementInput): Promise<{
    engagement: EngagementRow;
    project: { id: string; name: string; display_name: string };
  }> {
    const actor = input.createdBy ?? 'external-agent';
    return await this.db.transaction(async (tx) => {
      const [existingEngagement] = await tx
        .select()
        .from(engagements)
        .where(eq(engagements.id, input.id))
        .limit(1);
      const [existingProject] = await tx
        .select()
        .from(projects)
        .where(or(eq(projects.id, input.project.id), eq(projects.name, input.project.name)))
        .limit(1);

      if (existingEngagement || existingProject) {
        if (
          existingEngagement?.id === input.id &&
          existingEngagement.customer_name === input.customerName &&
          existingEngagement.title === input.title &&
          existingProject?.id === input.project.id &&
          existingProject.name === input.project.name
        ) {
          const [membership] = await tx
            .select()
            .from(engagementProjects)
            .where(
              and(
                eq(engagementProjects.engagement_id, input.id),
                eq(engagementProjects.project_id, input.project.id),
              ),
            )
            .limit(1);
          if (membership) {
            return {
              engagement: existingEngagement,
              project: {
                id: existingProject.id,
                name: existingProject.name,
                display_name: existingProject.display_name || existingProject.name,
              },
            };
          }
        }
        if (existingProject) throw new ProjectAlreadyExistsError(input.project.name);
        throw new EngagementStateError(
          input.id,
          'The deterministic Engagement id is already used by another operation.',
          existingEngagement?.status,
        );
      }

      const [project] = await tx
        .insert(projects)
        .values({
          id: input.project.id,
          name: input.project.name,
          display_name: input.project.displayName ?? input.project.name,
          description: input.project.description ?? null,
          tags: input.project.tags ?? null,
        })
        .returning();
      if (!project) throw new RepoPersistenceError('project', input.project.id);

      const [engagement] = await tx
        .insert(engagements)
        .values({
          id: input.id,
          customer_name: input.customerName,
          title: input.title,
          summary: input.summary ?? '',
          status: input.status ?? 'active',
          created_by: actor,
        })
        .returning();
      if (!engagement) throw new RepoPersistenceError('engagement', input.id);

      const [membership] = await tx
        .insert(engagementProjects)
        .values({
          engagement_id: engagement.id,
          project_id: project.id,
          linked_by: actor,
        })
        .returning();
      if (!membership) {
        throw new RepoPersistenceError('engagement project membership', project.id);
      }

      await insertEngagementActivity(tx, {
        engagementId: engagement.id,
        eventType: 'engagement:created',
        title: `Engagement created: ${engagement.title}`,
        description: `Created for ${engagement.customer_name} with initial Project ${project.name}.`,
        status: engagement.status,
        actor,
        projectId: project.id,
        metadata: {
          engagement_title: engagement.title,
          customer_name: engagement.customer_name,
          engagement_status: engagement.status,
          project_id: project.id,
          project_name: project.name,
          bootstrap: true,
        },
      });

      return {
        engagement,
        project: {
          id: project.id,
          name: project.name,
          display_name: project.display_name || project.name,
        },
      };
    });
  }

  async update(id: string, input: UpdateEngagementInput): Promise<EngagementRow> {
    const actor = input.updatedBy ?? 'admin';
    return await this.db.transaction(async (tx) => {
      const current = await this.requireForUpdate(tx, id);
      if (current.status === 'archived') {
        throw new EngagementStateError(
          id,
          'Archived Engagements cannot be edited until they are unarchived.',
          current.status,
        );
      }
      const [updated] = await tx
        .update(engagements)
        .set({
          ...(input.customerName !== undefined ? { customer_name: input.customerName } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updated_at: new Date().toISOString(),
        })
        .where(eq(engagements.id, id))
        .returning();
      if (!updated) throw new EngagementNotFoundError(id);
      const changedFields = [
        input.customerName !== undefined ? 'customer_name' : null,
        input.title !== undefined ? 'title' : null,
        input.summary !== undefined ? 'summary' : null,
        input.status !== undefined ? 'status' : null,
      ].filter((field): field is string => field !== null);
      await insertEngagementActivity(tx, {
        engagementId: id,
        eventType: 'engagement:updated',
        title: `Engagement updated: ${updated.title}`,
        description: 'Engagement metadata was updated.',
        status: updated.status,
        actor,
        metadata: {
          engagement_title: updated.title,
          previous_engagement_title: current.title,
          customer_name: updated.customer_name,
          previous_status: current.status,
          engagement_status: updated.status,
          changed_fields: changedFields,
        },
      });
      return updated;
    });
  }

  async archive(id: string, actor = 'admin'): Promise<EngagementRow> {
    return await this.setArchivedStatus(id, 'archived', actor);
  }

  async unarchive(id: string, actor = 'admin'): Promise<EngagementRow> {
    return await this.setArchivedStatus(id, 'active', actor);
  }

  private async setArchivedStatus(
    id: string,
    status: 'active' | 'archived',
    actor: string,
  ): Promise<EngagementRow> {
    return await this.db.transaction(async (tx) => {
      const current = await this.requireForUpdate(tx, id);
      if (status === 'archived' && current.status === 'archived') return current;
      if (status === 'active' && current.status !== 'archived') {
        throw new EngagementStateError(
          id,
          'Only archived Engagements can be unarchived.',
          current.status,
        );
      }
      const [updated] = await tx
        .update(engagements)
        .set({ status, updated_at: new Date().toISOString() })
        .where(eq(engagements.id, id))
        .returning();
      if (!updated) throw new EngagementNotFoundError(id);
      const archived = status === 'archived';
      await insertEngagementActivity(tx, {
        engagementId: id,
        eventType: archived ? 'engagement:archived' : 'engagement:unarchived',
        title: `Engagement ${archived ? 'archived' : 'unarchived'}: ${updated.title}`,
        description: archived
          ? 'The Engagement was archived. Linked Projects and Deliveries were not changed.'
          : 'The Engagement was restored to active status.',
        status,
        actor,
        metadata: {
          engagement_title: updated.title,
          customer_name: updated.customer_name,
          previous_status: current.status,
          engagement_status: updated.status,
          linked_projects_changed: false,
          deliveries_changed: false,
        },
      });
      return updated;
    });
  }

  async linkProject(
    engagementId: string,
    projectId: string,
    actor = 'admin',
  ): Promise<EngagementProjectRow> {
    try {
      return await this.db.transaction(async (tx) => {
        const engagement = await this.requireForUpdate(tx, engagementId);
        if (engagement.status === 'archived') {
          throw new EngagementStateError(
            engagementId,
            'Projects cannot be linked to an archived Engagement.',
            engagement.status,
          );
        }
        const [project] = await tx
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);
        if (!project) throw new ProjectNotFoundError(projectId);

        const [existing] = await tx
          .select()
          .from(engagementProjects)
          .where(eq(engagementProjects.project_id, projectId))
          .limit(1);
        if (existing?.engagement_id === engagementId) return existing;
        if (existing) {
          throw new EngagementProjectConflictError(projectId, existing.engagement_id);
        }

        const [linked] = await tx
          .insert(engagementProjects)
          .values({
            engagement_id: engagementId,
            project_id: projectId,
            linked_by: actor,
          })
          .returning();
        if (!linked) throw new RepoPersistenceError('engagement project link', projectId);
        await tx
          .update(engagements)
          .set({ updated_at: new Date().toISOString() })
          .where(eq(engagements.id, engagementId));
        await insertEngagementActivity(tx, {
          engagementId,
          projectId,
          eventType: 'engagement:project_linked',
          title: `Project linked: ${project.name}`,
          description: `Project "${project.name}" was linked to ${engagement.title}.`,
          status: engagement.status,
          actor,
          metadata: {
            engagement_title: engagement.title,
            customer_name: engagement.customer_name,
            engagement_status: engagement.status,
            project_id: projectId,
            project_name: project.name,
          },
        });
        return linked;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const [conflict] = await this.db
        .select()
        .from(engagementProjects)
        .where(eq(engagementProjects.project_id, projectId))
        .limit(1);
      if (conflict?.engagement_id === engagementId) return conflict;
      throw new EngagementProjectConflictError(projectId, conflict?.engagement_id ?? 'unknown');
    }
  }

  async unlinkProject(engagementId: string, projectId: string, actor = 'admin'): Promise<void> {
    await this.db.transaction(async (tx) => {
      const engagement = await this.requireForUpdate(tx, engagementId);
      if (engagement.status === 'archived') {
        throw new EngagementStateError(
          engagementId,
          'Projects cannot be unlinked from an archived Engagement.',
          engagement.status,
        );
      }
      const [membership] = await tx
        .select()
        .from(engagementProjects)
        .where(
          and(
            eq(engagementProjects.engagement_id, engagementId),
            eq(engagementProjects.project_id, projectId),
          ),
        )
        .limit(1);
      if (!membership) throw new EngagementProjectNotLinkedError(engagementId, projectId);

      const [project] = await tx
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      await tx
        .delete(engagementProjects)
        .where(
          and(
            eq(engagementProjects.engagement_id, engagementId),
            eq(engagementProjects.project_id, projectId),
          ),
        );
      await tx
        .update(engagements)
        .set({ updated_at: new Date().toISOString() })
        .where(eq(engagements.id, engagementId));
      await insertEngagementActivity(tx, {
        engagementId,
        projectId,
        eventType: 'engagement:project_unlinked',
        title: `Project unlinked: ${project?.name ?? projectId}`,
        description: `Project "${project?.name ?? projectId}" was unlinked from ${engagement.title}.`,
        status: engagement.status,
        actor,
        metadata: {
          engagement_title: engagement.title,
          customer_name: engagement.customer_name,
          engagement_status: engagement.status,
          project_id: projectId,
          project_name: project?.name ?? projectId,
        },
      });
    });
  }

  async getProjectEngagement(projectId: string): Promise<EngagementRow | null> {
    const [row] = await this.db
      .select({ engagement: engagements })
      .from(engagementProjects)
      .innerJoin(engagements, eq(engagements.id, engagementProjects.engagement_id))
      .where(eq(engagementProjects.project_id, projectId))
      .limit(1);
    return row?.engagement ?? null;
  }

  async listUnassignedProjects(): Promise<
    Array<{ id: string; name: string; display_name: string; archived_at: string | null }>
  > {
    return await this.db
      .select({
        id: projects.id,
        name: projects.name,
        display_name: projects.display_name,
        archived_at: projects.archived_at,
      })
      .from(projects)
      .leftJoin(engagementProjects, eq(engagementProjects.project_id, projects.id))
      .where(and(isNull(engagementProjects.project_id), isNull(projects.archived_at)))
      .orderBy(projects.name);
  }

  async getPortfolioRows(engagementIds: readonly string[]): Promise<EngagementPortfolioRows> {
    if (engagementIds.length === 0) {
      return {
        memberships: [],
        serviceRows: [],
        deliveryRows: [],
        gateRows: [],
        workItemRows: [],
        activityRows: [],
      };
    }

    const memberships = await this.db
      .select({
        engagement_id: engagementProjects.engagement_id,
        project_id: projects.id,
        linked_by: engagementProjects.linked_by,
        linked_at: engagementProjects.linked_at,
        project_name: projects.name,
        project_display_name: projects.display_name,
        project_archived_at: projects.archived_at,
        project_updated_at: projects.updated_at,
      })
      .from(engagementProjects)
      .innerJoin(projects, eq(projects.id, engagementProjects.project_id))
      .where(inArray(engagementProjects.engagement_id, [...engagementIds]))
      .orderBy(projects.name);
    const projectIds = memberships.map((row) => row.project_id);
    if (projectIds.length === 0) {
      return {
        memberships,
        serviceRows: [],
        deliveryRows: [],
        gateRows: [],
        workItemRows: [],
        activityRows: [],
      };
    }

    const [serviceRows, deliveryRows, activityRows] = await Promise.all([
      this.db
        .select({
          project_id: services.project_id,
          kind: services.kind,
          status: services.status,
          runtime_role: services.runtime_role,
          archived_at: services.archived_at,
        })
        .from(services)
        .where(inArray(services.project_id, projectIds)),
      this.db
        .select({
          id: deliveries.id,
          project_id: deliveries.project_id,
          title: deliveries.title,
          delivery_type: deliveries.delivery_type,
          maturity: deliveries.maturity,
          status: deliveries.status,
          updated_at: deliveries.updated_at,
        })
        .from(deliveries)
        .where(inArray(deliveries.project_id, projectIds)),
      this.db
        .select({
          project_id: activityLog.project_id,
          correlation_id: activityLog.correlation_id,
          latest_at: sql<string>`max(${activityLog.created_at})`,
        })
        .from(activityLog)
        .where(
          or(
            inArray(activityLog.project_id, projectIds),
            inArray(activityLog.correlation_id, [...engagementIds]),
          ),
        )
        .groupBy(activityLog.project_id, activityLog.correlation_id),
    ]);
    const deliveryIds = deliveryRows.map((row) => row.id);
    if (deliveryIds.length === 0) {
      return {
        memberships,
        serviceRows,
        deliveryRows,
        gateRows: [],
        workItemRows: [],
        activityRows,
      };
    }
    const [gateRows, workItemRows] = await Promise.all([
      this.db
        .select({
          id: deliveryGates.id,
          delivery_id: deliveryGates.delivery_id,
          gate_key: deliveryGates.gate_key,
          label: deliveryGates.label,
          required: deliveryGates.required,
          status: deliveryGates.status,
          summary: deliveryGates.summary,
          warning_accepted: deliveryGates.warning_accepted,
        })
        .from(deliveryGates)
        .where(inArray(deliveryGates.delivery_id, deliveryIds)),
      this.db
        .select({
          id: deliveryWorkItems.id,
          delivery_id: deliveryWorkItems.delivery_id,
          kind: deliveryWorkItems.kind,
          title: deliveryWorkItems.title,
          detail: deliveryWorkItems.detail,
          status: deliveryWorkItems.status,
        })
        .from(deliveryWorkItems)
        .where(inArray(deliveryWorkItems.delivery_id, deliveryIds)),
    ]);
    return { memberships, serviceRows, deliveryRows, gateRows, workItemRows, activityRows };
  }

  async listRecentActivity(
    engagementId: string,
    projectIds: readonly string[],
    limit = 30,
  ): Promise<Array<typeof activityLog.$inferSelect>> {
    const engagementCondition = eq(activityLog.correlation_id, engagementId);
    const condition =
      projectIds.length > 0
        ? or(engagementCondition, inArray(activityLog.project_id, [...projectIds]))
        : engagementCondition;
    return await this.db
      .select()
      .from(activityLog)
      .where(condition)
      .orderBy(desc(activityLog.created_at), desc(activityLog.id))
      .limit(limit);
  }
}
