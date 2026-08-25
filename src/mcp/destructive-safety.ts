import { OperationRequiresHumanUiError } from '../errors.js';
import { HUMAN_UI_ONLY_TOOL_SET, APPROVAL_HOLD_TOOL_SET } from './mcp-restricted-actions.js';
import type { ToolContext, ToolDef } from '../tools/defs/types.js';
import { getOperationPermissionSnapshot } from '../security/operation-permissions.js';
import { assertMcpActiveScope, resolveMcpScopeTarget } from './scope-policy.js';
import {
  afterApprovalGuidanceForTool,
  buildMcpActionStatusCall,
  lifecycleEffectForTool,
  type LifecycleEffect,
  type McpCompositeCall,
} from './agent-lifecycle-contract.js';

export { assertMcpActiveScope, resolveMcpTargetProjectId } from './scope-policy.js';

// Derived from the single policy source (mcp-restricted-actions.ts). Only real
// tool defs land here; deployable/project lifecycle aliases live in that module's
// HUMAN_UI_ONLY_ALIASES and are intercepted by the composite, not blocked here.
const GROUP_A_HUMAN_UI_ONLY = HUMAN_UI_ONLY_TOOL_SET;
const GROUP_B_APPROVAL_HOLD = APPROVAL_HOLD_TOOL_SET;
const POLICY_CONTROLLED_DESTRUCTIVE_TOOLS = new Set([
  'remove_service',
  'remove_volume',
  'delete_bucket',
  'cleanup_docker',
]);
const DATABASE_ACCESS_TOOLS = new Set([
  'describe_data_source',
  'read_data_source',
  'get_service_credentials',
  'create_service_user',
  'exec_service_container',
  'get_migration_preflight',
]);

interface SafetyResult {
  error?: string;
  code?: string;
  message?: string;
  status?: string;
  actionRunId?: string;
  action_run_id?: string;
  tool?: string;
  projectId?: string;
  project_id?: string;
  details?: Record<string, unknown>;
  poll_call?: McpCompositeCall;
  effect_preview?: LifecycleEffect;
  after_approval?: Record<string, string>;
  web_ui?: Record<string, unknown>;
  safe_alternatives?: Record<string, unknown>[];
  do_not_substitute?: string[];
  _agent_guidance?: Record<string, unknown>;
}

function buildHumanUiOnlyResponse(toolName: string): SafetyResult {
  const error = new OperationRequiresHumanUiError(toolName);
  const target = 'an operator-run host maintenance workflow';
  return {
    error: error.code,
    code: error.code,
    message: error.message,
    details: error.details,
    web_ui: {
      surface: 'host_maintenance',
      requires_human: true,
    },
    safe_alternatives: [],
    do_not_substitute: ['archive_service', 'archive_project', 'cleanup_docker', 'remove_service'],
    _agent_guidance: {
      message: `This destructive operation is intentionally blocked from MCP in OpenLander 0.1. Tell the user to use ${target}; do not substitute another MCP cleanup or removal tool.`,
    },
  };
}

function buildPermissionBlockedResponse(
  toolName: string,
  permission: 'destructive_actions' | 'database_access',
  targetProjectId: string | null,
  targetServiceId: string | null,
): SafetyResult {
  return {
    status: 'blocked',
    error: 'OPERATION_PERMISSION_DENIED',
    code: 'OPERATION_PERMISSION_DENIED',
    message: 'This operation is blocked by the effective OpenLander permission policy.',
    tool: toolName,
    projectId: targetProjectId ?? undefined,
    project_id: targetProjectId ?? undefined,
    details: {
      permission,
      project_id: targetProjectId,
      service_id: targetServiceId,
    },
    _agent_guidance: {
      message:
        'The operator disabled this capability in OpenLander Security settings. Do not retry or substitute another action.',
      next_steps: [
        'Report which permission blocked the action.',
        'Ask the operator to change the global, Project, or service override if this action is intended.',
      ],
    },
  };
}

function isAllowedMcpPreview(def: ToolDef, args: Record<string, unknown>): boolean {
  // Keep this narrow: only read-only previews may bypass the human-UI-only MCP gate.
  if (def.name !== 'platform_cleanup_orphans') return false;
  return args['dry_run'] !== false;
}

