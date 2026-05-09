import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  setupAutoRecovery,
  TOOL_TO_RECOVERY_STEP,
  type AutoRecoveryAgent,
  type AutoRecoveryHandlers,
} from '../../src/pipeline/auto-recovery.js';
import { EventBus } from '../../src/events/index.js';
import { Database } from '../../src/db/index.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import { QuestionBridge } from '../../src/lib/question-bridge.js';
import type { DeployPipeline, DeployResult } from '../../src/pipeline/deploy.js';
import type { DeployQueue } from '../../src/pipeline/deploy-queue.js';
import { normalizeErrorSignature } from '../../src/llm/memory.js';
import type { RecoveryAutomationPolicy } from '../../src/monitor/ops-types.js';
import { ApprovalGate } from '../../src/pipeline/approval-gate.js';

interface Harness {
  eventBus: EventBus;
  db: Database;
  redeployMock: (
    projectId: string,
    options?: { noCache?: boolean; environment?: 'production' | 'development' },
  ) => Promise<DeployResult>;
  agentChatMock: AutoRecoveryAgent['chatStream'] | null;
  recoveryHandlers: AutoRecoveryHandlers;
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
  getAutomationPolicy?: (projectId: string) => RecoveryAutomationPolicy | null;
  approvalGate?: ApprovalGate;
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

  const recoveryHandlers = setupAutoRecovery({
    eventBus,
    agent,
    db,
    buildDebugger: null,
    deployQueue,
    pipeline,
    questionBridge,
    language: 'en',
    config: testConfig,
    getAutomationPolicy: options?.getAutomationPolicy,
    approvalGate: options?.approvalGate,
  });

