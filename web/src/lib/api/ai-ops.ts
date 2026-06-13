import { apiGet, apiPatch } from './client';

export type AiOpsProjectMode = 'off' | 'briefing';
export type AiOpsServiceOverrideMode = 'inherit' | 'off' | 'briefing';
export type AiOpsBriefingStatus = 'open' | 'acknowledged' | 'resolved';
export type AiOpsBriefingSeverity = 'info' | 'warning' | 'high' | 'critical';
export type AiOpsBriefingSummarySource = 'llm' | 'deterministic';
export type AiOpsBriefingSummaryStatus = 'llm' | 'fallback' | 'skipped' | 'deterministic';

export interface AiOpsPolicy {
  project_id: string;
  mode: AiOpsProjectMode;
  daily_briefing_limit: number;
  fingerprint_cooldown_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface AiOpsServiceOverride {
  service_id: string;
  mode: AiOpsServiceOverrideMode;
  created_at: string;
  updated_at: string;
}

export interface AiOpsResolvedPolicy {
  mode: AiOpsProjectMode;
  source: 'project' | 'service_override';
}

export interface AiOpsBudget {
  projectUsed: number;
  projectLimit: number;
  instanceUsed: number;
  instanceLimit: number;
  decision: {
    llmSummaryAllowed: boolean;
    deterministicBriefingAllowed: true;
    reason: 'allowed' | 'project_daily_limit_exceeded' | 'instance_daily_limit_exceeded';
  };
}

export interface AiOpsUsageSummary {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  count: number;
}

export interface AiOpsBriefing {
  briefing_id: string;
  project_id: string;
  service_id: string | null;
  status: AiOpsBriefingStatus;
  severity: AiOpsBriefingSeverity;
  classification: string;
  title: string;
  summary: string;
  summary_source: AiOpsBriefingSummarySource;
  summary_status: AiOpsBriefingSummaryStatus;
  summary_truncated: boolean;
  summary_finish_reason?: string;
  summary_error?: string;
  summary_usage?: Record<string, unknown>;
  deterministic_summary: string;
  llm_summary?: string;
  fingerprint: string;
  dedupe_key: string | null;
  suggested_call: Record<string, unknown> | null;
  evidence?: Record<string, unknown>;
  usage?: AiOpsUsageSummary;
  created_at: string;
  updated_at: string;
}

export interface ProjectAiOpsResponse {
  project_id: string;
  policy: AiOpsPolicy;
  budget: AiOpsBudget;
  recent_briefings: AiOpsBriefing[];
}

export interface ServiceAiOpsResponse {
  project_id: string;
  service_id: string;
  project_policy: AiOpsPolicy;
  service_override: AiOpsServiceOverride;
  resolved_policy: AiOpsResolvedPolicy;
}

export interface AiOpsBriefingsResponse {
  project_id?: string;
  service_id?: string;
  count: number;
  briefings: AiOpsBriefing[];
}

export async function getProjectAiOps(projectId: string): Promise<ProjectAiOpsResponse> {
  return apiGet<ProjectAiOpsResponse>(`/api/projects/${projectId}/ai-ops`);
}

export async function updateProjectAiOps(
  projectId: string,
  input: {
    mode?: AiOpsProjectMode;
    daily_briefing_limit?: number;
    fingerprint_cooldown_minutes?: number;
  },
): Promise<ProjectAiOpsResponse> {
  return apiPatch<ProjectAiOpsResponse>(`/api/projects/${projectId}/ai-ops`, input);
}

export async function getServiceAiOps(
  projectId: string,
  serviceId: string,
): Promise<ServiceAiOpsResponse> {
  return apiGet<ServiceAiOpsResponse>(`/api/projects/${projectId}/services/${serviceId}/ai-ops`);
}

export async function updateServiceAiOps(
  projectId: string,
  serviceId: string,
  input: { mode?: AiOpsServiceOverrideMode },
): Promise<ServiceAiOpsResponse> {
  return apiPatch<ServiceAiOpsResponse>(
    `/api/projects/${projectId}/services/${serviceId}/ai-ops`,
    input,
  );
}

export async function listProjectAiOpsBriefings(
  projectId: string,
): Promise<AiOpsBriefingsResponse> {
  return apiGet<AiOpsBriefingsResponse>(`/api/projects/${projectId}/ai-ops/briefings`);
}

export async function listServiceAiOpsBriefings(
  projectId: string,
  serviceId: string,
): Promise<AiOpsBriefingsResponse> {
  return apiGet<AiOpsBriefingsResponse>(
    `/api/projects/${projectId}/services/${serviceId}/ai-ops/briefings`,
  );
}

export async function getAiOpsBriefing(briefingId: string): Promise<{ briefing: AiOpsBriefing }> {
  return apiGet<{ briefing: AiOpsBriefing }>(`/api/ai-ops/briefings/${briefingId}`);
}
