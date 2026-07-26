import { expect, test } from '@playwright/test';

import { deleteProject, mcpCall, uniqueProjectName } from './fixtures/api.js';
import { authHeaders, OPENLANDER_URL } from './fixtures/config.js';

const REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';

type McpToolCallEnvelope = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

function parseToolCallResult<T>(envelope: McpToolCallEnvelope): T {
  if (envelope.isError === true) {
    const text = envelope.content?.find((item) => item.type === 'text')?.text;
    throw new Error(`MCP tool returned error: ${text ?? JSON.stringify(envelope)}`);
  }
  const text = envelope.content?.find((item) => item.type === 'text')?.text;
  expect(typeof text).toBe('string');
  return JSON.parse(text as string) as T;
}

async function callTool<T>(
  name: 'openlander_deploy' | 'openlander_project',
  action: string,
  params: Record<string, unknown>,
): Promise<T> {
  return parseToolCallResult<T>(
    (await mcpCall('tools/call', {
      name,
      arguments: { action, params },
    })) as McpToolCallEnvelope,
  );
}

async function waitForPromotion(promotionId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const evaluated = await callTool<{
      promotion: Record<string, unknown>;
    }>('openlander_deploy', 'evaluate_promotion', { promotion_id: promotionId });
    const status = evaluated.promotion['status'];
    if (status === 'succeeded') return evaluated.promotion;
    if (status === 'failed') {
      throw new Error(`Promotion failed: ${JSON.stringify(evaluated.promotion)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Promotion ${promotionId} did not finish in time.`);
}

async function listDeliveries(projectId: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${OPENLANDER_URL}/api/projects/${projectId}/deliveries`, {
    headers: authHeaders(),
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  const payload = JSON.parse(body) as { deliveries?: Array<Record<string, unknown>> };
  return payload.deliveries ?? [];
}

async function getDeliveryExecution(
  projectId: string,
  deliveryId: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${OPENLANDER_URL}/api/projects/${projectId}/deliveries/${deliveryId}/execution`,
    { headers: authHeaders() },
  );
  const body = await response.text();
  expect(response.status, body).toBe(200);
  return JSON.parse(body) as Record<string, unknown>;
}