  return {
    eventBus,
    db,
    redeployMock,
    agentChatMock: agent?.chatStream ?? null,
    recoveryHandlers,
    tmpDir,
  };
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

describe('setupAutoRecovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips deployment recovery for infrastructure errors', async () => {
    const harness = createHarness();

    try {
      const projectId = 'proj-infra-error';
      await emitDeployFailed(
        harness.recoveryHandlers,
        projectId,
        'Cannot connect to Docker daemon at unix:///var/run/docker.sock',
      );

      expect(harness.redeployMock).not.toHaveBeenCalled();
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('stops tool execution when shouldContinue turns false mid-stream', async () => {
    let allowContinuation = true;
    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
      await onEvent({
        type: 'tool_call',
        toolName: 'list_projects',
        arguments: {},
        stepIndex: 0,
      });
      allowContinuation = false;
      await onEvent({
        type: 'tool_call',
        toolName: 'create_deploy_plan',
        arguments: { project_id: 'proj-stop-midstream' },
        stepIndex: 1,
      });
    });

    const harness = createHarness({
      agent: { chatStream: agentChatMock },
    });

    harness.recoveryHandlers = setupAutoRecovery({
      eventBus: harness.eventBus,
      agent: { chatStream: agentChatMock },
      db: harness.db,
      buildDebugger: null,
      deployQueue: {
        acquire: vi.fn<() => Promise<() => void>>(async () => () => undefined),
      } as unknown as DeployQueue,
      pipeline: { redeploy: harness.redeployMock } as unknown as DeployPipeline,
      questionBridge: new QuestionBridge(),
      language: 'en',
      config: {} as OpenLanderConfig,
      shouldContinue: () => allowContinuation,
    });

    try {
      const projectId = 'proj-stop-midstream';
      harness.db.createProject({
        id: projectId,
        name: projectId,
        repoUrl: 'https://github.com/openlander/proj-stop-midstream',
        branch: 'main',
      });
      harness.db.updateProject(projectId, { status: 'running' });

      const stoppedHandler = vi.fn();
      harness.eventBus.on('recovery:stopped', stoppedHandler);

      await emitDeployFailed(
        harness.recoveryHandlers,
        projectId,
        'unknown build failure requiring ai',
      );

      expect(harness.redeployMock).not.toHaveBeenCalled();
      expect(stoppedHandler).toHaveBeenCalledWith({
        projectId,
        reason: 'Recovery aborted because project is no longer eligible to continue',
        correlationId: projectId,
      });

      const runs = harness.db.getActionRunsByProject(projectId, 1);
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe('failed');
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
      harness.db.updateProject(projectId, { status: 'running' });
      await emitDeployFailed(harness.recoveryHandlers, projectId, 'node-gyp ERR! build failed');

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

      await emitDeployFailed(harness.recoveryHandlers, projectId, error);

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
        toolName: 'rollback_service',
        arguments: { project_name: 'proj-approval-approved' },
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
      harness.db.createProject({
        id: projectId,
        name: projectId,
        repoUrl: 'https://github.com/openlander/proj-approval-approved',
        branch: 'main',
      });
      harness.db.updateProject(projectId, { status: 'running' });
      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
        projectId,
        'unknown build failure requiring ai',
        'build',
      );
      await vi.advanceTimersByTimeAsync(2_100);

      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
      expect(pendingRun.approval_status).toBe('pending');
      expect(pendingRun.approval_tool).toBe('rollback_service');

      harness.recoveryHandlers.resolveApproval(pendingRun.id, true);

      await vi.advanceTimersByTimeAsync(0);

      await harness.eventBus.emit('deploy:success', {
        projectId,
        url: 'http://example.test',
        totalDurationMs: 123,
      });

      await vi.advanceTimersByTimeAsync(0);
      await recoveryPromise;

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
        toolName: 'rollback_service',
        arguments: { project_name: 'proj-approval-rejected' },
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
      harness.db.createProject({
        id: projectId,
        name: projectId,
        repoUrl: 'https://github.com/openlander/proj-approval-rejected',
        branch: 'main',
      });
      harness.db.updateProject(projectId, { status: 'running' });
      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
        projectId,
        'unknown build failure requiring ai',
        'build',
      );
      await vi.advanceTimersByTimeAsync(2_100);

      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
      expect(pendingRun.approval_status).toBe('pending');

      harness.recoveryHandlers.resolveApproval(pendingRun.id, false);

      await vi.advanceTimersByTimeAsync(0);
      await recoveryPromise;

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
      harness.db.updateProject(projectId, { status: 'running' });
      await emitDeployFailed(harness.recoveryHandlers, projectId, 'JavaScript heap out of memory');

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
        harness.recoveryHandlers,
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
      await emitDeployFailed(harness.recoveryHandlers, projectId, 'node-gyp ERR! failure');

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
      await emitDeployFailed(harness.recoveryHandlers, projectId, 'unknown build error message');

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

// ── Automation policy tests ────────────────────────────────────────────────────

describe('setupAutoRecovery — automation policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips approval gate when automationPolicy.rollback is auto for rollback_service tool', async () => {
    const autoSkippedHandler = vi.fn();

    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
      await onEvent({
        type: 'tool_call',
        toolName: 'rollback_service',
        arguments: { project_name: 'proj-auto-policy' },
        stepIndex: 0,
      });
    });

    const policy: RecoveryAutomationPolicy = {
      restart: 'auto',
      diagnosis: 'auto',
      apply_fixes: 'auto',
      rollback: 'auto',
    };

    const harness = createHarness({
      agent: { chatStream: agentChatMock },
      getAutomationPolicy: () => policy,
    });

    harness.eventBus.on('recovery:approval-auto-skipped', autoSkippedHandler);

    try {
      const projectId = 'proj-auto-policy';
      harness.db.createProject({
        id: projectId,
        name: projectId,
        repoUrl: 'https://github.com/openlander/proj-auto-policy',
        branch: 'main',
      });
      harness.db.updateProject(projectId, { status: 'running' });

      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
        projectId,
        'unknown build failure requiring ai',
        'build',
      );
      await vi.advanceTimersByTimeAsync(2_100);

      // With rollback='auto', no pending approval should be set
      const runs = harness.db.getActionRunsByProject(projectId, 1);
      expect(runs).toHaveLength(1);
      expect(runs[0].approval_status).not.toBe('pending');

      // Audit event must be emitted
      expect(autoSkippedHandler).toHaveBeenCalledOnce();
      expect(autoSkippedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          toolName: 'rollback_service',
          recoveryStep: 'rollback',
        }),
      );

      // Let recovery complete (agent stream ended; wait for outcome timeout)
      await vi.advanceTimersByTimeAsync(300_000);
      await recoveryPromise;
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('triggers approval gate when automationPolicy.rollback is confirm for rollback_service tool', async () => {
    const approvalNeededHandler = vi.fn();

    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
      await onEvent({
        type: 'tool_call',
        toolName: 'rollback_service',
        arguments: { project_name: 'proj-confirm-policy' },
        stepIndex: 0,
      });
    });

    const policy: RecoveryAutomationPolicy = {
      restart: 'auto',
      diagnosis: 'auto',
      apply_fixes: 'auto',
      rollback: 'confirm',
    };

    const harness = createHarness({
      agent: { chatStream: agentChatMock },
      getAutomationPolicy: () => policy,
    });

    harness.eventBus.on('recovery:approval-needed', approvalNeededHandler);

    try {
      const projectId = 'proj-confirm-policy';
      harness.db.createProject({
        id: projectId,
        name: projectId,
        repoUrl: 'https://github.com/openlander/proj-confirm-policy',
        branch: 'main',
      });
      harness.db.updateProject(projectId, { status: 'running' });

      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
        projectId,
        'unknown build failure requiring ai',
        'build',
      );
      await vi.advanceTimersByTimeAsync(2_100);

      // With rollback='confirm', approval should be pending
      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
      expect(pendingRun.approval_status).toBe('pending');
      expect(pendingRun.approval_tool).toBe('rollback_service');

