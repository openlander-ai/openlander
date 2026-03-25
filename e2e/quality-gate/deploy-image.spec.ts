import { expect, test } from '@playwright/test';

import { deleteProject, deployImageProject, waitForStatus } from './fixtures/api.js';
import { DEPLOY_EVENTS } from './fixtures/event-types.js';
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
      await stream.waitForEvent(DEPLOY_EVENTS.START, 120_000);
      await stream.waitForEvent(DEPLOY_EVENTS.RUN, 120_000);
      await stream.waitForEvent(DEPLOY_EVENTS.SUCCESS, 120_000);

      const project = await waitForStatus(projectId, 'running', 120_000);
      expect(project.status).toBe('running');

      if (typeof project.port !== 'number') {
        throw new Error(`Expected numeric project.port, got: ${String(project.port)}`);
      }

      const nginxResponse = await fetch(`http://localhost:${String(project.port)}/`);
      const nginxBody = await nginxResponse.text();

      expect(nginxBody.includes('Welcome to nginx') || nginxResponse.status === 200).toBe(true);

      const eventTypes = stream.events.map((event) => event.type);
      expect(eventTypes).not.toContain(DEPLOY_EVENTS.CLONE);
      expect(eventTypes).not.toContain(DEPLOY_EVENTS.BUILD);

      assertEventSequence(stream.events, [
        DEPLOY_EVENTS.START,
        DEPLOY_EVENTS.RUN,
        DEPLOY_EVENTS.SUCCESS,
      ]);
    } finally {
      stream.close();
    }
  });
});