export async function maybeHandleMcpSafety(
  def: ToolDef,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<SafetyResult | undefined> {
  if (context.target !== 'mcp') return undefined;

  const target = await resolveMcpScopeTarget(context.appCtx, args, context.identity);
  const targetProjectId = target?.projectId ?? null;
  const targetServiceId = target?.serviceId ?? null;
  await assertMcpActiveScope(
    context.appCtx,
    targetProjectId,
    false,
    context.identity,
    targetServiceId,
  );

  const needsPermissionPolicy =
    DATABASE_ACCESS_TOOLS.has(def.name) || POLICY_CONTROLLED_DESTRUCTIVE_TOOLS.has(def.name);
  const targetPermissions = needsPermissionPolicy
    ? await getOperationPermissionSnapshot(context.appCtx.db, {
        projectId: targetProjectId,
        serviceId: targetServiceId,
      })
    : null;

  if (
    DATABASE_ACCESS_TOOLS.has(def.name) &&
    targetPermissions?.effective.database_access === 'block'
  ) {
    return buildPermissionBlockedResponse(
      def.name,
      'database_access',
      targetProjectId,
      targetServiceId,
    );
  }

  const destructivePermission = POLICY_CONTROLLED_DESTRUCTIVE_TOOLS.has(def.name)
    ? (targetPermissions?.effective.destructive_actions ?? 'allow')
    : null;
  if (destructivePermission === 'block') {
    return buildPermissionBlockedResponse(
      def.name,
      'destructive_actions',
      targetProjectId,
      targetServiceId,
    );
  }

  if (GROUP_A_HUMAN_UI_ONLY.has(def.name) && !isAllowedMcpPreview(def, args)) {
    return buildHumanUiOnlyResponse(def.name);
  }

  const shouldHold =
    destructivePermission === 'approval_required' ||
    def.name === 'archive_project' ||
    def.name === 'unarchive_project' ||
    def.name === 'archive_service' ||
    def.name === 'unarchive_service' ||
    def.name === 'remove_secret_file' ||
    def.name === 'remove_git_credential' ||
    def.name === 'remove_unused_docker_network' ||
    (def.name === 'bulk_delete_env_vars' && args['confirm'] === true);
  if (!GROUP_B_APPROVAL_HOLD.has(def.name) || !shouldHold) return undefined;

  const plan = {
    type: 'destructive_mcp',
    tool: def.name,
    args,
    targetProjectId,
    targetServiceId,
    identity: context.identity
      ? {
          source: context.identity.source,
          initiatedBy: context.identity.initiatedBy,
          mcpTokenId: context.identity.mcpTokenId,
          mcpTokenType: context.identity.mcpTokenType,
          mcpScopeKind: context.identity.mcpScopeKind,
          mcpScopeProjectId: context.identity.mcpScopeProjectId,
          mcpScopeServiceId: context.identity.mcpScopeServiceId,
        }
      : undefined,
    requestedAt: new Date().toISOString(),
  };
  const actionRunId = await context.appCtx.db.createPendingMcpApproval({
    projectId: targetProjectId ?? '',
    toolName: def.name,
    plan: JSON.stringify(plan),
  });

  return {
    status: 'pending_approval',
    actionRunId,
    action_run_id: actionRunId,
    tool: def.name,
    projectId: targetProjectId ?? undefined,
    project_id: targetProjectId ?? undefined,
    poll_call: buildMcpActionStatusCall(actionRunId),
    effect_preview: lifecycleEffectForTool(def.name),
    after_approval: afterApprovalGuidanceForTool(def.name),
    _agent_guidance: {
      message:
        'This destructive MCP action is waiting for human approval. Poll mcp_action_status with the returned action_run_id; do not retry the original action while approval is pending.',
      next_steps: [
        'Use poll_call to check whether the human approved, rejected, or the executor failed.',
        'After approval succeeds, follow after_approval for the safe next action.',
      ],
    },
  };
}

export function isGroupBMcpHoldTool(toolName: string): boolean {
  return GROUP_B_APPROVAL_HOLD.has(toolName);
}
