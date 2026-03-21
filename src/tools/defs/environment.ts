import type { AppContext } from '../../app.js';
import { ProjectNotFoundError } from '../../errors.js';
import {
  createEnvironmentSchema,
  deployEnvironmentSchema,
  listEnvironmentsSchema,
} from './schemas.js';
import type { ToolDef } from './types.js';

function getProjectByName(appCtx: AppContext, name: string) {
  const project = appCtx.db.getProjectByName(name);
  if (!project) throw new ProjectNotFoundError(name);
  return project;
}

const createEnvironmentTool: ToolDef = {
  name: 'create_environment',
  description:
    'Create a new environment for a project (e.g., development environment on a feature branch). Every project auto-creates a production environment on deploy — use this to add additional environments like development. Returns the created environment with { id, type, branch, status }. If the environment type already exists, returns the existing one. Errors: PROJECT_NOT_FOUND.',
  mcpDescription: 'Create an environment for a project branch and type.',
  inputSchema: createEnvironmentSchema,
  execute: (args, { appCtx }) => {
    const input = args as {
      project_name: string;
      type: 'production' | 'development';
      branch: string;
    };

    const project = getProjectByName(appCtx, input.project_name);
    const existing = appCtx.db
      .getEnvironmentsByProject(project.id)
      .find((environment) => environment.type === input.type);

    if (existing) {
      return {
        id: existing.id,
        type: existing.type,
        branch: existing.branch,
        status: existing.status,
        alreadyExists: true,
      };
    }

    const id = `${project.id}-${input.type}`;
    appCtx.db.createEnvironment({
      id,
      projectId: project.id,
      type: input.type,
      branch: input.branch,
    });

    return {
      id,
      type: input.type,
      branch: input.branch,
      status: 'idle',
    };
  },
};

const listEnvironmentsTool: ToolDef = {
  name: 'list_environments',
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

const deployEnvironmentTool: ToolDef = {
  name: 'deploy_environment',
  description:
    "Deploy a specific environment (production or development) for a project. Pulls latest code from the environment's configured branch and builds/runs it. Returns immediately with { status: 'building' } — poll with get_deploy_status. Errors: PROJECT_NOT_FOUND, ENVIRONMENT_NOT_FOUND.",
  mcpDescription: 'Deploy a specific project environment and start a new build.',
  inputSchema: deployEnvironmentSchema,
  execute: (args, { appCtx }) => {
    const input = args as {
      project_name: string;
      environment_type: 'production' | 'development';
      no_cache?: boolean;
    };

    const project = getProjectByName(appCtx, input.project_name);
    const environments = appCtx.db.getEnvironmentsByProject(project.id);
    const environment = environments.find((entry) => entry.type === input.environment_type);

    if (!environment) {
      throw new Error(
        `ENVIRONMENT_NOT_FOUND: No ${input.environment_type} environment found for project ${input.project_name}`,
      );
    }

    void appCtx.pipeline.deployEnvironment(project.id, environment.id, {
      trigger: 'chat',
      dockerfilePath: project.dockerfile_path || undefined,
      dockerTarget: project.docker_target ?? undefined,
      _noCacheBuild: input.no_cache === true,
    });

    return {
      status: 'building',
      projectId: project.id,
      environmentId: environment.id,
      type: environment.type,
      branch: environment.branch,
    };
  },
};

export const environmentToolDefs: ToolDef[] = [
  createEnvironmentTool,
  listEnvironmentsTool,
  deployEnvironmentTool,
];
