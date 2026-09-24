import type { ToolContext, ToolDef } from '../tools/defs/types.js';
import { deployableServiceToolDefs } from '../tools/defs/deployable-service.js';
import { MANAGED_SERVICE_KINDS } from '../db/repos/service.repo.js';
import { OpenLanderError, ServiceNotFoundError, ScopeViolationError } from '../errors.js';
import { maybeHandleMcpSafety } from './destructive-safety.js';
import { maybeRejectMcpScope } from './scope-policy.js';
import { buildMcpActionStatusCall } from './agent-lifecycle-contract.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('mcp-cleanup');
function appTool(name: string): ToolDef {
  const def = deployableServiceToolDefs.find((tool) => tool.name === name);
  if (!def)
    throw new OpenLanderError('App lifecycle action is unavailable.', 'UNKNOWN_ACTION', 400);
  return def;
}

export interface AppCleanupArgs {
  project_id: string;
  service_ids: string[];
  operation: 'stop' | 'delete';
}

export async function inspectAppCleanup(args: AppCleanupArgs, context: ToolContext) {
  const services = await context.appCtx.db.listServices();
  const byId = new Map(services.map((service) => [service.id, service]));
  const targets = new Set(args.service_ids);
  for (const id of args.service_ids) {
    const service = byId.get(id);
    if (!service) throw new ServiceNotFoundError(id);
    if (service.project_id !== args.project_id)
      throw new ScopeViolationError('Every service must belong to the requested Project.', {});
    if ((MANAGED_SERVICE_KINDS as readonly string[]).includes(service.kind)) {
      throw new OpenLanderError(
        'App cleanup does not remove managed data services.',
        'INVALID_CLEANUP_TARGET',
        400,
      );
    }
    if (service.kind === 'compose') {
      const descendants = new Set([id]);
      for (const parentId of descendants) {
        for (const child of services) {
          if (child.parent_service_id === parentId) {
            descendants.add(child.id);
            targets.add(child.id);
          }
        }
      }
    }
  }
  // Top-level selected Compose services already include their descendants.
  const roots = args.service_ids.filter((id) => {
    let parent = byId.get(id)?.parent_service_id;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      if (targets.has(parent)) return false;
      seen.add(parent);
      parent = byId.get(parent)?.parent_service_id;
    }
    return true;
  });
  const def = appTool(`${args.operation}_app`);
  const permissions = [];
  for (const id of targets) {
    if (byId.get(id)?.project_id !== args.project_id)
      throw new ScopeViolationError(
        'Every affected service must belong to the requested Project.',
        {},
      );
    const params = { service_id: id };
    const scopeError = await maybeRejectMcpScope(def, params, context);
    if (scopeError) throw new ScopeViolationError(scopeError.message, scopeError.details);
    permissions.push({
      service_id: id,
      response: await maybeHandleMcpSafety(def, params, context, { preview: true }),
    });
  }
  return { roots, permissions };
}

export async function executeAppCleanup(
  args: AppCleanupArgs,
  context: ToolContext,
  actionRunId: string,
  plan: Record<string, unknown>,
  requirePermission = false,
) {
  const { roots } = await inspectAppCleanup(args, context);
  const results: Array<{
    service_id: string;
    status: string;
    error_code?: string;
    message?: string;
  }> = [];
  const summarize = () => ({
    operation: args.operation,
    total: roots.length,
    succeeded: results.filter(
      (result) => result.status === 'stopped' || result.status === 'deleted',
    ).length,
    failed: results.filter((result) => result.status === 'failed').length,
    results,
  });
  for (const serviceId of roots) {
    try {
      const def = appTool(`${args.operation}_app`);
      const rejection = await maybeHandleMcpSafety(def, { service_id: serviceId }, context, {
        preview: true,
      });
      if (rejection && (requirePermission || rejection.status !== 'pending_approval')) {
        throw new OpenLanderError(
          'App cleanup permission no longer allows this service.',
          'OPERATION_PERMISSION_DENIED',
          403,
        );
      }
      if (args.operation === 'stop') await context.appCtx.pipeline.stopService(serviceId);
      else await context.appCtx.pipeline.deleteService(serviceId, context.appCtx.cloudflare);
      results.push({
        service_id: serviceId,
        status: args.operation === 'stop' ? 'stopped' : 'deleted',
      });
    } catch (error) {
      results.push({
        service_id: serviceId,
        status: 'failed',
        error_code: error instanceof OpenLanderError ? error.code : 'INTERNAL_ERROR',
        message: error instanceof OpenLanderError ? error.message : 'Service cleanup failed.',
      });
    }
    await context.appCtx.db.updateActionRunPlan(
      actionRunId,
      JSON.stringify({ ...plan, result: summarize() }),
    );
  }
  return summarize();
}

