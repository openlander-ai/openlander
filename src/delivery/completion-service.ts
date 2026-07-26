import { Readable } from 'node:stream';

import type { Database } from '../db/index.js';
import {
  DeliveryStateError,
  ProjectEnvironmentNotFoundError,
  ReleaseStateError,
} from '../errors.js';
import type { DeliveryAgentRunService } from './agent-run-service.js';
import type { DeliveryService } from './delivery-service.js';

export class DeliveryCompletionService {
  constructor(
    private readonly db: Database,
    private readonly deliveryService: DeliveryService,
    private readonly agentRunService: DeliveryAgentRunService,
  ) {}

  async complete(input: {
    deliveryId: string;
    runId: string;
    releaseId: string;
    promotionId: string;
    limitations: string;
    actor: string;
  }) {
    const delivery = await this.db.requireDelivery(input.deliveryId);
    const run = await this.db.requireDeliveryAgentRun(input.runId);
    const release = await this.db.requireRelease(input.releaseId);
    const promotion = await this.db.getReleasePromotion(input.promotionId);
    if (
      run.delivery_id !== delivery.id ||
      release.delivery_id !== delivery.id ||
      release.agent_run_id !== run.id ||
      !promotion ||
      promotion.release_id !== release.id ||
      promotion.status !== 'succeeded'
    ) {
      throw new ReleaseStateError(
        release.id,
        'Run, Release, Promotion, and Delivery must belong to the same successful chain.',
      );
    }
    const environment = await this.db.getProjectEnvironment(promotion.project_environment_id);
    if (!environment) throw new ProjectEnvironmentNotFoundError(promotion.project_environment_id);
    if (environment.tier !== 'production') {
      throw new ReleaseStateError(
        release.id,
        'Completion evidence requires a successful Production Promotion.',
      );
    }
    const existingReceipt = await this.db.getDeliveryReceipt(delivery.id);
    if (existingReceipt) {
      await this.agentRunService.complete({
        runId: run.id,
        summary: `Completion evidence ${existingReceipt.id} is finalized.`,
        actor: input.actor,
      });
      return existingReceipt;
    }
    if (!delivery.auto_finalize) {
      throw new DeliveryStateError(
        delivery.id,
        'This Delivery is not enabled for agent finalization.',
      );
    }

    await this.db.updateDelivery(delivery.id, { limitations: input.limitations.trim() });

    const gates = await this.db.listDeliveryGates(delivery.id);
    const reviewRequired = gates.some((gate) => gate.gate_type === 'review' && gate.required);
    if (!reviewRequired) {
      const artifacts = await this.db.listDeliveryArtifacts(delivery.id);
      if (artifacts.length === 0) {
        const releaseArtifacts = await this.db.listReleaseArtifacts(release.id);
        const evidence = Buffer.from(
          JSON.stringify(
            {
              delivery_id: delivery.id,
              run_id: run.id,
              release_id: release.id,
              promotion_id: promotion.id,
              commit_sha: release.commit_sha,
              artifacts: releaseArtifacts.map((artifact) => ({
                service_id: artifact.service_id,
                image_digest: artifact.image_digest,
              })),
            },
            null,
            2,
          ),
        );
        const artifact = await this.deliveryService.uploadArtifact({
          deliveryId: delivery.id,
          source: Readable.from([evidence]),
          filename: `${delivery.id}-completion-evidence.json`,
          declaredMimeType: 'application/json',
          logicalKey: 'agent-completion-evidence',
          revision: 1,
          kind: 'qa_report',
          includeInReceipt: true,
          idempotencyKey: `complete:${release.id}`,
          actor: input.actor,
        });
        await this.deliveryService.setArtifactStatus(delivery.id, artifact.id, 'approved');
      } else {
        for (const { artifact } of artifacts) {
          if (artifact.status === 'draft' && artifact.kind === 'qa_report') {
            await this.deliveryService.setArtifactStatus(delivery.id, artifact.id, 'approved');
          }
        }
      }
      await this.db.setDeliveryStatus(delivery.id, 'approved');
    }

    await this.deliveryService.generateReceiptPreview(delivery.id);
    const receipt = await this.deliveryService.finalizeReceipt(delivery.id, input.actor);
    await this.agentRunService.complete({
      runId: run.id,
      summary: `Completion evidence ${receipt.id} finalized after Production Promotion.`,
      actor: input.actor,
    });
    return receipt;
  }
}
