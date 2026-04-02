import type { AppContext } from '../../app.js';
import { ProjectNotFoundError } from '../../errors.js';
import { listEnvironmentsSchema } from './schemas.js';
import type { ToolDef } from './types.js';

function getProjectByName(appCtx: AppContext, name: string) {
  const project = appCtx.db.getProjectByName(name);
  if (!project) throw new ProjectNotFoundError(name);
  return project;
}

const listEnvironmentsTool: ToolDef = {
  name: 'list_environments',
  riskLevel: 'low',
  description:
    'List all environments for a project with type, branch, status, and container info. Every project has at least a production environment. Returns { count, environments[] }. Errors: PROJECT_NOT_FOUND.',
  mcpDescription: 'List project environments with branch and runtime status.',
  inputSchema: listEnvironmentsSchema,
  execute: (args, { appCtx }) => {
    const input = args as { project_name: string };
    const project = getProjectByName(appCtx, input.project_name);
    const environments = appCtx.db.getEnvironmentsByProject(project.id);

    return {
      count: environments.length,
      environments: environments.map((environment) => ({
        id: environment.id,
        type: environment.type,
        branch: environment.branch,
        status: environment.status,
        containerId: environment.container_id,
        publicUrl: environment.public_url,
      })),
    };
  },
};

export const environmentToolDefs: ToolDef[] = [listEnvironmentsTool];
