import type { Database } from '../db/index.js';
import type { EngagementPortfolioRows } from '../db/repos/engagement.repo.js';
import { deriveGroupStatusFromServices } from '../db/repos/project.repo.js';
import type { EngagementRow } from '../db/schema.drizzle.js';
import { EngagementValidationError } from '../errors.js';
import type {
  EngagementActivity,
  EngagementActivityMetadata,
  EngagementBlocker,
  EngagementDeliverySummary,
  EngagementDeliveryView,
  EngagementDetail,
  EngagementProjectRuntimeStatus,
  EngagementProjectSummary,
  EngagementStatus,
  EngagementSummary,
  ProjectEngagementReference,
} from './types.js';

function requiredText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new EngagementValidationError(`${field} must not be empty.`, { field });
  }
  return trimmed;
}

function parseActivityMetadata(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function maxTimestamp(...values: Array<string | null | undefined>): string {
  return values.reduce<string>(
    (latest, value) => (value && value > latest ? value : latest),
    '1970-01-01T00:00:00.000Z',
  );
}

function emptyDeliverySummary(): EngagementDeliverySummary {
  return {
    total: 0,
    blocker_count: 0,
    by_status: {
      draft: 0,
      in_review: 0,
      revision_requested: 0,
      approved: 0,
      ready: 0,
      delivered: 0,
      cancelled: 0,
    },
  };
}

function groupBy<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = result.get(key);
    if (group) group.push(row);
    else result.set(key, [row]);
  }
  return result;
}

function projectRuntimeStatus(
  serviceRows: EngagementPortfolioRows['serviceRows'],
): EngagementProjectRuntimeStatus {
  const status = deriveGroupStatusFromServices(serviceRows);
  return status ?? 'unknown';
}

function createDeliveryBlockers(
  delivery: EngagementPortfolioRows['deliveryRows'][number],
  project: EngagementPortfolioRows['memberships'][number],
  gates: EngagementPortfolioRows['gateRows'],
  workItems: EngagementPortfolioRows['workItemRows'],
): EngagementBlocker[] {
  const blockers: EngagementBlocker[] = [];
  const base = {
    project_id: project.project_id,
    project_name: project.project_display_name || project.project_name,
    delivery_id: delivery.id,
    delivery_title: delivery.title,
    deep_link: `/projects/${encodeURIComponent(project.project_id)}/deliveries/${encodeURIComponent(delivery.id)}`,
  };
  if (delivery.status === 'revision_requested') {
    blockers.push({
      ...base,
      kind: 'revision_requested',
      resource_id: delivery.id,
      title: 'Revision requested',
      detail: `${delivery.title} requires revision before it can progress.`,
      metadata: { delivery_status: 'revision_requested' },
    });
  }
  for (const gate of gates) {
    if (gate.required && gate.status === 'failed') {
      blockers.push({
        ...base,
        kind: 'required_gate_failed',
        resource_id: gate.id,
        title: gate.label,
        detail: gate.summary ?? 'A required Delivery Gate failed.',
        metadata: {
          gate_key: gate.gate_key,
          gate_label: gate.label,
          gate_summary: gate.summary,
          gate_required: true,
          gate_status: 'failed',
        },
      });
    }
    if (gate.status === 'warning' && !gate.warning_accepted) {
      blockers.push({
        ...base,
        kind: 'warning_unacknowledged',
        resource_id: gate.id,
        title: gate.label,
        detail: gate.summary ?? 'A Delivery Gate warning has not been acknowledged.',
        metadata: {
          gate_key: gate.gate_key,
          gate_label: gate.label,
          gate_summary: gate.summary,
          gate_required: gate.required,
          gate_status: 'warning',
          warning_accepted: false,
        },
      });
    }
  }
  for (const item of workItems) {
    if (
      item.status === 'confirmed' &&
      (item.kind === 'question' || item.kind === 'change_request')
    ) {
      blockers.push({
        ...base,
        kind: 'work_item_unresolved',
        resource_id: item.id,
        title: item.title,
        detail:
          item.detail ||
          (item.kind === 'question'
            ? 'A confirmed question remains unresolved.'
            : 'A confirmed change request remains unresolved.'),
        metadata: {
          work_item_kind: item.kind,
          work_item_status: 'confirmed',
          work_item_title: item.title,
          work_item_detail: item.detail,
        },
      });
    }
  }
  return blockers;
}

export class EngagementService {
  constructor(private readonly db: Database) {}

  async list(options?: {
    includeArchived?: boolean;
    status?: EngagementStatus;
  }): Promise<EngagementSummary[]> {
    let rows = await this.db.listEngagements(options?.includeArchived ?? false);
    if (options?.status) rows = rows.filter((row) => row.status === options.status);
    const portfolio = await this.db.getEngagementPortfolioRows(rows.map((row) => row.id));
    return this.buildSummaries(rows, portfolio).map((entry) => entry.summary);
  }

