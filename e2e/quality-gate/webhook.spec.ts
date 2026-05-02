import { expect, test } from '@playwright/test';

import {
  configureWebhook,
  deleteProject,
  deployGitProject,
  getDeployments,
  postWebhook,
  waitForStatus,
} from './fixtures/api.js';

const R1_REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';
const WEBHOOK_REPO_CLONE_URL = 'https://github.com/openlander-ai/test-single-dockerfile.git';
const SCENARIO_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1_000;

type DeploymentSummary = {
  id: string;
  status: string;
  trigger: string;
};

async function waitForWebhookDeployment(
  projectId: string,
  minimumDeploymentCount: number,
  timeoutMs: number,
): Promise<DeploymentSummary> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const deployments = await getDeployments(projectId);
    const webhookDeployment = deployments.find(
      (deployment: any) => deployment.trigger === 'webhook' && deployment.status === 'success',
    ) as DeploymentSummary | undefined;

    if (deployments.length >= minimumDeploymentCount && webhookDeployment) {
      return webhookDeployment;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const lastDeployments = await getDeployments(projectId);
  throw new Error(
    `Timed out waiting for webhook deployment. count=${String(lastDeployments.length)}, triggers=${lastDeployments
      .map((deployment: any) => deployment.trigger)
      .join(',')}`,
  );
}

test.describe.configure({ mode: 'serial' });

test.describe('quality-gate webhook: signed push auto-redeploy', () => {
  let projectId: string | null = null;

  test.afterAll(async () => {
    if (projectId) {
      await deleteProject(projectId);
    }
  });

  // fixme (0.1.x): webhook test reuses test-single-dockerfile from prior
  // specs; PROJECT_ALREADY_EXISTS without per-spec cleanup. Add teardown
  // before re-enabling.
  test.fixme('signed github webhook triggers redeploy with webhook trigger', async () => {
    test.setTimeout(SCENARIO_TIMEOUT_MS);

    const deployResult = await deployGitProject(R1_REPO_URL);
    expect(deployResult.success).toBe(true);
    expect(deployResult.projectId).toBeTruthy();
    projectId = deployResult.projectId;

    const firstRunning = await waitForStatus(projectId, 'running', SCENARIO_TIMEOUT_MS);
    expect(firstRunning.status).toBe('running');

    const deploymentsBeforeWebhook = await getDeployments(projectId);
    expect(deploymentsBeforeWebhook.length).toBeGreaterThanOrEqual(1);

    const webhook = await configureWebhook(projectId);
    expect(webhook.secret.length).toBeGreaterThan(0);

    const payload = {
      ref: 'refs/heads/main',
      repository: {
        full_name: 'openlander-ai/test-single-dockerfile',
        clone_url: WEBHOOK_REPO_CLONE_URL,
      },
      head_commit: {
        id: 'abc123',
        message: 'test push',
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const inputUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (inputUrl.includes(`/api/webhooks/${projectId}/github`) && init) {
        const headers = new Headers(init.headers);
        headers.set('x-github-event', 'push');
        return originalFetch(input, { ...init, headers });
      }

      return originalFetch(input, init);
    };

    try {
      const webhookResult = (await postWebhook(projectId, payload, webhook.secret)) as {
        accepted?: boolean;
        projectId?: string;
      };
      expect(webhookResult.accepted).toBe(true);
      expect(webhookResult.projectId).toBe(projectId);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const webhookDeployment = await waitForWebhookDeployment(
      projectId,
      deploymentsBeforeWebhook.length + 1,
      SCENARIO_TIMEOUT_MS,
    );
    expect(webhookDeployment.trigger).toBe('webhook');

    const projectAfterWebhook = await waitForStatus(projectId, 'running', SCENARIO_TIMEOUT_MS);
    expect(projectAfterWebhook.status).toBe('running');
  });
});
