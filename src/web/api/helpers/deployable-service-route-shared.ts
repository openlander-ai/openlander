import type { Context } from 'hono';

import type { AppContext } from '../../../app.js';
import type { ProjectRow, ServiceRow } from '../../../db/index.js';
import { projectIdToDeployableServiceId } from '../../../db/service-ids.js';

export type ResolvedDeployableService = {
  project: ProjectRow;
  service: ServiceRow;
};

export async function resolveProject(
  ctx: AppContext,
  value: string,
): Promise<ProjectRow | undefined> {
  return (await ctx.db.getProject(value)) ?? (await ctx.db.getProjectByName(value));
}

export async function findService(
  ctx: AppContext,
  serviceParam: string,
): Promise<ServiceRow | null> {
  return (
    (await ctx.db.getService(serviceParam)) ??
    (await ctx.db.getService(projectIdToDeployableServiceId(serviceParam))) ??
    null
  );
}

export async function resolveDeployableServiceForRoute(
  c: Context,
  ctx: AppContext,
): Promise<ResolvedDeployableService | Response> {
  const projectParam = c.req.param('p') ?? '';
  const serviceParam = c.req.param('s') ?? '';
  const project = await resolveProject(ctx, projectParam);
  if (!project) {
    return c.json({ error: 'NOT_FOUND', message: `Project not found: ${projectParam}` }, 404);
  }

  const service = await findService(ctx, serviceParam);
  if (!service || service.project_id !== project.id) {
    return c.json({ error: 'NOT_FOUND', message: `Service not found: ${serviceParam}` }, 404);
  }

  return { project, service };
}
