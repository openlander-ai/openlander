import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import type { DeliveryAgentRunService } from '../../src/delivery/agent-run-service.js';
import { DeliveryCompletionService } from '../../src/delivery/completion-service.js';
import type { DeliveryService } from '../../src/delivery/delivery-service.js';

describe('DeliveryCompletionService', () => {
  it('records limitations before finalizing a human-reviewed Delivery', async () => {
    const delivery = { id: 'delivery-1', auto_finalize: true };
    const run = { id: 'run-1', delivery_id: delivery.id };
    const release = { id: 'release-1', delivery_id: delivery.id, agent_run_id: run.id };
    const promotion = {
      id: 'promotion-1',
      release_id: release.id,
      project_environment_id: 'environment-production',
      status: 'succeeded',
    };
    const receipt = { id: 'receipt-1', pdf_sha256: 'a'.repeat(64) };
    const db = {
      requireDelivery: vi.fn(async () => delivery),
      requireDeliveryAgentRun: vi.fn(async () => run),
      requireRelease: vi.fn(async () => release),
      getReleasePromotion: vi.fn(async () => promotion),
      getProjectEnvironment: vi.fn(async () => ({
        id: 'environment-production',
        tier: 'production',
      })),
      getDeliveryReceipt: vi.fn(async () => null),
      updateDelivery: vi.fn(async () => delivery),
      listDeliveryGates: vi.fn(async () => [
        { gate_type: 'review', required: true, status: 'passed' },
      ]),
    };
    const deliveryService = {
      generateReceiptPreview: vi.fn(async () => undefined),
      finalizeReceipt: vi.fn(async () => receipt),
    };
    const agentRunService = {
      complete: vi.fn(async () => run),
    };
    const service = new DeliveryCompletionService(
      db as unknown as Database,
      deliveryService as unknown as DeliveryService,
      agentRunService as unknown as DeliveryAgentRunService,
    );

    await expect(
      service.complete({
        deliveryId: delivery.id,
        runId: run.id,
        releaseId: release.id,
        promotionId: promotion.id,
        limitations: '  Known customer-side dependency.  ',
        actor: 'agent-a',
      }),
    ).resolves.toEqual(receipt);

    expect(db.updateDelivery).toHaveBeenCalledWith(delivery.id, {
      limitations: 'Known customer-side dependency.',
    });
    expect(deliveryService.generateReceiptPreview).toHaveBeenCalledWith(delivery.id);
    expect(deliveryService.finalizeReceipt).toHaveBeenCalledWith(delivery.id, 'agent-a');
  });
});
