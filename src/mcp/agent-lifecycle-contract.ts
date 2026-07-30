export interface McpCompositeCall {
  tool: string;
  arguments: {
    action: string;
    params: Record<string, string>;
  };
}

export interface LifecycleEffect {
  kind: string;
  reversible: boolean;
  runtime: string;
  data: string;
  hard_delete: boolean;
}

export interface DestructiveMcpPlanSummary {
  tool: string;
  args: Record<string, unknown>;
  targetProjectId: string | null;
  failure?: {
    code: string;
    message?: string;
    details?: Record<string, string>;
  };
}

const safeArgKeys = new Set([
  'project_id',
  'project_name',
  'projectId',
  'projectName',
  'service_id',
  'service_name',
  'serviceId',
  'serviceName',
  'target_project_id',
  'network_name',
  'network_id',
]);

export function buildMcpActionStatusCall(actionRunId: string): McpCompositeCall {
  return {
    tool: 'openlander_monitor',
    arguments: {
      action: 'mcp_action_status',
      params: { action_run_id: actionRunId },
    },
  };
}

export function lifecycleEffectForTool(toolName: string): LifecycleEffect {
  if (toolName === 'archive_project' || toolName === 'archive_service') {
    return {
      kind: 'archive',
      reversible: true,
      runtime: 'stop_remove_container',
      data: 'preserve_config_history',
      hard_delete: false,
    };
  }

  if (toolName === 'unarchive_project' || toolName === 'unarchive_service') {
    return {
      kind: 'unarchive',
      reversible: true,
      runtime: 'no_auto_start',
      data: 'preserve_config_history',
      hard_delete: false,
    };
  }

  if (toolName === 'bulk_delete_env_vars') {
    return {
      kind: 'delete_env_keys',
      reversible: false,
      runtime: 'no_runtime_change',
      data: 'delete_env_keys',
      hard_delete: false,
    };
  }

  if (toolName === 'remove_secret_file') {
    return {
      kind: 'remove_secret_file',
      reversible: false,
      runtime: 'no_runtime_change',
      data: 'delete_secret_file',
      hard_delete: false,
    };
  }

  if (toolName === 'remove_unused_docker_network') {
    return {
      kind: 'remove_unused_docker_network',
      reversible: false,
      runtime: 'remove_zero_endpoint_network',
      data: 'preserve_containers_volumes',
      hard_delete: false,
    };
  }

  return {
    kind: 'approval_hold',
    reversible: false,
    runtime: 'policy_defined',
    data: 'policy_defined',
    hard_delete: false,
  };
}

export function afterApprovalGuidanceForTool(toolName: string): Record<string, string> {
  if (toolName === 'archive_project' || toolName === 'archive_service') {
    return {
      succeeded: 'Inspect list_archived_services to confirm archived cleanup targets.',
      rejected: 'Stop and report that the human rejected the archive request.',
      failed:
        'Report the failure; do not substitute hard delete, remove_service, or cleanup_docker.',
    };
  }

  if (toolName === 'unarchive_project' || toolName === 'unarchive_service') {
    return {
      succeeded:
        'Confirm active lifecycle state, then redeploy only if the user wants runtime started.',
      rejected: 'Stop and report that the human rejected the restore request.',
      failed: 'Report the failure; do not claim a container was started.',
    };
  }

  if (toolName === 'remove_unused_docker_network') {
    return {
      succeeded: 'Re-list Docker networks, then retry the address-pool-blocked deployment.',
      rejected: 'Stop and report that the operator rejected Docker network cleanup.',
      failed: 'Report the typed cleanup blocker; do not remove another network as a substitute.',
    };
  }

  return {
    succeeded: 'Poll mcp_action_status until the action reaches a terminal status.',
    rejected: 'Stop and report that the human rejected the request.',
    failed: 'Report the failure without substituting another destructive action.',
  };
}

export function summarizeDestructiveArgs(
  args: Record<string, unknown>,
): Record<string, string | number> {
  const summary: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(args)) {
    if (safeArgKeys.has(key) && typeof value === 'string' && value.trim()) {
      summary[key] = value.trim();
    }
  }

  const keys = args['keys'];
  if (Array.isArray(keys)) {
    summary.key_count = keys.length;
  }

  return summary;
}

export function parseDestructiveMcpPlan(plan: string | null): DestructiveMcpPlanSummary | null {
  if (!plan) return null;

  try {
    const parsed = JSON.parse(plan) as Record<string, unknown>;
    if (parsed['type'] !== 'destructive_mcp' || typeof parsed['tool'] !== 'string') {
      return null;
    }

    const rawArgs = parsed['args'];
    const args =
      rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    const targetProjectId =
      typeof parsed['targetProjectId'] === 'string' && parsed['targetProjectId'].trim()
        ? parsed['targetProjectId'].trim()
        : null;
    const failureCandidate = parsed['failure'];
    const rawFailure =
      failureCandidate && typeof failureCandidate === 'object' && !Array.isArray(failureCandidate)
        ? (failureCandidate as Record<string, unknown>)
        : null;
    const rawDetails =
      rawFailure?.['details'] &&
      typeof rawFailure['details'] === 'object' &&
      !Array.isArray(rawFailure['details'])
        ? (rawFailure['details'] as Record<string, unknown>)
        : null;
    const safeDetailMappings = [
      ['projectId', 'project_id'],
      ['lockedBySession', 'lock_session'],
      ['blockedServiceId', 'blocked_service_id'],
      ['statusSource', 'status_source'],
      ['operationPhase', 'operation_phase'],
      ['deployId', 'deploy_id'],
      ['environmentId', 'environment_id'],
    ] as const;
    const safeDetails = Object.fromEntries(
      safeDetailMappings.flatMap(([sourceKey, outputKey]) => {
        const value = rawDetails?.[sourceKey];
        return typeof value === 'string' && value.length > 0 ? [[outputKey, value]] : [];
      }),
    );
    const failure =
      typeof rawFailure?.['code'] === 'string'
        ? {
            code: rawFailure['code'],
            ...(typeof rawFailure['message'] === 'string'
              ? { message: rawFailure['message'] }
              : {}),
            ...(Object.keys(safeDetails).length > 0 ? { details: safeDetails } : {}),
          }
        : undefined;

    return {
      tool: parsed['tool'],
      args,
      targetProjectId,
      ...(failure ? { failure } : {}),
    };
  } catch {
    // Malformed historical action-run plans should not break status polling.
    return null;
  }
}

export function archivedServicesSuggestedCall(
  projectId: string | null,
): McpCompositeCall | undefined {
  if (!projectId) return undefined;

  return {
    tool: 'openlander_service',
    arguments: {
      action: 'list_archived_services',
      params: { project_id: projectId },
    },
  };
}