async function waitForNextImplicitRelease(input: {
  projectId: string;
  previousDeliveryId: string;
}): Promise<{
  deliveryId: string;
  releaseId: string;
  digest: string;
}> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const deliveries = await listDeliveries(input.projectId);
    const candidate = deliveries.find(
      (delivery) =>
        delivery['id'] !== input.previousDeliveryId &&
        typeof delivery['id'] === 'string' &&
        String(delivery['id']).startsWith('delivery_implicit_'),
    );
    if (candidate && typeof candidate['id'] === 'string') {
      const execution = await getDeliveryExecution(input.projectId, candidate['id']);
      const releases = execution['releases'];
      const artifacts = execution['release_artifacts'];
      if (Array.isArray(releases) && Array.isArray(artifacts)) {
        const release = releases.find(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            (entry as Record<string, unknown>)['status'] === 'ready',
        ) as Record<string, unknown> | undefined;
        const artifact = artifacts[0] as Record<string, unknown> | undefined;
        if (typeof release?.['id'] === 'string' && typeof artifact?.['image_digest'] === 'string') {
          return {
            deliveryId: candidate['id'],
            releaseId: release['id'],
            digest: artifact['image_digest'],
          };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('The updated deploy was not adopted as a second implicit Release in time.');
}

async function promoteThrough(
  releaseId: string,
  environments: Array<{ environment_id: string; key: string }>,
  keyPrefix: string,
): Promise<Array<Record<string, unknown>>> {
  const promotions: Array<Record<string, unknown>> = [];
  for (const environment of environments) {
    const started = await callTool<{
      status: string;
      promotion_id: string;
    }>('openlander_deploy', 'promote_release', {
      idempotency_key: `${keyPrefix}-${environment.key}`,
      release_id: releaseId,
      project_environment_id: environment.environment_id,
    });
    expect(started.status).toBe('deploying');
    promotions.push(await waitForPromotion(started.promotion_id));
  }
  return promotions;
}

async function expectEnvironmentDigests(
  projectId: string,
  environmentIds: string[],
  digest: string,
): Promise<void> {
  const response = await fetch(`${OPENLANDER_URL}/api/projects/${projectId}/environments`, {
    headers: authHeaders(),
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  const payload = JSON.parse(body) as {
    environments?: Array<Record<string, unknown>>;
  };
  const promoted = (payload.environments ?? []).filter((environment) =>
    environmentIds.includes(String(environment['project_environment_id'])),
  );
  expect(promoted).toHaveLength(environmentIds.length);
  expect(promoted.map((environment) => environment['image_tag'])).toEqual(
    environmentIds.map(() => digest),
  );
}

test('deploy_app promotes one exact digest through every Environment and rolls back', async () => {
  test.setTimeout(420_000);
  let projectId: string | undefined;

  try {
    await mcpCall('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'implicit-release-quality-gate', version: '1.0.0' },
    });
    const envelope = (await mcpCall('tools/call', {
      name: 'openlander_deploy',
      arguments: {
        action: 'deploy_app',
        params: {
          repo_url: REPO_URL,
          branch: 'main',
          name: uniqueProjectName('deploy-app-release'),
          wait: true,
          wait_healthy: false,
          timeout: 180,
        },
      },
    })) as McpToolCallEnvelope;
    const deployed = parseToolCallResult<{
      status: string;
      project_id: string;
      implicit_release?: {
        status: string;
        delivery_id: string;
        run_id: string;
        release_id: string;
        image_digests: Record<string, string>;
      };
      warnings?: string[];
    }>(envelope);
    projectId = deployed.project_id;

    expect(deployed.status).toBe('done');
    expect(deployed.warnings ?? []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('implicit Release adoption failed')]),
    );
    expect(deployed.implicit_release).toMatchObject({ status: 'ready' });
    expect(Object.values(deployed.implicit_release?.image_digests ?? {})).toEqual([
      expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    ]);

    const releaseEnvelope = (await mcpCall('tools/call', {
      name: 'openlander_deploy',
      arguments: {
        action: 'get_release',
        params: { release_id: deployed.implicit_release?.release_id },
      },
    })) as McpToolCallEnvelope;
    const release = parseToolCallResult<{
      release: { status: string };
      artifacts: Array<{
        service_id: string;
        image_reference: string;
        image_digest: string;
        build_provenance: { rebuilt?: boolean; source?: string };
      }>;
    }>(releaseEnvelope);

    expect(release.release.status).toBe('ready');
    expect(release.artifacts).toHaveLength(1);
    expect(release.artifacts[0]?.image_reference).toBe(release.artifacts[0]?.image_digest);
    expect(release.artifacts[0]?.build_provenance).toMatchObject({
      source: 'deploy_app_compatibility',
      rebuilt: false,
    });

    const releaseId = deployed.implicit_release?.release_id;
    const deliveryId = deployed.implicit_release?.delivery_id;
    const serviceId = release.artifacts[0]?.service_id;
    const firstDigest = release.artifacts[0]?.image_digest;
    expect(typeof releaseId).toBe('string');
    expect(typeof deliveryId).toBe('string');
    expect(typeof serviceId).toBe('string');
    expect(firstDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

    const manifest = await callTool<{
      status: string;
      environments: Array<{ environment_id: string; key: string }>;
    }>('openlander_project', 'apply_project_manifest', {
      idempotency_key: `${projectId}-promotion-manifest`,
      project_id: projectId,
      manifest_path: '.openlander/project.yml',
      manifest_sha256: '4'.repeat(64),
      environments: [
        {
          key: 'dev',
          display_name: 'Development',
          tier: 'development',
          promotion_order: 0,
          health_timeout_seconds: 30,
          smoke_path: null,
          soak_seconds: 0,
        },
        {
          key: 'qa',
          display_name: 'QA',
          tier: 'validation',
          promotion_order: 1,
          health_timeout_seconds: 30,
          smoke_path: null,
          soak_seconds: 0,
        },
        {
          key: 'customer-validation',
          display_name: 'Customer Validation',
          tier: 'validation',
          promotion_order: 2,
          health_timeout_seconds: 30,
          smoke_path: null,
          soak_seconds: 0,
        },
        {
          key: 'production',
          display_name: 'Production',
          tier: 'production',
          promotion_order: 3,
          health_timeout_seconds: 30,
          smoke_path: null,
          soak_seconds: 0,
        },
      ],
    });
    expect(manifest.status).toBe('applied');
    expect(manifest.environments.map((environment) => environment.key)).toEqual([
      'dev',
      'qa',
      'customer-validation',
      'production',
    ]);

    const firstPromotions = await promoteThrough(
      releaseId as string,
      manifest.environments,
      `${projectId}-release-one`,
    );
    expect(firstPromotions).toHaveLength(4);
    expect(firstPromotions.map((promotion) => promotion['status'])).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    await expectEnvironmentDigests(
      projectId,
      manifest.environments.map((environment) => environment.environment_id),
      firstDigest as string,
    );

    const update = await callTool<{ status: string }>('openlander_deploy', 'deploy_app', {
      service_id: serviceId,
      strategy: 'force',
    });
    expect(update.status).toBe('deploying');
    const second = await waitForNextImplicitRelease({
      projectId,
      previousDeliveryId: deliveryId as string,
    });
    expect(second.releaseId).not.toBe(releaseId);

    await promoteThrough(second.releaseId, manifest.environments, `${projectId}-release-two`);
    await expectEnvironmentDigests(
      projectId,
      manifest.environments.map((environment) => environment.environment_id),
      second.digest,
    );

    const production = manifest.environments.find(
      (environment) => environment.key === 'production',
    );
    expect(production).toBeDefined();
    const rolledBack = await callTool<{
      status: string;
      result: Record<string, unknown>;
    }>('openlander_deploy', 'rollback_environment', {
      idempotency_key: `${projectId}-rollback-production`,
      project_environment_id: production?.environment_id,
    });
    expect(rolledBack).toMatchObject({
      status: 'rolled_back',
      result: { release_id: releaseId, status: 'succeeded' },
    });

    const recalled = await callTool<{ status: string; release_id: string }>(
      'openlander_deploy',
      'recall_release',
      {
        idempotency_key: `${projectId}-recall-release-two`,
        release_id: second.releaseId,
      },
    );
    expect(recalled).toMatchObject({
      status: 'recalled',
      release_id: second.releaseId,
      operation_id: expect.any(String),
      operation_version: 1,
      replayed: false,
    });
  } finally {
    if (projectId) {
      await deleteProject(projectId);
    }
  }
});
