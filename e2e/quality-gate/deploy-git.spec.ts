import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import { deleteProject, deployGitProject, getProject, waitForStatus } from './fixtures/api.js';
import {
  assertEventSequence,
  consumeDeployStream,
  type StreamConsumer,
} from './fixtures/stream-consumer.js';

const R1_REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';
const R2_REPO_URL = 'https://github.com/openlander-ai/test-no-dockerfile';
const SCENARIO_TIMEOUT_MS = 120_000;
const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

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
        await waitForAnyEventType(stream, ['complete'], SCENARIO_TIMEOUT_MS);

        const project = await waitForStatus(projectId, 'running', SCENARIO_TIMEOUT_MS);
        expect(project.status).toBe('running');
        expect(typeof project.assigned_port).toBe('number');
        expect((project.assigned_port as number) > 0).toBe(true);
        expect(project.container_id).not.toBeNull();

        assertLocalOkResponse(project.assigned_port as number);

        assertEventSequence(
          stream.events.map((e) => ({ type: e.type, message: String(e.message ?? '') })),
          ['status:Preparing', 'status:Clone', 'status:Build', 'status:Start', 'complete'],
        );
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
        await waitForAnyEventType(stream, ['complete'], SCENARIO_TIMEOUT_MS);

        const project = await waitForStatus(deploy.projectId, 'running', SCENARIO_TIMEOUT_MS);
        expect(project.status).toBe('running');

        expect(
          stream.events.some((e) => /auto.?detect|generated/i.test(String(e.message || ''))),
        ).toBe(true);

        assertEventSequence(
          stream.events.map((e) => ({ type: e.type, message: String(e.message ?? '') })),
          ['status:Preparing', 'status:Clone', 'status:Build', 'status:Start', 'complete'],
        );

        const latestProject = await getProject(deploy.projectId);
        expect(latestProject.status).toBe('running');
      } finally {
        stream.close();
      }
    });
  });
}
