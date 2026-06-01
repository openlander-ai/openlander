import { execSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import {
  blueGreenDeploy,
  createGitProject,
  deleteProject,
  deployGitProject,
  deployImageProject,
  getDeployments,
  getFirstDeployableService,
  redeployService,
  rollbackService,
  runtimeProjectIdFromServiceId,
  waitForStatus,
  waitForServiceStatus,
} from './fixtures/api.js';
import { assertEventSequence, consumeDeployStream } from './fixtures/stream-consumer.js';

const TEST_TIMEOUT_MS = 300_000;
const R1_DOCKERFILE_REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';
const R2_AUTODETECT_REPO_URL = 'https://github.com/openlander-ai/test-no-dockerfile';
const R3_COMPOSE_REPO_URL = 'https://github.com/openlander-ai/test-compose-multi';
const R5_BUILD_FAIL_REPO_URL = 'https://github.com/openlander-ai/test-build-fail';
const R6_RUNTIME_CRASH_REPO_URL = 'https://github.com/openlander-ai/test-runtime-crash';

test.describe.configure({ mode: 'serial' });

test.describe('Quality Gate — Event wiring golden sequences (Q-2)', () => {
  const createdProjectIds = new Set<string>();

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

    const project = await createGitProject(R1_DOCKERFILE_REPO_URL, {
      name: `test-single-dockerfile-${Date.now().toString(36)}`,
    });
    createdProjectIds.add(project.projectId);

    const service = await getFirstDeployableService(project.projectId);
    const stream = consumeDeployStream(runtimeProjectIdFromServiceId(service.id));
    try {
      await redeployService(project.projectId);
      await stream.waitForEvent('complete', TEST_TIMEOUT_MS);
      await waitForServiceStatus(project.projectId, 'running', TEST_TIMEOUT_MS);

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

    const project = await createGitProject(R2_AUTODETECT_REPO_URL, {
      name: `test-no-dockerfile-${Date.now().toString(36)}`,
    });
    createdProjectIds.add(project.projectId);

    const service = await getFirstDeployableService(project.projectId);
    const stream = consumeDeployStream(runtimeProjectIdFromServiceId(service.id));
    try {
      await redeployService(project.projectId);
      await stream.waitForEvent('complete', TEST_TIMEOUT_MS);
      await waitForServiceStatus(project.projectId, 'running', TEST_TIMEOUT_MS);

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

  test('Compose Deploy: reaches running', async () => {
    test.skip(
      process.env.OPENLANDER_E2E_SLOW !== '1',
      'Compose quality gate is slow; set OPENLANDER_E2E_SLOW=1 to run it.',
    );
    test.setTimeout(TEST_TIMEOUT_MS);

    const deploy = await deployGitProject(R3_COMPOSE_REPO_URL);
    expect(deploy.success).toBe(true);
    createdProjectIds.add(deploy.projectId);

    await waitForStatus(deploy.projectId, 'running', TEST_TIMEOUT_MS);
  });

  test('Build Fail: deploy ends with error event', async () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    const deploy = await deployGitProject(R5_BUILD_FAIL_REPO_URL, 'main', undefined, {
      allowFailure: true,
    });
    expect(deploy.success).toBe(false);
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

  test('Blue-Green: standalone Dockerfile project reaches running', async () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    const project = await createGitProject(R1_DOCKERFILE_REPO_URL, {
      name: `test-blue-green-${Date.now().toString(36)}`,
    });
    createdProjectIds.add(project.projectId);

    await redeployService(project.projectId);
    await waitForServiceStatus(project.projectId, 'running', TEST_TIMEOUT_MS);

    await blueGreenDeploy(project.projectId, '/');
    await waitForServiceStatus(project.projectId, 'running', TEST_TIMEOUT_MS);
  });

  test('Rollback: standalone Dockerfile project reaches running', async () => {
    test.setTimeout(TEST_TIMEOUT_MS);

    const project = await createGitProject(R1_DOCKERFILE_REPO_URL, {
      name: `test-rollback-${Date.now().toString(36)}`,
    });
    createdProjectIds.add(project.projectId);

    await redeployService(project.projectId);
    await waitForServiceStatus(project.projectId, 'running', TEST_TIMEOUT_MS);

    const initialDeployments = await getDeployments(project.projectId);
    const firstDeployId = (initialDeployments[0] as any)?.id;
    expect(firstDeployId).toBeTruthy();

    await redeployService(project.projectId);
    await waitForServiceStatus(project.projectId, 'running', TEST_TIMEOUT_MS);

    await rollbackService(project.projectId, firstDeployId!);
    await waitForServiceStatus(project.projectId, 'running', TEST_TIMEOUT_MS);
  });
});
