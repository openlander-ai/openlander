import { Hono } from 'hono';

import type { AppContext } from '../../app.js';

const DESTRUCTIVE_DETAIL_KEYS = [
  'keys',
  'key',
  'filename',
  'path',
  'name',
  'project_name',
  'service_name',
  'service_id',
] as const;

export function createApprovalRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  function readString(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    return typeof value === 'string' && value ? value : null;
  }

  function readDestructivePlanDetails(planJson: string | null): {
    toolName: string;
    details?: Record<string, unknown>;
    actor?: Record<string, unknown>;
  } {
    if (!planJson) return { toolName: 'unknown' };
    try {
      const plan = JSON.parse(planJson) as Record<string, unknown>;
      const toolName = typeof plan['tool'] === 'string' ? plan['tool'] : 'unknown';
      const identity = plan['identity'];
      const actor =
        identity && typeof identity === 'object'
          ? {
              source: readString(identity as Record<string, unknown>, 'source'),
              initiatedBy: readString(identity as Record<string, unknown>, 'initiatedBy'),
              tokenId: readString(identity as Record<string, unknown>, 'mcpTokenId'),
              tokenType: readString(identity as Record<string, unknown>, 'mcpTokenType'),
              scopeKind: readString(identity as Record<string, unknown>, 'mcpScopeKind'),
              scopeProjectId: readString(identity as Record<string, unknown>, 'mcpScopeProjectId'),
              scopeServiceId: readString(identity as Record<string, unknown>, 'mcpScopeServiceId'),
            }
          : undefined;
      const args = plan['args'];
      const details: Record<string, unknown> = {};

      const statefulCompose = plan['statefulCompose'];
      if (statefulCompose && typeof statefulCompose === 'object') {
        const changes = (statefulCompose as Record<string, unknown>)['changes'];
        if (Array.isArray(changes)) {
          const changeRecords = changes.filter(
            (change): change is Record<string, unknown> =>
              Boolean(change) && typeof change === 'object' && !Array.isArray(change),
          );
          details['services'] = changeRecords.flatMap((change) =>
            typeof change['serviceName'] === 'string' ? [change['serviceName']] : [],
          );
          details['changed_fields'] = [
            ...new Set(
              changeRecords.flatMap((change) =>
                Array.isArray(change['changedFields'])
                  ? change['changedFields'].filter(
                      (field): field is string => typeof field === 'string',
                    )
                  : [],
              ),
            ),
          ];
          details['backup'] = 'required before replacement';
          details['data_effect'] = changeRecords.some((change) => change['change'] === 'remove')
            ? 'removed resources are stopped and archived; named volumes and backups are retained'
            : 'previous containers and named volumes are retained for rollback';
        }
      }

      if (!args || typeof args !== 'object') {
        return Object.keys(details).length > 0
          ? actor
            ? { toolName, details, actor }
            : { toolName, details }
          : actor
            ? { toolName, actor }
            : { toolName };
      }

      const argRecord = args as Record<string, unknown>;

      for (const key of DESTRUCTIVE_DETAIL_KEYS) {
        const value = argRecord[key];
        if (Array.isArray(value)) {
          const strings = value.filter(
            (item): item is string => typeof item === 'string' && !!item,
          );
          if (strings.length > 0) details[key] = strings;
          continue;
        }
        if (typeof value === 'string' && value) {
          details[key] = value;
        }
      }

      if (Object.keys(details).length > 0) {
        return actor ? { toolName, details, actor } : { toolName, details };
      }
      return actor ? { toolName, actor } : { toolName };
    } catch {
      return { toolName: 'unknown' };
    }
  }

  // --- Pending Approvals ---

  api.get('/approvals/pending', async (c) => {
    const approvals = await Promise.all(
      (await ctx.db.getActionRunsByApprovalStatus('pending', 50))
        .filter((run) => run.approval_tool === 'destructive_mcp')
        .map(async (run) => {
          const { toolName, details, actor } = readDestructivePlanDetails(run.plan);
          const project = run.project_id ? await ctx.db.getProject(run.project_id) : undefined;
          return {
            id: run.id,
            createdAt: run.approval_requested_at ?? run.created_at,
            metadata: {
              actionRunId: run.id,
              projectId: run.project_id,
              projectName: project?.name ?? run.project_id,
              toolName,
              source: 'mcp',
              details,
              actor,
            },
          };
        }),
    );
    return c.json({ approvals });
  });

  return api;
}
