import { and, count, desc, eq, inArray, ne, or } from 'drizzle-orm';

import {
  DeliveryNotFoundError,
  ProjectUpdateItemNotFoundError,
  ProjectUpdateItemStatusConflictError,
  ProjectUpdateNotFoundError,
  ProjectUpdateProjectMismatchError,
  RepoPersistenceError,
} from '../../errors.js';
import {
  canTransitionProjectUpdateItem,
  type ProjectUpdateEntryInput,
  type ProjectUpdateSource,
  type ProjectUpdateTransitionInput,
} from '../../project-updates/types.js';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import {
  activityLog,
  deliveries,
  deliveryProjectUpdateItems,
  projectUpdateItems,
  projectUpdates,
  type ProjectUpdateItemRow,
  type ProjectUpdateRow,
} from '../schema.drizzle.js';
import { ulid } from './activity-log.repo.js';

export interface ProjectUpdateContextItem {
  item: ProjectUpdateItemRow;
  update: Pick<ProjectUpdateRow, 'id' | 'summary' | 'occurred_at' | 'created_by'>;
  deliveryIds: string[];
}

export interface ProjectUpdateContext {
  counts: Record<string, number>;
  currentItems: ProjectUpdateContextItem[];
  currentItemsTruncated: boolean;
  recentUpdates: Array<
    ProjectUpdateRow & {
      itemCount: number;
    }
  >;
  recentUpdatesTruncated: boolean;
  changedDeliveryContext: Array<{
    deliveryId: string;
    itemId: string;
    linkedStatus: string;
    currentStatus: string;
  }>;
  changedDeliveryContextTruncated: boolean;
}

export interface DeliveryProjectContextItem {
  item: ProjectUpdateItemRow;
  update: Pick<ProjectUpdateRow, 'id' | 'summary' | 'occurred_at'>;
  linkedStatus: string;
  linkedItemUpdatedAt: string;
  linkedAt: string;
  contextChanged: boolean;
}

function countKey(kind: string, status: string): string {
  return `${kind}:${status}`;
}

