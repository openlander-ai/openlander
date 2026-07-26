import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OpenLanderConfig } from '../../src/config/index.js';
import type { Database } from '../../src/db/index.js';
import type { Docker } from '../../src/pipeline/docker.js';
import { ReleasePromotionService } from '../../src/release/promotion-service.js';

const digest = `sha256:${'e'.repeat(64)}`;

function createHarness(
  options: {
    inspectedDigest?: string;
    priorSucceeded?: boolean;
    smokePath?: string | null;
    soakSeconds?: number;
    smokePassed?: boolean;
    useDefaultSmokeProbe?: boolean;
  } = {},
) {
  const release = {
    id: 'release-1',
    delivery_id: 'delivery-1',
    status: 'ready',
    version: '1.0.0',
    commit_sha: 'a'.repeat(40),
  };
  const promotion = {
    id: 'promotion-1',
    release_id: release.id,
    project_environment_id: 'penv-qa',
    previous_release_id: null,
    status: 'pending',
  };
  const runtime = {
    id: 'env-qa-service-1',
    container_id: 'old-container',
    image_tag: `sha256:${'f'.repeat(64)}`,
  };
  const db = {
    requireRelease: vi.fn(async () => release),
    requireDelivery: vi.fn(async () => ({ id: 'delivery-1', project_id: 'project-1' })),
    getProjectEnvironment: vi.fn(async () => ({
      id: 'penv-qa',
      project_id: 'project-1',
      key: 'qa',
      display_name: 'QA',
      tier: 'validation',
      promotion_order: 1,
      health_timeout_seconds: 30,
      smoke_path: options.smokePath ?? null,
      soak_seconds: options.soakSeconds ?? 0,
    })),
    listProjectEnvironments: vi.fn(async () => [
      { id: 'penv-dev', promotion_order: 0 },
      { id: 'penv-qa', promotion_order: 1 },
    ]),
    listReleasePromotions: vi.fn(async () =>
      options.priorSucceeded ? [{ project_environment_id: 'penv-dev', status: 'succeeded' }] : [],
    ),
    getLatestSuccessfulPromotion: vi.fn(async () => null),
    createReleasePromotion: vi.fn(async () => promotion),
    updateReleasePromotion: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
      Object.assign(promotion, patch);
      return promotion;
    }),
    getReleasePromotion: vi.fn(async () => promotion),
    finalizeReleasePromotion: vi.fn(async (input: Record<string, unknown>) => {
      Object.assign(promotion, {
        status: 'succeeded',
        health_status: 'healthy',
        soak_status: input['soakStatus'],
        deploy_ids: (input['candidates'] as Array<{ deployId: string }>).map(
          (candidate) => candidate.deployId,
        ),
      });
      return promotion;
    }),
    listReleaseArtifacts: vi.fn(async () => [
      {
        release_id: release.id,
        service_id: 'service-1',
        image_reference: digest,
        image_digest: digest,
      },
    ]),
    getServices: vi.fn(async () => [
      {
        id: 'service-1',
        name: 'project-one',
        container_port: 3000,
        image_cmd: null,
      },
    ]),
    getProject: vi.fn(async () => ({ id: 'project-1', name: 'project-one' })),
    createProjectEnvironmentRuntime: vi.fn(async () => runtime),
    getEnvVarsForService: vi.fn(async () => ({})),
    updateEnvironment: vi.fn(async () => undefined),
    createDeployLogForService: vi.fn(async () => undefined),
    linkDeliveryDeploy: vi.fn(async () => undefined),
    insertActivityLog: vi.fn(async () => undefined),
  };
  const docker = {
    inspectImage: vi.fn(async () => ({ Id: options.inspectedDigest ?? digest })),
    ensureProjectNetwork: vi.fn(async () => 'project-network'),
    runContainer: vi.fn(async () => 'candidate-container'),
    waitForHealthy: vi.fn(async () => ({ healthy: true })),
    safeRemoveContainer: vi.fn(async () => undefined),
  };
  const allocateRuntimePort = vi.fn(async () => 32123);
  const releaseRuntimePort = vi.fn();
  const smokeProbe = vi.fn(async () => ({
    passed: options.smokePassed ?? true,
    statusCode: options.smokePassed === false ? 503 : 200,
  }));
  const waitForSoak = vi.fn(async () => undefined);
  const service = new ReleasePromotionService(
    db as unknown as Database,
    docker as unknown as Docker,
    { traefik: { mode: 'external' } } as OpenLanderConfig,
    allocateRuntimePort,
    releaseRuntimePort,
    options.useDefaultSmokeProbe ? undefined : smokeProbe,
    waitForSoak,
  );
  return {
    service,
    db,
    docker,
    promotion,
    allocateRuntimePort,
    releaseRuntimePort,
    smokeProbe,
    waitForSoak,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('ReleasePromotionService', () => {
  it('persists a queryable Promotion before start returns', async () => {
    const harness = createHarness({ priorSucceeded: true });
    let releaseInspection: (() => void) | undefined;
    const inspectionBlocked = new Promise<void>((resolve) => {
      releaseInspection = resolve;
    });
    harness.docker.inspectImage.mockImplementation(async () => {
      await inspectionBlocked;
      return { Id: digest };
    });

    await harness.service.start({
      id: 'promotion-1',
      releaseId: 'release-1',
      projectEnvironmentId: 'penv-qa',
      idempotencyKey: 'promote-1',
      actor: 'agent-a',
    });

    expect(harness.db.createReleasePromotion).toHaveBeenCalledOnce();
    await expect(harness.service.evaluate('promotion-1')).resolves.toMatchObject({
      id: 'promotion-1',
      status: expect.stringMatching(/^(pending|deploying)$/),
    });

    releaseInspection?.();
    await vi.waitFor(() => expect(harness.promotion.status).toBe('succeeded'));
  });

  it('reuses the exact Release digest without rebuilding', async () => {
    const harness = createHarness({ priorSucceeded: true });
    const result = await harness.service.execute({
      id: 'promotion-1',
      releaseId: 'release-1',
      projectEnvironmentId: 'penv-qa',
      idempotencyKey: 'promote-1',
      actor: 'agent-a',
    });

    expect(harness.docker.runContainer).toHaveBeenCalledWith(
      expect.objectContaining({ imageTag: digest }),
    );
    expect(harness.db.finalizeReleasePromotion).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [expect.objectContaining({ imageDigest: digest })],
      }),
    );
    expect(result.status).toBe('succeeded');
    expect(harness.releaseRuntimePort).toHaveBeenCalledWith(32123);
  });

  it('rejects Promotion when the prior Environment has not succeeded', async () => {
    const harness = createHarness();

    await expect(
      harness.service.execute({
        id: 'promotion-1',
        releaseId: 'release-1',
        projectEnvironmentId: 'penv-qa',
        idempotencyKey: 'promote-1',
        actor: 'agent-a',
      }),
    ).rejects.toMatchObject({ code: 'PROMOTION_ORDER_VIOLATION' });
    expect(harness.docker.inspectImage).not.toHaveBeenCalled();
  });

  it('fails closed when the local image identifier differs from the recorded digest', async () => {
    const harness = createHarness({
      priorSucceeded: true,
      inspectedDigest: `sha256:${'9'.repeat(64)}`,
    });

    await expect(
      harness.service.execute({
        id: 'promotion-1',
        releaseId: 'release-1',
        projectEnvironmentId: 'penv-qa',
        idempotencyKey: 'promote-1',
        actor: 'agent-a',
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_DIGEST_MISMATCH' });
    expect(harness.docker.runContainer).not.toHaveBeenCalled();
  });

  it('promotes every service artifact with the exact recorded digest', async () => {
    const harness = createHarness({ priorSucceeded: true });
    const secondDigest = `sha256:${'7'.repeat(64)}`;
    harness.db.listReleaseArtifacts.mockResolvedValue([
      {
        release_id: 'release-1',
        service_id: 'service-1',
        image_reference: digest,
        image_digest: digest,
      },
      {
        release_id: 'release-1',
        service_id: 'service-2',
        image_reference: secondDigest,
        image_digest: secondDigest,
      },
    ]);
    harness.db.getServices.mockResolvedValue([
      { id: 'service-1', name: 'project-one', container_port: 3000, image_cmd: null },
      { id: 'service-2', name: 'project-worker', container_port: 4000, image_cmd: null },
    ]);
    harness.docker.inspectImage.mockImplementation(async (image: string) => ({ Id: image }));
    harness.db.createProjectEnvironmentRuntime.mockImplementation(async (input) => ({
      id: input.id,
      container_id: null,
      image_tag: null,
    }));
    harness.docker.runContainer
      .mockResolvedValueOnce('candidate-service-1')
      .mockResolvedValueOnce('candidate-service-2');

    const result = await harness.service.execute({
      id: 'promotion-1',
      releaseId: 'release-1',
      projectEnvironmentId: 'penv-qa',
      idempotencyKey: 'promote-1',
      actor: 'agent-a',
    });

    expect(harness.docker.runContainer).toHaveBeenCalledTimes(2);
    expect(harness.docker.runContainer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ imageTag: digest }),
    );
    expect(harness.docker.runContainer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ imageTag: secondDigest }),
    );
    expect(harness.db.finalizeReleasePromotion).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.objectContaining({ imageDigest: digest }),
          expect.objectContaining({ imageDigest: secondDigest }),
        ]),
      }),
    );
    expect(result.status).toBe('succeeded');
    expect(harness.db.finalizeReleasePromotion).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.objectContaining({ deployId: 'deploy_promotion-1_service-1' }),
          expect.objectContaining({ deployId: 'deploy_promotion-1_service-2' }),
        ]),
      }),
    );
  });

  it('fails Promotion when the manifest Smoke Test fails', async () => {
    const harness = createHarness({
      priorSucceeded: true,
      smokePath: '/smoke',
      smokePassed: false,
    });

    await expect(
      harness.service.execute({
        id: 'promotion-1',
        releaseId: 'release-1',
        projectEnvironmentId: 'penv-qa',
        idempotencyKey: 'promote-1',
        actor: 'agent-a',
      }),
    ).rejects.toMatchObject({ code: 'RELEASE_STATE_INVALID' });
    expect(harness.smokeProbe).toHaveBeenCalledWith(32123, '/smoke', 30_000);
    expect(harness.docker.safeRemoveContainer).toHaveBeenCalledWith('candidate-container');
    expect(harness.db.finalizeReleasePromotion).not.toHaveBeenCalled();
  });

  it('probes the Docker host when OpenLander runs in a container', async () => {
    vi.stubEnv('OPENLANDER_CONTAINERIZED', 'true');
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const harness = createHarness({
      priorSucceeded: true,
      smokePath: '/smoke',
      useDefaultSmokeProbe: true,
    });

    const result = await harness.service.execute({
      id: 'promotion-1',
      releaseId: 'release-1',
      projectEnvironmentId: 'penv-qa',
      idempotencyKey: 'promote-1',
      actor: 'agent-a',
    });

    expect(result.status).toBe('succeeded');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://host.docker.internal:32123/smoke',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('rechecks health and Smoke Test after the configured soak window', async () => {
    const harness = createHarness({
      priorSucceeded: true,
      smokePath: '/smoke',
      soakSeconds: 5,
    });

    const result = await harness.service.execute({
      id: 'promotion-1',
      releaseId: 'release-1',
      projectEnvironmentId: 'penv-qa',
      idempotencyKey: 'promote-1',
      actor: 'agent-a',
    });

    expect(result.status).toBe('succeeded');
    expect(harness.waitForSoak).toHaveBeenCalledWith(5_000);
    expect(harness.docker.waitForHealthy).toHaveBeenCalledTimes(2);
    expect(harness.smokeProbe).toHaveBeenCalledTimes(2);
    expect(harness.db.finalizeReleasePromotion).toHaveBeenCalledWith(
      expect.objectContaining({ soakStatus: 'passed' }),
    );
  });
});
