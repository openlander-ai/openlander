import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { setupAutoRecovery, type AutoRecoveryAgent } from '../../src/pipeline/auto-recovery.js';
import { EventBus } from '../../src/events/index.js';
import { Database } from '../../src/db/index.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import { QuestionBridge } from '../../src/lib/question-bridge.js';
import type { DeployPipeline, DeployResult } from '../../src/pipeline/deploy.js';
import type { DeployQueue } from '../../src/pipeline/deploy-queue.js';
import { normalizeErrorSignature } from '../../src/llm/memory.js';

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
  const testConfig = {} as OpenLanderConfig;

  setupAutoRecovery({
    eventBus,
    agent,
    db,
    buildDebugger: null,
    deployQueue,
    pipeline,
    questionBridge,
    language: 'en',
    config: testConfig,
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
      harness.db.createProject({
        id: projectId,
        name: projectId,
        repoUrl: 'https://github.com/openlander/proj-recipe-path',
        branch: 'main',
      });
      await emitDeployFailed(harness.eventBus, projectId, 'node-gyp ERR! build failed');

      expect(harness.redeployMock).toHaveBeenCalledOnce();
      expect(harness.agentChatMock).not.toHaveBeenCalled();

      const runs = harness.db.getActionRunsByProject(projectId, 1);
      expect(runs).toHaveLength(1);
      expect(runs[0].recovery_strategy).toBe('recipe');

      const pendingFix = harness.db.getProject(projectId)?.pending_fix;
      expect(pendingFix).not.toBeNull();
      const parsedPendingFix = JSON.parse(pendingFix ?? '{}') as {
        filePath?: string;
        patches?: Array<{ pattern?: string; replacement?: string; flags?: string }>;
      };
      expect(parsedPendingFix.filePath).toBe('Dockerfile');
      expect(parsedPendingFix.patches?.[0]?.pattern).toBe('FROM (node:[^-\\s]+)-alpine');
      expect(parsedPendingFix.patches?.[0]?.replacement).toBe('FROM $1-bookworm-slim');
      expect(parsedPendingFix.patches?.[0]?.flags).toBe('gm');
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('marks recovery strategy as memory when a deployment pattern matches', async () => {
    const harness = createHarness();

    try {
      const projectId = 'proj-pattern-hit';
      const error = 'JavaScript heap out of memory';
      const signature = normalizeErrorSignature(error);
      harness.db.upsertDeploymentPattern({
        project_id: projectId,
        pattern_type: 'build',
        error_signature: signature,
        fix_action: JSON.stringify({ strategy: 'recipe', recipe: 'Use NODE_OPTIONS 4096MB' }),
      });

      await emitDeployFailed(harness.eventBus, projectId, error);

      const runs = harness.db.getActionRunsByProject(projectId, 1);
      expect(runs).toHaveLength(1);
      expect(runs[0].recovery_strategy).toBe('memory');
      expect(harness.redeployMock).toHaveBeenCalledOnce();
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('waits for approval on high-risk tool call and continues when approved', async () => {
    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
      await onEvent({
        type: 'tool_call',
        toolName: 'remove_project',
        arguments: { project_id: 'proj-approval-approved' },
        stepIndex: 0,
      });
    });

    const harness = createHarness({
      agent: {
        chatStream: agentChatMock,
      },
    });

    try {
      const projectId = 'proj-approval-approved';
      await emitDeployFailed(harness.eventBus, projectId, 'unknown build failure requiring ai');

      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
      expect(pendingRun.approval_status).toBe('pending');
      expect(pendingRun.approval_tool).toBe('remove_project');

      await harness.eventBus.emit('recovery:approval-resolved', {
        actionRunId: pendingRun.id,
        approved: true,
      });

      await vi.advanceTimersByTimeAsync(0);

      await harness.eventBus.emit('deploy:success', {
        projectId,
        url: 'http://example.test',
        totalDurationMs: 123,
      });

      await vi.advanceTimersByTimeAsync(0);

      const updatedRun = harness.db.getActionRunsByProject(projectId, 1)[0];
      expect(updatedRun.approval_status).toBe('approved');
      expect(updatedRun.approval_resolved_at).not.toBeNull();
      expect(updatedRun.status).toBe('succeeded');
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('marks high-risk tool as rejected and fails recovery when rejected', async () => {
    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
      await onEvent({
        type: 'tool_call',
        toolName: 'remove_project',
        arguments: { project_id: 'proj-approval-rejected' },
        stepIndex: 0,
      });
    });

    const harness = createHarness({
      agent: {
        chatStream: agentChatMock,
      },
    });

    try {
      const projectId = 'proj-approval-rejected';
      await emitDeployFailed(harness.eventBus, projectId, 'unknown build failure requiring ai');

      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
      expect(pendingRun.approval_status).toBe('pending');

      await harness.eventBus.emit('recovery:approval-resolved', {
        actionRunId: pendingRun.id,
        approved: false,
      });

      await vi.advanceTimersByTimeAsync(0);

      const updatedRun = harness.db.getActionRunsByProject(projectId, 1)[0];
      expect(updatedRun.approval_status).toBe('rejected');
      expect(updatedRun.status).toBe('failed');
      expect(updatedRun.error_message).toContain('was rejected or timed out');
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('stores Dockerfile add-line recipe action as pending patch before redeploy', async () => {
    const harness = createHarness();

    try {
      const projectId = 'proj-oom-recipe-path';
      harness.db.createProject({
        id: projectId,
        name: projectId,
        repoUrl: 'https://github.com/openlander/proj-oom-recipe-path',
        branch: 'main',
      });
      await emitDeployFailed(harness.eventBus, projectId, 'JavaScript heap out of memory');

      expect(harness.redeployMock).toHaveBeenCalledOnce();

      const pendingFix = harness.db.getProject(projectId)?.pending_fix;
      expect(pendingFix).not.toBeNull();
      const parsedPendingFix = JSON.parse(pendingFix ?? '{}') as {
        filePath?: string;
        patches?: Array<{ pattern?: string; replacement?: string; flags?: string }>;
      };

      expect(parsedPendingFix.filePath).toBe('Dockerfile');
      expect(parsedPendingFix.patches?.[0]?.pattern).toBe('^CMD\\b|^ENTRYPOINT\\b');
      expect(parsedPendingFix.patches?.[0]?.replacement).toContain(
        'ENV NODE_OPTIONS="--max-old-space-size=4096"',
      );
      expect(parsedPendingFix.patches?.[0]?.flags).toBe('m');
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
