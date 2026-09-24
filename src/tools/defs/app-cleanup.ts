import { z } from 'zod';
import type { ToolDef } from './types.js';
import {
  inspectAppCleanup,
  startAllowedMcpAction,
  type AppCleanupArgs,
} from '../../mcp/app-cleanup.js';
import { buildMcpActionStatusCall } from '../../mcp/agent-lifecycle-contract.js';

export const appCleanupToolDefs: ToolDef[] = [
  {
    name: 'cleanup_apps',
    targets: ['mcp'],
    riskLevel: 'high',
    description:
      'Stop or delete multiple app/Compose services in one Project. Preserves volumes; excludes managed data services. Returns a durable action_run_id and poll_call immediately, with per-service results available through mcp_action_status. If permission is required, keep this ID and explicitly resume it after the user grants app_lifecycle permission. Never re-submit cleanup_apps to poll or resume.',
    inputSchema: z.object({
      project_id: z.string().trim().min(1),
      service_ids: z
        .array(z.string().trim().min(1))
        .min(1)
        .max(50)
        .refine(
          (ids) => new Set(ids).size === ids.length,
          'Duplicate service IDs are not allowed.',
        ),
      operation: z.enum(['stop', 'delete']),
    }),
    execute: async (input, context) => {
      const args = input as unknown as AppCleanupArgs;
      const inspection = await inspectAppCleanup(args, context);
      const blocked = inspection.permissions.find(
        (item) => item.response && item.response.status !== 'pending_approval',
      );
      if (blocked) return { ...blocked.response, service_id: blocked.service_id };
      const pending = inspection.permissions.some((item) => item.response);
      const plan = {
        type: 'destructive_mcp',
        tool: 'cleanup_apps',
        args,
        targetProjectId: args.project_id,
        identity: context.identity,
        requestedAt: new Date().toISOString(),
        result: {
          operation: args.operation,
          total: inspection.roots.length,
          succeeded: 0,
          failed: 0,
          results: [],
        },
      };
      const id = await context.appCtx.db.createPendingMcpApproval({
        projectId: args.project_id,
        toolName: 'cleanup_apps',
        plan: JSON.stringify(plan),
      });
      if (!pending) await startAllowedMcpAction(context, id);
      return {
        status: pending ? 'pending_approval' : 'running',
        project_id: args.project_id,
        action_run_id: id,
        total: inspection.roots.length,
        poll_call: buildMcpActionStatusCall(id),
        suggested_call: pending
          ? {
              tool: 'openlander_project',
              arguments: {
                action: 'set_project_permissions',
                params: {
                  project_id: args.project_id,
                  app_lifecycle: 'allow',
                  action_run_ids: [id],
                },
              },
            }
          : undefined,
        _agent_guidance: {
          message: pending
            ? 'Ask the user whether to allow app stop/delete for this Project. Only on their explicit permission request, use suggested_call to save it and resume this exact action. Service overrides may still block it.'
            : 'Poll this action ID until complete and report every service result. Do not repeat cleanup_apps.',
        },
      };
    },
  },
];
