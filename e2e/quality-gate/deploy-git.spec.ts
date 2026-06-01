import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import { deleteProject, deployGitProject, getProject, waitForStatus } from './fixtures/api.js';

const R1_REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';
const R2_REPO_URL = 'https://github.com/openlander-ai/test-no-dockerfile';
const SCENARIO_TIMEOUT_MS = 120_000;

function assertLocalOkResponse(port: number, retries = 5, delayMs = 2000): void {
  for (let i = 0; i < retries; i++) {
    try {
      const body = execFileSync('curl', ['-fsSL', `http://localhost:${String(port)}/`], {
        encoding: 'utf8',
        timeout: 5000,
      });
      expect(body).toContain('OK');
      return;
    } catch {
      if (i === retries - 1)
        throw new Error(`curl localhost:${port} failed after ${retries} retries`);
      execFileSync('sleep', [String(delayMs / 1000)]);
    }
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('Quality Gate — Git Deploy via Web/API', () => {
  const createdProjectIds = new Set<string>();

  test.afterAll(async () => {
    for (const projectId of createdProjectIds) {
      try {
        await deleteProject(projectId);
      } catch (error) {
        console.warn(`Failed to delete project ${projectId}:`, error);
      }
    }
  });

  test('Scenario A: R1 deploy via API reaches running and serves OK', async () => {
    test.setTimeout(180_000);

    const deploy = await deployGitProject(R1_REPO_URL);
    expect(deploy.success).toBe(true);
    expect(deploy.projectId).toBeTruthy();
    createdProjectIds.add(deploy.projectId);

    const project = await waitForStatus(deploy.projectId, 'running', SCENARIO_TIMEOUT_MS);
    expect(project.status).toBe('running');
    expect(typeof project.assigned_port).toBe('number');
    expect((project.assigned_port as number) > 0).toBe(true);
    expect(project.container_id).not.toBeNull();

    assertLocalOkResponse(project.assigned_port as number);
  });

  test('Scenario B: R2 deploy via API auto-detects and reaches running', async () => {
    test.setTimeout(180_000);

    const deploy = await deployGitProject(R2_REPO_URL);
    expect(deploy.success).toBe(true);
    expect(deploy.projectId).toBeTruthy();
    createdProjectIds.add(deploy.projectId);

    const project = await waitForStatus(deploy.projectId, 'running', SCENARIO_TIMEOUT_MS);
    expect(project.status).toBe('running');

    const latestProject = await getProject(deploy.projectId);
    expect(latestProject.status).toBe('running');
  });
});
