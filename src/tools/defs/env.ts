import type { ToolDef } from './types.js';
import { ProjectNotFoundError } from '../../errors.js';
import {
  listGlobalSecretsSchema,
  projectNameSchema,
  setEnvVarsSchema,
  setGlobalSecretSchema,
} from './schemas.js';

function getProjectByName(appCtx: Parameters<ToolDef['execute']>[1]['appCtx'], name: string) {
  const project = appCtx.db.getProjectByName(name);
  if (!project) {
    throw new ProjectNotFoundError(name);
  }
  return project;
}

export const envToolDefs: ToolDef[] = [
  {
    name: 'set_env_vars',
    description:
      'Set environment variables for a project and trigger a redeploy if running. Use when user needs to configure DATABASE_URL, API keys, or other env vars. The variables parameter must be a JSON string of key-value pairs, e.g. {"DATABASE_URL": "postgresql://user:pass@ol-svc-pg:5432/db", "REDIS_URL": "redis://ol-svc-redis:6379"}. For host services use host.docker.internal as hostname. For OpenLander services use the container name (ol-svc-*). Returns { status, project, keys[] }. Errors: PROJECT_NOT_FOUND, JSON parse error if variables is malformed.',
    inputSchema: setEnvVarsSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const project = getProjectByName(appCtx, projectName);
      const vars = JSON.parse(args['variables'] as string) as Record<string, string>;
      const changed = appCtx.env.setBulk(project.id, vars);

      if (changed && project.status === 'running') {
        await appCtx.pipeline.redeploy(project.id);
        return {
          status: 'updated_and_redeployed',
          project: projectName,
          keys: Object.keys(vars),
        };
      }

      return {
        status: 'updated',
        project: projectName,
        keys: Object.keys(vars),
      };
    },
  },
  {
    name: 'set_global_secret',
    description:
      'Set a global secret that is available to all projects (stored encrypted). Use for shared API keys, database credentials, etc. that multiple projects need. Returns { status, key }.',
    inputSchema: setGlobalSecretSchema,
    execute: (args, { appCtx, target }) => {
      const key = args['key'] as string;
      const value = args['value'] as string;
      const description = args['description'] as string | undefined;
      appCtx.env.setGlobalSecret(key, value, description);

      if (target === 'mcp') {
        return { status: 'saved', key };
      }

      return { status: 'saved', key, message: `Global secret "${key}" saved (encrypted).` };
    },
  },
  {
    name: 'list_global_secrets',
    description:
      'List all global secrets (values are masked for security). Returns { secrets: [{ key, maskedValue, description }], count }.',
    inputSchema: listGlobalSecretsSchema,
    execute: (_args, { appCtx }) => {
      const secrets = appCtx.env.getGlobalSecretsMasked();
      return { secrets, count: secrets.length };
    },
  },
  {
    name: 'expose_public',
    description:
      'Create a temporary public URL for a project via TryCloudflare tunnel. Use when user wants to share their app externally or test from another device. Returns { status, project, publicUrl }. The URL is temporary and changes on restart. Errors: PROJECT_NOT_FOUND, "not running" if project has no port — deploy it first. For permanent custom domains, use map_domain instead.',
    inputSchema: projectNameSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const project = getProjectByName(appCtx, projectName);
      if (!project.assigned_port) {
        return { error: 'Project is not running — deploy it first' };
      }

      const url = await appCtx.pipeline.exposeTunnel(project.id, project.assigned_port);
      return { status: 'exposed', project: projectName, publicUrl: url };
    },
  },
  {
    name: 'unexpose_public',
    description:
      'Remove the public TryCloudflare tunnel URL for a project. Use when user wants to make a project private again. Returns { status, project }. Errors: PROJECT_NOT_FOUND.',
    inputSchema: projectNameSchema,
    execute: (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const project = getProjectByName(appCtx, projectName);
      appCtx.pipeline.closeTunnel(project.id);
      return { status: 'unexposed', project: projectName };
    },
  },
];
