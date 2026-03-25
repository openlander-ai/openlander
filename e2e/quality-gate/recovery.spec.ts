import { test, expect } from '@playwright/test';

import { deleteProject, deployGitProject, getProject } from './fixtures/api.js';
import { consumeDeployStream, type StreamConsumer } from './fixtures/stream-consumer.js';

const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const SCENARIO_TIMEOUT_MS = 180_000;
const PROJECT_STATUS_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProjectStatus(
  projectId: string,
  statuses: readonly string[],
  timeoutMs: number,
): Promise<{ status: string; [key: string]: unknown }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const project = (await getProject(projectId)) as { status: string; [key: string]: unknown };
    if (statuses.includes(project.status)) {
      return project;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  const lastProject = (await getProject(projectId)) as { status: string; [key: string]: unknown };
  throw new Error(
    `Timed out waiting for project status [${statuses.join(', ')}] after ${String(timeoutMs)}ms. Current: ${lastProject.status}`,
  );
}

if (!isBunRuntime) {
  test.describe.configure({ mode: 'serial' });

  test.describe('Quality Gate Recovery (R5/R6)', () => {
    const createdProjectIds: string[] = [];
    const streamConsumers: StreamConsumer[] = [];

    test.afterAll(async () => {
      for (const consumer of streamConsumers) {
        try {
          consumer.close();
        } catch (error) {
          console.warn('Failed to close stream consumer:', error);
        }
      }

      const uniqueProjectIds = Array.from(new Set(createdProjectIds));
      for (const projectId of uniqueProjectIds) {
        try {
          await deleteProject(projectId);
        } catch (error) {
          console.warn(`Failed to delete project ${projectId}:`, error);
        }
      }
    });

    test('Scenario A: R5 build fail emits error + recovery in messages', async () => {
      test.setTimeout(SCENARIO_TIMEOUT_MS);

      const deploy = await deployGitProject('https://github.com/openlander-ai/test-build-fail');
      expect(deploy.success).toBe(true);
      expect(deploy.projectId).toBeTruthy();

      createdProjectIds.push(deploy.projectId);
      const stream = consumeDeployStream(deploy.projectId);
      streamConsumers.push(stream);

      const errorEvent = await stream.waitForEvent('error', SCENARIO_TIMEOUT_MS);
      expect(errorEvent.type).toBe('error');

      // Check for recovery in messages
      const hasRecovery = stream.events.some((e) => /recovery/i.test(String(e.message || '')));
      expect(hasRecovery).toBe(true);

      const project = await waitForProjectStatus(
        deploy.projectId,
        ['error', 'stopped'],
        PROJECT_STATUS_TIMEOUT_MS,
      );
      expect(['error', 'stopped']).toContain(project.status);
    });

    test('Scenario B: R6 runtime crash emits complete then error + recovery in messages', async () => {
      test.setTimeout(SCENARIO_TIMEOUT_MS);

      const deploy = await deployGitProject('https://github.com/openlander-ai/test-runtime-crash');
      expect(deploy.success).toBe(true);
      expect(deploy.projectId).toBeTruthy();

      createdProjectIds.push(deploy.projectId);
      const stream = consumeDeployStream(deploy.projectId);
      streamConsumers.push(stream);

      const completeEvent = await stream.waitForEvent('complete', SCENARIO_TIMEOUT_MS);
      expect(completeEvent.type).toBe('complete');

      const errorEvent = await stream.waitForEvent('error', SCENARIO_TIMEOUT_MS);
      expect(errorEvent.type).toBe('error');

      // Check for recovery in messages
      const hasRecovery = stream.events.some((e) => /recovery/i.test(String(e.message || '')));
      expect(hasRecovery).toBe(true);

      const completeIndex = stream.events.findIndex((event) => event.type === 'complete');
      const errorIndex = stream.events.findIndex((event) => event.type === 'error');

      expect(completeIndex).toBeGreaterThanOrEqual(0);
      expect(errorIndex).toBeGreaterThan(completeIndex);
    });
  });
}
