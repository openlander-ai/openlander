export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const PROCESSED_RETENTION_MS = 5 * 60 * 1000;

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
export type ApprovalActionResult = 'approved' | 'rejected' | 'not-found' | 'already-processed';

interface PendingApprovalEntry {
  resolve: (result: ApprovalResult) => void;
  timer: NodeJS.Timeout;
  metadata: ApprovalMetadata;
}

export class ApprovalGate {
  private readonly pendingApprovals = new Map<string, PendingApprovalEntry>();
  private readonly recentlyProcessed = new Map<string, NodeJS.Timeout>();

  waitForApproval(actionRunId: string, metadata: ApprovalMetadata): Promise<ApprovalResult> {
    const existing = this.pendingApprovals.get(actionRunId);
    if (existing) {
      clearTimeout(existing.timer);
      this.pendingApprovals.delete(actionRunId);
      existing.resolve('timed_out');
    }

    return new Promise<ApprovalResult>((resolve) => {
      const timer = setTimeout(() => {
        const entry = this.pendingApprovals.get(actionRunId);
        if (entry) {
          clearTimeout(entry.timer);
          this.pendingApprovals.delete(actionRunId);
          this.markAsProcessed(actionRunId);
          entry.resolve('timed_out');
        }
      }, APPROVAL_TIMEOUT_MS);

      this.pendingApprovals.set(actionRunId, {
        resolve,
        timer,
        metadata,
      });
    });
  }

  approve(actionRunId: string): ApprovalActionResult {
    const entry = this.pendingApprovals.get(actionRunId);
    if (!entry) {
      return this.recentlyProcessed.has(actionRunId) ? 'already-processed' : 'not-found';
    }

    clearTimeout(entry.timer);
    this.pendingApprovals.delete(actionRunId);
    entry.resolve('approved');
    this.markAsProcessed(actionRunId);
    return 'approved';
  }

  reject(actionRunId: string): ApprovalActionResult {
    const entry = this.pendingApprovals.get(actionRunId);
    if (!entry) {
      return this.recentlyProcessed.has(actionRunId) ? 'already-processed' : 'not-found';
    }

    clearTimeout(entry.timer);
    this.pendingApprovals.delete(actionRunId);
    entry.resolve('rejected');
    this.markAsProcessed(actionRunId);
    return 'rejected';
  }

  getPendingApprovals(): PendingApproval[] {
    return Array.from(this.pendingApprovals.values()).map((entry) => ({
      metadata: entry.metadata,
      createdAt: entry.metadata.createdAt,
    }));
  }

  dispose(): void {
    for (const [actionRunId] of this.pendingApprovals) {
      const entry = this.pendingApprovals.get(actionRunId);
      if (entry) {
        clearTimeout(entry.timer);
        entry.resolve('timed_out');
      }
    }
    this.pendingApprovals.clear();

    for (const timer of this.recentlyProcessed.values()) {
      clearTimeout(timer);
    }
    this.recentlyProcessed.clear();
  }

  private markAsProcessed(actionRunId: string): void {
    const existingTimer = this.recentlyProcessed.get(actionRunId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.recentlyProcessed.delete(actionRunId);
    }, PROCESSED_RETENTION_MS);

    this.recentlyProcessed.set(actionRunId, timer);
  }
}
