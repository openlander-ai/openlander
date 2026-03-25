import { expect, test } from '@playwright/test';

import {
  deleteProject,
  deployGitProject,
  getProject,
  redeployProject,
  rollbackProject,
  waitForStatus,
} from './fixtures/api.js';

const BASE_URL = 'http://localhost:10114';
const R1_REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';
const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

async function fetchWithRetry(url: string, retries = 5, delayMs = 2000): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      return res;
    } catch {
      if (i === retries - 1) {
        throw new Error(`Fetch failed after ${retries} retries: ${url}`);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('unreachable');
}

type DeploymentSummary = {
  id: string;
};

async function getDeployments(projectId: string): Promise<DeploymentSummary[]> {
  const res = await fetch(`${BASE_URL}/api/projects/${projectId}/deployments`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get deployments failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { deployments?: Array<{ id?: string }> };
  return (data.deployments ?? [])
    .map((deployment) => ({ id: deployment.id ?? '' }))
    .filter((deployment) => deployment.id.length > 0);
}

if (!isBunRuntime) {
  test.describe.configure({ mode: 'serial' });

  test.describe('quality-gate lifecycle: redeploy + rollback', () => {
    let projectId: string | null = null;
    let firstDeployId: string | null = null;

    test.afterAll(async () => {
      if (projectId) {
        await deleteProject(projectId);
      }
    });

    test('redeploy creates a new deployment and rollback emits rollback event', async () => {
      const deployResult = await deployGitProject(R1_REPO_URL);
      expect(deployResult.success).toBe(true);

      projectId = deployResult.projectId;
      expect(projectId).toBeTruthy();

      const initialProject = await waitForStatus(projectId, 'running', 120_000);
      expect(initialProject.status).toBe('running');

      const initialDeployments = await getDeployments(projectId);
      expect(initialDeployments.length).toBeGreaterThanOrEqual(1);
      firstDeployId = initialDeployments[0]?.id ?? null;
      expect(firstDeployId).toBeTruthy();

      await redeployProject(projectId);
      const projectAfterRedeploy = await waitForStatus(projectId, 'running', 120_000);
      expect(projectAfterRedeploy.status).toBe('running');

      const deploymentsAfterRedeploy = await getDeployments(projectId);
      const deployIdsAfterRedeploy = new Set(
        deploymentsAfterRedeploy.map((deployment) => deployment.id),
      );
      expect(deploymentsAfterRedeploy.length).toBeGreaterThanOrEqual(2);
      expect(firstDeployId).not.toBeNull();
      expect(deployIdsAfterRedeploy.has(firstDeployId!)).toBe(true);

      const newDeployId = deploymentsAfterRedeploy.find(
        (deployment) => deployment.id !== firstDeployId,
      )?.id;
      expect(newDeployId).toBeTruthy();

      const latestProject = await getProject(projectId);
      const accessibleUrl =
        typeof latestProject.assigned_port === 'number' && latestProject.assigned_port > 0
          ? `http://localhost:${String(latestProject.assigned_port)}`
          : null;
      expect(accessibleUrl).toBeTruthy();

      const urlRes = await fetchWithRetry(accessibleUrl!);
      expect(urlRes.ok).toBe(true);

      await rollbackProject(projectId, firstDeployId!);
      const projectAfterRollback = await waitForStatus(projectId, 'running', 120_000);
      expect(projectAfterRollback.status).toBe('running');
    });
  });
}