export class ProjectUpdateRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async record(input: {
    id?: string;
    projectId: string;
    deliveryId?: string | null;
    summary: string;
    occurredAt: string;
    sources: ProjectUpdateSource[];
    entries: ProjectUpdateEntryInput[];
    transitions: ProjectUpdateTransitionInput[];
    createdBy: string;
  }): Promise<{
    update: ProjectUpdateRow;
    items: ProjectUpdateItemRow[];
    transitionedItemIds: string[];
    affectedDeliveryIds: string[];
  }> {
    const updateId = input.id ?? `pupd_${ulid()}`;
    const itemIds = input.entries.map(() => `pui_${ulid()}`);
    return await this.db.transaction(async (tx) => {
      if (input.id) {
        const [existing] = await tx
          .select()
          .from(projectUpdates)
          .where(eq(projectUpdates.id, input.id))
          .limit(1);
        if (existing) {
          if (
            existing.project_id !== input.projectId ||
            existing.delivery_id !== (input.deliveryId ?? null) ||
            existing.summary !== input.summary ||
            existing.occurred_at !== input.occurredAt
          ) {
            throw new RepoPersistenceError('project update idempotency', input.id);
          }
          const [existingItems, transitionedItems] = await Promise.all([
            tx
              .select()
              .from(projectUpdateItems)
              .where(eq(projectUpdateItems.project_update_id, input.id)),
            tx
              .select({ id: projectUpdateItems.id })
              .from(projectUpdateItems)
              .where(eq(projectUpdateItems.resolution_update_id, input.id)),
          ]);
          const transitionedItemIds = transitionedItems.map((item) => item.id);
          const affectedRows =
            transitionedItemIds.length > 0
              ? await tx
                  .select({ delivery_id: deliveryProjectUpdateItems.delivery_id })
                  .from(deliveryProjectUpdateItems)
                  .where(
                    inArray(deliveryProjectUpdateItems.project_update_item_id, transitionedItemIds),
                  )
              : [];
          return {
            update: existing,
            items: existingItems,
            transitionedItemIds,
            affectedDeliveryIds: [...new Set(affectedRows.map((row) => row.delivery_id))],
          };
        }
      }
      if (input.deliveryId) {
        const [delivery] = await tx
          .select({ id: deliveries.id, project_id: deliveries.project_id })
          .from(deliveries)
          .where(eq(deliveries.id, input.deliveryId))
          .limit(1);
        if (!delivery) throw new DeliveryNotFoundError(input.deliveryId);
        if (delivery.project_id !== input.projectId) {
          throw new ProjectUpdateProjectMismatchError(
            input.projectId,
            input.deliveryId,
            'delivery',
          );
        }
      }

      const transitionIds = input.transitions.map((transition) => transition.itemId);
      const transitionRows =
        transitionIds.length > 0
          ? await tx
              .select({ item: projectUpdateItems, project_id: projectUpdates.project_id })
              .from(projectUpdateItems)
              .innerJoin(
                projectUpdates,
                eq(projectUpdates.id, projectUpdateItems.project_update_id),
              )
              .where(inArray(projectUpdateItems.id, transitionIds))
              .for('update')
          : [];
      const transitionById = new Map(transitionRows.map((row) => [row.item.id, row]));
      for (const transition of input.transitions) {
        const current = transitionById.get(transition.itemId);
        if (!current) throw new ProjectUpdateItemNotFoundError(transition.itemId);
        if (current.project_id !== input.projectId) {
          throw new ProjectUpdateProjectMismatchError(
            input.projectId,
            transition.itemId,
            'project_update_item',
          );
        }
        if (current.item.status !== transition.expectedStatus) {
          throw new ProjectUpdateItemStatusConflictError(
            transition.itemId,
            transition.expectedStatus,
            current.item.status,
          );
        }
        if (!canTransitionProjectUpdateItem(current.item.status, transition.status)) {
          throw new ProjectUpdateItemStatusConflictError(
            transition.itemId,
            transition.expectedStatus,
            current.item.status,
          );
        }
      }

      const [update] = await tx
        .insert(projectUpdates)
        .values({
          id: updateId,
          project_id: input.projectId,
          delivery_id: input.deliveryId ?? null,
          summary: input.summary,
          occurred_at: input.occurredAt,
          sources: input.sources,
          created_by: input.createdBy,
        })
        .returning();
      if (!update) throw new RepoPersistenceError('project update', updateId);

      const createdItems =
        input.entries.length > 0
          ? await tx
              .insert(projectUpdateItems)
              .values(
                input.entries.map((entry, index) => ({
                  id: itemIds[index] as string,
                  project_update_id: updateId,
                  kind: entry.kind,
                  title: entry.title,
                  detail: entry.detail,
                  status: entry.status,
                })),
              )
              .returning()
          : [];

      const now = new Date().toISOString();
      for (const transition of input.transitions) {
        const [transitioned] = await tx
          .update(projectUpdateItems)
          .set({
            status: transition.status,
            resolution_update_id: updateId,
            resolution_note: transition.note,
            resolved_at: now,
            updated_at: now,
          })
          .where(
            and(
              eq(projectUpdateItems.id, transition.itemId),
              eq(projectUpdateItems.status, transition.expectedStatus),
            ),
          )
          .returning({ id: projectUpdateItems.id });
        if (!transitioned) {
          const latest = transitionById.get(transition.itemId)?.item.status ?? 'missing';
          throw new ProjectUpdateItemStatusConflictError(
            transition.itemId,
            transition.expectedStatus,
            latest,
          );
        }
      }

      const affectedRows =
        transitionIds.length > 0
          ? await tx
              .select({ delivery_id: deliveryProjectUpdateItems.delivery_id })
              .from(deliveryProjectUpdateItems)
              .where(inArray(deliveryProjectUpdateItems.project_update_item_id, transitionIds))
          : [];
      await tx.insert(activityLog).values({
        id: ulid(),
        event_type: 'project.update_recorded',
        activity_type: 'project_update',
        severity: input.entries.some((entry) => entry.kind === 'risk' && entry.status === 'open')
          ? 'warning'
          : 'info',
        project_id: input.projectId,
        correlation_id: updateId,
        title: 'Project update recorded',
        description: input.summary,
        status: 'completed',
        created_at: now,
        metadata: JSON.stringify({
          update_id: updateId,
          delivery_id: input.deliveryId ?? null,
          source_count: input.sources.length,
          entry_count: input.entries.length,
          transitioned_item_count: input.transitions.length,
          affected_delivery_ids: [...new Set(affectedRows.map((row) => row.delivery_id))],
          actor: input.createdBy,
        }),
      });
      return {
        update,
        items: createdItems,
        transitionedItemIds: transitionIds,
        affectedDeliveryIds: [...new Set(affectedRows.map((row) => row.delivery_id))],
      };
    });
  }

  async get(updateId: string): Promise<ProjectUpdateRow | null> {
    const [row] = await this.db
      .select()
      .from(projectUpdates)
      .where(eq(projectUpdates.id, updateId))
      .limit(1);
    return row ?? null;
  }

  async require(updateId: string): Promise<ProjectUpdateRow> {
    const update = await this.get(updateId);
    if (!update) throw new ProjectUpdateNotFoundError(updateId);
    return update;
  }

  async listItemsByIds(itemIds: readonly string[]): Promise<
    Array<{
      item: ProjectUpdateItemRow;
      projectId: string;
      updateSummary: string;
      updateOccurredAt: string;
    }>
  > {
    if (itemIds.length === 0) return [];
    return await this.db
      .select({
        item: projectUpdateItems,
        projectId: projectUpdates.project_id,
        updateSummary: projectUpdates.summary,
        updateOccurredAt: projectUpdates.occurred_at,
      })
      .from(projectUpdateItems)
      .innerJoin(projectUpdates, eq(projectUpdates.id, projectUpdateItems.project_update_id))
      .where(inArray(projectUpdateItems.id, [...itemIds]));
  }

  async getContext(
    projectId: string,
    currentItemLimit: number,
    recentUpdateLimit: number,
  ): Promise<ProjectUpdateContext> {
    const [countRows, currentRows, recentRows, changedContextRows] = await Promise.all([
      this.db
        .select({
          kind: projectUpdateItems.kind,
          status: projectUpdateItems.status,
          value: count(),
        })
        .from(projectUpdateItems)
        .innerJoin(projectUpdates, eq(projectUpdates.id, projectUpdateItems.project_update_id))
        .where(eq(projectUpdates.project_id, projectId))
        .groupBy(projectUpdateItems.kind, projectUpdateItems.status),
      this.db
        .select({ item: projectUpdateItems, update: projectUpdates })
        .from(projectUpdateItems)
        .innerJoin(projectUpdates, eq(projectUpdates.id, projectUpdateItems.project_update_id))
        .where(
          and(
            eq(projectUpdates.project_id, projectId),
            or(
              and(
                eq(projectUpdateItems.kind, 'decision'),
                eq(projectUpdateItems.status, 'accepted'),
              ),
              and(
                inArray(projectUpdateItems.kind, ['action', 'risk', 'question', 'dependency']),
                eq(projectUpdateItems.status, 'open'),
              ),
            ),
          ),
        )
        .orderBy(desc(projectUpdateItems.updated_at), desc(projectUpdateItems.id))
        .limit(currentItemLimit + 1),
      this.db
        .select()
        .from(projectUpdates)
        .where(eq(projectUpdates.project_id, projectId))
        .orderBy(desc(projectUpdates.occurred_at), desc(projectUpdates.id))
        .limit(recentUpdateLimit + 1),
      this.db
        .select({
          delivery_id: deliveryProjectUpdateItems.delivery_id,
          item_id: projectUpdateItems.id,
          linked_status: deliveryProjectUpdateItems.item_status,
          current_status: projectUpdateItems.status,
        })
        .from(deliveryProjectUpdateItems)
        .innerJoin(
          projectUpdateItems,
          eq(projectUpdateItems.id, deliveryProjectUpdateItems.project_update_item_id),
        )
        .innerJoin(projectUpdates, eq(projectUpdates.id, projectUpdateItems.project_update_id))
        .where(
          and(
            eq(projectUpdates.project_id, projectId),
            or(
              ne(projectUpdateItems.status, deliveryProjectUpdateItems.item_status),
              ne(projectUpdateItems.updated_at, deliveryProjectUpdateItems.item_updated_at),
            ),
          ),
        )
        .orderBy(desc(projectUpdateItems.updated_at), desc(projectUpdateItems.id))
        .limit(currentItemLimit + 1),
    ]);

    const visibleCurrentRows = currentRows.slice(0, currentItemLimit);
    const visibleRecentRows = recentRows.slice(0, recentUpdateLimit);
    const itemIds = visibleCurrentRows.map((row) => row.item.id);
    const updateIds = visibleRecentRows.map((row) => row.id);
    const [linkRows, recentItemCounts] = await Promise.all([
      itemIds.length > 0
        ? this.db
            .select({
              item_id: deliveryProjectUpdateItems.project_update_item_id,
              delivery_id: deliveryProjectUpdateItems.delivery_id,
            })
            .from(deliveryProjectUpdateItems)
            .where(inArray(deliveryProjectUpdateItems.project_update_item_id, itemIds))
        : Promise.resolve([]),
      updateIds.length > 0
        ? this.db
            .select({ update_id: projectUpdateItems.project_update_id, value: count() })
            .from(projectUpdateItems)
            .where(inArray(projectUpdateItems.project_update_id, updateIds))
            .groupBy(projectUpdateItems.project_update_id)
        : Promise.resolve([]),
    ]);
    const deliveriesByItem = new Map<string, string[]>();
    for (const row of linkRows) {
      const values = deliveriesByItem.get(row.item_id) ?? [];
      values.push(row.delivery_id);
      deliveriesByItem.set(row.item_id, values);
    }
    const itemCountByUpdate = new Map(recentItemCounts.map((row) => [row.update_id, row.value]));
    return {
      counts: Object.fromEntries(
        countRows.map((row) => [countKey(row.kind, row.status), row.value]),
      ),
      currentItems: visibleCurrentRows.map((row) => ({
        item: row.item,
        update: {
          id: row.update.id,
          summary: row.update.summary,
          occurred_at: row.update.occurred_at,
          created_by: row.update.created_by,
        },
        deliveryIds: deliveriesByItem.get(row.item.id) ?? [],
      })),
      currentItemsTruncated: currentRows.length > currentItemLimit,
      recentUpdates: visibleRecentRows.map((update) => ({
        ...update,
        itemCount: itemCountByUpdate.get(update.id) ?? 0,
      })),
      recentUpdatesTruncated: recentRows.length > recentUpdateLimit,
      changedDeliveryContext: changedContextRows.slice(0, currentItemLimit).map((row) => ({
        deliveryId: row.delivery_id,
        itemId: row.item_id,
        linkedStatus: row.linked_status,
        currentStatus: row.current_status,
      })),
      changedDeliveryContextTruncated: changedContextRows.length > currentItemLimit,
    };
  }

  async getDetail(
    projectId: string,
    updateId: string,
  ): Promise<{
    update: ProjectUpdateRow;
    items: ProjectUpdateItemRow[];
    transitionedItems: ProjectUpdateItemRow[];
    deliveryIdsByItem: Map<string, string[]>;
  }> {
    const update = await this.require(updateId);
    if (update.project_id !== projectId) {
      throw new ProjectUpdateProjectMismatchError(projectId, updateId, 'project_update');
    }
    const [items, transitionedItems] = await Promise.all([
      this.db
        .select()
        .from(projectUpdateItems)
        .where(eq(projectUpdateItems.project_update_id, updateId))
        .orderBy(projectUpdateItems.created_at, projectUpdateItems.id),
      this.db
        .select()
        .from(projectUpdateItems)
        .where(eq(projectUpdateItems.resolution_update_id, updateId))
        .orderBy(projectUpdateItems.updated_at, projectUpdateItems.id),
    ]);
    const itemIds = [...items, ...transitionedItems].map((item) => item.id);
    const linkRows =
      itemIds.length > 0
        ? await this.db
            .select({
              item_id: deliveryProjectUpdateItems.project_update_item_id,
              delivery_id: deliveryProjectUpdateItems.delivery_id,
            })
            .from(deliveryProjectUpdateItems)
            .where(inArray(deliveryProjectUpdateItems.project_update_item_id, itemIds))
        : [];
    const deliveryIdsByItem = new Map<string, string[]>();
    for (const row of linkRows) {
      const values = deliveryIdsByItem.get(row.item_id) ?? [];
      values.push(row.delivery_id);
      deliveryIdsByItem.set(row.item_id, values);
    }
    return { update, items, transitionedItems, deliveryIdsByItem };
  }

  async listDeliveryContext(deliveryId: string): Promise<DeliveryProjectContextItem[]> {
    const rows = await this.db
      .select({
        item: projectUpdateItems,
        update: projectUpdates,
        link: deliveryProjectUpdateItems,
      })
      .from(deliveryProjectUpdateItems)
      .innerJoin(
        projectUpdateItems,
        eq(projectUpdateItems.id, deliveryProjectUpdateItems.project_update_item_id),
      )
      .innerJoin(projectUpdates, eq(projectUpdates.id, projectUpdateItems.project_update_id))
      .where(eq(deliveryProjectUpdateItems.delivery_id, deliveryId))
      .orderBy(projectUpdates.occurred_at, projectUpdateItems.created_at);
    return rows.map((row) => ({
      item: row.item,
      update: {
        id: row.update.id,
        summary: row.update.summary,
        occurred_at: row.update.occurred_at,
      },
      linkedStatus: row.link.item_status,
      linkedItemUpdatedAt: row.link.item_updated_at,
      linkedAt: row.link.linked_at,
      contextChanged:
        row.item.status !== row.link.item_status ||
        row.item.updated_at !== row.link.item_updated_at,
    }));
  }
}
