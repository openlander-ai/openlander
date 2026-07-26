import { and, desc, eq, inArray } from 'drizzle-orm';

import {
  DeliveryAgentRunConflictError,
  DeliveryAgentRunNotFoundError,
  DeliveryAgentRunStateError,
  DeliveryNotFoundError,
  RepoPersistenceError,
} from '../../errors.js';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import {
  deliveries,
  deliveryAgentRunEvents,
  deliveryAgentRuns,
  deliveryRunChecks,
  type DeliveryAgentRunEventRow,
  type DeliveryAgentRunRow,
  type DeliveryRunCheckRow,
} from '../schema.drizzle.js';
import { ulid } from './activity-log.repo.js';

type AgentRunTransaction = Parameters<Parameters<DrizzleClient['transaction']>[0]>[0];

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === '23505' ||
    (typeof candidate.message === 'string' &&
      candidate.message.toLowerCase().includes('unique constraint'))
  );
}

async function appendEvent(
  tx: AgentRunTransaction,
  input: {
    runId: string;
    eventType: string;
    phase?: string | null;
    summary: string;
    detail?: Record<string, unknown>;
    actor: string;
  },
): Promise<DeliveryAgentRunEventRow> {
  const [latest] = await tx
    .select({ sequence: deliveryAgentRunEvents.sequence })
    .from(deliveryAgentRunEvents)
    .where(eq(deliveryAgentRunEvents.run_id, input.runId))
    .orderBy(desc(deliveryAgentRunEvents.sequence))
    .limit(1);
  const [event] = await tx
    .insert(deliveryAgentRunEvents)
    .values({
      id: ulid(),
      run_id: input.runId,
      sequence: (latest?.sequence ?? 0) + 1,
      event_type: input.eventType,
      phase: input.phase ?? null,
      summary: input.summary,
      detail_json: input.detail ?? {},
      actor: input.actor,
    })
    .returning();
  if (!event) throw new RepoPersistenceError('delivery agent run event', input.runId);
  return event;
}

