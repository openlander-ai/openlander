import { beforeEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from '../../src/events/index.js';
import { RecoveryPipeline, type RecoveryContext } from '../../src/monitor/ops-recovery.js';
import {
  DEFAULT_RECOVERY_AUTOMATION,
  type RecoveryAutomationPolicy,
} from '../../src/monitor/ops-types.js';
import type {
  ApprovalGate,
  ApprovalMetadata,
  ApprovalResult,
} from '../../src/pipeline/approval-gate.js';

interface RecoveryPipelineInternals {
  restartContainer: (
    projectId: string,
    containerId: string,
  ) => Promise<{ success: true } | { success: false; reason: string }>;
  waitForHealthy: (projectId: string, containerId: string) => Promise<boolean>;
  generateDiagnosis: (
    context: RecoveryContext,
    failureReason: string,
    logs: string,
  ) => Promise<string | null>;
  readContainerLogs: (containerId: string) => Promise<string>;
  applyFixes: (context: RecoveryContext, logs: string) => Promise<string[]>;
  tryRollback: (context: RecoveryContext, reason: string) => Promise<'recovered' | 'escalated'>;
  escalate: (context: RecoveryContext, reason: string) => Promise<'escalated'>;
  incrementAndCheckBreaker: (projectId: string) => void;
}

interface MockContext {
  db: {
    isCircuitBreakerOpen: ReturnType<typeof vi.fn>;
    getCircuitBreakerState: ReturnType<typeof vi.fn>;
    createActionRun: ReturnType<typeof vi.fn>;
    updateActionRunStatus: ReturnType<typeof vi.fn>;
    updateActionRunApproval: ReturnType<typeof vi.fn>;
    updateActionRunPlan: ReturnType<typeof vi.fn>;
    getProject: ReturnType<typeof vi.fn>;
    resetCircuitBreaker: ReturnType<typeof vi.fn>;
    updateOpsIncidentStatus: ReturnType<typeof vi.fn>;
    updateOpsIncident: ReturnType<typeof vi.fn>;
    addOpsIncidentEvent: ReturnType<typeof vi.fn>;
    incrementCircuitBreakerFailure: ReturnType<typeof vi.fn>;
    openCircuitBreaker: ReturnType<typeof vi.fn>;
    getEnvironmentsByProject: ReturnType<typeof vi.fn>;
    listOpsIncidentsByProject: ReturnType<typeof vi.fn>;
  };
  docker: {
    getClient: ReturnType<typeof vi.fn>;
    getLogs: ReturnType<typeof vi.fn>;
    listAllContainers: ReturnType<typeof vi.fn>;
    stopContainer: ReturnType<typeof vi.fn>;
  };
  pipeline: {
    rollback: ReturnType<typeof vi.fn>;
  };
  config: {
    language: string;
  };
  modelRegistry: unknown;
}

function createMockContext(): MockContext {
  return {
    db: {
      isCircuitBreakerOpen: vi.fn(() => false),
      getCircuitBreakerState: vi.fn(() => null),
      createActionRun: vi.fn(() => 'action-run-1'),
      updateActionRunStatus: vi.fn(),
      updateActionRunApproval: vi.fn(),
      updateActionRunPlan: vi.fn(),
      getProject: vi.fn(() => ({
        id: 'project-1',
        assigned_port: 3000,
        previous_image_tag: 'openlander/project-1:prev',
        deploy_lock_session: null,
      })),
      resetCircuitBreaker: vi.fn(),
      updateOpsIncidentStatus: vi.fn(),
      updateOpsIncident: vi.fn(),
      addOpsIncidentEvent: vi.fn(),
      incrementCircuitBreakerFailure: vi.fn(() => ({ failure_count: 1 })),
      openCircuitBreaker: vi.fn(),
      getEnvironmentsByProject: vi.fn(() => []),
      listOpsIncidentsByProject: vi.fn(() => []),
    },
    docker: {
      getClient: vi.fn(() => ({
        getContainer: vi.fn(() => ({
          restart: vi.fn(),
          inspect: vi.fn(async () => ({
            State: {
              Running: true,
              Restarting: false,
            },
          })),
        })),
      })),
      getLogs: vi.fn(async () => 'container logs'),
      listAllContainers: vi.fn(async () => []),
      stopContainer: vi.fn(async () => undefined),
    },
    pipeline: {
      rollback: vi.fn(async () => ({ success: true, containerId: 'container-1' })),
    },
    config: {
      language: 'en',
    },
    modelRegistry: {},
  };
}

function createExecuteContext(
  automationPolicy?: Partial<RecoveryAutomationPolicy>,
): Omit<RecoveryContext, 'actionRunId'> {
  return {
    projectId: 'project-1',
    projectName: 'Project 1',
    containerId: 'container-1',
    incidentId: 'incident-1',
    automationPolicy: {
      ...DEFAULT_RECOVERY_AUTOMATION,
      ...automationPolicy,
    },
  };
}

describe('RecoveryPipeline approval gates', () => {
  let ctx: MockContext;
  let approvalGate: Pick<ApprovalGate, 'waitForApproval'>;
  let pipeline: RecoveryPipeline;
  let internals: RecoveryPipelineInternals;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = createMockContext();
    approvalGate = {
      waitForApproval: vi.fn(
        async (_actionRunId: string, _metadata: ApprovalMetadata): Promise<ApprovalResult> =>
          'approved',
      ),
    };
    pipeline = new RecoveryPipeline(ctx as never, approvalGate as never);
    internals = pipeline as unknown as RecoveryPipelineInternals;

    vi.spyOn(internals, 'restartContainer').mockResolvedValue({ success: true });
    vi.spyOn(internals, 'waitForHealthy').mockResolvedValue(true);
    vi.spyOn(internals, 'readContainerLogs').mockResolvedValue('container logs');
    vi.spyOn(internals, 'generateDiagnosis').mockResolvedValue('diagnosis');
    vi.spyOn(internals, 'applyFixes').mockResolvedValue(['fix applied']);
    vi.spyOn(internals, 'tryRollback').mockResolvedValue('recovered');
    vi.spyOn(internals, 'escalate').mockResolvedValue('escalated');
    vi.spyOn(internals, 'incrementAndCheckBreaker').mockImplementation(() => undefined);
    vi.spyOn(eventBus, 'emit').mockResolvedValue(undefined);
  });

  it('runs with all-auto policy without waiting for approvals', async () => {
    const result = await pipeline.execute(
      createExecuteContext({
        restart: 'auto',
        diagnosis: 'auto',
        apply_fixes: 'auto',
        rollback: 'auto',
      }),
    );

    expect(result).toBe('recovered');
    expect(approvalGate.waitForApproval).not.toHaveBeenCalled();
    expect(internals.restartContainer).toHaveBeenCalled();
  });

  it('proceeds with restart step when restart confirm gate is approved', async () => {
    const result = await pipeline.execute(createExecuteContext({ restart: 'confirm' }));

    expect(result).toBe('recovered');
    expect(approvalGate.waitForApproval).toHaveBeenCalledTimes(1);
    expect(internals.restartContainer).toHaveBeenCalledTimes(1);
    expect(ctx.db.updateActionRunStatus).toHaveBeenCalledWith('action-run-1', 'pending_approval');
    expect(ctx.db.updateActionRunStatus).toHaveBeenCalledWith('action-run-1', 'running');
  });

  it('escalates when restart confirm gate is rejected without breaker increment', async () => {
    vi.mocked(approvalGate.waitForApproval).mockResolvedValueOnce('rejected');

    const result = await pipeline.execute(createExecuteContext({ restart: 'confirm' }));

    expect(result).toBe('escalated');
    expect(internals.escalate).toHaveBeenCalledWith(
      expect.any(Object),
      'Recovery gated: restart step rejected by operator',
    );
    expect(internals.incrementAndCheckBreaker).not.toHaveBeenCalled();
    expect(internals.restartContainer).not.toHaveBeenCalled();
  });

  it('escalates when restart confirm gate times out without breaker increment', async () => {
    vi.mocked(approvalGate.waitForApproval).mockResolvedValueOnce('timed_out');

    const result = await pipeline.execute(createExecuteContext({ restart: 'confirm' }));

    expect(result).toBe('escalated');
    expect(internals.escalate).toHaveBeenCalledWith(
      expect.any(Object),
      'Recovery gated: restart step timed_out by operator',
    );
    expect(internals.incrementAndCheckBreaker).not.toHaveBeenCalled();
    expect(internals.restartContainer).not.toHaveBeenCalled();
  });

  it('escalates when diagnosis confirm gate is rejected', async () => {
    vi.spyOn(internals, 'restartContainer').mockResolvedValueOnce({
      success: false,
      reason: 'restart failed',
    });
    vi.mocked(approvalGate.waitForApproval).mockResolvedValueOnce('rejected');

    const result = await pipeline.execute(
      createExecuteContext({
        restart: 'auto',
        diagnosis: 'confirm',
      }),
    );

    expect(result).toBe('escalated');
    expect(internals.escalate).toHaveBeenCalledWith(
      expect.any(Object),
      'Recovery gated: diagnosis step rejected by operator',
    );
  });

  it('skips fixes and still attempts rollback when apply_fixes confirm gate is rejected', async () => {
    vi.spyOn(internals, 'restartContainer').mockResolvedValueOnce({
      success: false,
      reason: 'restart failed',
    });
    vi.mocked(approvalGate.waitForApproval).mockResolvedValueOnce('rejected');
    vi.spyOn(internals, 'tryRollback').mockResolvedValueOnce('recovered');

    const result = await pipeline.execute(
      createExecuteContext({
        restart: 'auto',
        diagnosis: 'auto',
        apply_fixes: 'confirm',
        rollback: 'auto',
      }),
    );

    expect(result).toBe('recovered');
    expect(internals.applyFixes).not.toHaveBeenCalled();
    expect(internals.tryRollback).toHaveBeenCalledTimes(1);
    expect(internals.escalate).not.toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining('apply_fixes'),
    );
  });

  it('escalates when rollback confirm gate is rejected', async () => {
    vi.spyOn(internals, 'restartContainer').mockResolvedValueOnce({
      success: false,
      reason: 'restart failed',
    });
    vi.mocked(approvalGate.waitForApproval).mockResolvedValueOnce('rejected');

    const result = await pipeline.execute(
      createExecuteContext({
        restart: 'auto',
        diagnosis: 'auto',
        apply_fixes: 'auto',
        rollback: 'confirm',
      }),
    );

    expect(result).toBe('escalated');
    expect(internals.escalate).toHaveBeenCalledWith(
      expect.any(Object),
      'Recovery gated: rollback step rejected by operator',
    );
    expect(internals.tryRollback).not.toHaveBeenCalled();
  });
});
