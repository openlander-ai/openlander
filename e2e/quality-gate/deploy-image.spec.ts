import { expect, test } from '@playwright/test';

import { deleteProject, deployImageProject, waitForStatus } from './fixtures/api.js';
import { assertEventSequence, consumeDeployStream } from './fixtures/stream-consumer.js';

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

    const stream = consumeDeployStream(projectId);

    try {
      await stream.waitForEvent('status:Preparing', 120_000);
      await stream.waitForEvent('status:Start', 120_000);
      await stream.waitForEvent('complete', 120_000);

      const project = await waitForStatus(projectId, 'running', 120_000);
      expect(project.status).toBe('running');

      if (typeof project.port !== 'number') {
        throw new Error(`Expected numeric project.port, got: ${String(project.port)}`);
      }

      const nginxResponse = await fetch(`http://localhost:${String(project.port)}/`);
      const nginxBody = await nginxResponse.text();

      expect(nginxBody.includes('Welcome to nginx') || nginxResponse.status === 200).toBe(true);

      // Assert NO clone/build: image deploy skips these stages
      expect(stream.events.filter((e) => e.stepName === 'Clone')).toHaveLength(0);
      expect(stream.events.filter((e) => e.stepName === 'Build')).toHaveLength(0);

      assertEventSequence(stream.events, ['status:Preparing', 'status:Start', 'complete']);
    } finally {
      stream.close();
    }
  });
});
