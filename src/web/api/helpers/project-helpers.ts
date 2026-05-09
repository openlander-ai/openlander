import type { Context } from 'hono';

import type { AppContext } from '../../../app.js';
import { ProjectNotFoundError } from '../../../errors.js';
import type { EnvironmentRow, ProjectRow } from '../../../db/index.js';

function environmentNotFoundResponse(c: Context, message: string): Response {
  return c.json({ error: 'ENVIRONMENT_NOT_FOUND', message }, 404);
}

export async function getProjectOrThrow(
  c: Context,
  ctx: Pick<AppContext, 'db'>,
): Promise<ProjectRow> {
  const id = c.req.param('id') ?? '';
  const project = (await ctx.db.getProject(id)) ?? (await ctx.db.getProjectByName(id));
  if (!project) throw new ProjectNotFoundError(id);
  return project;
}

export async function getEnvironmentByIdOrThrow(
  c: Context,
  ctx: AppContext,
  projectId: string,
): Promise<EnvironmentRow | Response> {
  const envId = c.req.param('envId') ?? '';
  const environment = await ctx.db.getEnvironment(envId);
  if (!environment || environment.project_id !== projectId) {
    return environmentNotFoundResponse(c, 'Environment not found');
  }
  return environment;
}

export async function resolveEnvironmentByType(
  c: Context,
  ctx: AppContext,
  project: ProjectRow,
  options?: { requireExistingEnvironmentWhenAnyExists?: boolean },
): Promise<
  | { requestedEnvironment: string; environmentRow: EnvironmentRow | undefined }
  | { response: Response }
> {
  const requestedEnvironment = 'production';
  const environments = await ctx.db.getEnvironmentsByProject(project.id);
  const environmentRow = environments.find((environment) => environment.type === 'production');
  const shouldRequireEnvironment =
    options?.requireExistingEnvironmentWhenAnyExists === true && environments.length > 0;

  if (shouldRequireEnvironment && !environmentRow) {
    return {
      response: environmentNotFoundResponse(
        c,
        `${requestedEnvironment} environment not found for project`,
      ),
    };
  }

  return { requestedEnvironment, environmentRow };
}
