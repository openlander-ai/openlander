import { apiGet, apiPost } from './client';

export interface PendingApprovalMetadata {
  actionRunId: string;
  projectId: string | null;
  projectName: string | null;
  toolName: string;
  source?: 'mcp' | 'recovery' | string;
  details?: {
    keys?: string[];
    key?: string;
    [key: string]: unknown;
  };
  actor?: {
    source?: string | null;
    initiatedBy?: string | null;
    tokenId?: string | null;
    tokenType?: string | null;
    scopeKind?: string | null;
    scopeProjectId?: string | null;
    scopeServiceId?: string | null;
  };
}

export interface PendingApproval {
  id?: string;
  createdAt: string;
  metadata: PendingApprovalMetadata;
}

export async function listPendingApprovals(): Promise<{ approvals: PendingApproval[] }> {
  return apiGet<{ approvals: PendingApproval[] }>('/api/approvals/pending');
}

export async function approveActionRun(id: string): Promise<void> {
  await apiPost(`/api/action-runs/${encodeURIComponent(id)}/approve`);
}

export async function rejectActionRun(id: string): Promise<void> {
  await apiPost(`/api/action-runs/${encodeURIComponent(id)}/reject`);
}
