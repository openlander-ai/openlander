import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { ReleaseNotFoundError, ReleaseStateError, RepoPersistenceError } from '../../errors.js';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import {
  activityLog,
  deliveries,
  deliveryDeployLinks,
  deployLogs,
  environments,
  releaseArtifacts,
  releasePromotions,
  releases,
  type ReleaseArtifactRow,
  type ReleasePromotionRow,
  type ReleaseRow,
} from '../schema.drizzle.js';
import { ulid } from './activity-log.repo.js';

export class ReleaseRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async create(input: {
    id: string;
    deliveryId: string;
    agentRunId: string;
    version: string;
    commitSha: string;
    createdBy: string;
  }): Promise<ReleaseRow> {
    const existing = await this.get(input.id);
    if (existing) {
      if (
        existing.delivery_id === input.deliveryId &&
        existing.agent_run_id === input.agentRunId &&
        existing.version === input.version &&
        existing.commit_sha === input.commitSha
      ) {
        return existing;
      }
      throw new ReleaseStateError(input.id, 'Deterministic Release id is already in use.');
    }
    const [created] = await this.db
      .insert(releases)
      .values({
        id: input.id,
        delivery_id: input.deliveryId,
        agent_run_id: input.agentRunId,
        version: input.version,
        commit_sha: input.commitSha,
        created_by: input.createdBy,
      })
      .returning();
    if (!created) throw new RepoPersistenceError('release', input.id);
    return created;
  }

  async get(id: string): Promise<ReleaseRow | null> {
    const [row] = await this.db.select().from(releases).where(eq(releases.id, id)).limit(1);
    return row ?? null;
  }

  async require(id: string): Promise<ReleaseRow> {
    const release = await this.get(id);
    if (!release) throw new ReleaseNotFoundError(id);
    return release;
  }

  async setStatus(
    id: string,
    status: 'building' | 'ready' | 'recalled' | 'failed',
  ): Promise<ReleaseRow> {
    const [row] = await this.db
      .update(releases)
      .set({ status, updated_at: new Date().toISOString() })
      .where(eq(releases.id, id))
      .returning();
    if (!row) throw new ReleaseNotFoundError(id);
    return row;
  }

  async listForDelivery(deliveryId: string): Promise<ReleaseRow[]> {
    return await this.db
      .select()
      .from(releases)
      .where(eq(releases.delivery_id, deliveryId))
      .orderBy(desc(releases.created_at));
  }

  async addArtifact(input: {
    releaseId: string;
    serviceId: string;
    imageReference: string;
    imageDigest: string;
    buildProvenance: Record<string, unknown>;
  }): Promise<ReleaseArtifactRow> {
    const [row] = await this.db
      .insert(releaseArtifacts)
      .values({
        id: `relart_${ulid()}`,
        release_id: input.releaseId,
        service_id: input.serviceId,
        image_reference: input.imageReference,
        image_digest: input.imageDigest,
        build_provenance: input.buildProvenance,
      })
      .onConflictDoUpdate({
        target: [releaseArtifacts.release_id, releaseArtifacts.service_id],
        set: {
          image_reference: input.imageReference,
          image_digest: input.imageDigest,
          build_provenance: input.buildProvenance,
        },
      })
      .returning();
    if (!row) throw new RepoPersistenceError('release artifact', input.releaseId);
    return row;
  }

  async listArtifacts(releaseId: string): Promise<ReleaseArtifactRow[]> {
    await this.require(releaseId);
    return await this.db
      .select()
      .from(releaseArtifacts)
      .where(eq(releaseArtifacts.release_id, releaseId))
      .orderBy(asc(releaseArtifacts.service_id));
  }

  async listArtifactsForReleases(releaseIds: readonly string[]): Promise<ReleaseArtifactRow[]> {
    if (releaseIds.length === 0) return [];
    return await this.db
      .select()
      .from(releaseArtifacts)
      .where(inArray(releaseArtifacts.release_id, [...releaseIds]))
      .orderBy(asc(releaseArtifacts.release_id), asc(releaseArtifacts.service_id));
  }

  async listPromotionsForReleases(releaseIds: readonly string[]): Promise<ReleasePromotionRow[]> {
    if (releaseIds.length === 0) return [];
    return await this.db
      .select()
      .from(releasePromotions)
      .where(inArray(releasePromotions.release_id, [...releaseIds]))
      .orderBy(desc(releasePromotions.created_at));
  }

  async createPromotion(input: {
    id: string;
    releaseId: string;
    projectEnvironmentId: string;
    previousReleaseId?: string | null;
    idempotencyKey: string;
    initiatedBy: string;
  }): Promise<ReleasePromotionRow> {
    const [existing] = await this.db
      .select()
      .from(releasePromotions)
      .where(
        and(
          eq(releasePromotions.project_environment_id, input.projectEnvironmentId),
          eq(releasePromotions.idempotency_key, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.release_id !== input.releaseId) {
        throw new ReleaseStateError(
          input.releaseId,
          'Promotion idempotency key is already used by another Release.',
        );
      }
      return existing;
    }
    const [row] = await this.db
      .insert(releasePromotions)
      .values({
        id: input.id,
        release_id: input.releaseId,
        project_environment_id: input.projectEnvironmentId,
        previous_release_id: input.previousReleaseId ?? null,
        idempotency_key: input.idempotencyKey,
        initiated_by: input.initiatedBy,
      })
      .returning();
    if (!row) throw new RepoPersistenceError('release promotion', input.id);
    return row;
  }

  async updatePromotion(
    id: string,
    patch: Partial<{
      status: ReleasePromotionRow['status'];
      healthStatus: ReleasePromotionRow['health_status'];
      soakStatus: ReleasePromotionRow['soak_status'];
      deployIds: string[];
      runtimeEnvironmentIds: string[];
      errorCode: string | null;
      errorMessage: string | null;
      startedAt: string | null;
      completedAt: string | null;
    }>,
  ): Promise<ReleasePromotionRow> {
    const [row] = await this.db
      .update(releasePromotions)
      .set({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.healthStatus ? { health_status: patch.healthStatus } : {}),
        ...(patch.soakStatus ? { soak_status: patch.soakStatus } : {}),
        ...(patch.deployIds ? { deploy_ids: patch.deployIds } : {}),
        ...(patch.runtimeEnvironmentIds
          ? { runtime_environment_ids: patch.runtimeEnvironmentIds }
          : {}),
        ...(patch.errorCode !== undefined ? { error_code: patch.errorCode } : {}),
        ...(patch.errorMessage !== undefined ? { error_message: patch.errorMessage } : {}),
        ...(patch.startedAt !== undefined ? { started_at: patch.startedAt } : {}),
        ...(patch.completedAt !== undefined ? { completed_at: patch.completedAt } : {}),
        updated_at: new Date().toISOString(),
      })
      .where(eq(releasePromotions.id, id))
      .returning();
    if (!row) throw new RepoPersistenceError('release promotion', id);
    return row;
  }

  async finalizePromotion(input: {
    promotionId: string;
    projectId: string;
    deliveryId: string;
    releaseId: string;
    releaseVersion: string;
    projectEnvironmentId: string;
    projectEnvironmentName: string;
    relation: 'candidate' | 'released';
    commitSha: string;
    soakStatus: 'passed' | 'skipped';
    imageDigests: Record<string, string>;
    candidates: Array<{
      environmentId: string;
      serviceId: string;
      deployId: string;
      assignedPort: number;
      containerId: string;
      imageReference: string;
      imageDigest: string;
      previousImageTag: string | null;
      containerPort: number;
    }>;
  }): Promise<ReleasePromotionRow> {
    return await this.db.transaction(async (tx) => {
      for (const candidate of input.candidates) {
        const [updatedEnvironment] = await tx
          .update(environments)
          .set({
            status: 'running',
            assigned_port: candidate.assignedPort,
            container_id: candidate.containerId,
            image_tag: candidate.imageReference,
            previous_image_tag: candidate.previousImageTag,
            container_port: candidate.containerPort,
            updated_at: sql`now()::text`,
          })
          .where(eq(environments.id, candidate.environmentId))
          .returning({ id: environments.id });
        if (!updatedEnvironment) {
          throw new RepoPersistenceError('promotion runtime environment', candidate.environmentId);
        }
        await tx.insert(deployLogs).values({
          id: candidate.deployId,
          service_id: candidate.serviceId,
          environment_id: candidate.environmentId,
          status: 'success',
          trigger: 'api',
          trigger_detail: `release-promotion:${input.promotionId}`,
          commit_sha: input.commitSha,
          build_log: `[promotion] Reused immutable image ${candidate.imageDigest}\n`,
        });
        await tx.insert(deliveryDeployLinks).values({
          id: ulid(),
          delivery_id: input.deliveryId,
          deploy_id: candidate.deployId,
          relation: input.relation,
        });
      }
      const completedAt = new Date().toISOString();
      const [promotion] = await tx
        .update(releasePromotions)
        .set({
          status: 'succeeded',
          health_status: 'healthy',
          soak_status: input.soakStatus,
          deploy_ids: input.candidates.map((candidate) => candidate.deployId),
          runtime_environment_ids: input.candidates.map((candidate) => candidate.environmentId),
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .where(eq(releasePromotions.id, input.promotionId))
        .returning();
      if (!promotion) throw new RepoPersistenceError('release promotion', input.promotionId);
      await tx
        .update(deliveries)
        .set({ updated_at: completedAt })
        .where(eq(deliveries.id, input.deliveryId));
      await tx.insert(activityLog).values({
        id: ulid(),
        event_type: 'release.promoted',
        activity_type: 'deploy',
        severity: 'info',
        project_id: input.projectId,
        correlation_id: input.deliveryId,
        title: 'Release promoted',
        description: `${input.releaseVersion} → ${input.projectEnvironmentName}`,
        status: 'completed',
        metadata: JSON.stringify({
          release_id: input.releaseId,
          promotion_id: input.promotionId,
          project_environment_id: input.projectEnvironmentId,
          image_digests: input.imageDigests,
        }),
        created_at: completedAt,
      });
      return promotion;
    });
  }

  async getPromotion(id: string): Promise<ReleasePromotionRow | null> {
    const [row] = await this.db
      .select()
      .from(releasePromotions)
      .where(eq(releasePromotions.id, id))
      .limit(1);
    return row ?? null;
  }

  async listPromotionsForRelease(releaseId: string): Promise<ReleasePromotionRow[]> {
    return await this.db
      .select()
      .from(releasePromotions)
      .where(eq(releasePromotions.release_id, releaseId))
      .orderBy(asc(releasePromotions.created_at));
  }

  async latestSuccessfulPromotion(
    projectEnvironmentId: string,
  ): Promise<ReleasePromotionRow | null> {
    const [row] = await this.db
      .select()
      .from(releasePromotions)
      .where(
        and(
          eq(releasePromotions.project_environment_id, projectEnvironmentId),
          eq(releasePromotions.status, 'succeeded'),
        ),
      )
      .orderBy(desc(releasePromotions.completed_at), desc(releasePromotions.created_at))
      .limit(1);
    return row ?? null;
  }
}
