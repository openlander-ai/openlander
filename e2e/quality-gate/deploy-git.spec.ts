import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import { deleteProject, deployGitProject, getProject, waitForStatus } from './fixtures/api.js';
import { DEPLOY_EVENTS } from './fixtures/event-types.js';
import {
  assertEventSequence,
  consumeDeployStream,
  type StreamConsumer,
} from './fixtures/stream-consumer.js';

const R1_REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';
const R2_REPO_URL = 'https://github.com/openlander-ai/test-no-dockerfile';
const SCENARIO_TIMEOUT_MS = 120_000;
const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

type TimelineLikeEvent = {
  type: string;
  message?: unknown;
  stepName?: unknown;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAnyEventType(
  stream: StreamConsumer,
  eventTypes: readonly string[],
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (stream.events.some((event) => eventTypes.includes(event.type))) {
      return;
    }
    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for any event [${eventTypes.join(', ')}] after ${String(timeoutMs)}ms. Seen: ${stream.events
      .map((event) => event.type)
      .join(' -> ')}`,
  );
}

function mapToDeployEvents(events: TimelineLikeEvent[]): Array<{ type: string }> {
  const mapped: Array<{ type: string }> = [];

  for (const event of events) {
    if (
      Object.values(DEPLOY_EVENTS).includes(
        event.type as (typeof DEPLOY_EVENTS)[keyof typeof DEPLOY_EVENTS],
      )
    ) {
      mapped.push({ type: event.type });
    }

    const stepName = typeof event.stepName === 'string' ? event.stepName.toLowerCase() : '';
    const message = typeof event.message === 'string' ? event.message.toLowerCase() : '';

    if (stepName === 'preparing' || message.includes('starting deployment')) {
      mapped.push({ type: DEPLOY_EVENTS.START });
    }

    if (stepName === 'clone' || message.includes('cloning repository')) {
      mapped.push({ type: DEPLOY_EVENTS.CLONE });
    }

    if (
      stepName === 'build' ||
      message.includes('docker image built') ||
      message.includes('building docker image')
    ) {
      mapped.push({ type: DEPLOY_EVENTS.BUILD });
    }

    if (stepName === 'start' || message.includes('starting container')) {
      mapped.push({ type: DEPLOY_EVENTS.RUN });
    }

    if (message.includes('auto-generated') || message.includes('auto-detect')) {
      mapped.push({ type: DEPLOY_EVENTS.AUTO_DETECT });
    }

    if (event.type === 'complete' || message.includes('deploy complete')) {
      mapped.push({ type: DEPLOY_EVENTS.SUCCESS });
    }
  }

  return mapped;
}

function assertLocalOkResponse(port: number): void {
  const body = execFileSync('curl', ['-fsSL', `http://localhost:${String(port)}/`], {
    encoding: 'utf8',
  });

  expect(body).toContain('OK');
}

if (!isBunRuntime) {
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

    test('Scenario A: R1 deploy via Web UI reaches running and serves OK', async ({ page }) => {
      test.setTimeout(180_000);

      await page.goto('/projects/new');
      await page.getByRole('button', { name: 'Search' }).click();
      await page.getByPlaceholder('Search repositories...').fill(R1_REPO_URL);

      const repoRow = page
        .locator('div', { hasText: 'openlander-ai/test-single-dockerfile' })
        .first();
      await expect(repoRow).toBeVisible({ timeout: 30_000 });

      await repoRow.hover();
      await repoRow.getByRole('button', { name: 'Deploy' }).click();

      const deployResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes('/api/projects/deploy') && response.request().method() === 'POST',
      );

      await page.getByRole('button', { name: 'Deploy Project' }).click();

      const deployResponse = await deployResponsePromise;
      const deployPayload = (await deployResponse.json()) as { projectId?: string };

      await page.waitForURL(/\/projects\/[^/?]+(?:\?.*)?$/, { timeout: SCENARIO_TIMEOUT_MS });

      const pathSegments = new URL(page.url()).pathname.split('/').filter(Boolean);
      const projectIdFromUrl = pathSegments[pathSegments.length - 1] ?? '';
      const projectId = deployPayload.projectId ?? projectIdFromUrl;

      expect(projectId).toBeTruthy();
      createdProjectIds.add(projectId);

      const stream = consumeDeployStream(projectId);
      try {
        await waitForAnyEventType(stream, [DEPLOY_EVENTS.SUCCESS, 'complete'], SCENARIO_TIMEOUT_MS);

        const project = await waitForStatus(projectId, 'running', SCENARIO_TIMEOUT_MS);
        expect(project.status).toBe('running');
        expect(typeof project.assigned_port).toBe('number');
        expect((project.assigned_port as number) > 0).toBe(true);
        expect(project.container_id).not.toBeNull();

        assertLocalOkResponse(project.assigned_port as number);

        const deployEvents = mapToDeployEvents(stream.events as TimelineLikeEvent[]);
        assertEventSequence(deployEvents, [
          DEPLOY_EVENTS.START,
          DEPLOY_EVENTS.CLONE,
          DEPLOY_EVENTS.BUILD,
          DEPLOY_EVENTS.RUN,
          DEPLOY_EVENTS.SUCCESS,
        ]);
      } finally {
        stream.close();
      }
    });

    test('Scenario B: R2 deploy via API auto-detects and reaches running', async () => {
      test.setTimeout(180_000);

      const deploy = await deployGitProject(R2_REPO_URL);
      expect(deploy.success).toBe(true);
      expect(deploy.projectId).toBeTruthy();
      createdProjectIds.add(deploy.projectId);

      const stream = consumeDeployStream(deploy.projectId);
      try {
        await waitForAnyEventType(stream, [DEPLOY_EVENTS.SUCCESS, 'complete'], SCENARIO_TIMEOUT_MS);

        const project = await waitForStatus(deploy.projectId, 'running', SCENARIO_TIMEOUT_MS);
        expect(project.status).toBe('running');

        const deployEvents = mapToDeployEvents(stream.events as TimelineLikeEvent[]);

        expect(deployEvents.map((event) => event.type)).toContain(DEPLOY_EVENTS.AUTO_DETECT);

        assertEventSequence(deployEvents, [
          DEPLOY_EVENTS.START,
          DEPLOY_EVENTS.CLONE,
          DEPLOY_EVENTS.AUTO_DETECT,
          DEPLOY_EVENTS.BUILD,
          DEPLOY_EVENTS.RUN,
          DEPLOY_EVENTS.SUCCESS,
        ]);

        const latestProject = await getProject(deploy.projectId);
        expect(latestProject.status).toBe('running');
      } finally {
        stream.close();
      }
    });
  });
}
