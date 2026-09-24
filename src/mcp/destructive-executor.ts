import { executeAppCleanup, type AppCleanupArgs } from './app-cleanup.js';
import type { AppContext } from '../app.js';
import { DeployLockedError, OpenLanderError } from '../errors.js';
import { deployableServiceToolDefs } from '../tools/defs/deployable-service.js';
import { envToolDefs } from '../tools/defs/env.js';
import { networkOperationToolDefs } from '../tools/defs/network-operations.js';
import { projectOpsToolDefs } from '../tools/defs/project-ops.js';
import { serviceToolDefs } from '../tools/defs/service.js';
import { volumeToolDefs } from '../tools/defs/volume.js';
import type { ToolDef } from '../tools/defs/types.js';
import type { EventPayload } from '../events/index.js';
import {
  assertMcpActiveScope,
  isGroupBMcpHoldTool,
  maybeHandleMcpSafety,
} from './destructive-safety.js';
import { parseStatefulComposeApprovalPlan } from './stateful-compose-approval.js';
import type { RequestIdentity } from '../types/identity.js';
import {
  assertAppLifecycleAllowed,
  assertDestructiveActionAllowed,
} from '../security/operation-permissions.js';

const POLICY_CONTROLLED_DESTRUCTIVE_TOOLS = new Set([
  'stop_app',
  'delete_app',
  'stop_service',
  'archive_project',
  'unarchive_project',
  'archive_service',
  'unarchive_service',
  'remove_service',
  'remove_volume',
  'delete_bucket',
  'cleanup_docker',
]);

interface DestructiveMcpPlan {
  type: 'destructive_mcp';
  tool: string;
  args: Record<string, unknown>;
  targetProjectId: string | null;
  targetServiceId?: string | null;
  identity?: RequestIdentity;
  requestedAt: string;
}

function parsePlan(plan: string | null): DestructiveMcpPlan {
  if (!plan) {
    throw new OpenLanderError(
      'Destructive MCP action is missing its execution plan.',
      'BAD_REQUEST',
      400,
    );
  }
  const parsed = JSON.parse(plan) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new OpenLanderError('Destructive MCP action plan is invalid.', 'BAD_REQUEST', 400);
  }

  const candidate = parsed as Partial<DestructiveMcpPlan>;
  if (
    candidate.type !== 'destructive_mcp' ||
    typeof candidate.tool !== 'string' ||
    !candidate.args ||
    typeof candidate.args !== 'object'
  ) {
    throw new OpenLanderError('Destructive MCP action plan is invalid.', 'BAD_REQUEST', 400);
  }

  return {
    type: 'destructive_mcp',
    tool: candidate.tool,
    args: candidate.args,
    targetProjectId:
      typeof candidate.targetProjectId === 'string' ? candidate.targetProjectId : null,
    targetServiceId:
      typeof candidate.targetServiceId === 'string' ? candidate.targetServiceId : null,
    identity:
      candidate.identity && typeof candidate.identity === 'object' ? candidate.identity : undefined,
    requestedAt: typeof candidate.requestedAt === 'string' ? candidate.requestedAt : '',
  };
}

function findExecutableTool(toolName: string): ToolDef | undefined {
  if (!isGroupBMcpHoldTool(toolName)) return undefined;
  return [
    ...projectOpsToolDefs,
    ...deployableServiceToolDefs,
    ...envToolDefs,
    ...networkOperationToolDefs,
    ...serviceToolDefs,
    ...volumeToolDefs,
  ].find((def) => def.name === toolName);
}

export async function handleDestructiveMcpApproval(
  ctx: AppContext,
  payload: EventPayload['recovery:approval-resolved'],
): Promise<void> {
  const actionRun = await ctx.db.getActionRun(payload.actionRunId);
  if (!actionRun || actionRun.approval_tool !== 'destructive_mcp') return;

  if (!payload.approved) {
    if (actionRun.status === 'pending_approval' && actionRun.approval_status === 'rejected')
      await ctx.db.updateActionRunStatus(actionRun.id, 'failed', 'rejected');
    return;
  }
  if (!(await ctx.db.claimMcpActionExecution(actionRun.id))) return;
  await executeClaimedMcpAction(ctx, actionRun.id);
}

