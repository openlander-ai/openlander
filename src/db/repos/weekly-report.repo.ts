import { and, between, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';

import { RepoPersistenceError } from '../../errors.js';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import {
  activityLog,
  deliveries,
  deliveryAgentRuns,
  deliveryGates,
  deliveryProjectUpdateItems,
  deliveryRunChecks,
  engagementProjects,
  engagementWeeklyReports,
  projectEnvironments,
  projectUpdateItems,
  projectUpdates,
  releaseArtifacts,
  releasePromotions,
  releases,
  type EngagementWeeklyReportRow,
} from '../schema.drizzle.js';
import { ulid } from './activity-log.repo.js';

export class WeeklyReportRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async create(input: {
    engagementId: string;
    periodStart: string;
    periodEnd: string;
    evidenceSnapshot: Record<string, unknown>;
    evidenceSha256: string;
    createdBy: string;
  }): Promise<EngagementWeeklyReportRow> {
    return await this.db.transaction(async (tx) => {
      const revisionLockKey = [input.engagementId, input.periodStart, input.periodEnd].join(':');
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${revisionLockKey}, 0))`);
      const [latest] = await tx
        .select({ revision: engagementWeeklyReports.revision })
        .from(engagementWeeklyReports)
        .where(
          and(
            eq(engagementWeeklyReports.engagement_id, input.engagementId),
            eq(engagementWeeklyReports.period_start, input.periodStart),
            eq(engagementWeeklyReports.period_end, input.periodEnd),
          ),
        )
        .orderBy(desc(engagementWeeklyReports.revision))
        .limit(1)
        .for('update');
      const [created] = await tx
        .insert(engagementWeeklyReports)
        .values({
          id: `report_${ulid()}`,
          engagement_id: input.engagementId,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          revision: (latest?.revision ?? 0) + 1,
          evidence_snapshot: input.evidenceSnapshot,
          evidence_sha256: input.evidenceSha256,
          created_by: input.createdBy,
        })
        .returning();
      if (!created) throw new RepoPersistenceError('engagement weekly report', input.engagementId);
      return created;
    });
  }

  async collectEvidence(engagementId: string, periodStart: string, periodEnd: string) {
    const memberships = await this.db
      .select()
      .from(engagementProjects)
      .where(eq(engagementProjects.engagement_id, engagementId));
    const projectIds = memberships.map((row) => row.project_id);
    if (projectIds.length === 0) {
      return {
        deliveries: [],
        gates: [],
        runs: [],
        checks: [],
        releases: [],
        releaseArtifacts: [],
        promotions: [],
        activity: [],
        environments: [],
        projectUpdates: [],
        projectUpdateItems: [],
        transitionedProjectUpdateItems: [],
        currentProjectUpdateItems: [],
        deliveryProjectUpdateItems: [],
        changedDeliveryProjectUpdateItems: [],
      };
    }
    const deliveryRows = await this.db
      .select()
      .from(deliveries)
      .where(inArray(deliveries.project_id, projectIds));
    const deliveryIds = deliveryRows.map((row) => row.id);
    const [
      gateRows,
      runRows,
      activityRows,
      environmentRows,
      projectUpdateRows,
      currentProjectUpdateItemRows,
      changedDeliveryProjectUpdateItemRows,
    ] = await Promise.all([
      deliveryIds.length > 0
        ? this.db
            .select()
            .from(deliveryGates)
            .where(inArray(deliveryGates.delivery_id, deliveryIds))
        : Promise.resolve([]),
      deliveryIds.length > 0
        ? this.db
            .select()
            .from(deliveryAgentRuns)
            .where(inArray(deliveryAgentRuns.delivery_id, deliveryIds))
        : Promise.resolve([]),
      this.db
        .select()
        .from(activityLog)
        .where(
          and(
            between(activityLog.created_at, periodStart, periodEnd),
            ne(activityLog.event_type, 'project.update_recorded'),
            or(
              inArray(activityLog.project_id, projectIds),
              eq(activityLog.correlation_id, engagementId),
            ),
          ),
        )
        .orderBy(activityLog.created_at),
      this.db
        .select()
        .from(projectEnvironments)
        .where(inArray(projectEnvironments.project_id, projectIds)),
      this.db
        .select()
        .from(projectUpdates)
        .where(
          and(
            inArray(projectUpdates.project_id, projectIds),
            between(projectUpdates.occurred_at, periodStart, periodEnd),
          ),
        )
        .orderBy(projectUpdates.occurred_at, projectUpdates.id),
      this.db
        .select({ item: projectUpdateItems, update: projectUpdates })
        .from(projectUpdateItems)
        .innerJoin(projectUpdates, eq(projectUpdates.id, projectUpdateItems.project_update_id))
        .where(
          and(
            inArray(projectUpdates.project_id, projectIds),
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
        .orderBy(projectUpdateItems.updated_at, projectUpdateItems.id),
      this.db
        .select({ item: projectUpdateItems, link: deliveryProjectUpdateItems })
        .from(deliveryProjectUpdateItems)
        .innerJoin(
          projectUpdateItems,
          eq(projectUpdateItems.id, deliveryProjectUpdateItems.project_update_item_id),
        )
        .innerJoin(projectUpdates, eq(projectUpdates.id, projectUpdateItems.project_update_id))
        .where(
          and(
            inArray(projectUpdates.project_id, projectIds),
            or(
              ne(projectUpdateItems.status, deliveryProjectUpdateItems.item_status),
              ne(projectUpdateItems.updated_at, deliveryProjectUpdateItems.item_updated_at),
            ),
          ),
        )
        .orderBy(projectUpdateItems.updated_at, projectUpdateItems.id),
    ]);
    const projectUpdateIds = projectUpdateRows.map((row) => row.id);
    const [projectUpdateItemRows, transitionedProjectUpdateItemRows] =
      projectUpdateIds.length > 0
        ? await Promise.all([
            this.db
              .select()
              .from(projectUpdateItems)
              .where(inArray(projectUpdateItems.project_update_id, projectUpdateIds))
              .orderBy(projectUpdateItems.created_at, projectUpdateItems.id),
            this.db
              .select()
              .from(projectUpdateItems)
              .where(inArray(projectUpdateItems.resolution_update_id, projectUpdateIds))
              .orderBy(projectUpdateItems.updated_at, projectUpdateItems.id),
          ])
        : [[], []];
    const contextItemIds = [
      ...new Set([
        ...projectUpdateItemRows.map((row) => row.id),
        ...transitionedProjectUpdateItemRows.map((row) => row.id),
        ...currentProjectUpdateItemRows.map((row) => row.item.id),
      ]),
    ];
    const projectUpdateLinkRows =
      contextItemIds.length > 0
        ? await this.db
            .select()
            .from(deliveryProjectUpdateItems)
            .where(inArray(deliveryProjectUpdateItems.project_update_item_id, contextItemIds))
        : [];
    const runIds = runRows.map((row) => row.id);
    const [checkRows, releaseRows] = await Promise.all([
      runIds.length > 0
        ? this.db.select().from(deliveryRunChecks).where(inArray(deliveryRunChecks.run_id, runIds))
        : Promise.resolve([]),
      deliveryIds.length > 0
        ? this.db.select().from(releases).where(inArray(releases.delivery_id, deliveryIds))
        : Promise.resolve([]),
    ]);
    const releaseIds = releaseRows.map((row) => row.id);
    const [artifactRows, promotionRows] = await Promise.all([
      releaseIds.length > 0
        ? this.db
            .select()
            .from(releaseArtifacts)
            .where(inArray(releaseArtifacts.release_id, releaseIds))
        : Promise.resolve([]),
      releaseIds.length > 0
        ? this.db
            .select()
            .from(releasePromotions)
            .where(inArray(releasePromotions.release_id, releaseIds))
        : Promise.resolve([]),
    ]);
    return {
      deliveries: deliveryRows,
      gates: gateRows,
      runs: runRows,
      checks: checkRows,
      releases: releaseRows,
      releaseArtifacts: artifactRows,
      promotions: promotionRows,
      activity: activityRows,
      environments: environmentRows,
      projectUpdates: projectUpdateRows,
      projectUpdateItems: projectUpdateItemRows,
      transitionedProjectUpdateItems: transitionedProjectUpdateItemRows,
      currentProjectUpdateItems: currentProjectUpdateItemRows,
      deliveryProjectUpdateItems: projectUpdateLinkRows,
      changedDeliveryProjectUpdateItems: changedDeliveryProjectUpdateItemRows,
    };
  }

  async get(id: string): Promise<EngagementWeeklyReportRow | null> {
    const [row] = await this.db
      .select()
      .from(engagementWeeklyReports)
      .where(eq(engagementWeeklyReports.id, id))
      .limit(1);
    return row ?? null;
  }

  async list(engagementId: string): Promise<EngagementWeeklyReportRow[]> {
    return await this.db
      .select()
      .from(engagementWeeklyReports)
      .where(eq(engagementWeeklyReports.engagement_id, engagementId))
      .orderBy(desc(engagementWeeklyReports.period_start), desc(engagementWeeklyReports.revision));
  }

  async publish(input: {
    id: string;
    internalHtmlBlobId: string;
    internalPdfBlobId: string;
    customerHtmlBlobId: string;
    customerPdfBlobId: string;
    internalSha256: string;
    customerSha256: string;
  }): Promise<EngagementWeeklyReportRow> {
    const [row] = await this.db
      .update(engagementWeeklyReports)
      .set({
        status: 'published',
        internal_html_blob_id: input.internalHtmlBlobId,
        internal_pdf_blob_id: input.internalPdfBlobId,
        customer_html_blob_id: input.customerHtmlBlobId,
        customer_pdf_blob_id: input.customerPdfBlobId,
        internal_sha256: input.internalSha256,
        customer_sha256: input.customerSha256,
        published_at: new Date().toISOString(),
      })
      .where(
        and(eq(engagementWeeklyReports.id, input.id), eq(engagementWeeklyReports.status, 'draft')),
      )
      .returning();
    if (!row) throw new RepoPersistenceError('engagement weekly report publication', input.id);
    return row;
  }
}
