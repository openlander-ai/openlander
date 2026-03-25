import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import {
  blueGreenDeploy,
  deleteProject,
  deployGitProject,
  getProject,
  waitForStatus,
} from './fixtures/api.js';

const R1_REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';
const SCENARIO_TIMEOUT_MS = 150_000;
const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

function assertOkResponse(url: string, retries = 5, delayMs = 2000): void {
  for (let i = 0; i < retries; i++) {
    try {
      const body = execFileSync('curl', ['-fsSL', url], { encoding: 'utf8', timeout: 5000 });
      expect(body).toContain('OK');
      return;
    } catch {
      if (i === retries - 1) throw new Error(`curl ${url} failed after ${retries} retries`);
      execFileSync('sleep', [String(delayMs / 1000)]);
    }
  }
}

function resolveAccessibleUrl(project: { assigned_port?: unknown }): string {
  if (typeof project.assigned_port === 'number' && project.assigned_port > 0) {
    return `http://localhost:${String(project.assigned_port)}`;
  }

  throw new Error('Project has no accessible assigned_port');
}

async function waitForContainerSwitch(
  projectId: string,
  previousContainerId: string,
  timeoutMs: number,
): Promise<{ container_id: string }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const latest = await getProject(projectId);

    if (
      latest.status === 'running' &&
      typeof latest.container_id === 'string' &&
      latest.container_id.length > 0 &&
      latest.container_id !== previousContainerId
    ) {
      return latest as { container_id: string };
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const current = await getProject(projectId);
  throw new Error(
    `Timed out waiting for container switch. Previous=${previousContainerId}, current=${String(current.container_id)}`,
  );
}

if (!isBunRuntime) {
  test.describe.configure({ mode: 'serial' });

  test.describe('quality-gate lifecycle: blue-green deploy', () => {
    let projectId: string | null = null;

    test.afterAll(async () => {
      if (projectId) {
        await deleteProject(projectId);
      }
    });

    test('blue-green deploy swaps container without downtime', async () => {
      test.setTimeout(240_000);

      const deploy = await deployGitProject(R1_REPO_URL);
      expect(deploy.success).toBe(true);
      expect(deploy.projectId).toBeTruthy();

      projectId = deploy.projectId;

      const runningBefore = await waitForStatus(projectId, 'running', SCENARIO_TIMEOUT_MS);
      expect(typeof runningBefore.container_id).toBe('string');
      expect((runningBefore.container_id as string).length).toBeGreaterThan(0);

      const originalContainerId = runningBefore.container_id as string;
      const beforeUrl = resolveAccessibleUrl(runningBefore);
      assertOkResponse(beforeUrl);

      await blueGreenDeploy(projectId, '/');
      await waitForStatus(projectId, 'running', SCENARIO_TIMEOUT_MS);

      const runningAfterSwitch = await waitForContainerSwitch(
        projectId,
        originalContainerId,
        SCENARIO_TIMEOUT_MS,
      );

      expect(runningAfterSwitch.container_id).not.toBe(originalContainerId);

      const latestProject = await getProject(projectId);
      const afterUrl = resolveAccessibleUrl(latestProject);
      assertOkResponse(afterUrl);
    });
  });
}
