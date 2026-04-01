import { test, expect } from '@playwright/test';

import {
  deleteProject,
  deployGitProject,
  getOpsIncidents,
  getProject,
  waitForStatus,
} from './fixtures/api.js';

const SCENARIO_TIMEOUT_MS = 180_000;
const PROJECT_STATUS_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProjectStatus(
  projectId: string,
  statuses: readonly string[],
  timeoutMs: number,
): Promise<{ status: string; [key: string]: unknown }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const project = (await getProject(projectId)) as { status: string; [key: string]: unknown };
    if (statuses.includes(project.status)) {
      return project;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  const lastProject = (await getProject(projectId)) as { status: string; [key: string]: unknown };
  throw new Error(
    `Timed out waiting for project status [${statuses.join(', ')}] after ${String(timeoutMs)}ms. Current: ${lastProject.status}`,
  );
}

test.describe.configure({ mode: 'serial' });

test.describe('Quality Gate Recovery (R5/R6)', () => {
  const createdProjectIds: string[] = [];

  test.afterAll(async () => {
    const uniqueProjectIds = Array.from(new Set(createdProjectIds));
    for (const projectId of uniqueProjectIds) {
      try {
        await deleteProject(projectId);
      } catch (error) {
        console.warn(`Failed to delete project ${projectId}:`, error);
      }
    }
  });

  test('Scenario A: R5 build fail reaches error/stopped status', async () => {
    test.setTimeout(SCENARIO_TIMEOUT_MS);

    const deploy = await deployGitProject('https://github.com/openlander-ai/test-build-fail');
    expect(deploy.success).toBe(true);
    expect(deploy.projectId).toBeTruthy();
    createdProjectIds.push(deploy.projectId);

    const project = await waitForProjectStatus(
      deploy.projectId,
      ['error', 'stopped'],
      PROJECT_STATUS_TIMEOUT_MS,
    );
    expect(['error', 'stopped']).toContain(project.status);
  });

  test('Scenario B: R6 runtime crash detected after successful deploy', async () => {
    test.setTimeout(SCENARIO_TIMEOUT_MS);

    const deploy = await deployGitProject('https://github.com/openlander-ai/test-runtime-crash');
    expect(deploy.success).toBe(true);
    expect(deploy.projectId).toBeTruthy();
    createdProjectIds.push(deploy.projectId);

    await waitForStatus(deploy.projectId, 'running', SCENARIO_TIMEOUT_MS);

    const crashedProject = await waitForProjectStatus(
      deploy.projectId,
      ['error', 'stopped'],
      PROJECT_STATUS_TIMEOUT_MS,
    );
    expect(['error', 'stopped']).toContain(crashedProject.status);

    await sleep(8000);
    const incidents = await getOpsIncidents(deploy.projectId);
    expect(incidents.incidents.length).toBeGreaterThanOrEqual(1);
    const incident = incidents.incidents[0] as Record<string, unknown>;
    expect(incident['project_id']).toBe(deploy.projectId);
  });
});
