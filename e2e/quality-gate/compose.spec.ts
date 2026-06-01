import { execSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import {
  deleteProject,
  deployGitProject,
  getProject,
  resolveProjectAccessibleUrl,
  waitForStatus,
} from './fixtures/api.js';

const R3_REPO_URL = 'https://github.com/openlander-ai/test-compose-multi';
const SCENARIO_TIMEOUT_MS = 300_000;

async function fetchWithRetry(url: string, retries = 5, delayMs = 2000): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      // noop
    }
    if (i < retries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Fetch failed after ${retries} retries: ${url}`);
}

test.describe.configure({ mode: 'serial' });

test.describe('Quality Gate — Compose multi-service deploy', () => {
  test.skip(
    process.env.OPENLANDER_E2E_SLOW !== '1',
    'Compose quality gate is slow; set OPENLANDER_E2E_SLOW=1 to run it.',
  );

  let projectId: string | null = null;

  test.beforeAll(() => {
    try {
      const ids = execSync('docker ps -a --filter name=ol-test-compose -q', {
        encoding: 'utf-8',
      })
        .trim()
        .split('\n')
        .filter(Boolean);
      for (const id of ids) {
        execSync(`docker rm -f ${id}`, { stdio: 'pipe' });
      }
    } catch {
      // noop
    }

    execSync(
      'test -d /tmp/e2e-compose-cache || git clone --depth=1 https://github.com/openlander-ai/test-compose-multi /tmp/e2e-compose-cache; docker build -t ol-test-compose-multi-web:latest /tmp/e2e-compose-cache',
      { stdio: 'pipe', timeout: 120_000 },
    );
  });

  test.afterAll(async () => {
    if (projectId) {
      try {
        await deleteProject(projectId);
      } catch (error) {
        console.warn(`Failed to delete project ${projectId}:`, error);
      }
    }
  });

  test('deploys compose repo and serves /count endpoint', async () => {
    test.setTimeout(SCENARIO_TIMEOUT_MS);

    const deploy = await deployGitProject(R3_REPO_URL);
    expect(deploy.success).toBe(true);
    expect(deploy.projectId).toBeTruthy();
    projectId = deploy.projectId;

    const runningProject = await waitForStatus(projectId, 'running', SCENARIO_TIMEOUT_MS);
    expect(runningProject.status).toBe('running');

    const latestProject = await getProject(projectId);
    const countUrl = new URL(resolveProjectAccessibleUrl(latestProject));
    countUrl.pathname = '/count';

    const countResponse = await fetchWithRetry(countUrl.toString());
    expect(countResponse.ok).toBe(true);

    const countPayload = (await countResponse.json()) as { count?: unknown };
    expect(typeof countPayload.count).toBe('number');
  });
});
