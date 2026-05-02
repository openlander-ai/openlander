import { expect, test } from '@playwright/test';

import {
  deleteProject,
  deployGitProject,
  getProject,
  redeployProject,
  setEnvVars,
  waitForStatus,
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

async function resolveAccessibleUrl(projectId: string): Promise<string> {
  const project = (await getProject(projectId)) as {
    url?: unknown;
    assigned_port?: unknown;
    port?: unknown;
  };

  if (typeof project.assigned_port === 'number' && project.assigned_port > 0) {
    return `http://localhost:${String(project.assigned_port)}`;
  }

  if (typeof project.port === 'number' && (project.port as number) > 0) {
    return `http://localhost:${String(project.port)}`;
  }

  if (typeof project.url === 'string' && project.url.length > 0) {
    return project.url;
  }

  throw new Error('Unable to resolve accessible URL from project response');
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

  // fixme (0.1.x): missing-env deploy now returns sync 5xx; fixture throws
  // before the test can poll. Refresh fixture to handle structured errors.
  test.fixme('Scenario A: R7 deploy without DATABASE_URL ends in error/stopped', async () => {
    test.setTimeout(SCENARIO_TIMEOUT_MS);

    const deploy = await deployGitProject(R7_REPO_URL);
    expect(deploy.success).toBe(true);
    expect(deploy.projectId).toBeTruthy();

    projectId = deploy.projectId;

    const failedProject = await waitForErrorOrStopped(projectId, SCENARIO_TIMEOUT_MS);
    expect(['error', 'stopped']).toContain(failedProject.status);
  });

  test('Scenario B: set DATABASE_URL then redeploy reaches running', async () => {
    test.setTimeout(SCENARIO_TIMEOUT_MS);

    if (!projectId) {
      throw new Error('projectId missing from Scenario A deploy');
    }

    await setEnvVars(projectId, {
      DATABASE_URL: 'postgres://test:test@localhost/test',
    });

    await redeployProject(projectId);

    const runningProject = await waitForStatus(projectId, 'running', 120_000);
    expect(runningProject.status).toBe('running');

    const accessibleUrl = await resolveAccessibleUrl(projectId);
    const response = await fetchWithRetry(accessibleUrl);
    expect(response.ok).toBe(true);
  });
});
