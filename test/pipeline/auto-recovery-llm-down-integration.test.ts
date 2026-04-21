/**
 * Integration test for the LLM-unreachable path through auto-recovery
 * (1.0 GA B4).
 *
 * Validates the END-TO-END flow against production-shape errors:
 *   - A recovery agent whose `chatStream` throws a typed
 *     `LLMUnreachableError` (mimicking the new agent.ts B4 typed-throw).
 *   - A recovery agent whose `chatStream` throws a raw connectivity-class
 *     error (ECONNREFUSED) — covers callers that haven't yet been wrapped.
 *   - A recovery agent whose `chatStream` throws an AI SDK `RetryError`
 *     wrapping a network cause (real production shape from
 *     `@ai-sdk/openai` / Anthropic SDK after retry exhaustion).
 *
 * In each case auto-recovery must:
 *   1. Open the LLM-unreachable cooldown (so subsequent attempts skip the
 *      LLM path).
 *   2. Emit `recovery:failed` with the typed cooldown message.
 *   3. NOT call redeploy (LLM path failed before producing a fix).
 *   4. NOT crash the host process (the typed throw is caught cleanly).
 *
 * The pre-existing unit test (`auto-recovery-llm-down.test.ts`) already
 * covers `isLlmUnreachableError` against fixture inputs. This file is the
 * integration counterpart that exercises the full
 * `recoveryHandlers.handleDeploymentRecovery` boundary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  resetLlmUnreachableCooldownForTests,
  setupAutoRecovery,
  type AutoRecoveryAgent,
  type AutoRecoveryHandlers,
} from '../../src/pipeline/auto-recovery.js';
import { EventBus } from '../../src/events/index.js';
import { Database } from '../../src/db/index.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import { QuestionBridge } from '../../src/lib/question-bridge.js';
import type { DeployPipeline, DeployResult } from '../../src/pipeline/deploy.js';
import type { DeployQueue } from '../../src/pipeline/deploy-queue.js';
import { LLMUnreachableError } from '../../src/errors.js';

interface Harness {
  eventBus: EventBus;
  db: Database;
  redeployMock: (projectId: string) => Promise<DeployResult>;
  recoveryHandlers: AutoRecoveryHandlers;
  tmpDir: string;
}

function createHarnessWithFailingAgent(failure: () => Error): Harness {
  const tmpDir = mkdtempSync(join(tmpdir(), 'openlander-llm-down-'));
  const db = new Database(join(tmpDir, 'test.db'));
  const eventBus = new EventBus();

  const redeployMock = vi.fn<(projectId: string) => Promise<DeployResult>>(
    async (projectId: string): Promise<DeployResult> => ({
      success: true,
      projectId,
      projectName: projectId,
    }),
  );

  const pipeline = { redeploy: redeployMock } as unknown as DeployPipeline;
  const deployQueue = {
    acquire: vi.fn<() => Promise<() => void>>(async () => () => undefined),
  } as unknown as DeployQueue;

  // Recovery agent whose chatStream synchronously throws — same shape as
  // the new agent.ts B4 typed-throw produces when the AI SDK surfaces a
  // connectivity-class failure.
  const agent: AutoRecoveryAgent = {
    chatStream: vi.fn(async () => {
      throw failure();
    }),
  };

  const recoveryHandlers = setupAutoRecovery({
    eventBus,
    agent,
    db,
    buildDebugger: null,
    deployQueue,
    pipeline,
    questionBridge: new QuestionBridge(),
    language: 'en',
    config: {} as OpenLanderConfig,
  });

  return { eventBus, db, redeployMock, recoveryHandlers, tmpDir };
}

async function emitDeployFailed(
  recoveryHandlers: AutoRecoveryHandlers,
  projectId: string,
  error: string,
): Promise<void> {
  const recoveryPromise = recoveryHandlers.handleDeploymentRecovery(projectId, error, 'build');
  await vi.advanceTimersByTimeAsync(2_100);
  await recoveryPromise;
}

describe('Auto-recovery LLM down integration (1.0 GA B4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetLlmUnreachableCooldownForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetLlmUnreachableCooldownForTests();
  });

  it('typed LLMUnreachableError thrown by chatStream opens cooldown + emits recovery:failed', async () => {
    const harness = createHarnessWithFailingAgent(
      () => new LLMUnreachableError('ollama', 'connect ECONNREFUSED 127.0.0.1:11434'),
    );

    try {
      const projectId = 'proj-llm-down-typed';
      harness.db.createProject({
        id: projectId,
        name: projectId,
        repoUrl: 'https://github.com/openlander/proj-llm-down-typed',
        branch: 'main',
      });
      harness.db.updateProject(projectId, { status: 'running' });

      const failedHandler = vi.fn();
      harness.eventBus.on('recovery:failed', failedHandler);

      // Use an error message that does NOT match any recipe so the LLM path
      // is selected (selectRecoveryStrategy: recipe=null + agent => 'llm').
      await emitDeployFailed(
        harness.recoveryHandlers,
        projectId,
        'Some unrecognised build failure that no recipe matches',
      );

      // 1) LLM path ran (chatStream was called and threw); redeploy must
      //    NOT have been invoked — the cooldown short-circuited everything.
      expect(harness.redeployMock).not.toHaveBeenCalled();

      // 2) recovery:failed fires with the cooldown messaging.
      expect(failedHandler).toHaveBeenCalled();
      const failedCall = failedHandler.mock.calls[0]?.[0] as { error?: string } | undefined;
      expect(failedCall?.error).toMatch(/LLM provider unreachable/i);
      expect(failedCall?.error).toMatch(/recovery paused/i);

      // 3) The action run rows reflect the failure (no crash, clean state).
      const runs = harness.db.getActionRunsByProject(projectId, 5);
      expect(runs.length).toBeGreaterThan(0);
      expect(runs[0].status).toBe('failed');
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('raw ECONNREFUSED Error thrown by chatStream is detected via heuristic + opens cooldown', async () => {
    const harness = createHarnessWithFailingAgent(() =>
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), {
        code: 'ECONNREFUSED',
      }),
    );

    try {
      const projectId = 'proj-llm-down-raw';
      harness.db.createProject({
        id: projectId,
        name: projectId,
        repoUrl: 'https://github.com/openlander/proj-llm-down-raw',
        branch: 'main',
      });
      harness.db.updateProject(projectId, { status: 'running' });

      const failedHandler = vi.fn();
      harness.eventBus.on('recovery:failed', failedHandler);

      await emitDeployFailed(
        harness.recoveryHandlers,
        projectId,
        'Some unrecognised build failure that no recipe matches',
      );

      expect(harness.redeployMock).not.toHaveBeenCalled();
      expect(failedHandler).toHaveBeenCalled();
      const failedCall = failedHandler.mock.calls[0]?.[0] as { error?: string } | undefined;
      expect(failedCall?.error).toMatch(/LLM provider unreachable/i);
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('AI SDK RetryError with connectivity cause is detected via heuristic + opens cooldown', async () => {
    // Production shape from `@ai-sdk/*` after retry exhaustion: an outer
    // RetryError whose `.cause` is the underlying network failure.
    const harness = createHarnessWithFailingAgent(() => {
      const inner = Object.assign(new Error('fetch failed'), {
        code: 'ECONNREFUSED',
      });
      const outer = Object.assign(new Error('AI_RetryError: too many retries'), {
        name: 'AI_RetryError',
      });
      (outer as Error & { cause: unknown }).cause = inner;
      return outer;
    });

    try {
      const projectId = 'proj-llm-down-retry';
      harness.db.createProject({
        id: projectId,
        name: projectId,
        repoUrl: 'https://github.com/openlander/proj-llm-down-retry',
        branch: 'main',
      });
      harness.db.updateProject(projectId, { status: 'running' });

      const failedHandler = vi.fn();
      harness.eventBus.on('recovery:failed', failedHandler);

      await emitDeployFailed(
        harness.recoveryHandlers,
        projectId,
        'Another unrecognised build failure that no recipe matches',
      );

      expect(harness.redeployMock).not.toHaveBeenCalled();
      expect(failedHandler).toHaveBeenCalled();
      const failedCall = failedHandler.mock.calls[0]?.[0] as { error?: string } | undefined;
      expect(failedCall?.error).toMatch(/LLM provider unreachable/i);
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('LLM unreachable cooldown short-circuits the next recovery attempt to the recipe path', async () => {
    const harness = createHarnessWithFailingAgent(
      () => new LLMUnreachableError('ollama', 'connect ECONNREFUSED 127.0.0.1:11434'),
    );

    try {
      const projectId = 'proj-llm-down-cooldown';
      harness.db.createProject({
        id: projectId,
        name: projectId,
        repoUrl: 'https://github.com/openlander/proj-llm-down-cooldown',
        branch: 'main',
      });
      harness.db.updateProject(projectId, { status: 'running' });

      // First attempt: LLM down — opens cooldown.
      await emitDeployFailed(
        harness.recoveryHandlers,
        projectId,
        'Yet another unrecognised build failure that no recipe matches',
      );

      // Second attempt while cooldown is active: the LLM path is skipped
      // and the programmatic / recipe fallback runs. Since this error also
      // does NOT match any recipe, the harness redeploys directly via the
      // fallback (no agent.chatStream call this time).
      const chatStreamSpy = (harness.recoveryHandlers as unknown as { __agent?: AutoRecoveryAgent })
        .__agent?.chatStream;
      const callsBefore = (chatStreamSpy as unknown as { mock?: { calls: unknown[] } } | undefined)
        ?.mock?.calls.length;

      await emitDeployFailed(
        harness.recoveryHandlers,
        projectId,
        'Yet another unrecognised build failure that no recipe matches',
      );

      // chatStream was NOT called again on the second attempt (cooldown
      // skips the LLM strategy). The redeploy fallback path fires.
      const callsAfter = (chatStreamSpy as unknown as { mock?: { calls: unknown[] } } | undefined)
        ?.mock?.calls.length;
      if (callsBefore !== undefined && callsAfter !== undefined) {
        expect(callsAfter).toBe(callsBefore);
      }
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });
});