  async get(id: string): Promise<EngagementDetail> {
    const engagement = await this.db.requireEngagement(id);
    const portfolio = await this.db.getEngagementPortfolioRows([id]);
    const [built] = this.buildSummaries([engagement], portfolio);
    if (!built) {
      throw new EngagementValidationError('Engagement summary could not be assembled.', {
        engagementId: id,
      });
    }
    const projectIds = built.projects.map((project) => project.id);
    const recentRows = await this.db.listEngagementRecentActivity(id, projectIds, 30);
    const recentActivity: EngagementActivity[] = recentRows.map((row) => {
      const metadata = parseActivityMetadata(row.metadata);
      const deliveryId =
        typeof metadata['delivery_id'] === 'string' ? metadata['delivery_id'] : null;
      const relatedProjectId = row.project_id.startsWith('engagement:') ? null : row.project_id;
      const normalizedMetadata: EngagementActivityMetadata = {
        ...metadata,
        schema_version: 1,
        engagement_id: id,
        ...(relatedProjectId ? { project_id: relatedProjectId } : {}),
        ...(deliveryId ? { delivery_id: deliveryId } : {}),
      };
      return {
        id: row.id,
        event_type: row.event_type,
        severity: row.severity,
        project_id: row.project_id,
        correlation_id: row.correlation_id,
        title: row.title,
        description: row.description,
        status: row.status,
        metadata: normalizedMetadata,
        created_at: row.created_at,
        deep_link:
          relatedProjectId && deliveryId
            ? `/projects/${encodeURIComponent(relatedProjectId)}/deliveries/${encodeURIComponent(deliveryId)}`
            : relatedProjectId
              ? `/projects/${encodeURIComponent(relatedProjectId)}`
              : null,
      };
    });
    return {
      ...built.summary,
      projects: built.projects,
      deliveries: built.deliveries,
      blockers: built.blockers,
      recent_activity: recentActivity,
    };
  }

  async create(input: {
    customerName: string;
    title: string;
    summary?: string;
    status?: Exclude<EngagementStatus, 'archived'>;
    actor?: string;
  }): Promise<EngagementDetail> {
    const created = await this.db.createEngagement({
      customerName: requiredText(input.customerName, 'customer_name'),
      title: requiredText(input.title, 'title'),
      summary: input.summary?.trim() ?? '',
      status: input.status,
      createdBy: input.actor,
    });
    return await this.get(created.id);
  }

