import { expect, test } from '@playwright/test';

import { deleteProject, deployImageProject, waitForStatus } from './fixtures/api.js';

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

test.describe('Quality Gate — Docker Image Deploy', () => {
  let projectId: string | null = null;

  test.afterAll(async () => {
    if (!projectId) return;
    await deleteProject(projectId);
  });

  test('deploys nginx image via API without clone/build stages', async () => {
    const deploy = await deployImageProject('nginx:alpine', 80, 'test-image-deploy');

    expect(deploy.success).toBe(true);
    expect(deploy.projectId.length).toBeGreaterThan(0);
    projectId = deploy.projectId;

    const project = await waitForStatus(projectId, 'running', 120_000);
    expect(project.status).toBe('running');

    const port = project.assigned_port ?? project.port;
    if (typeof port !== 'number') {
      throw new Error(`Expected numeric project port, got: ${String(port)}`);
    }

    const nginxResponse = await fetchWithRetry(`http://localhost:${String(port)}/`);
    const nginxBody = await nginxResponse.text();

    expect(nginxBody.includes('Welcome to nginx') || nginxResponse.status === 200).toBe(true);
  });
});
