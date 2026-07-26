import type { Database } from '../db/index.js';
import { DeliveryAgentRunStateError } from '../errors.js';
import type { DeliveryService } from './delivery-service.js';

export class DeliveryAgentRunService {
  constructor(
    private readonly db: Database,
    private readonly deliveryService: DeliveryService,
  ) {}

  private async audit(input: {
    projectId: string;
    deliveryId: string;
    runId: string;
    eventType: string;
    title: string;
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insertActivityLog({
      event_type: input.eventType,
      activity_type: 'delivery',
      severity: 'info',
      project_id: input.projectId,
      correlation_id: input.deliveryId,
      title: input.title,
      description: input.description,
      status: 'completed',
      metadata: JSON.stringify({
        delivery_id: input.deliveryId,
        run_id: input.runId,
        ...input.metadata,
      }),
    });
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
  }) {
    await this.deliveryService.assertDeliveryCanMutate(input.deliveryId);
    const delivery = await this.db.requireDelivery(input.deliveryId);
    if (!delivery.manifest_path) {
      throw new DeliveryAgentRunStateError(
        input.id ?? 'new',
        'Delivery must be planned with a manifest path before starting an Agent Run.',
      );
    }
    if (delivery.manifest_path !== input.manifestPath) {
      throw new DeliveryAgentRunStateError(
        input.id ?? 'new',
        'Agent Run manifest path does not match the planned Delivery manifest.',
      );
    }
    const run = await this.db.startDeliveryAgentRun(input);
    await this.audit({
      projectId: delivery.project_id,
      deliveryId: delivery.id,
      runId: run.id,
      eventType: 'delivery.agent_run_started',
      title: 'Agent Run started',
      description: `Pinned to commit ${run.commit_sha}.`,
      metadata: {
        commit_sha: run.commit_sha,
        manifest_sha256: run.manifest_sha256,
        runner_image: run.runner_image,
      },
    });
    return run;
  }

  async get(runId: string) {
    const run = await this.db.requireDeliveryAgentRun(runId);
    const [delivery, events, checks] = await Promise.all([
      this.db.requireDelivery(run.delivery_id),
      this.db.listDeliveryAgentRunEvents(runId),
      this.db.listDeliveryRunChecks(runId),
    ]);
    return { run, delivery, events, checks };
  }

  async projectIdForRun(runId: string): Promise<string> {
    const run = await this.db.requireDeliveryAgentRun(runId);
    const delivery = await this.db.requireDelivery(run.delivery_id);
    return delivery.project_id;
  }

  async recordProgress(input: {
    runId: string;
    phase: string;
    summary: string;
    detail?: Record<string, unknown>;
    handoffSummary?: string | null;
    actor: string;
  }) {
    const run = await this.db.requireDeliveryAgentRun(input.runId);
    await this.deliveryService.assertDeliveryCanMutate(run.delivery_id);
    const result = await this.db.recordDeliveryAgentRunProgress(input);
    const delivery = await this.db.requireDelivery(run.delivery_id);
    await this.audit({
      projectId: delivery.project_id,
      deliveryId: delivery.id,
      runId: run.id,
      eventType: input.handoffSummary
        ? 'delivery.agent_run_handoff'
        : 'delivery.agent_run_progress',
      title: input.handoffSummary ? 'Agent Run handed off' : 'Agent Run progressed',
      description: input.summary,
      metadata: { phase: input.phase },
    });
    return result;
  }

  async resume(input: { runId: string; summary: string; actor: string }) {
    const run = await this.db.requireDeliveryAgentRun(input.runId);
    await this.deliveryService.assertDeliveryCanMutate(run.delivery_id);
    const resumed = await this.db.resumeDeliveryAgentRun(input);
    const delivery = await this.db.requireDelivery(run.delivery_id);
    await this.audit({
      projectId: delivery.project_id,
      deliveryId: delivery.id,
      runId: run.id,
      eventType: 'delivery.agent_run_resumed',
      title: 'Agent Run resumed',
      description: input.summary,
      metadata: { phase: resumed.current_phase },
    });
    return resumed;
  }

  async cancel(input: { runId: string; reason: string; actor: string }) {
    const current = await this.db.requireDeliveryAgentRun(input.runId);
    const delivery = await this.db.requireDelivery(current.delivery_id);
    const cancelled = await this.db.cancelDeliveryAgentRun(input);
    await this.audit({
      projectId: delivery.project_id,
      deliveryId: delivery.id,
      runId: current.id,
      eventType: 'delivery.agent_run_cancelled',
      title: 'Agent Run cancelled',
      description: input.reason,
    });
    return cancelled;
  }

  async fail(input: { runId: string; summary: string; actor: string }) {
    const current = await this.db.requireDeliveryAgentRun(input.runId);
    const delivery = await this.db.requireDelivery(current.delivery_id);
    const failed = await this.db.failDeliveryAgentRun(input);
    await this.audit({
      projectId: delivery.project_id,
      deliveryId: delivery.id,
      runId: current.id,
      eventType: 'delivery.agent_run_failed',
      title: 'Agent Run failed',
      description: input.summary,
    });
    return failed;
  }

  async complete(input: { runId: string; summary: string; actor: string }) {
    const current = await this.db.requireDeliveryAgentRun(input.runId);
    const delivery = await this.db.requireDelivery(current.delivery_id);
    const completed = await this.db.completeDeliveryAgentRun(input);
    await this.audit({
      projectId: delivery.project_id,
      deliveryId: delivery.id,
      runId: current.id,
      eventType: 'delivery.agent_run_completed',
      title: 'Agent Run completed',
      description: input.summary,
    });
    return completed;
  }
}