      // Approval event must be emitted
      expect(approvalNeededHandler).toHaveBeenCalledOnce();
      expect(approvalNeededHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          toolName: 'rollback_service',
        }),
      );

      // Resolve by rejection so the recovery promise can settle
      harness.recoveryHandlers.resolveApproval(pendingRun.id, false);
      await vi.advanceTimersByTimeAsync(0);
      await recoveryPromise;
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('uses DecisionEngine fallback (requires approval) when policy is null', async () => {
    const approvalNeededHandler = vi.fn();

    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
      await onEvent({
        type: 'tool_call',
        toolName: 'rollback_service',
        arguments: { project_name: 'proj-null-policy' },
        stepIndex: 0,
      });
    });

    // getAutomationPolicy returns null → no policy active
    const harness = createHarness({
      agent: { chatStream: agentChatMock },
      getAutomationPolicy: () => null,
    });

    harness.eventBus.on('recovery:approval-needed', approvalNeededHandler);

    try {
      const projectId = 'proj-null-policy';
      harness.db.createProject({
        id: projectId,
        name: projectId,
        repoUrl: 'https://github.com/openlander/proj-null-policy',
        branch: 'main',
      });
      harness.db.updateProject(projectId, { status: 'running' });

      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
        projectId,
        'unknown build failure requiring ai',
        'build',
      );
      await vi.advanceTimersByTimeAsync(2_100);

      // With null policy, DecisionEngine classifies rollback_service as REQUIRE_APPROVAL
      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
      expect(pendingRun.approval_status).toBe('pending');
      expect(approvalNeededHandler).toHaveBeenCalledOnce();

      harness.recoveryHandlers.resolveApproval(pendingRun.id, false);
      await vi.advanceTimersByTimeAsync(0);
      await recoveryPromise;
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('uses DecisionEngine fallback for unmapped tool even when policy is set', async () => {
    // 'create_deploy_plan' is NOTIFY_THEN_ALLOW (medium risk), not in TOOL_TO_RECOVERY_STEP
    // Even with a policy, an unmapped tool must fall through to DecisionEngine logic
    const approvalNeededHandler = vi.fn();
    const autoSkippedHandler = vi.fn();

    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
      await onEvent({
        type: 'tool_call',
        toolName: 'create_deploy_plan',
        arguments: { project_id: 'proj-unmapped-tool' },
        stepIndex: 0,
      });
    });

    const policy: RecoveryAutomationPolicy = {
      restart: 'auto',
      diagnosis: 'auto',
      apply_fixes: 'auto',
      rollback: 'auto',
    };

    const harness = createHarness({
      agent: { chatStream: agentChatMock },
      getAutomationPolicy: () => policy,
    });

    harness.eventBus.on('recovery:approval-needed', approvalNeededHandler);
    harness.eventBus.on('recovery:approval-auto-skipped', autoSkippedHandler);

    try {
      const projectId = 'proj-unmapped-tool';
      harness.db.createProject({
        id: projectId,
        name: projectId,
        repoUrl: 'https://github.com/openlander/proj-unmapped-tool',
        branch: 'main',
      });
      harness.db.updateProject(projectId, { status: 'running' });

      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
        projectId,
        'unknown build failure requiring ai',
        'build',
      );
      await vi.advanceTimersByTimeAsync(2_100);

      // create_deploy_plan is medium risk → NOTIFY_THEN_ALLOW → no approval needed
      expect(approvalNeededHandler).not.toHaveBeenCalled();
      expect(autoSkippedHandler).not.toHaveBeenCalled();

      // Let recovery complete (no approval gate blocking it)
      await vi.advanceTimersByTimeAsync(300_000);
      await recoveryPromise;
    } finally {
      harness.db.close();
      rmSync(harness.tmpDir, { recursive: true, force: true });
    }
  });

  it('TOOL_TO_RECOVERY_STEP maps most HIGH_RISK_DEFAULTS tools to a configurable step', () => {
    // These are the high-risk tools that should be policy-controllable.
    // remove_volume is intentionally excluded — permanent data deletion always requires approval.
    const POLICY_MAPPED_TOOLS = [
      'rollback_service',
      'remove_project',
      'remove_service',
      'create_database',
      'platform_cleanup_orphans',
      'platform_reconcile',
      'platform_force_remove',
    ] as const;

    const validSteps = new Set(['restart', 'diagnosis', 'apply_fixes', 'rollback']);

    for (const tool of POLICY_MAPPED_TOOLS) {
      const mappedStep = TOOL_TO_RECOVERY_STEP[tool];
      expect(mappedStep, `${tool} must be mapped in TOOL_TO_RECOVERY_STEP`).toBeDefined();
      expect(validSteps, `${tool} must map to a valid ConfigurableRecoveryStep`).toContain(
        mappedStep,
      );
    }
  });
});
