import { apiGet, apiPostVoid } from './client';

export interface AiUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number | null;
  callCount: number;
}

export interface AiUsageLog {
  id: string;
  projectId: string | null;
  sessionId: string | null;
  actionType: string;
  modelName: string | null;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  toolsCalled: string | null;
  result: string | null;
  errorMessage?: string | null;
  errorType?: string | null;
  durationMs: number | null;
  source: string | null;
  createdAt: string;
}

export interface AiUsageRecent {
  logs: AiUsageLog[];
  count: number;
}

export interface PendingApproval {
  metadata: {
    projectId: string;
    projectName: string;
    toolName: string;
    attempt: number;
    actionRunId: string;
    createdAt: string;
  };
  createdAt: string;
}

export async function getPendingApprovals(): Promise<PendingApproval[]> {
  const data = await apiGet<{ approvals: PendingApproval[] }>('/api/approvals/pending');
  return data.approvals;
}

export async function approveRecovery(projectId: string, actionRunId: string): Promise<void> {
  await apiPostVoid(`/api/projects/${projectId}/recovery/approve`, { actionRunId });
}

export async function rejectRecovery(projectId: string, actionRunId: string): Promise<void> {
  await apiPostVoid(`/api/projects/${projectId}/recovery/reject`, { actionRunId });
}

export async function getAiUsageSummary(projectId?: string): Promise<AiUsageSummary> {
  const params = new URLSearchParams();
  if (projectId) {
    params.set('projectId', projectId);
  }

  const url = `/api/usage/summary${params.toString() ? `?${params.toString()}` : ''}`;
  return apiGet<AiUsageSummary>(url);
}

export async function getAiUsageRecent(opts?: {
  limit?: number;
  projectId?: string;
  from?: string;
  to?: string;
}): Promise<AiUsageRecent> {
  const params = new URLSearchParams();

  if (opts?.limit) {
    params.set('limit', opts.limit.toString());
  }
  if (opts?.projectId) {
    params.set('projectId', opts.projectId);
  }
  if (opts?.from) {
    params.set('from', opts.from);
  }
  if (opts?.to) {
    params.set('to', opts.to);
  }

  const url = `/api/usage/recent${params.toString() ? `?${params.toString()}` : ''}`;
  return apiGet<AiUsageRecent>(url);
}