  async update(
    id: string,
    input: {
      customerName?: string;
      title?: string;
      summary?: string;
      status?: Exclude<EngagementStatus, 'archived'>;
      actor?: string;
    },
  ): Promise<EngagementDetail> {
    await this.db.updateEngagement(id, {
      ...(input.customerName !== undefined
        ? { customerName: requiredText(input.customerName, 'customer_name') }
        : {}),
      ...(input.title !== undefined ? { title: requiredText(input.title, 'title') } : {}),
      ...(input.summary !== undefined ? { summary: input.summary.trim() } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedBy: input.actor,
    });
    return await this.get(id);
  }

  async archive(id: string, actor?: string): Promise<EngagementDetail> {
    await this.db.archiveEngagement(id, actor);
    return await this.get(id);
  }

  async unarchive(id: string, actor?: string): Promise<EngagementDetail> {
    await this.db.unarchiveEngagement(id, actor);
    return await this.get(id);
  }

  async linkProject(id: string, projectId: string, actor?: string): Promise<EngagementDetail> {
    await this.db.linkEngagementProject(id, requiredText(projectId, 'project_id'), actor);
    return await this.get(id);
  }

  async unlinkProject(id: string, projectId: string, actor?: string): Promise<EngagementDetail> {
    await this.db.unlinkEngagementProject(id, projectId, actor);
    return await this.get(id);
  }

  async getProjectReference(projectId: string): Promise<ProjectEngagementReference | null> {
    const engagement = await this.db.getProjectEngagement(projectId);
    return engagement
      ? {
          id: engagement.id,
          customer_name: engagement.customer_name,
          title: engagement.title,
          status: engagement.status,
        }
      : null;
  }

  async listUnassignedProjects(): Promise<
    Array<{ id: string; name: string; display_name: string; archived_at: string | null }>
  > {
    return await this.db.listUnassignedEngagementProjects();
  }

  private buildSummaries(
    engagementsRows: EngagementRow[],
    portfolio: EngagementPortfolioRows,
  ): Array<{
    summary: EngagementSummary;
    projects: EngagementProjectSummary[];
    deliveries: EngagementDeliveryView[];
    blockers: EngagementBlocker[];
  }> {
    const membershipsByEngagement = groupBy(portfolio.memberships, (row) => row.engagement_id);
    const servicesByProject = groupBy(portfolio.serviceRows, (row) => row.project_id);
    const deliveriesByProject = groupBy(portfolio.deliveryRows, (row) => row.project_id);
    const gatesByDelivery = groupBy(portfolio.gateRows, (row) => row.delivery_id);
    const workItemsByDelivery = groupBy(portfolio.workItemRows, (row) => row.delivery_id);

    return engagementsRows.map((engagement) => {
      const memberships = membershipsByEngagement.get(engagement.id) ?? [];
      const blockers: EngagementBlocker[] = [];
      const deliveryViews: EngagementDeliveryView[] = [];
      const deliverySummary = emptyDeliverySummary();
      const projectViews: EngagementProjectSummary[] = [];

      for (const membership of memberships) {
        const projectServices = servicesByProject.get(membership.project_id) ?? [];
        const runtimeStatus = projectRuntimeStatus(projectServices);
        const projectDeliveries = deliveriesByProject.get(membership.project_id) ?? [];
        const projectBlockers: EngagementBlocker[] = [];
        if (!membership.project_archived_at && runtimeStatus === 'error') {
          projectBlockers.push({
            kind: 'project_error',
            project_id: membership.project_id,
            project_name: membership.project_display_name || membership.project_name,
            delivery_id: null,
            delivery_title: null,
            resource_id: membership.project_id,
            title: 'Project runtime error',
            detail: 'At least one active service is in an error state.',
            metadata: {
              runtime_status: 'error',
              error_service_count: projectServices.filter(
                (service) => !service.archived_at && service.status === 'error',
              ).length,
            },
            deep_link: `/projects/${encodeURIComponent(membership.project_id)}`,
          });
        }
        for (const delivery of projectDeliveries) {
          deliverySummary.total += 1;
          deliverySummary.by_status[delivery.status] += 1;
          const deliveryBlockers = createDeliveryBlockers(
            delivery,
            membership,
            gatesByDelivery.get(delivery.id) ?? [],
            workItemsByDelivery.get(delivery.id) ?? [],
          );
          if (deliveryBlockers.length > 0) deliverySummary.blocker_count += 1;
          projectBlockers.push(...deliveryBlockers);
          deliveryViews.push({
            id: delivery.id,
            project_id: delivery.project_id,
            title: delivery.title,
            delivery_type: delivery.delivery_type,
            maturity: delivery.maturity,
            status: delivery.status,
            blocker_count: deliveryBlockers.length,
            updated_at: delivery.updated_at,
          });
        }
        blockers.push(...projectBlockers);
        projectViews.push({
          id: membership.project_id,
          name: membership.project_name,
          display_name: membership.project_display_name || membership.project_name,
          archived_at: membership.project_archived_at,
          runtime_status: runtimeStatus,
          delivery_count: projectDeliveries.length,
          blocker_count: projectBlockers.length,
          linked_at: membership.linked_at,
        });
      }

      const activeProjects = projectViews.filter((project) => !project.archived_at);
      const runtimeHealth = activeProjects.some((project) => project.runtime_status === 'error')
        ? 'degraded'
        : activeProjects.length > 0
          ? 'healthy'
          : 'unknown';
      const projectIdSet = new Set(projectViews.map((project) => project.id));
      const activityTimestamps = portfolio.activityRows
        .filter((row) => row.correlation_id === engagement.id || projectIdSet.has(row.project_id))
        .map((row) => row.latest_at);
      const recentActivityAt = maxTimestamp(
        engagement.updated_at,
        ...memberships.map((membership) =>
          maxTimestamp(
            membership.linked_at,
            membership.project_updated_at,
            ...(deliveriesByProject.get(membership.project_id) ?? []).map(
              (delivery) => delivery.updated_at,
            ),
          ),
        ),
        ...activityTimestamps,
      );

      deliveryViews.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      blockers.sort((a, b) => a.project_name.localeCompare(b.project_name));

      return {
        summary: {
          id: engagement.id,
          customer_name: engagement.customer_name,
          title: engagement.title,
          summary: engagement.summary,
          status: engagement.status,
          runtime_health: runtimeHealth,
          project_count: projectViews.length,
          active_project_count: activeProjects.length,
          delivery_summary: deliverySummary,
          blocker_count: blockers.length,
          recent_activity_at: recentActivityAt,
          created_by: engagement.created_by,
          created_at: engagement.created_at,
          updated_at: engagement.updated_at,
        },
        projects: projectViews,
        deliveries: deliveryViews,
        blockers,
      };
    });
  }
}
