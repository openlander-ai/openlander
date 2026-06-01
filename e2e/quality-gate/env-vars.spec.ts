import { expect, test } from '@playwright/test';

import {
  createGitProject,
  deleteProject,
  deployGitProject,
  getProject,
  resolveServiceAccessibleUrl,
  waitForServiceStatus,
} from './fixtures/api.js';

const R7_REPO_URL = 'https://github.com/openlander-ai/test-env-required';
const SCENARIO_TIMEOUT_MS = 300_000;
const STATUS_POLL_INTERVAL_MS = 1_500;

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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForErrorOrStopped(
  projectId: string,
  timeoutMs: number,
): Promise<{ status: string; [key: string]: unknown }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const project = (await getProject(projectId)) as { status: string; [key: string]: unknown };
    if (project.status === 'error' || project.status === 'stopped') {
      return project;
    }

    await sleep(STATUS_POLL_INTERVAL_MS);
  }

  const latestProject = (await getProject(projectId)) as { status: string; [key: string]: unknown };
  if (latestProject.status === 'error' || latestProject.status === 'stopped') {
    return latestProject;
  }
  throw new Error(
    `Timed out waiting for error/stopped after ${String(timeoutMs)}ms. Current status: ${latestProject.status}`,
  );
}

test.describe.configure({ mode: 'serial' });

test.describe('Quality Gate — Env Vars Injection (R7)', () => {
  let projectId: string | null = null;

  test.afterAll(async () => {
    if (!projectId) {
      return;
    }

    try {
      await deleteProject(projectId);
    } catch (error) {
      console.warn(`Failed to delete project ${projectId}:`, error);
    }
  });

  test('Scenario A: R7 deploy without DATABASE_URL ends in error/stopped', async () => {
    test.setTimeout(SCENARIO_TIMEOUT_MS);

    const deploy = await deployGitProject(R7_REPO_URL, 'main', undefined, {
      allowFailure: true,
    });
    expect(deploy.success).toBe(false);

    projectId = deploy.projectId;
    expect(projectId).toBeTruthy();

    const failedProject = await waitForErrorOrStopped(projectId, SCENARIO_TIMEOUT_MS);
    expect(['error', 'stopped']).toContain(failedProject.status);
  });

  test('Scenario B: deploy with DATABASE_URL reaches running', async () => {
    test.setTimeout(SCENARIO_TIMEOUT_MS);

    const project = await createGitProject(R7_REPO_URL, {
      name: `test-env-required-${Date.now().toString(36)}`,
      envVars: {
        DATABASE_URL: 'postgres://test:test@localhost/test',
      },
    });
    projectId = project.projectId;

    const runningService = await waitForServiceStatus(projectId, 'running', 120_000);
    expect(runningService.status).toBe('running');

    const accessibleUrl = await resolveServiceAccessibleUrl(projectId);
    const response = await fetchWithRetry(accessibleUrl);
    expect(response.ok).toBe(true);
  });
});
