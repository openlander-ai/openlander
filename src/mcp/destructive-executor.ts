import type { AppContext } from '../app.js';
import { OpenLanderError } from '../errors.js';
import { deployableServiceToolDefs } from '../tools/defs/deployable-service.js';
import { envToolDefs } from '../tools/defs/env.js';
import { projectOpsToolDefs } from '../tools/defs/project-ops.js';
import type { ToolDef } from '../tools/defs/types.js';
import type { EventPayload } from '../events/index.js';
import { assertMcpActiveScope, isGroupBMcpHoldTool } from './destructive-safety.js';
import type { RequestIdentity } from '../types/identity.js';

interface DestructiveMcpPlan {
  type: 'destructive_mcp';
  tool: string;
  args: Record<string, unknown>;
  targetProjectId: string | null;
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
    identity:
      candidate.identity && typeof candidate.identity === 'object' ? candidate.identity : undefined,
    requestedAt: typeof candidate.requestedAt === 'string' ? candidate.requestedAt : '',
  };
}

function findExecutableTool(toolName: string): ToolDef | undefined {
  if (!isGroupBMcpHoldTool(toolName)) return undefined;
  return [...projectOpsToolDefs, ...deployableServiceToolDefs, ...envToolDefs].find(
    (def) => def.name === toolName,
  );
}

export async function handleDestructiveMcpApproval(
  ctx: AppContext,
  payload: EventPayload['recovery:approval-resolved'],
): Promise<void> {
  const actionRun = await ctx.db.getActionRun(payload.actionRunId);
  if (!actionRun || actionRun.approval_tool !== 'destructive_mcp') return;

  if (!payload.approved) {
    await ctx.db.updateActionRunStatus(actionRun.id, 'failed', 'rejected');
    return;
  }

  try {
    const plan = parsePlan(actionRun.plan);
    const def = findExecutableTool(plan.tool);
    if (!def) {
      await ctx.db.updateActionRunStatus(
        actionRun.id,
        'failed',
        'unsupported_destructive_mcp_tool',
      );
      return;
    }

    await assertMcpActiveScope(ctx, plan.targetProjectId, true, plan.identity);
    await ctx.db.updateActionRunStatus(actionRun.id, 'running');
    const result = await def.execute(plan.args, {
      target: 'mcp',
      appCtx: ctx,
      identity: plan.identity,
    });
    await ctx.db.updateActionRunPlan(
      actionRun.id,
      JSON.stringify({ ...plan, result, executedAt: new Date().toISOString() }),
    );
    await ctx.db.updateActionRunStatus(actionRun.id, 'succeeded');
  } catch (error) {
    const message =
      error instanceof OpenLanderError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    await ctx.db.updateActionRunStatus(actionRun.id, 'failed', message);
  }
}
