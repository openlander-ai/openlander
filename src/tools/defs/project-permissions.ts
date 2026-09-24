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
    inputSchema: z.object(targetFields).refine((v) => Boolean(v.project_id || v.project_name)),
    execute: async (args, { appCtx }) => {
      const projectId = typeof args['project_id'] === 'string' ? args['project_id'] : '';
      const projectName = typeof args['project_name'] === 'string' ? args['project_name'] : '';
      const project = projectId
        ? await appCtx.db.getProject(projectId)
        : await appCtx.db.getProjectByName(projectName);
      if (!project) throw new ProjectNotFoundError(projectId || projectName);
      if (projectName && project.name !== projectName && project.id !== projectName)
        throw new ProjectNotFoundError(projectName);
      return {
        project_id: project.id,
        permissions: await getOperationPermissionSnapshot(appCtx.db, { projectId: project.id }),
      };
    },
  },
  {
    name: 'set_project_permissions',
    description:
      'Change persistent destructive-action permission for the requested Project only. Call only when the user explicitly asks to change permission in this conversation; never infer permission from a blocked tool result. allow lets subsequent stop, archive, and delete actions run without per-action web approval. Does not widen token scope or change database access. Service-specific overrides remain effective.',
    targets: ['mcp'],
    riskLevel: 'high',
    inputSchema: z
      .object({
        ...targetFields,
        destructive_actions: z.enum(['allow', 'approval_required', 'block']),
      })
      .refine((v) => Boolean(v.project_id || v.project_name)),
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
      const permission = args['destructive_actions'] as 'allow' | 'approval_required' | 'block';
      const permissions = await saveOperationPermissionOverride(
        appCtx.db,
        { projectId: project.id },
        { destructive_actions: permission },
      );
      await appCtx.db.insertActivityLog({
        event_type: 'security:permissions-updated',
        activity_type: 'security',
        severity: 'info',
        project_id: project.id,
        title: 'Project operation permissions updated',
        description: `Destructive actions: ${permission}`,
        status: 'success',
        metadata: JSON.stringify({
          source: 'mcp',
          actor: identity?.initiatedBy ?? 'external-mcp-agent',
          destructive_actions: permission,
        }),
      });
      return {
        status: 'updated',
        project_id: project.id,
        permissions,
        _agent_guidance: {
          message:
            'Permission is saved for this Project. Continue the user-requested actions within the token scope; service overrides still apply.',
        },
      };
    },
  },
];
