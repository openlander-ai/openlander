import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../src/db/index.js';
import type { ArtifactStore } from '../../src/delivery/artifact-store.js';
import { DeliveryService } from '../../src/delivery/delivery-service.js';

describe('Delivery execution view', () => {
  it('batch-loads execution and Promotion evidence with a bounded query count', async () => {
    const db = {
      requireDelivery: vi.fn(async () => ({ id: 'delivery-1', project_id: 'project-1' })),
      listDeliveryAgentRuns: vi.fn(async () => [{ id: 'run-1' }]),
      listProjectEnvironments: vi.fn(async () => [{ id: 'project-environment-1' }]),
      listReleasesForDelivery: vi.fn(async () => [{ id: 'release-1' }]),
      listDeliveryAgentRunEventsForRuns: vi.fn(async () => [{ id: 'event-1' }]),
      listDeliveryRunChecksForRuns: vi.fn(async () => [{ id: 'check-1' }]),
      listReleaseArtifactsForReleases: vi.fn(async () => [{ id: 'artifact-1' }]),
      listReleasePromotionsForReleases: vi.fn(async () => [{ id: 'promotion-1' }]),
    };
    const service = new DeliveryService(db as unknown as Database, {} as unknown as ArtifactStore);

    const result = await service.getDeliveryExecution('delivery-1');

    expect(result).toEqual({
      agent_runs: [{ id: 'run-1' }],
      run_events: [{ id: 'event-1' }],
      run_checks: [{ id: 'check-1' }],
      project_environments: [{ id: 'project-environment-1' }],
      releases: [{ id: 'release-1' }],
      release_artifacts: [{ id: 'artifact-1' }],
      release_promotions: [{ id: 'promotion-1' }],
    });
    expect(db.listDeliveryAgentRunEventsForRuns).toHaveBeenCalledWith(['run-1']);
    expect(db.listDeliveryRunChecksForRuns).toHaveBeenCalledWith(['run-1']);
    expect(db.listReleaseArtifactsForReleases).toHaveBeenCalledWith(['release-1']);
    expect(db.listReleasePromotionsForReleases).toHaveBeenCalledWith(['release-1']);
    for (const query of Object.values(db)) {
      expect(query).toHaveBeenCalledTimes(1);
    }
  });
});
