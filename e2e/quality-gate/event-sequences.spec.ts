import { execSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import {
  blueGreenDeploy,
  deleteProject,
  deployGitProject,
  deployImageProject,
  getDeployments,
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

if (!isBunRuntime) {
  test.describe.configure({ mode: 'serial' });

  test.describe('Quality Gate — Event wiring golden sequences (Q-2)', () => {
    const createdProjectIds = new Set<string>();
    let r1ProjectId: string | null = null;

    test.beforeAll(() => {
      try {
        const ids = execSync('docker ps -a --filter name=ol- -q', { encoding: 'utf-8' })
          .trim()
          .split('\n')
          .filter(Boolean);
        for (const id of ids) {
          execSync(`docker rm -f ${id}`, { stdio: 'pipe' });
        }
      } catch {
        // noop
      }
    });

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
      r1ProjectId = deploy.projectId;

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

    test.fixme('Compose Deploy: reaches running', async () => {
      test.setTimeout(TEST_TIMEOUT_MS);

      const deploy = await deployGitProject(R3_COMPOSE_REPO_URL);
      expect(deploy.success).toBe(true);
      createdProjectIds.add(deploy.projectId);

      await waitForStatus(deploy.projectId, 'running', TEST_TIMEOUT_MS);
    });

    test('Build Fail: deploy ends with error event', async () => {
      test.setTimeout(TEST_TIMEOUT_MS);

      const deploy = await deployGitProject(R5_BUILD_FAIL_REPO_URL);
      expect(deploy.success).toBe(true);
      createdProjectIds.add(deploy.projectId);

      const stream = consumeDeployStream(deploy.projectId);
      try {
        const errorEvent = await stream.waitForEvent('error', TEST_TIMEOUT_MS);
        expect(errorEvent.type).toBe('error');

        const hasStatusEvents = stream.events.some((e) => e.type === 'status');
        expect(hasStatusEvents).toBe(true);
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

    test('Blue-Green: reuses R1 project, blue-green reaches running', async () => {
      test.setTimeout(TEST_TIMEOUT_MS);
      expect(r1ProjectId).toBeTruthy();

      await blueGreenDeploy(r1ProjectId!, '/');
      await waitForStatus(r1ProjectId!, 'running', TEST_TIMEOUT_MS);
    });

    test('Rollback: reuses R1 project, rollback reaches running', async () => {
      test.setTimeout(TEST_TIMEOUT_MS);
      expect(r1ProjectId).toBeTruthy();

      const initialDeployments = await getDeployments(r1ProjectId!);
      const firstDeployId = (initialDeployments[0] as any)?.id;
      expect(firstDeployId).toBeTruthy();

      await redeployProject(r1ProjectId!);
      await waitForStatus(r1ProjectId!, 'running', TEST_TIMEOUT_MS);

      await rollbackProject(r1ProjectId!, firstDeployId!);
      await waitForStatus(r1ProjectId!, 'running', TEST_TIMEOUT_MS);
    });
  });
}
