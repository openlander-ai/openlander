export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export interface ApprovalMetadata {
  projectId: string;
  projectName: string;
  toolName: string;
  attempt: number;
  actionRunId: string;
  createdAt: Date;
}

export interface PendingApproval {
  metadata: ApprovalMetadata;
  createdAt: Date;
}

export type ApprovalResult = 'approved' | 'rejected' | 'timed_out';

interface PendingApprovalEntry {
  resolve: (result: ApprovalResult) => void;
  timer: NodeJS.Timeout;
  metadata: ApprovalMetadata;
}

export class ApprovalGate {
  private readonly pendingApprovals = new Map<string, PendingApprovalEntry>();

  waitForApproval(actionRunId: string, metadata: ApprovalMetadata): Promise<ApprovalResult> {
    const existing = this.pendingApprovals.get(actionRunId);
    if (existing) {
      clearTimeout(existing.timer);
      this.pendingApprovals.delete(actionRunId);
      existing.resolve('timed_out');
    }

    return new Promise<ApprovalResult>((resolve) => {
      const timer = setTimeout(() => {
        this.resolveAndCleanup(actionRunId, 'timed_out');
      }, APPROVAL_TIMEOUT_MS);

      this.pendingApprovals.set(actionRunId, {
        resolve,
        timer,
        metadata,
      });
    });
  }

  approve(actionRunId: string): boolean {
    return this.resolveAndCleanup(actionRunId, 'approved');
  }

  reject(actionRunId: string): boolean {
    return this.resolveAndCleanup(actionRunId, 'rejected');
  }

  getPendingApprovals(): PendingApproval[] {
    return Array.from(this.pendingApprovals.values()).map((entry) => ({
      metadata: entry.metadata,
      createdAt: entry.metadata.createdAt,
    }));
  }

  dispose(): void {
    for (const [actionRunId] of this.pendingApprovals) {
      this.resolveAndCleanup(actionRunId, 'timed_out');
    }
  }

  private resolveAndCleanup(actionRunId: string, result: ApprovalResult): boolean {
    const entry = this.pendingApprovals.get(actionRunId);
    if (!entry) {
      return false;
    }

    clearTimeout(entry.timer);
    this.pendingApprovals.delete(actionRunId);
    entry.resolve(result);
    return true;
  }
}
