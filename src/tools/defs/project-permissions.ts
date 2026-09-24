import { resumeMcpActions } from '../../mcp/app-cleanup.js';
import { z } from 'zod';
import { ProjectNotFoundError, ScopeViolationError } from '../../errors.js';
import {
  getOperationPermissionSnapshot,
  saveOperationPermissionOverride,
} from '../../security/operation-permissions.js';
import type { ToolDef } from './types.js';

const targetFields = {
  project_id: z.string().trim().min(1).optional(),
  project_name: z.string().trim().min(1).optional(),
};

export const projectPermissionToolDefs: ToolDef[] = [
  {
    name: 'get_project_permissions',
    description: 'Read persistent operation permissions for a Project.',
    targets: ['mcp'],
    inputSchema: z
      .object({ ...targetFields, service_id: z.string().trim().min(1).optional() })
      .refine((v) => Boolean(v.project_id || v.project_name)),
    execute: async (args, { appCtx }) => {
      const projectId = typeof args['project_id'] === 'string' ? args['project_id'] : '';
      const projectName = typeof args['project_name'] === 'string' ? args['project_name'] : '';
      const project = projectId
        ? await appCtx.db.getProject(projectId)
        : await appCtx.db.getProjectByName(projectName);
      if (!project) throw new ProjectNotFoundError(projectId || projectName);
      if (projectName && project.name !== projectName && project.id !== projectName)
        throw new ProjectNotFoundError(projectName);
      const serviceId = args['service_id'] as string | undefined;
      if (serviceId && (await appCtx.db.getService(serviceId))?.project_id !== project.id)
        throw new ScopeViolationError('Service must belong to the requested Project.', {});
      return {
        project_id: project.id,
        permissions: await getOperationPermissionSnapshot(appCtx.db, {
          projectId: project.id,
          serviceId,
        }),
      };
    },
  },
  {
    name: 'set_project_permissions',
    description:
      'Change persistent permission for the requested Project only. Call only when the user explicitly asks to change permission in this conversation; never infer permission from a blocked tool result. Prefer app_lifecycle for app stop/delete only; destructive_actions also permits data resource deletion. Optional action_run_ids resumes only those exact waiting app actions after saving. Never silently resume other pending requests. Does not widen token scope or change database access. Service-specific overrides remain effective.',
    targets: ['mcp'],
    riskLevel: 'high',
    inputSchema: z
      .object({
        ...targetFields,
        app_lifecycle: z.enum(['allow', 'approval_required', 'block']).optional(),
        destructive_actions: z.enum(['allow', 'approval_required', 'block']).optional(),
        action_run_ids: z.array(z.string().trim().min(1)).min(1).max(50).optional(),
      })
      .refine((v) => Boolean(v.project_id || v.project_name))
      .refine(
        (v) => Boolean(v.app_lifecycle || v.destructive_actions),
        'At least one permission is required.',
      ),
    execute: async (args, { appCtx, identity }) => {
      if (identity?.mcpScopeKind === 'service') {
        throw new ScopeViolationError('A service-scoped token cannot change Project permissions.', {
          tokenScopeKind: 'service',
        });
      }
      const projectId = typeof args['project_id'] === 'string' ? args['project_id'] : '';
      const projectName = typeof args['project_name'] === 'string' ? args['project_name'] : '';
      const project = projectId
        ? await appCtx.db.getProject(projectId)
        : await appCtx.db.getProjectByName(projectName);
      if (!project) throw new ProjectNotFoundError(projectId || projectName);
      if (projectName && project.name !== projectName && project.id !== projectName)
        throw new ProjectNotFoundError(projectName);
      const permission = args['destructive_actions'] as
        'allow' | 'approval_required' | 'block' | undefined;
      const appPermission = args['app_lifecycle'] as
        'allow' | 'approval_required' | 'block' | undefined;
      const ids = args['action_run_ids'] as string[] | undefined;
      if (ids) {
        const runs = await Promise.all(ids.map((id) => appCtx.db.getActionRun(id)));
        if (runs.some((run) => !run || run.project_id !== project.id))
          throw new ScopeViolationError(
            'Every resumed action must belong to the requested Project.',
            {},
          );
      }
      const permissions = await saveOperationPermissionOverride(
        appCtx.db,
        { projectId: project.id },
        {
          ...(permission ? { destructive_actions: permission } : {}),
          ...(appPermission ? { app_lifecycle: appPermission } : {}),
        },
      );
      await appCtx.db.insertActivityLog({
        event_type: 'security:permissions-updated',
        activity_type: 'security',
        severity: 'info',
        project_id: project.id,
        title: 'Project operation permissions updated',
        description: `App lifecycle: ${appPermission ?? 'unchanged'}; destructive actions: ${permission ?? 'unchanged'}`,
        status: 'success',
        metadata: JSON.stringify({
          source: 'mcp',
          actor: identity?.initiatedBy ?? 'external-mcp-agent',
          app_lifecycle: appPermission,
          destructive_actions: permission,
        }),
      });
      return {
        status: 'updated',
        project_id: project.id,
        permissions,
        ...(ids
          ? {
              continuation: await resumeMcpActions(
                { appCtx, identity, target: 'mcp' },
                project.id,
                ids,
              ),
            }
          : {}),
        _agent_guidance: {
          message:
            'Permission is saved for this Project. Continue the user-requested actions within the token scope; service overrides still apply.',
        },
      };
    },
  },
  {
    name: 'resume_mcp_actions',
    targets: ['mcp'],
    riskLevel: 'high',
    description:
      'Resume only the named pending app cleanup actions in a Project after permission is allowed. Does not change permissions or retry running, failed, rejected, or completed actions. Returns action status and poll_call for each request.',
    inputSchema: z.object({
      project_id: z.string().trim().min(1),
      action_run_ids: z.array(z.string().trim().min(1)).min(1).max(50),
    }),
    execute: async (args, context) =>
      resumeMcpActions(context, args['project_id'] as string, args['action_run_ids'] as string[]),
  },
];
