import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { setupAutoRecovery, type AutoRecoveryAgent } from '../../src/pipeline/auto-recovery.js';
import { EventBus } from '../../src/events/index.js';
import { Database } from '../../src/db/index.js';
import { QuestionBridge } from '../../src/lib/question-bridge.js';
import type { DeployPipeline, DeployResult } from '../../src/pipeline/deploy.js';
import type { DeployQueue } from '../../src/pipeline/deploy-queue.js';

interface Harness {
  eventBus: EventBus;
  db: Database;
  redeployMock: (
    projectId: string,
    options?: { noCache?: boolean; environment?: 'production' | 'development' },
  ) => Promise<DeployResult>;
  agentChatMock: AutoRecoveryAgent['chatStream'] | null;
  tmpDir: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  if (!resolve || !reject) {
    throw new Error('Failed to initialize deferred promise handlers');
  }

  return { promise, resolve, reject };
}

function createHarness(options?: {
  agent?: AutoRecoveryAgent | null;
  redeployImpl?: Harness['redeployMock'];
}): Harness {
  const tmpDir = mkdtempSync(join(tmpdir(), 'openlander-auto-recovery-'));
  const db = new Database(join(tmpDir, 'test.db'));
  const eventBus = new EventBus();

  const redeployMock =
    options?.redeployImpl ??
    vi.fn<
      (
        projectId: string,
        options?: { noCache?: boolean; environment?: 'production' | 'development' },
      ) => Promise<DeployResult>
    >(async (projectId: string) => ({
      success: true,
      projectId,
      projectName: projectId,
    }));

  const pipeline = {
    redeploy: redeployMock,
  } as unknown as DeployPipeline;

  const deployQueue = {
    acquire: vi.fn<() => Promise<() => void>>(async () => () => undefined),
  } as unknown as DeployQueue;

  const questionBridge = new QuestionBridge();
  const agent = options?.agent ?? null;

  setupAutoRecovery({
    eventBus,
    agent,
    db,
    buildDebugger: null,
    deployQueue,
    pipeline,
    questionBridge,
    language: 'en',
  });

  return {
    eventBus,
    db,
    redeployMock,
    agentChatMock: agent?.chatStream ?? null,
    tmpDir,
  };
}

async function emitDeployFailed(
  eventBus: EventBus,
  projectId: string,
  error: string,
): Promise<void> {
  await eventBus.emit('deploy:failed', {
    projectId,
    step: 'build',
    error,
  });
  await vi.advanceTimersByTimeAsync(2_100);
}

describe('setupAutoRecovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks gate check when action_runs has 3 failed records within one hour', async () => {
    const harness = createHarness();

    try {
      const projectId = 'proj-max-attempts';

      for (let i = 0; i < 3; i++) {
        const runId = harness.db.createActionRun({
          projectId,
          triggerSource: 'auto_recovery',
          recoveryStrategy: 'recipe',
        });
        harness.db.updateActionRunStatus(runId, 'failed', `failed-${String(i)}`);
      }

      const exhaustedHandler = vi.fn();
      harness.eventBus.on('recovery:exhausted', exhaustedHandler);

      await emitDeployFailed(harness.eventBus, projectId, 'build failed again');

      expect(exhaustedHandler).toHaveBeenCalledOnce();
      expect(harness.redeployMock).not.toHaveBeenCalled();
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('blocks gate check when there is already a running action_run', async () => {
    const harness = createHarness();

    try {
      const projectId = 'proj-running';
      harness.db.createActionRun({
        projectId,
        triggerSource: 'auto_recovery',
        recoveryStrategy: 'recipe',
      });

      await emitDeployFailed(harness.eventBus, projectId, 'another failure');

      expect(harness.redeployMock).not.toHaveBeenCalled();
      const runs = harness.db.getActionRunsByProject(projectId);
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('running');
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('uses recipe strategy when error matches known recipe even with agent available', async () => {
    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async () => undefined);

    const harness = createHarness({
      agent: {
        chatStream: agentChatMock,
      },
    });

    try {
      const projectId = 'proj-recipe-path';
      await emitDeployFailed(harness.eventBus, projectId, 'node-gyp ERR! build failed');

      expect(harness.redeployMock).toHaveBeenCalledOnce();
      expect(harness.agentChatMock).not.toHaveBeenCalled();

      const runs = harness.db.getActionRunsByProject(projectId, 1);
      expect(runs).toHaveLength(1);
      expect(runs[0].recovery_strategy).toBe('recipe');
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('creates action_run with running status when recovery starts', async () => {
    const deferred = createDeferred<DeployResult>();
    const redeployImpl = vi.fn<
      (
        projectId: string,
        options?: { noCache?: boolean; environment?: 'production' | 'development' },
      ) => Promise<DeployResult>
    >((projectId: string) => deferred.promise.then((result) => ({ ...result, projectId })));

    const harness = createHarness({ redeployImpl });

    try {
      const projectId = 'proj-running-status';
      const emitPromise = emitDeployFailed(
        harness.eventBus,
        projectId,
        'node-gyp ERR! still failing',
      );

      await vi.advanceTimersByTimeAsync(2_100);

      const runningRuns = harness.db.getRunningActionRuns(projectId);
      expect(runningRuns).toHaveLength(1);
      expect(runningRuns[0].status).toBe('running');

      deferred.resolve({
        success: true,
        projectId,
        projectName: projectId,
      });

      await emitPromise;
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('updates action_run status to failed when recovery fails', async () => {
    const redeployImpl = vi.fn<
      (
        projectId: string,
        options?: { noCache?: boolean; environment?: 'production' | 'development' },
      ) => Promise<DeployResult>
    >(async (projectId: string) => ({
      success: false,
      projectId,
      projectName: projectId,
      error: 'still broken after retry',
    }));

    const harness = createHarness({ redeployImpl });

    try {
      const projectId = 'proj-failed-status';
      await emitDeployFailed(harness.eventBus, projectId, 'node-gyp ERR! failure');

      const runs = harness.db.getActionRunsByProject(projectId, 1);
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('failed');
      expect(runs[0].error_message).toContain('still broken after retry');
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('programmatic mode deploys without LLM when agent is null', async () => {
    const harness = createHarness({ agent: null });

    try {
      const projectId = 'proj-programmatic';
      await emitDeployFailed(harness.eventBus, projectId, 'unknown build error message');

      expect(harness.redeployMock).toHaveBeenCalledOnce();

      const runs = harness.db.getActionRunsByProject(projectId, 1);
      expect(runs).toHaveLength(1);
      expect(runs[0].recovery_strategy).toBe('recipe');
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });
});