export async function startAllowedMcpAction(context: ToolContext, actionRunId: string) {
  if (!(await context.appCtx.db.claimMcpActionExecution(actionRunId, true))) return false;
  // Ownership is durable before returning. The executor records per-run failures.
  const { executeClaimedMcpAction } = await import('./destructive-executor.js');
  void executeClaimedMcpAction(context.appCtx, actionRunId, true).catch((error: unknown) => {
    log.error({ error, actionRunId }, 'Failed to record MCP action execution');
  });
  return true;
}

export async function resumeMcpActions(context: ToolContext, projectId: string, ids: string[]) {
  const runs = await Promise.all(ids.map((id) => context.appCtx.db.getActionRun(id)));
  // Validate the complete set before starting anything.
  for (const run of runs) {
    if (!run || run.project_id !== projectId)
      throw new ScopeViolationError('Every action must belong to the requested Project.', {});
    if (run.approval_tool !== 'destructive_mcp')
      throw new OpenLanderError('Only held MCP actions can be resumed.', 'INVALID_ACTION_RUN', 400);
  }
  const results = [];
  for (const run of runs) {
    if (!run) continue;
    const poll_call = buildMcpActionStatusCall(run.id);
    if (run.status !== 'pending_approval' || run.approval_status === 'rejected') {
      results.push({ action_run_id: run.id, status: run.status, poll_call });
      continue;
    }
    const plan = JSON.parse(run.plan ?? '{}') as Record<string, unknown>;
    const args = plan['args'] as Record<string, unknown>;
    if (
      plan['type'] !== 'destructive_mcp' ||
      !['stop_app', 'delete_app', 'cleanup_apps'].includes(String(plan['tool']))
    ) {
      results.push({
        action_run_id: run.id,
        status: 'pending_approval',
        code: 'WEB_APPROVAL_REQUIRED',
        poll_call,
      });
      continue;
    }
    let blocked;
    if (plan['tool'] === 'cleanup_apps') {
      const inspection = await inspectAppCleanup(args as unknown as AppCleanupArgs, context);
      blocked = inspection.permissions.find((item) => item.response)?.response;
    } else {
      const def = appTool(String(plan['tool']));
      blocked =
        (await maybeRejectMcpScope(def, args, context)) ??
        (await maybeHandleMcpSafety(def, args, context, { preview: true }));
    }
    if (blocked) {
      results.push({ action_run_id: run.id, status: 'blocked', reason: blocked, poll_call });
      continue;
    }
    const started = await startAllowedMcpAction(context, run.id);
    results.push({
      action_run_id: run.id,
      status: started
        ? 'running'
        : ((await context.appCtx.db.getActionRun(run.id))?.status ?? 'not_found'),
      poll_call,
    });
  }
  return {
    project_id: projectId,
    actions: results,
    _agent_guidance: {
      message:
        'Poll the returned action IDs. Repeating this continuation never restarts a running or completed action. Report every failed service; do not create a new cleanup request to poll.',
    },
  };
}
