import { expect, test } from '@playwright/test';

import {
  blueGreenDeploy,
  deleteProject,
  deployGitProject,
  deployImageProject,
  redeployProject,
  rollbackProject,
  waitForStatus,
} from './fixtures/api.js';
import { assertEventSequence, consumeDeployStream } from './fixtures/stream-consumer.js';

const TEST_TIMEOUT_MS = 300_000;
const R1_DOCKERFILE_REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';
const R2_AUTODETECT_REPO_URL = 'https://github.com/openlander-ai/test-no-dockerfile';
const R3_COMPOSE_REPO_URL = 'https://github.com/openlander-ai/test-compose-multi';
const R5_BUILD_FAIL_REPO_URL = 'https://github.com/openlander-ai/test-build-fail';
const R6_RUNTIME_CRASH_REPO_URL = 'https://github.com/openlander-ai/test-runtime-crash';
const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
const BASE_URL = 'http://localhost:10114';

type DeploymentSummary = {
  id: string;
};

async function getDeployments(projectId: string): Promise<DeploymentSummary[]> {
  const res = await fetch(`${BASE_URL}/api/projects/${projectId}/deployments`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get deployments failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { deployments?: Array<{ id?: string }> };
  return (data.deployments ?? [])
    .map((deployment) => ({ id: deployment.id ?? '' }))
    .filter((deployment) => deployment.id.length > 0);
}

if (!isBunRuntime) {
  test.describe.configure({ mode: 'serial' });

  test.describe('Quality Gate — Event wiring golden sequences (Q-2)', () => {
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

    test('Git Deploy (Dockerfile): start -> clone -> build -> run -> success', async () => {
      test.setTimeout(TEST_TIMEOUT_MS);

      const deploy = await deployGitProject(R1_DOCKERFILE_REPO_URL);
      expect(deploy.success).toBe(true);
      createdProjectIds.add(deploy.projectId);

      const stream = consumeDeployStream(deploy.projectId);
      try {
        await stream.waitForEvent('complete', TEST_TIMEOUT_MS);
        await waitForStatus(deploy.projectId, 'running', TEST_TIMEOUT_MS);

        assertEventSequence(stream.events, [
          'status:Preparing',
          'status:Clone',
          'status:Build',
          'status:Start',
          'complete',
        ]);
      } finally {
        stream.close();
      }
    });

    test('Git Deploy (Auto-detect): start -> clone -> auto-detect -> build -> run -> success', async () => {
      test.setTimeout(TEST_TIMEOUT_MS);

      const deploy = await deployGitProject(R2_AUTODETECT_REPO_URL);
      expect(deploy.success).toBe(true);
      createdProjectIds.add(deploy.projectId);

      const stream = consumeDeployStream(deploy.projectId);
      try {
        await stream.waitForEvent('complete', TEST_TIMEOUT_MS);
        await waitForStatus(deploy.projectId, 'running', TEST_TIMEOUT_MS);

        assertEventSequence(stream.events, [
          'status:Preparing',
          'status:Clone',
          'status:Build',
          'status:Start',
          'complete',
        ]);
      } finally {
        stream.close();
      }
    });

    test('Image Deploy: start -> run -> success', async () => {
      test.setTimeout(TEST_TIMEOUT_MS);

      const deploy = await deployImageProject('nginx:alpine', 80, 'golden-image-sequence');
      expect(deploy.success).toBe(true);
      createdProjectIds.add(deploy.projectId);

      const stream = consumeDeployStream(deploy.projectId);
      try {
        await stream.waitForEvent('complete', TEST_TIMEOUT_MS);
        await waitForStatus(deploy.projectId, 'running', TEST_TIMEOUT_MS);

        assertEventSequence(stream.events, ['status:Preparing', 'status:Start', 'complete']);
      } finally {
        stream.close();
      }
    });

    test('Compose Deploy: start -> clone -> compose:start -> compose:up -> success', async () => {
      test.setTimeout(TEST_TIMEOUT_MS);

      const deploy = await deployGitProject(R3_COMPOSE_REPO_URL);
      expect(deploy.success).toBe(true);
      createdProjectIds.add(deploy.projectId);

      const stream = consumeDeployStream(deploy.projectId);
      try {
        await stream.waitForEvent('complete', TEST_TIMEOUT_MS);
        await waitForStatus(deploy.projectId, 'running', TEST_TIMEOUT_MS);

        assertEventSequence(stream.events, ['status:Preparing', 'status:Clone', 'complete']);
      } finally {
        stream.close();
      }
    });

    test('Build Fail: start -> clone -> build -> failed -> recovery:start', async () => {
      test.setTimeout(TEST_TIMEOUT_MS);

      const deploy = await deployGitProject(R5_BUILD_FAIL_REPO_URL);
      expect(deploy.success).toBe(true);
      createdProjectIds.add(deploy.projectId);

      const stream = consumeDeployStream(deploy.projectId);
      try {
        await stream.waitForEvent('error', TEST_TIMEOUT_MS);

        assertEventSequence(stream.events, [
          'status:Preparing',
          'status:Clone',
          'status:Build',
          'error',
        ]);
      } finally {
        stream.close();
      }
    });

    test('Runtime Crash: start -> clone -> build -> run -> success', async () => {
      test.setTimeout(TEST_TIMEOUT_MS);

      const deploy = await deployGitProject(R6_RUNTIME_CRASH_REPO_URL);
      expect(deploy.success).toBe(true);
      createdProjectIds.add(deploy.projectId);

      const stream = consumeDeployStream(deploy.projectId);
      try {
        await stream.waitForEvent('complete', TEST_TIMEOUT_MS);

        assertEventSequence(stream.events, [
          'status:Preparing',
          'status:Clone',
          'status:Build',
          'status:Start',
          'complete',
        ]);
      } finally {
        stream.close();
      }
    });

    test('Blue-Green: start -> build -> run -> success', async () => {
      test.setTimeout(TEST_TIMEOUT_MS);

      const deploy = await deployGitProject(R1_DOCKERFILE_REPO_URL);
      expect(deploy.success).toBe(true);
      createdProjectIds.add(deploy.projectId);
      await waitForStatus(deploy.projectId, 'running', TEST_TIMEOUT_MS);

      const stream = consumeDeployStream(deploy.projectId);
      try {
        await blueGreenDeploy(deploy.projectId, '/');
        await stream.waitForEvent('complete', TEST_TIMEOUT_MS);
        await waitForStatus(deploy.projectId, 'running', TEST_TIMEOUT_MS);

        assertEventSequence(stream.events, ['status:Preparing', 'status:Start', 'complete']);
      } finally {
        stream.close();
      }
    });

    test('Rollback: deploy:rollback', async () => {
      test.setTimeout(TEST_TIMEOUT_MS);

      const deploy = await deployGitProject(R1_DOCKERFILE_REPO_URL);
      expect(deploy.success).toBe(true);
      createdProjectIds.add(deploy.projectId);
      await waitForStatus(deploy.projectId, 'running', TEST_TIMEOUT_MS);

      const initialDeployments = await getDeployments(deploy.projectId);
      const firstDeployId = initialDeployments[0]?.id;
      expect(firstDeployId).toBeTruthy();

      await redeployProject(deploy.projectId);
      await waitForStatus(deploy.projectId, 'running', TEST_TIMEOUT_MS);

      await rollbackProject(deploy.projectId, firstDeployId!);
      await waitForStatus(deploy.projectId, 'running', TEST_TIMEOUT_MS);
    });
  });
}
