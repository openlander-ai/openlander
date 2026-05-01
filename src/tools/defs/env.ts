import type { ToolDef } from './types.js';
import { getProjectByName, getProductionEnvironmentId } from './helpers.js';
import {
  CircuitBreakerOpenError,
  ProjectArchivedError,
  ProjectRecoveringError,
} from '../../errors.js';
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

export const envToolDefs: ToolDef[] = [
  {
    name: 'list_env_vars',
    riskLevel: 'low',
    description:
      'List all environment variables for a project (values are masked for security). Use to check what variables are currently set before adding or modifying. Returns { variables: { KEY: "sk-****7890" }, count }. Errors: PROJECT_NOT_FOUND.',
    mcpDescription: 'List project-scoped environment variables with masked values.',
    inputSchema: listEnvVarsSchema,
    execute: (_args, { appCtx }) => {
      const projectName = _args['project_name'] as string;
      const project = getProjectByName(appCtx, projectName);
      const vars = appCtx.env.getAllWithInheritanceMasked(project.id);
      return Promise.resolve({ variables: vars, count: Object.keys(vars).length });
    },
  },
  {
    name: 'get_env_var',
    riskLevel: 'low',
    description:
      'Get the unmasked value of a single environment variable for debugging. Use when you need to verify the exact value was set correctly (e.g., connection strings with special characters). Returns { key, value }. Throws NOT_FOUND error if key does not exist. Errors: PROJECT_NOT_FOUND.',
    mcpDescription: 'Get a single environment variable value for a project.',
    inputSchema: getEnvVarSchema,
    execute: (_args, { appCtx }) => {
      const projectName = _args['project_name'] as string;
      const key = _args['key'] as string;
      const project = getProjectByName(appCtx, projectName);
      const prodEnvId = getProductionEnvironmentId(appCtx, project.id);
      const vars = prodEnvId
        ? appCtx.env.getAllWithInheritance(project.id, prodEnvId)
        : appCtx.env.getAll(project.id);
      if (key in vars) {
        return Promise.resolve({ key, value: vars[key] });
      }
      throw new Error(`NOT_FOUND: Environment variable "${key}" not found`);
    },
  },
  {
    name: 'set_env_vars',
    riskLevel: 'medium',
    description:
      'Set environment variables for a project and trigger a redeploy if running. Use when user needs to configure DATABASE_URL, API keys, or other env vars. The variables parameter must be a JSON string of key-value pairs, e.g. {"DATABASE_URL": "postgresql://user:pass@ol-svc-pg:5432/db", "REDIS_URL": "redis://ol-svc-redis:6379"}. For host services use host.docker.internal as hostname. For OpenLander services use the container name (ol-svc-*). Returns { status, project, keys[] }. Errors: PROJECT_NOT_FOUND, JSON parse error if variables is malformed.',
    mcpDescription:
      'Set project-scoped environment variables. Triggers redeploy if project running. Use for DATABASE_URL, API keys, etc. For services: ol-svc-* for OpenLander, host.docker.internal for host.',
    inputSchema: setEnvVarsSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const project = getProjectByName(appCtx, projectName);
      const vars = JSON.parse(args['variables'] as string) as Record<string, string>;
      const prodEnvId = getProductionEnvironmentId(appCtx, project.id);

      const changed = appCtx.env.setBulk(project.id, vars, prodEnvId);
      const mismatches = appCtx.env.verifyRoundTrip(project.id, vars, prodEnvId);

      if (mismatches.length > 0) {
        return {
          status: 'error',
          project: projectName,
          error: `Round-trip verification failed for keys: ${mismatches.join(', ')}. Values may have been mangled during storage.`,
          keys: Object.keys(vars),
        };
      }

      // PR 4.5: canonical-first status read.
      const setEnvDeployable = appCtx.db.getDeployableForProject(project.id);
      const setEnvStatus = setEnvDeployable?.status ?? project.status;
      if (changed && setEnvStatus === 'running') {
        // 1.0 GA: per-project lock instead of global DeployQueue.
        const envSessionId = `mcp-set-env-${project.id}-${Date.now().toString(36)}`;
        const memLockAcquired = appCtx.agentPool
          ? appCtx.agentPool.acquireProjectLock(project.id, envSessionId)
          : true;
        if (!memLockAcquired) {
          const lock = appCtx.agentPool?.getProjectLock(project.id);
          return {
            status: 'updated_redeploy_skipped',
            project: projectName,
            keys: Object.keys(vars),
            reason: 'PROJECT_BUSY',
            message: `Env vars saved but redeploy was skipped: another deploy is in progress (session ${lock?.sessionId ?? 'unknown'}).`,
          };
        }
        try {
          await appCtx.pipeline.redeploy(project.id);
        } catch (err) {
          if (
            err instanceof ProjectArchivedError ||
            err instanceof ProjectRecoveringError ||
            err instanceof CircuitBreakerOpenError
          ) {
            return {
              status: 'updated_redeploy_skipped',
              project: projectName,
              keys: Object.keys(vars),
              reason: err.code,
              message: `Env vars saved but redeploy was skipped: ${err.message}`,
            };
          }
          throw err;
        } finally {
          appCtx.agentPool?.releaseProjectLock(project.id, envSessionId);
        }
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
    riskLevel: 'medium',
    description:
      'Set a global secret that is available to all projects (stored encrypted). Use for shared API keys, database credentials, etc. that multiple projects need. Returns { status, key }.',
    mcpDescription: 'Set an encrypted global secret shared across all projects.',
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
    riskLevel: 'low',
    description:
      'List all global secrets (values are masked for security). Returns { secrets: [{ key, maskedValue, description }], count }.',
    mcpDescription: 'List all global secrets with masked values and descriptions.',
    inputSchema: listGlobalSecretsSchema,
    execute: (_args, { appCtx }) => {
      const secrets = appCtx.env.getGlobalSecretsMasked();
      return { secrets, count: secrets.length };
    },
  },
  {
    name: 'expose_public',
    riskLevel: 'medium',
    description:
      'Create a temporary public URL for a project via TryCloudflare tunnel. Use when user wants to share their app externally or test from another device. Returns { status, project, publicUrl }. The URL is temporary and changes on restart. Errors: PROJECT_NOT_FOUND, "not running" if project has no port — deploy it first. For permanent custom domains, use map_domain instead.',
    mcpDescription: 'Generate a temporary public URL for a project via TryCloudflare.',
    inputSchema: projectNameSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const project = getProjectByName(appCtx, projectName);
      // PR 4.5: canonical-first port read.
      const exposeDeployable = appCtx.db.getDeployableForProject(project.id);
      const exposePort = exposeDeployable?.assigned_port ?? project.assigned_port;
      if (!exposePort) {
        throw new Error('Project is not running — deploy it first');
      }

      const url = await appCtx.pipeline.exposeTunnel(project.id, exposePort);
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
    riskLevel: 'medium',
    description:
      'Remove the public TryCloudflare tunnel URL for a project. Use when user wants to make a project private again. Returns { status, project }. Errors: PROJECT_NOT_FOUND.',
    mcpDescription: 'Remove a public URL and stop the TryCloudflare tunnel.',
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
    riskLevel: 'medium',
    description:
      'Upload a secret file that will be mounted into containers at /run/secrets/filename. Use for credential files like Firebase service account JSON, TLS certificates, or any file the app reads from disk. Content is encrypted at rest. Omit project_name to make it global (available to all projects). Requires redeploy to take effect. Returns { status, mountPath }.',
    mcpDescription: 'Upload an encrypted secret file mounted at /run/secrets/filename.',
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
    riskLevel: 'low',
    description:
      'List secret files uploaded for a project or globally. Shows filenames, mount paths, and scope (project/global) — file content is never returned for security. Omit project_name to list global secret files. Returns { files[], count }.',
    mcpDescription: 'List uploaded secret files; file content is never returned.',
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
    riskLevel: 'medium',
    description:
      'Remove a previously uploaded secret file from a project or global scope. The file will no longer be mounted after the next redeploy. Omit project_name for global secret files. Returns { status: "removed"|"not_found", filename }. Errors: PROJECT_NOT_FOUND.',
    mcpDescription: 'Remove a secret file. Redeploy to stop mounting it in containers.',
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
