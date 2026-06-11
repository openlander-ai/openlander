import type { AiOpsProjectMode, AiOpsServiceOverrideMode } from '../db/types.js';

export const AI_OPS_DEFAULT_PROJECT_MODE: AiOpsProjectMode = 'off';
export const AI_OPS_DEFAULT_SERVICE_OVERRIDE_MODE: AiOpsServiceOverrideMode = 'inherit';
export const AI_OPS_DEFAULT_PROJECT_DAILY_BRIEFING_LIMIT = 20;
export const AI_OPS_DEFAULT_INSTANCE_DAILY_BRIEFING_LIMIT = 200;
export const AI_OPS_DEFAULT_FINGERPRINT_COOLDOWN_MINUTES = 30;

export interface ResolvedAiOpsPolicy {
  mode: AiOpsProjectMode;
  source: 'project' | 'service_override';
}

export interface AiOpsBudgetInput {
  projectUsed: number;
  projectLimit: number;
  instanceUsed: number;
  instanceLimit: number;
}

export interface AiOpsBudgetDecision {
  llmSummaryAllowed: boolean;
  deterministicBriefingAllowed: true;
  reason: 'allowed' | 'project_daily_limit_exceeded' | 'instance_daily_limit_exceeded';
}

function safeLimit(limit: number): number {
  return Number.isFinite(limit) && limit >= 0 ? limit : 0;
}

export function resolveAiOpsMode(
  projectMode: AiOpsProjectMode = AI_OPS_DEFAULT_PROJECT_MODE,
  serviceOverrideMode: AiOpsServiceOverrideMode = AI_OPS_DEFAULT_SERVICE_OVERRIDE_MODE,
): ResolvedAiOpsPolicy {
  if (serviceOverrideMode === 'off' || serviceOverrideMode === 'briefing') {
    return { mode: serviceOverrideMode, source: 'service_override' };
  }

  return { mode: projectMode, source: 'project' };
}

export function buildAiOpsDedupeKey(input: {
  projectId: string;
  serviceId?: string | null;
  resourceKind?: string | null;
  resourceId?: string | null;
  fingerprint: string;
}): string {
  const resourcePart = input.serviceId
    ? `service:${input.serviceId}`
    : input.resourceId
      ? `${input.resourceKind?.trim() || 'resource'}:${input.resourceId}`
      : 'project';

  return `${input.projectId}:${resourcePart}:${input.fingerprint}`;
}

export function evaluateAiOpsBriefingBudget(input: AiOpsBudgetInput): AiOpsBudgetDecision {
  const projectLimit = safeLimit(input.projectLimit);
  const instanceLimit = safeLimit(input.instanceLimit);

  if (input.projectUsed >= projectLimit) {
    return {
      llmSummaryAllowed: false,
      deterministicBriefingAllowed: true,
      reason: 'project_daily_limit_exceeded',
    };
  }

  if (input.instanceUsed >= instanceLimit) {
    return {
      llmSummaryAllowed: false,
      deterministicBriefingAllowed: true,
      reason: 'instance_daily_limit_exceeded',
    };
  }

  return {
    llmSummaryAllowed: true,
    deterministicBriefingAllowed: true,
    reason: 'allowed',
  };
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
