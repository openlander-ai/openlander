import type { ToolDef } from './types.js';
import { getProjectByName } from './helpers.js';
import {
  CircuitBreakerOpenError,
  OpenLanderError,
  ProjectArchivedError,
  ProjectRecoveringError,
} from '../../errors.js';
import {
  bulkDeleteEnvVarsSchema,
  deleteEnvVarSchema,
  exportEnvVarsSchema,
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

type AppCtx = Parameters<ToolDef['execute']>[1]['appCtx'];

const MAX_AUDIT_KEYS = 50;

function parseEnvVariables(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new OpenLanderError(
      'variables must be a valid JSON object of string values.',
      'BAD_REQUEST',
      400,
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OpenLanderError(
      'variables must be a JSON object of string values.',
      'BAD_REQUEST',
      400,
    );
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new OpenLanderError(
        `Environment variable "${key}" must be a string. Use delete_env_var to remove a key.`,
        'BAD_REQUEST',
        400,
        { key },
      );
    }
    result[key] = value;
  }
  return result;
}

function formatDotenvValue(value: string): string {
  if (value === '') return '""';
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function toDotenv(vars: Record<string, string>): string {
  return Object.entries(vars)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${formatDotenvValue(value)}`)
    .join('\n');
}

async function recordEnvActivity(
  appCtx: AppCtx,
  projectId: string,
  operation: string,
  keys: string[],
  extra?: Record<string, unknown>,
): Promise<void> {
  const db = appCtx.db as unknown as {
    insertActivityLog?: (entry: {
      event_type: string;
      activity_type: string;
      severity: string;
      project_id: string;
      title: string;
      description: string;
      status: string;
      metadata?: string;
    }) => Promise<void> | void;
  };
  if (typeof db.insertActivityLog !== 'function') return;

  const visibleKeys = keys.slice(0, MAX_AUDIT_KEYS);
  await db.insertActivityLog({
    event_type: 'env:changed',
    activity_type: 'config',
    severity: operation === 'export' ? 'warning' : 'info',
    project_id: projectId,
    title: `Environment variables ${operation}`,
    description: `${operation} ${String(keys.length)} environment variable(s)`,
    status: 'completed',
    metadata: JSON.stringify({
      actor: 'mcp',
      operation,
      keys: visibleKeys,
      truncated: keys.length > visibleKeys.length,
      key_count: keys.length,
      ...extra,
    }),
  });
}

async function applyRedeployIfRequested(
  appCtx: AppCtx,
  projectId: string,
  projectName: string,
  changed: boolean,
  deferRedeploy: boolean,
): Promise<{
  redeployed: boolean;
  needsRedeploy: boolean;
  redeploySkipped?: { reason: string; message: string };
}> {
  const deployable = await appCtx.db.getDeployableForProject(projectId);
  const status = deployable?.status;
  const needsRedeploy = changed && status === 'running';
  if (!needsRedeploy || deferRedeploy) {
    return { redeployed: false, needsRedeploy };
  }

  const sessionId = `mcp-set-env-${projectId}-${Date.now().toString(36)}`;
  const lockAcquired = appCtx.agentPool
    ? appCtx.agentPool.acquireProjectLock(projectId, sessionId)
    : true;
  if (!lockAcquired) {
    const lock = appCtx.agentPool?.getProjectLock(projectId);
    return {
      redeployed: false,
      needsRedeploy: true,
      redeploySkipped: {
        reason: 'PROJECT_BUSY',
        message: `Env vars saved but redeploy was skipped: another deploy is in progress (session ${lock?.sessionId ?? 'unknown'}).`,
      },
    };
  }

  try {
    await appCtx.pipeline.redeploy(projectId);
    return { redeployed: true, needsRedeploy: false };
  } catch (err) {
    if (
      err instanceof ProjectArchivedError ||
      err instanceof ProjectRecoveringError ||
      err instanceof CircuitBreakerOpenError
    ) {
      return {
        redeployed: false,
        needsRedeploy: true,
        redeploySkipped: {
          reason: err.code,
          message: `Env vars saved but redeploy was skipped for ${projectName}: ${err.message}`,
        },
      };
    }
    throw err;
  } finally {
    appCtx.agentPool?.releaseProjectLock(projectId, sessionId);
  }
}

export const envToolDefs: ToolDef[] = [
  {
    name: 'list_env_vars',
    riskLevel: 'low',
    description:
      'List all environment variables for a project. Values are masked by default; pass reveal=true to return raw values for audit/export workflows. Public prefixes (NEXT_PUBLIC_, PUBLIC_, VITE_PUBLIC_, NUXT_PUBLIC_) are not masked. Returns { variables, count, revealed }.',
    mcpDescription: 'List project-scoped environment variables. Pass reveal=true for raw values.',
    inputSchema: listEnvVarsSchema,
    execute: async (_args, { appCtx }) => {
      const projectName = _args['project_name'] as string;
      const reveal = (_args['reveal'] as boolean | undefined) ?? false;
      const project = await getProjectByName(appCtx, projectName);
      await appCtx.db.assertEnvToolSchemaReady();
      const vars = reveal
        ? await appCtx.env.getAll(project.id)
        : await appCtx.env.getAllMasked(project.id);
      return Promise.resolve({
        variables: vars,
        count: Object.keys(vars).length,
        revealed: reveal,
      });
    },
  },
  {
    name: 'get_env_var',
    riskLevel: 'low',
    description:
      'Get the unmasked value of a single environment variable for debugging. Use when you need to verify the exact value was set correctly (e.g., connection strings with special characters). Returns { key, value }. Throws NOT_FOUND error if key does not exist. Errors: PROJECT_NOT_FOUND.',
    mcpDescription: 'Get a single environment variable value for a project.',
    inputSchema: getEnvVarSchema,
    execute: async (_args, { appCtx }) => {
      const projectName = _args['project_name'] as string;
      const key = _args['key'] as string;
      const project = await getProjectByName(appCtx, projectName);
      await appCtx.db.assertEnvToolSchemaReady();
      const vars = await appCtx.env.getAll(project.id);
      if (key in vars) {
        return Promise.resolve({ key, value: vars[key] });
      }
      throw new OpenLanderError(`Environment variable "${key}" not found`, 'NOT_FOUND', 404, {
        key,
      });
    },
  },
  {
    name: 'set_env_vars',
    riskLevel: 'medium',
    description:
      'Set environment variables for a project. By default this saves only and does NOT redeploy; call redeploy_project/deploy_service separately to apply to a running container, or pass defer_redeploy=false for immediate apply. variables must be a JSON string object with string values only; null is rejected. Returns { status, project, keys, changed, needs_redeploy }.',
    mcpDescription:
      'Set project-scoped env vars. Default saves only; call redeploy to apply, or pass defer_redeploy=false.',
    inputSchema: setEnvVarsSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const project = await getProjectByName(appCtx, projectName);
      const vars = parseEnvVariables(args['variables'] as string);
      const deferRedeploy = (args['defer_redeploy'] as boolean | undefined) ?? true;
      await appCtx.db.assertEnvToolSchemaReady();

      const changes = await appCtx.env.setBulkDetailed(project.id, vars);
      const changed = changes.some((change) => change.op !== 'noop');
      const mismatches = await appCtx.env.verifyRoundTrip(project.id, vars);

      if (mismatches.length > 0) {
        return {
          status: 'error',
          project: projectName,
          error: `Round-trip verification failed for keys: ${mismatches.join(', ')}. Values may have been mangled during storage.`,
          keys: Object.keys(vars),
        };
      }

      const redeploy = await applyRedeployIfRequested(
        appCtx,
        project.id,
        projectName,
        changed,
        deferRedeploy,
      );
      await recordEnvActivity(appCtx, project.id, 'set', Object.keys(vars), {
        changed_count: changes.filter((change) => change.op !== 'noop').length,
        needs_redeploy: redeploy.needsRedeploy,
        deferred: deferRedeploy,
      });

      if (redeploy.redeployed) {
        return {
          status: 'updated_and_redeployed',
          project: projectName,
          keys: Object.keys(vars),
          changed: changes,
          needs_redeploy: false,
        };
      }

      if (redeploy.redeploySkipped) {
        return {
          status: 'updated_redeploy_skipped',
          project: projectName,
          keys: Object.keys(vars),
          changed: changes,
          needs_redeploy: true,
          reason: redeploy.redeploySkipped.reason,
          message: redeploy.redeploySkipped.message,
        };
      }

      return {
        status: 'updated',
        project: projectName,
        keys: Object.keys(vars),
        changed: changes,
        needs_redeploy: redeploy.needsRedeploy,
        _agent_guidance: {
          next_steps: redeploy.needsRedeploy
            ? ['Redeploy required: call redeploy_project/deploy_service to apply env changes.']
            : ['No redeploy required for these env changes.'],
        },
      };
    },
  },
  {
    name: 'export_env_vars',
    riskLevel: 'medium',
    description:
      'Export all environment variables for a project as .env text with raw unmasked values. This is intended for audit/migration workflows and records an audit activity without storing values.',
    mcpDescription: 'Export project env vars as .env text with raw values.',
    inputSchema: exportEnvVarsSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const project = await getProjectByName(appCtx, projectName);
      await appCtx.db.assertEnvToolSchemaReady();
      const vars = await appCtx.env.getAll(project.id);
      const keys = Object.keys(vars).sort();
      await recordEnvActivity(appCtx, project.id, 'export', keys);
      return {
        project: projectName,
        count: keys.length,
        format: 'dotenv',
        env: toDotenv(vars),
      };
    },
  },
  {
    name: 'delete_env_var',
    riskLevel: 'medium',
    description:
      'Delete one project environment variable. By default this saves only and does NOT redeploy; call redeploy_project/deploy_service separately to apply to a running container, or pass defer_redeploy=false.',
    mcpDescription: 'Delete one project env var. Default saves only; call redeploy to apply.',
    inputSchema: deleteEnvVarSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const key = args['key'] as string;
      const deferRedeploy = (args['defer_redeploy'] as boolean | undefined) ?? true;
      const project = await getProjectByName(appCtx, projectName);
      await appCtx.db.assertEnvToolSchemaReady();
      const deleted = await appCtx.env.delete(project.id, key);
      const redeploy = await applyRedeployIfRequested(
        appCtx,
        project.id,
        projectName,
        deleted,
        deferRedeploy,
      );
      if (deleted) {
        await recordEnvActivity(appCtx, project.id, 'delete', [key], {
          needs_redeploy: redeploy.needsRedeploy,
          deferred: deferRedeploy,
        });
      }
      return {
        status: deleted ? 'deleted' : 'not_found',
        project: projectName,
        key,
        needs_redeploy: redeploy.needsRedeploy,
      };
    },
  },
  {
    name: 'bulk_delete_env_vars',
    riskLevel: 'high',
    description:
      'Delete multiple project environment variables. Omitting confirm=true returns a dry-run preview only. By default confirmed deletes do NOT redeploy; call redeploy_project/deploy_service separately to apply, or pass defer_redeploy=false.',
    mcpDescription: 'Bulk delete project env vars with confirm-gated dry-run behavior.',
    inputSchema: bulkDeleteEnvVarsSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const keys = args['keys'] as string[];
      const confirm = (args['confirm'] as boolean | undefined) ?? false;
      const deferRedeploy = (args['defer_redeploy'] as boolean | undefined) ?? true;
      const project = await getProjectByName(appCtx, projectName);
      await appCtx.db.assertEnvToolSchemaReady();
      const existing = await appCtx.env.getAll(project.id);
      const wouldDelete = keys.filter((key) => key in existing);
      const notFound = keys.filter((key) => !(key in existing));

      if (!confirm) {
        return {
          would_delete: wouldDelete,
          not_found: notFound,
          count_to_delete: wouldDelete.length,
          confirm_required: true,
        };
      }

      const result = await appCtx.env.deleteBulk(project.id, keys);
      const redeploy = await applyRedeployIfRequested(
        appCtx,
        project.id,
        projectName,
        result.changed,
        deferRedeploy,
      );
      if (result.deleted.length > 0) {
        await recordEnvActivity(appCtx, project.id, 'bulk_delete', result.deleted, {
          needs_redeploy: redeploy.needsRedeploy,
          deferred: deferRedeploy,
        });
      }
      return {
        status: 'deleted',
        project: projectName,
        deleted: result.deleted,
        not_found: result.notFound,
        count_deleted: result.deleted.length,
        needs_redeploy: redeploy.needsRedeploy,
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
    execute: async (args, { appCtx, target }) => {
      const key = args['key'] as string;
      const value = args['value'] as string;
      const description = args['description'] as string | undefined;
      await appCtx.env.setGlobalSecret(key, value, description);

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
    execute: async (_args, { appCtx }) => {
      const secrets = await appCtx.env.getGlobalSecretsMasked();
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
      const project = await getProjectByName(appCtx, projectName);
      // PR 4.5: canonical-first port read.
      const exposeDeployable = await appCtx.db.getDeployableForProject(project.id);
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
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const project = await getProjectByName(appCtx, projectName);
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
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string | undefined;
      const filename = args['filename'] as string;
      const content = args['content'] as string;
      const mountPath = (args['mount_path'] as string | undefined) ?? '/run/secrets';

      let projectId: string | null = null;
      if (projectName) {
        const project = await getProjectByName(appCtx, projectName);
        projectId = project.id;
      }

      await appCtx.env.uploadSecretFile(projectId, filename, content, mountPath);

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
    execute: async (_args, { appCtx }) => {
      const projectName = _args['project_name'] as string | undefined;
      let projectId: string | null = null;
      if (projectName) {
        const project = await getProjectByName(appCtx, projectName);
        projectId = project.id;
      }

      const files = await appCtx.env.listSecretFiles(projectId);
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
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string | undefined;
      const filename = args['filename'] as string;

      let projectId: string | null = null;
      if (projectName) {
        const project = await getProjectByName(appCtx, projectName);
        projectId = project.id;
      }

      const removed = await appCtx.env.removeSecretFile(projectId, filename);
      return { status: removed ? 'removed' : 'not_found', filename };
    },
    targets: ['mcp'],
  },
];
