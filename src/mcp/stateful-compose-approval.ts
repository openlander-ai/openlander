import type { StatefulComposeApproval } from '../pipeline/compose-stateful-update.js';
import type { RequestIdentity } from '../types/identity.js';

export interface StatefulComposeApprovalPlan {
  type: 'destructive_mcp';
  tool: 'update_app';
  args: {
    service_id: string;
    no_cache: boolean;
    strategy: 'force';
  };
  targetProjectId: string;
  targetServiceId: string;
  identity?: RequestIdentity;
  requestedAt: string;
  statefulCompose: StatefulComposeApproval;
}

export function buildStatefulComposeApprovalPlan(params: {
  approval: StatefulComposeApproval;
  noCache: boolean;
  identity?: RequestIdentity;
}): StatefulComposeApprovalPlan {
  return {
    type: 'destructive_mcp',
    tool: 'update_app',
    args: {
      service_id: params.approval.serviceId,
      no_cache: params.noCache,
      strategy: 'force',
    },
    targetProjectId: params.approval.projectId,
    targetServiceId: params.approval.serviceId,
    identity: params.identity,
    requestedAt: new Date().toISOString(),
    statefulCompose: params.approval,
  };
}

export function parseStatefulComposeApprovalPlan(
  plan: string | null,
): StatefulComposeApprovalPlan | null {
  if (!plan) return null;
  try {
    const parsed = JSON.parse(plan) as Record<string, unknown>;
    const statefulCompose = parsed['statefulCompose'];
    const args = parsed['args'];
    if (
      parsed['type'] !== 'destructive_mcp' ||
      parsed['tool'] !== 'update_app' ||
      !statefulCompose ||
      typeof statefulCompose !== 'object' ||
      !args ||
      typeof args !== 'object'
    ) {
      return null;
    }
    const approval = statefulCompose as Partial<StatefulComposeApproval>;
    if (
      approval.version !== 1 ||
      typeof approval.serviceId !== 'string' ||
      typeof approval.projectId !== 'string' ||
      typeof approval.commitSha !== 'string' ||
      typeof approval.composeFingerprint !== 'string' ||
      !Array.isArray(approval.changes)
    ) {
      return null;
    }
    const argRecord = args as Record<string, unknown>;
    return {
      type: 'destructive_mcp',
      tool: 'update_app',
      args: {
        service_id: approval.serviceId,
        no_cache: argRecord['no_cache'] === true,
        strategy: 'force',
      },
      targetProjectId:
        typeof parsed['targetProjectId'] === 'string'
          ? parsed['targetProjectId']
          : approval.projectId,
      targetServiceId:
        typeof parsed['targetServiceId'] === 'string'
          ? parsed['targetServiceId']
          : approval.serviceId,
      identity:
        parsed['identity'] && typeof parsed['identity'] === 'object'
          ? (parsed['identity'] as RequestIdentity)
          : undefined,
      requestedAt: typeof parsed['requestedAt'] === 'string' ? parsed['requestedAt'] : '',
      statefulCompose: approval as StatefulComposeApproval,
    };
  } catch {
    return null;
  }
}

export function statefulComposeApprovalDiff(approval: StatefulComposeApproval) {
  return approval.changes.map((change) => ({
    service_name: change.serviceName,
    change: change.change,
    changed_fields: change.changedFields,
    backup_required: change.backupRequired,
  }));
}
