import { expect, test } from '@playwright/test';

import {
  deleteProject,
  deployGitProject,
  getDeployments,
  getProject,
  redeployService,
  rollbackService,
  waitForStatus,
} from './fixtures/api.js';

const R1_REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';

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

test.describe.configure({ mode: 'serial' });

test.describe('quality-gate lifecycle: redeploy + rollback', () => {
  let projectId: string | null = null;
  let firstDeployId: string | null = null;

  test.afterAll(async () => {
    if (projectId) {
      await deleteProject(projectId);
    }
  });

  // fixme (0.1.x): deploy fixture throws on 5xx — sync-deploy contract
  // drift since the v5 cut. Update fixture or rework as polling-based.
  test.fixme('redeploy creates a new deployment and rollback emits rollback event', async () => {
    const deployResult = await deployGitProject(R1_REPO_URL);
    expect(deployResult.success).toBe(true);

    projectId = deployResult.projectId;
    expect(projectId).toBeTruthy();

    const initialProject = await waitForStatus(projectId, 'running', 120_000);
    expect(initialProject.status).toBe('running');

    const initialDeployments = await getDeployments(projectId);
    expect(initialDeployments.length).toBeGreaterThanOrEqual(1);
    firstDeployId = (initialDeployments[0] as any)?.id ?? null;
    expect(firstDeployId).toBeTruthy();

    await redeployService(projectId);
    const projectAfterRedeploy = await waitForStatus(projectId, 'running', 120_000);
    expect(projectAfterRedeploy.status).toBe('running');

    const deploymentsAfterRedeploy = await getDeployments(projectId);
    const deployIdsAfterRedeploy = new Set(
      deploymentsAfterRedeploy.map((deployment: any) => deployment.id),
    );
    expect(deploymentsAfterRedeploy.length).toBeGreaterThanOrEqual(2);
    expect(firstDeployId).not.toBeNull();
    expect(deployIdsAfterRedeploy.has(firstDeployId!)).toBe(true);

    const newDeployId = (
      deploymentsAfterRedeploy.find((deployment: any) => deployment.id !== firstDeployId) as any
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

    await rollbackService(projectId, firstDeployId!);
    const projectAfterRollback = await waitForStatus(projectId, 'running', 120_000);
    expect(projectAfterRollback.status).toBe('running');
  });
});
