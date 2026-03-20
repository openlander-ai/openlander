import type { ToolDef } from './types.js';
import { ProjectNotFoundError } from '../../errors.js';
import { EnvManager } from '../../pipeline/env.js';
import {
  getEnvVarSchema,
  listEnvVarsSchema,
  listGlobalSecretsSchema,
  listSecretFilesSchema,
  projectNameSchema,
  removeSecretFileSchema,
  setEnvVarsSchema,
  setGlobalSecretSchema,
  uploadSecretFileSchema,
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
    name: 'list_env_vars',
    description:
      'List all environment variables for a project (values are masked for security). Use to check what variables are currently set before adding or modifying. Returns { variables: { KEY: "sk-****7890" }, count } or with source tracking { variables: { KEY: { value: "sk-****7890", source: "project" } }, count }. Errors: PROJECT_NOT_FOUND, ENVIRONMENT_NOT_FOUND.',
    mcpDescription:
      'List environment variables with optional source tracking. Priority: global < project < production < environment. Pass environment_name to see source (global/project/production/environment) for each var. Values always masked.',
    inputSchema: listEnvVarsSchema,
    execute: (_args, { appCtx }) => {
      const projectName = _args['project_name'] as string;
      const environmentName = _args['environment_name'] as string | undefined;
      const project = getProjectByName(appCtx, projectName);

      // Backward compatibility: if no environment_name, return simple masked format
      if (!environmentName) {
        const masked = appCtx.env.getAllMasked(project.id);
        return Promise.resolve({ variables: masked, count: Object.keys(masked).length });
      }

      // With environment_name: return source tracking
      const environments = appCtx.db.getEnvironmentsByProject(project.id);
      const environment = environments.find((e) => e.type === environmentName);

      if (!environment) {
        return Promise.resolve({
          error: `ENVIRONMENT_NOT_FOUND: No environment named "${environmentName}" found for project "${projectName}"`,
        });
      }

      const inheritanceInfo = appCtx.env.getInheritanceInfo(project.id, environment.id);
      const masked: Record<string, { value: string; source: string }> = {};

      for (const [key, info] of Object.entries(inheritanceInfo)) {
        masked[key] = {
          value: EnvManager.mask(info.value),
          source: info.source,
        };
      }

      return Promise.resolve({ variables: masked, count: Object.keys(masked).length });
    },
  },
  {
    name: 'get_env_var',
    description:
      'Get the unmasked value of a single environment variable for debugging. Use when you need to verify the exact value was set correctly (e.g., connection strings with special characters). Returns { key, value } or { error: "NOT_FOUND" }. Errors: PROJECT_NOT_FOUND.',
    inputSchema: getEnvVarSchema,
    execute: (_args, { appCtx }) => {
      const projectName = _args['project_name'] as string;
      const key = _args['key'] as string;
      const project = getProjectByName(appCtx, projectName);
      const vars = appCtx.env.getAll(project.id);
      if (key in vars) {
        return Promise.resolve({ key, value: vars[key] });
      }
      return Promise.resolve({ error: 'NOT_FOUND', key });
    },
  },
  {
    name: 'set_env_vars',
    description:
      'Set environment variables for a project and trigger a redeploy if running. Use when user needs to configure DATABASE_URL, API keys, or other env vars. The variables parameter must be a JSON string of key-value pairs, e.g. {"DATABASE_URL": "postgresql://user:pass@ol-svc-pg:5432/db", "REDIS_URL": "redis://ol-svc-redis:6379"}. For host services use host.docker.internal as hostname. For OpenLander services use the container name (ol-svc-*). Returns { status, project, keys[] }. Errors: PROJECT_NOT_FOUND, JSON parse error if variables is malformed.',
    mcpDescription:
      'Set environment variables at project level (priority: global < project < production < environment). Triggers redeploy if project running. Use for DATABASE_URL, API keys, etc. For services: ol-svc-* for OpenLander, host.docker.internal for host.',
    inputSchema: setEnvVarsSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const project = getProjectByName(appCtx, projectName);
      const vars = JSON.parse(args['variables'] as string) as Record<string, string>;
      const changed = appCtx.env.setBulk(project.id, vars);
      const mismatches = appCtx.env.verifyRoundTrip(project.id, vars);

      if (mismatches.length > 0) {
        return {
          status: 'error',
          project: projectName,
          error: `Round-trip verification failed for keys: ${mismatches.join(', ')}. Values may have been mangled during storage.`,
          keys: Object.keys(vars),
        };
      }

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
        _agent_guidance: {
          next_steps: [
            'Redeploy required: call create_deploy_plan + execute_deploy_plan for changes to take effect',
          ],
        },
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
      return {
        status: 'exposed',
        project: projectName,
        publicUrl: url,
        _agent_guidance: {
          next_steps: ['Access the app via the publicUrl above'],
        },
      };
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
  {
    name: 'upload_secret_file',
    description:
      'Upload a secret file that will be mounted into containers at /run/secrets/filename. Use for credential files like Firebase service account JSON, TLS certificates, or any file the app reads from disk. Content is encrypted at rest. Omit project_name to make it global (available to all projects). Requires redeploy to take effect. Returns { status, mountPath }.',
    inputSchema: uploadSecretFileSchema,
    execute: (args, { appCtx }) => {
      const projectName = args['project_name'] as string | undefined;
      const filename = args['filename'] as string;
      const content = args['content'] as string;
      const mountPath = (args['mount_path'] as string | undefined) ?? '/run/secrets';

      let projectId: string | null = null;
      if (projectName) {
        const project = getProjectByName(appCtx, projectName);
        projectId = project.id;
      }

      appCtx.env.uploadSecretFile(projectId, filename, content, mountPath);

      return {
        status: 'uploaded',
        filename,
        mountPath: `${mountPath}/${filename}`,
        scope: projectId ? 'project' : 'global',
        _agent_guidance: {
          next_steps: [
            'Redeploy required: call create_deploy_plan + execute_deploy_plan for the file to be mounted',
          ],
        },
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'list_secret_files',
    description:
      'List secret files uploaded for a project or globally. Shows filenames, mount paths, and scope (project/global) — file content is never returned for security. Omit project_name to list global secret files. Returns { files[], count }.',
    inputSchema: listSecretFilesSchema,
    execute: (_args, { appCtx }) => {
      const projectName = _args['project_name'] as string | undefined;
      let projectId: string | null = null;
      if (projectName) {
        const project = getProjectByName(appCtx, projectName);
        projectId = project.id;
      }

      const files = appCtx.env.listSecretFiles(projectId);
      return { files, count: files.length };
    },
    targets: ['mcp'],
  },
  {
    name: 'remove_secret_file',
    description:
      'Remove a previously uploaded secret file from a project or global scope. The file will no longer be mounted after the next redeploy. Omit project_name for global secret files. Returns { status: "removed"|"not_found", filename }. Errors: PROJECT_NOT_FOUND.',
    inputSchema: removeSecretFileSchema,
    execute: (args, { appCtx }) => {
      const projectName = args['project_name'] as string | undefined;
      const filename = args['filename'] as string;

      let projectId: string | null = null;
      if (projectName) {
        const project = getProjectByName(appCtx, projectName);
        projectId = project.id;
      }

      const removed = appCtx.env.removeSecretFile(projectId, filename);
      return { status: removed ? 'removed' : 'not_found', filename };
    },
    targets: ['mcp'],
  },
];
