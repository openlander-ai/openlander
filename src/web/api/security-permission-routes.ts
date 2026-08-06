import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { ORPHAN_MANAGED_GROUP_ID } from '../../db/service-ids.js';
import { ServiceNotFoundError } from '../../errors.js';
import {
  getOperationPermissionSnapshot,
  saveGlobalOperationPermissions,
  saveOperationPermissionOverride,
  type DatabaseAccessPermission,
  type DestructiveActionPermission,
} from '../../security/operation-permissions.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';

interface PermissionPatch {
  destructive_actions?: DestructiveActionPermission | null;
  database_access?: DatabaseAccessPermission | null;
}

function parsePatch(
  body: Record<string, unknown>,
  allowInherit: boolean,
): { ok: true; patch: PermissionPatch } | { ok: false; message: string } {
  const patch: PermissionPatch = {};
  if ('destructive_actions' in body) {
    const value = body['destructive_actions'];
    if (
      value !== 'allow' &&
      value !== 'approval_required' &&
      value !== 'block' &&
      !(allowInherit && value === null)
    ) {
      return {
        ok: false,
        message:
          'destructive_actions must be "allow", "approval_required", "block", or null for inheritance.',
      };
    }
    patch.destructive_actions = value;
  }
  if ('database_access' in body) {
    const value = body['database_access'];
    if (value !== 'allow' && value !== 'block' && !(allowInherit && value === null)) {
      return {
        ok: false,
        message: 'database_access must be "allow", "block", or null for inheritance.',
      };
    }
    patch.database_access = value;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, message: 'At least one permission field is required.' };
  }
  return { ok: true, patch };
}

function invalidPatchResponse(message: string) {
  return {
    error: 'INVALID_OPERATION_PERMISSION',
    code: 'INVALID_OPERATION_PERMISSION',
    message,
  };
}

export function createSecurityPermissionRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/security/permissions', async (c) => {
    const permissions = await getOperationPermissionSnapshot(ctx.db);
    return c.json({ scope: 'global', permissions });
  });

  api.patch('/security/permissions', async (c) => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const parsed = parsePatch(body, false);
    if (!parsed.ok) return c.json(invalidPatchResponse(parsed.message), 400);
    const permissions = await saveGlobalOperationPermissions(ctx.db, {
      ...(parsed.patch.destructive_actions
        ? { destructive_actions: parsed.patch.destructive_actions }
        : {}),
      ...(parsed.patch.database_access ? { database_access: parsed.patch.database_access } : {}),
    });
    return c.json({ scope: 'global', permissions });
  });

  api.get('/projects/:id/security/permissions', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const permissions = await getOperationPermissionSnapshot(ctx.db, { projectId: project.id });
    return c.json({ scope: 'project', project_id: project.id, permissions });
  });

  api.patch('/projects/:id/security/permissions', async (c) => {
    const project = await getProjectOrThrow(c, ctx);
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const parsed = parsePatch(body, true);
    if (!parsed.ok) return c.json(invalidPatchResponse(parsed.message), 400);
    const permissions = await saveOperationPermissionOverride(
      ctx.db,
      { projectId: project.id },
      parsed.patch,
    );
    return c.json({ scope: 'project', project_id: project.id, permissions });
  });

  api.get('/services/:id/security/permissions', async (c) => {
    const service = await ctx.db.getService(c.req.param('id'));
    if (!service) throw new ServiceNotFoundError(c.req.param('id'));
    const projectId = service.project_id === ORPHAN_MANAGED_GROUP_ID ? null : service.project_id;
    const permissions = await getOperationPermissionSnapshot(ctx.db, {
      projectId,
      serviceId: service.id,
    });
    return c.json({
      scope: 'service',
      project_id: projectId,
      service_id: service.id,
      permissions,
    });
  });

  api.patch('/services/:id/security/permissions', async (c) => {
    const service = await ctx.db.getService(c.req.param('id'));
    if (!service) throw new ServiceNotFoundError(c.req.param('id'));
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const parsed = parsePatch(body, true);
    if (!parsed.ok) return c.json(invalidPatchResponse(parsed.message), 400);
    const projectId =
      service.project_id === ORPHAN_MANAGED_GROUP_ID ? undefined : service.project_id;
    const permissions = await saveOperationPermissionOverride(
      ctx.db,
      { projectId, serviceId: service.id },
      parsed.patch,
    );
    return c.json({
      scope: 'service',
      project_id: projectId ?? null,
      service_id: service.id,
      permissions,
    });
  });

  return api;
}