export class DeliveryAgentRunRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async start(input: {
    id?: string;
    deliveryId: string;
    commitSha: string;
    manifestPath: string;
    manifestSha256: string;
    runnerImage: string;
    runnerImageDigest?: string | null;
    phase?: string;
    actor: string;
  }): Promise<DeliveryAgentRunRow> {
    const id = input.id ?? ulid();
    return await this.db.transaction(async (tx) => {
      const [delivery] = await tx
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(eq(deliveries.id, input.deliveryId))
        .limit(1)
        .for('update');
      if (!delivery) throw new DeliveryNotFoundError(input.deliveryId);

      const [existingById] = await tx
        .select()
        .from(deliveryAgentRuns)
        .where(eq(deliveryAgentRuns.id, id))
        .limit(1);
      if (existingById) {
        if (
          existingById.delivery_id === input.deliveryId &&
          existingById.commit_sha === input.commitSha &&
          existingById.manifest_sha256 === input.manifestSha256
        ) {
          return existingById;
        }
        throw new DeliveryAgentRunStateError(
          id,
          'The deterministic Agent Run id is already used by another operation.',
          existingById.status,
        );
      }

      const [active] = await tx
        .select({ id: deliveryAgentRuns.id })
        .from(deliveryAgentRuns)
        .where(
          and(
            eq(deliveryAgentRuns.delivery_id, input.deliveryId),
            inArray(deliveryAgentRuns.status, ['running', 'paused']),
          ),
        )
        .limit(1);
      if (active) throw new DeliveryAgentRunConflictError(input.deliveryId);

      try {
        const [run] = await tx
          .insert(deliveryAgentRuns)
          .values({
            id,
            delivery_id: input.deliveryId,
            commit_sha: input.commitSha,
            manifest_path: input.manifestPath,
            manifest_sha256: input.manifestSha256,
            runner_image: input.runnerImage,
            runner_image_digest: input.runnerImageDigest ?? null,
            current_phase: input.phase ?? 'planning',
            started_by: input.actor,
          })
          .returning();
        if (!run) throw new RepoPersistenceError('delivery agent run', id);
        await appendEvent(tx, {
          runId: run.id,
          eventType: 'started',
          phase: run.current_phase,
          summary: `Agent Run started at commit ${run.commit_sha}.`,
          detail: {
            commit_sha: run.commit_sha,
            manifest_path: run.manifest_path,
            manifest_sha256: run.manifest_sha256,
            runner_image: run.runner_image,
            runner_image_digest: run.runner_image_digest,
          },
          actor: input.actor,
        });
        return run;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DeliveryAgentRunConflictError(input.deliveryId);
        }
        throw error;
      }
    });
  }

  async listForDelivery(deliveryId: string): Promise<DeliveryAgentRunRow[]> {
    return await this.db
      .select()
      .from(deliveryAgentRuns)
      .where(eq(deliveryAgentRuns.delivery_id, deliveryId))
      .orderBy(desc(deliveryAgentRuns.started_at));
  }

  async listEventsForRuns(runIds: readonly string[]): Promise<DeliveryAgentRunEventRow[]> {
    if (runIds.length === 0) return [];
    return await this.db
      .select()
      .from(deliveryAgentRunEvents)
      .where(inArray(deliveryAgentRunEvents.run_id, [...runIds]))
      .orderBy(desc(deliveryAgentRunEvents.created_at));
  }

  async listChecksForRuns(runIds: readonly string[]): Promise<DeliveryRunCheckRow[]> {
    if (runIds.length === 0) return [];
    return await this.db
      .select()
      .from(deliveryRunChecks)
      .where(inArray(deliveryRunChecks.run_id, [...runIds]))
      .orderBy(desc(deliveryRunChecks.created_at));
  }

  async get(id: string): Promise<DeliveryAgentRunRow | null> {
    const [row] = await this.db
      .select()
      .from(deliveryAgentRuns)
      .where(eq(deliveryAgentRuns.id, id))
      .limit(1);
    return row ?? null;
  }

  async require(id: string): Promise<DeliveryAgentRunRow> {
    const run = await this.get(id);
    if (!run) throw new DeliveryAgentRunNotFoundError(id);
    return run;
  }

  async listEvents(runId: string): Promise<DeliveryAgentRunEventRow[]> {
    await this.require(runId);
    return await this.db
      .select()
      .from(deliveryAgentRunEvents)
      .where(eq(deliveryAgentRunEvents.run_id, runId))
      .orderBy(deliveryAgentRunEvents.sequence);
  }

  async recordProgress(input: {
    runId: string;
    phase: string;
    summary: string;
    detail?: Record<string, unknown>;
    handoffSummary?: string | null;
    actor: string;
  }): Promise<{ run: DeliveryAgentRunRow; event: DeliveryAgentRunEventRow }> {
    return await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(deliveryAgentRuns)
        .where(eq(deliveryAgentRuns.id, input.runId))
        .limit(1)
        .for('update');
      if (!current) throw new DeliveryAgentRunNotFoundError(input.runId);
      if (current.status !== 'running') {
        throw new DeliveryAgentRunStateError(
          input.runId,
          'Only running Agent Runs can record progress. Resume a paused Run first.',
          current.status,
        );
      }
      const [run] = await tx
        .update(deliveryAgentRuns)
        .set({
          ...(input.handoffSummary ? { status: 'paused' as const } : {}),
          current_phase: input.phase,
          ...(input.handoffSummary !== undefined ? { handoff_summary: input.handoffSummary } : {}),
          updated_at: new Date().toISOString(),
        })
        .where(eq(deliveryAgentRuns.id, input.runId))
        .returning();
      if (!run) throw new RepoPersistenceError('delivery agent run progress', input.runId);
      const event = await appendEvent(tx, {
        runId: input.runId,
        eventType: input.handoffSummary ? 'handoff' : 'progress',
        phase: input.phase,
        summary: input.summary,
        detail: input.detail,
        actor: input.actor,
      });
      return { run, event };
    });
  }

  async resume(input: {
    runId: string;
    summary: string;
    actor: string;
  }): Promise<DeliveryAgentRunRow> {
    return await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(deliveryAgentRuns)
        .where(eq(deliveryAgentRuns.id, input.runId))
        .limit(1)
        .for('update');
      if (!current) throw new DeliveryAgentRunNotFoundError(input.runId);
      if (current.status !== 'paused') {
        throw new DeliveryAgentRunStateError(
          input.runId,
          'Only paused Agent Runs can be resumed.',
          current.status,
        );
      }
      const [run] = await tx
        .update(deliveryAgentRuns)
        .set({ status: 'running', updated_at: new Date().toISOString() })
        .where(eq(deliveryAgentRuns.id, input.runId))
        .returning();
      if (!run) throw new RepoPersistenceError('delivery agent run resume', input.runId);
      await appendEvent(tx, {
        runId: input.runId,
        eventType: 'resumed',
        phase: run.current_phase,
        summary: input.summary,
        actor: input.actor,
      });
      return run;
    });
  }

  async cancel(input: {
    runId: string;
    reason: string;
    actor: string;
  }): Promise<DeliveryAgentRunRow> {
    return await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(deliveryAgentRuns)
        .where(eq(deliveryAgentRuns.id, input.runId))
        .limit(1)
        .for('update');
      if (!current) throw new DeliveryAgentRunNotFoundError(input.runId);
      if (current.status !== 'running' && current.status !== 'paused') {
        throw new DeliveryAgentRunStateError(
          input.runId,
          'Only active Agent Runs can be cancelled.',
          current.status,
        );
      }
      const now = new Date().toISOString();
      const [run] = await tx
        .update(deliveryAgentRuns)
        .set({
          status: 'cancelled',
          cancellation_reason: input.reason,
          completed_at: now,
          updated_at: now,
        })
        .where(eq(deliveryAgentRuns.id, input.runId))
        .returning();
      if (!run) throw new RepoPersistenceError('delivery agent run cancellation', input.runId);
      await appendEvent(tx, {
        runId: input.runId,
        eventType: 'cancelled',
        phase: run.current_phase,
        summary: input.reason,
        actor: input.actor,
      });
      return run;
    });
  }

  async startCheck(input: {
    runId: string;
    gateId: string;
    checkKey: string;
    command: string[];
    runnerImageDigest?: string | null;
  }): Promise<DeliveryRunCheckRow> {
    return await this.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(deliveryAgentRuns)
        .where(eq(deliveryAgentRuns.id, input.runId))
        .limit(1)
        .for('update');
      if (!run) throw new DeliveryAgentRunNotFoundError(input.runId);
      if (run.status !== 'running') {
        throw new DeliveryAgentRunStateError(
          input.runId,
          'Quality checks require a running Agent Run.',
          run.status,
        );
      }
      const [latest] = await tx
        .select({ attempt: deliveryRunChecks.attempt })
        .from(deliveryRunChecks)
        .where(
          and(
            eq(deliveryRunChecks.run_id, input.runId),
            eq(deliveryRunChecks.check_key, input.checkKey),
          ),
        )
        .orderBy(desc(deliveryRunChecks.attempt))
        .limit(1);
      const [check] = await tx
        .insert(deliveryRunChecks)
        .values({
          id: ulid(),
          run_id: input.runId,
          gate_id: input.gateId,
          check_key: input.checkKey,
          attempt: (latest?.attempt ?? 0) + 1,
          status: 'running',
          command: JSON.stringify(input.command),
          runner_image_digest: input.runnerImageDigest ?? null,
          started_at: new Date().toISOString(),
        })
        .returning();
      if (!check) throw new RepoPersistenceError('delivery run check', input.checkKey);
      return check;
    });
  }

  async finishCheck(input: {
    checkId: string;
    status: 'passed' | 'failed' | 'cancelled';
    exitCode: number;
    durationMs: number;
    logSha256: string;
    reportArtifactId?: string | null;
    details?: Record<string, unknown>;
  }): Promise<DeliveryRunCheckRow> {
    const [check] = await this.db
      .update(deliveryRunChecks)
      .set({
        status: input.status,
        exit_code: input.exitCode,
        duration_ms: input.durationMs,
        log_sha256: input.logSha256,
        report_artifact_id: input.reportArtifactId ?? null,
        details_json: input.details ?? {},
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where(eq(deliveryRunChecks.id, input.checkId))
      .returning();
    if (!check) throw new RepoPersistenceError('delivery run check', input.checkId);
    return check;
  }

  async listChecks(runId: string): Promise<DeliveryRunCheckRow[]> {
    await this.require(runId);
    return await this.db
      .select()
      .from(deliveryRunChecks)
      .where(eq(deliveryRunChecks.run_id, runId))
      .orderBy(deliveryRunChecks.check_key, deliveryRunChecks.attempt);
  }

  async setRunnerImageDigest(runId: string, digest: string): Promise<DeliveryAgentRunRow> {
    const [run] = await this.db
      .update(deliveryAgentRuns)
      .set({ runner_image_digest: digest, updated_at: new Date().toISOString() })
      .where(and(eq(deliveryAgentRuns.id, runId), eq(deliveryAgentRuns.status, 'running')))
      .returning();
    if (run) return run;
    const current = await this.require(runId);
    throw new DeliveryAgentRunStateError(
      runId,
      'Runner image can only be pinned while the Agent Run is running.',
      current.status,
    );
  }

  async fail(input: {
    runId: string;
    summary: string;
    actor: string;
  }): Promise<DeliveryAgentRunRow> {
    return await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(deliveryAgentRuns)
        .where(eq(deliveryAgentRuns.id, input.runId))
        .limit(1)
        .for('update');
      if (!current) throw new DeliveryAgentRunNotFoundError(input.runId);
      if (current.status !== 'running') {
        throw new DeliveryAgentRunStateError(
          input.runId,
          'Only a running Agent Run can be marked failed.',
          current.status,
        );
      }
      const now = new Date().toISOString();
      const [run] = await tx
        .update(deliveryAgentRuns)
        .set({ status: 'failed', completed_at: now, updated_at: now })
        .where(eq(deliveryAgentRuns.id, input.runId))
        .returning();
      if (!run) throw new RepoPersistenceError('delivery agent run failure', input.runId);
      await appendEvent(tx, {
        runId: input.runId,
        eventType: 'failed',
        phase: run.current_phase,
        summary: input.summary,
        actor: input.actor,
      });
      return run;
    });
  }

  async complete(input: {
    runId: string;
    summary: string;
    actor: string;
  }): Promise<DeliveryAgentRunRow> {
    return await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(deliveryAgentRuns)
        .where(eq(deliveryAgentRuns.id, input.runId))
        .limit(1)
        .for('update');
      if (!current) throw new DeliveryAgentRunNotFoundError(input.runId);
      if (current.status === 'completed') return current;
      if (current.status !== 'running') {
        throw new DeliveryAgentRunStateError(
          input.runId,
          'Only a running Agent Run can be completed.',
          current.status,
        );
      }
      const now = new Date().toISOString();
      const [run] = await tx
        .update(deliveryAgentRuns)
        .set({
          status: 'completed',
          current_phase: 'completed',
          completed_at: now,
          updated_at: now,
        })
        .where(eq(deliveryAgentRuns.id, input.runId))
        .returning();
      if (!run) throw new RepoPersistenceError('delivery agent run completion', input.runId);
      await appendEvent(tx, {
        runId: input.runId,
        eventType: 'completed',
        phase: 'completed',
        summary: input.summary,
        actor: input.actor,
      });
      return run;
    });
  }
}
