import { expect, test } from '@playwright/test';

import { deleteProject, deployGitProject, getProject, waitForStatus } from './fixtures/api.js';
import {
  assertEventSequence,
  consumeDeployStream,
  type StreamConsumer,
} from './fixtures/stream-consumer.js';

const R3_REPO_URL = 'https://github.com/openlander-ai/test-compose-multi';
const SCENARIO_TIMEOUT_MS = 240_000;
const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

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

function resolveProjectBaseUrl(project: {
  url?: unknown;
  assigned_port?: unknown;
  port?: unknown;
}): string {
  if (typeof project.url === 'string' && project.url.length > 0) {
    return project.url;
  }

  if (typeof project.assigned_port === 'number' && project.assigned_port > 0) {
    return `http://localhost:${String(project.assigned_port)}`;
  }

  if (typeof project.port === 'number' && project.port > 0) {
    return `http://localhost:${String(project.port)}`;
  }

  throw new Error('Project has no accessible URL or port for compose web service');
}

if (!isBunRuntime) {
  test.describe.configure({ mode: 'serial' });

  test.describe('Quality Gate — Compose multi-service deploy', () => {
    let projectId: string | null = null;
    let stream: StreamConsumer | null = null;

    test.afterAll(async () => {
      if (stream) {
        try {
          stream.close();
        } catch (error) {
          console.warn('Failed to close compose stream consumer:', error);
        }
      }

      if (projectId) {
        try {
          await deleteProject(projectId);
        } catch (error) {
          console.warn(`Failed to delete project ${projectId}:`, error);
        }
      }
    });

    test('deploys compose repo, emits compose events, and serves /count endpoint', async () => {
      test.setTimeout(SCENARIO_TIMEOUT_MS);

      const deploy = await deployGitProject(R3_REPO_URL);
      expect(deploy.success).toBe(true);
      expect(deploy.projectId).toBeTruthy();
      projectId = deploy.projectId;

      stream = consumeDeployStream(projectId);

      await stream.waitForEvent('complete', SCENARIO_TIMEOUT_MS);

      // Verify compose-related messages in the event stream
      const hasComposeMessages = stream.events.some((e) =>
        /compose/i.test(String(e.message || '')),
      );
      expect(hasComposeMessages).toBe(true);

      const runningProject = await waitForStatus(projectId, 'running', 180_000);
      expect(runningProject.status).toBe('running');

      const latestProject = await getProject(projectId);
      const baseUrl = resolveProjectBaseUrl(
        latestProject as {
          url?: unknown;
          assigned_port?: unknown;
          port?: unknown;
        },
      );

      const countResponse = await fetchWithRetry(`${baseUrl}/count`);
      expect(countResponse.ok).toBe(true);

      const countPayload = (await countResponse.json()) as { count?: unknown };
      expect(typeof countPayload.count).toBe('number');

      assertEventSequence(stream.events, ['status:Preparing', 'status:Clone', 'complete']);
    });
  });
}
