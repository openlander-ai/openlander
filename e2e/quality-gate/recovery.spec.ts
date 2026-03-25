import { test, expect } from '@playwright/test';

import { deleteProject, deployGitProject, getProject } from './fixtures/api.js';
import { DEPLOY_EVENTS, RECOVERY_EVENTS } from './fixtures/event-types.js';
import { consumeDeployStream, type StreamConsumer } from './fixtures/stream-consumer.js';

const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const SCENARIO_TIMEOUT_MS = 180_000;
const PROJECT_STATUS_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 1_000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAnyEvent(
  consumer: StreamConsumer,
  eventTypes: readonly string[],
  timeoutMs: number,
): Promise<{ type: string; [key: string]: unknown }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const matched = consumer.events.find((event) => eventTypes.includes(event.type));
    if (matched) {
      return matched;
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for any event [${eventTypes.join(', ')}] after ${String(timeoutMs)}ms. Seen: ${consumer.events
      .map((event) => event.type)
      .join(' -> ')}`,
  );
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

    test('Scenario A: R5 build fail emits deploy:failed + recovery:start', async () => {
      test.setTimeout(SCENARIO_TIMEOUT_MS);

      const deploy = await deployGitProject('https://github.com/openlander-ai/test-build-fail');
      expect(deploy.success).toBe(true);
      expect(deploy.projectId).toBeTruthy();

      createdProjectIds.push(deploy.projectId);
      const stream = consumeDeployStream(deploy.projectId);
      streamConsumers.push(stream);

      const failedEvent = await stream.waitForEvent(DEPLOY_EVENTS.FAILED, SCENARIO_TIMEOUT_MS);
      expect(failedEvent.type).toBe(DEPLOY_EVENTS.FAILED);

      const recoveryStartEvent = await stream.waitForEvent(
        RECOVERY_EVENTS.START,
        SCENARIO_TIMEOUT_MS,
      );
      expect(recoveryStartEvent.type).toBe(RECOVERY_EVENTS.START);

      const project = await waitForProjectStatus(
        deploy.projectId,
        ['error', 'stopped'],
        PROJECT_STATUS_TIMEOUT_MS,
      );
      expect(['error', 'stopped']).toContain(project.status);
    });

    test('Scenario B: R6 runtime crash emits deploy:success then crash + recovery:start', async () => {
      test.setTimeout(SCENARIO_TIMEOUT_MS);

      const deploy = await deployGitProject('https://github.com/openlander-ai/test-runtime-crash');
      expect(deploy.success).toBe(true);
      expect(deploy.projectId).toBeTruthy();

      createdProjectIds.push(deploy.projectId);
      const stream = consumeDeployStream(deploy.projectId);
      streamConsumers.push(stream);

      const successEvent = await stream.waitForEvent(DEPLOY_EVENTS.SUCCESS, SCENARIO_TIMEOUT_MS);
      expect(successEvent.type).toBe(DEPLOY_EVENTS.SUCCESS);

      const crashOrFailureEvent = await waitForAnyEvent(
        stream,
        [DEPLOY_EVENTS.CRASH, 'container:missing', DEPLOY_EVENTS.FAILED],
        SCENARIO_TIMEOUT_MS,
      );
      expect([DEPLOY_EVENTS.CRASH, 'container:missing', DEPLOY_EVENTS.FAILED]).toContain(
        crashOrFailureEvent.type,
      );

      const recoveryStartEvent = await stream.waitForEvent(
        RECOVERY_EVENTS.START,
        SCENARIO_TIMEOUT_MS,
      );
      expect(recoveryStartEvent.type).toBe(RECOVERY_EVENTS.START);

      const successIndex = stream.events.findIndex((event) => event.type === DEPLOY_EVENTS.SUCCESS);
      const crashIndex = stream.events.findIndex((event) => event === crashOrFailureEvent);
      const recoveryIndex = stream.events.findIndex(
        (event) => event.type === RECOVERY_EVENTS.START,
      );

      expect(successIndex).toBeGreaterThanOrEqual(0);
      expect(crashIndex).toBeGreaterThan(successIndex);
      expect(recoveryIndex).toBeGreaterThan(crashIndex);
    });
  });
}
