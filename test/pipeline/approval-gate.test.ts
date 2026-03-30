import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApprovalGate,
  APPROVAL_TIMEOUT_MS,
  type ApprovalMetadata,
} from '../../src/pipeline/approval-gate.js';

function createMetadata(overrides?: Partial<ApprovalMetadata>): ApprovalMetadata {
  return {
    projectId: 'project-1',
    projectName: 'project-name',
    toolName: 'rollback_project',
    attempt: 1,
    actionRunId: 'run-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ApprovalGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves approved when waitForApproval is approved', async () => {
    const gate = new ApprovalGate();
    const promise = gate.waitForApproval(
      'run-approve',
      createMetadata({ actionRunId: 'run-approve' }),
    );

    const approved = gate.approve('run-approve');

    expect(approved).toBe('approved');
    await expect(promise).resolves.toBe('approved');
  });

  it('resolves rejected when waitForApproval is rejected', async () => {
    const gate = new ApprovalGate();
    const promise = gate.waitForApproval(
      'run-reject',
      createMetadata({ actionRunId: 'run-reject' }),
    );

    const rejected = gate.reject('run-reject');

    expect(rejected).toBe('rejected');
    await expect(promise).resolves.toBe('rejected');
  });

  it('resolves timed_out after approval timeout', async () => {
    const gate = new ApprovalGate();
    const promise = gate.waitForApproval(
      'run-timeout',
      createMetadata({ actionRunId: 'run-timeout' }),
    );

    await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS);

    await expect(promise).resolves.toBe('timed_out');
  });

  it('returns not-found when approving a non-existent action run', () => {
    const gate = new ApprovalGate();

    expect(gate.approve('missing-run')).toBe('not-found');
  });

  it('returns already-processed when approving after timeout has already resolved', async () => {
    const gate = new ApprovalGate();
    const promise = gate.waitForApproval(
      'run-timeout-approve',
      createMetadata({ actionRunId: 'run-timeout-approve' }),
    );

    await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS);
    await expect(promise).resolves.toBe('timed_out');

    expect(gate.approve('run-timeout-approve')).toBe('already-processed');
  });

  it('handles two concurrent approvals independently', async () => {
    const gate = new ApprovalGate();
    const firstPromise = gate.waitForApproval('run-a', createMetadata({ actionRunId: 'run-a' }));
    const secondPromise = gate.waitForApproval('run-b', createMetadata({ actionRunId: 'run-b' }));

    expect(gate.approve('run-a')).toBe('approved');
    expect(gate.reject('run-b')).toBe('rejected');

    await expect(firstPromise).resolves.toBe('approved');
    await expect(secondPromise).resolves.toBe('rejected');
  });

  it('returns pending approvals metadata list', () => {
    const gate = new ApprovalGate();
    const firstMetadata = createMetadata({
      actionRunId: 'run-pending-a',
      toolName: 'remove_project',
    });
    const secondMetadata = createMetadata({
      actionRunId: 'run-pending-b',
      toolName: 'create_database',
    });

    void gate.waitForApproval('run-pending-a', firstMetadata);
    void gate.waitForApproval('run-pending-b', secondMetadata);

    const pending = gate.getPendingApprovals();
    expect(pending).toHaveLength(2);
    expect(pending.map((entry) => entry.metadata.actionRunId).sort()).toEqual([
      'run-pending-a',
      'run-pending-b',
    ]);
    expect(
      pending.find((entry) => entry.metadata.actionRunId === 'run-pending-a')?.metadata.toolName,
    ).toBe('remove_project');
  });

  it('dispose clears all pending approvals', async () => {
    const gate = new ApprovalGate();
    const firstPromise = gate.waitForApproval(
      'run-dispose-a',
      createMetadata({ actionRunId: 'run-dispose-a' }),
    );
    const secondPromise = gate.waitForApproval(
      'run-dispose-b',
      createMetadata({ actionRunId: 'run-dispose-b' }),
    );

    gate.dispose();

    await expect(firstPromise).resolves.toBe('timed_out');
    await expect(secondPromise).resolves.toBe('timed_out');
    expect(gate.getPendingApprovals()).toHaveLength(0);
  });
});
