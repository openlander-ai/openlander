import type { Context } from 'hono';

import type { AppContext } from '../../../app.js';
import { ProjectNotFoundError } from '../../../errors.js';
import type { EnvironmentRow, ProjectRow } from '../../../db/index.js';

function environmentNotFoundResponse(c: Context, message: string): Response {
  return c.json({ error: 'ENVIRONMENT_NOT_FOUND', message }, 404);
}

export function getProjectOrThrow(c: Context, ctx: AppContext): ProjectRow {
  const id = c.req.param('id') ?? '';
  const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
  if (!project) throw new ProjectNotFoundError(id);
  return project;
}

export function getEnvironmentByIdOrThrow(
  c: Context,
  ctx: AppContext,
  projectId: string,
): EnvironmentRow | Response {
  const envId = c.req.param('envId') ?? '';
  const environment = ctx.db.getEnvironment(envId);
  if (!environment || environment.project_id !== projectId) {
    return environmentNotFoundResponse(c, 'Environment not found');
  }
  return environment;
}

export function resolveEnvironmentByType(
  c: Context,
  ctx: AppContext,
  project: ProjectRow,
  options?: { requireExistingEnvironmentWhenAnyExists?: boolean },
):
  | { requestedEnvironment: string; environmentRow: EnvironmentRow | undefined }
  | { response: Response } {
  const requestedEnvironment = (c.req.query('environment') ?? 'production').toLowerCase();
  const environments = ctx.db.getEnvironmentsByProject(project.id);
  const environmentRow = environments.find(
    (environment) => environment.type === requestedEnvironment,
  );
  const shouldRequireEnvironment =
    requestedEnvironment !== 'production' ||
    (options?.requireExistingEnvironmentWhenAnyExists === true && environments.length > 0);

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