export async function executeClaimedMcpAction(
  ctx: AppContext,
  actionRunId: string,
  requirePermission = false,
): Promise<void> {
  const actionRun = await ctx.db.getActionRun(actionRunId);
  if (!actionRun || actionRun.status !== 'running') return;

  try {
    const statefulPlan = parseStatefulComposeApprovalPlan(actionRun.plan);
    if (statefulPlan) {
      await assertMcpActiveScope(
        ctx,
        statefulPlan.targetProjectId,
        true,
        statefulPlan.identity,
        statefulPlan.targetServiceId,
      );
      await ctx.db.updateActionRunStatus(actionRun.id, 'running');
      const result = await ctx.pipeline.executeApprovedStatefulComposeUpdate(
        { ...statefulPlan.statefulCompose, actionRunId: actionRun.id },
        { noCache: statefulPlan.args.no_cache, actionRunId: actionRun.id },
      );
      await ctx.db.updateActionRunPlan(
        actionRun.id,
        JSON.stringify({ ...statefulPlan, result, executedAt: new Date().toISOString() }),
      );
      if (!result.success) {
        await ctx.db.updateActionRunStatus(
          actionRun.id,
          'failed',
          result.error ?? 'stateful_compose_update_failed',
        );
        return;
      }
      await ctx.db.updateActionRunStatus(actionRun.id, 'succeeded');
      return;
    }

    const plan = parsePlan(actionRun.plan);
    const def = findExecutableTool(plan.tool);
    if (!def && plan.tool !== 'cleanup_apps') {
      await ctx.db.updateActionRunStatus(
        actionRun.id,
        'failed',
        'unsupported_destructive_mcp_tool',
      );
      return;
    }

    await assertMcpActiveScope(
      ctx,
      plan.targetProjectId,
      true,
      plan.identity,
      plan.targetServiceId,
    );
    if (POLICY_CONTROLLED_DESTRUCTIVE_TOOLS.has(plan.tool)) {
      const check = ['stop_app', 'delete_app'].includes(plan.tool)
        ? assertAppLifecycleAllowed
        : assertDestructiveActionAllowed;
      await check(ctx.db, {
        projectId: plan.targetProjectId,
        serviceId: plan.targetServiceId,
      });
    }
    await ctx.db.updateActionRunStatus(actionRun.id, 'running');
    const context = { target: 'mcp' as const, appCtx: ctx, identity: plan.identity };
    if (requirePermission && def) {
      const rejection = await maybeHandleMcpSafety(def, plan.args, context, { preview: true });
      if (rejection)
        throw new OpenLanderError(
          'Permission changed before execution.',
          'OPERATION_PERMISSION_DENIED',
          403,
        );
    }
    const result =
      plan.tool === 'cleanup_apps'
        ? await executeAppCleanup(
            plan.args as unknown as AppCleanupArgs,
            context,
            actionRun.id,
            { ...plan },
            requirePermission,
          )
        : def
          ? await def.execute(plan.args, context)
          : undefined;
    await ctx.db.updateActionRunPlan(
      actionRun.id,
      JSON.stringify({ ...plan, result, executedAt: new Date().toISOString() }),
    );
    const failed = plan.tool === 'cleanup_apps' && (result as { failed: number }).failed > 0;
    if (failed)
      await ctx.db.updateActionRunStatus(
        actionRun.id,
        'failed',
        'Some services could not be cleaned up; inspect per-service results.',
      );
    else await ctx.db.updateActionRunStatus(actionRun.id, 'succeeded');
  } catch (error) {
    const message =
      error instanceof OpenLanderError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    await ctx.db.updateActionRunStatus(actionRun.id, 'failed', message);
    if (error instanceof DeployLockedError && actionRun.plan) {
      const storedPlan = JSON.parse(actionRun.plan) as Record<string, unknown>;
      await ctx.db.updateActionRunPlan(
        actionRun.id,
        JSON.stringify({
          ...storedPlan,
          failure: error.toJSON(),
          failedAt: new Date().toISOString(),
        }),
      );
    }
  }
}
