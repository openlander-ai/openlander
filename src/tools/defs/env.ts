import type { ToolDef } from './types.js';
import { getProjectByName } from './helpers.js';
import {
  CircuitBreakerOpenError,
  OpenLanderError,
  ProjectArchivedError,
  ProjectNotFoundError,
  ProjectRecoveringError,
  ServiceNotFoundError,
} from '../../errors.js';
import { MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import { deployableServiceIdToProjectId } from '../../db/service-ids.js';
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
import { deployTriggerForToolContext } from './helpers.js';
import type { ToolDeployTrigger } from './helpers.js';

type AppCtx = Parameters<ToolDef['execute']>[1]['appCtx'];
type ServiceRow = Awaited<ReturnType<AppCtx['db']['getService']>>;
type ProjectRow = Awaited<ReturnType<AppCtx['db']['getProject']>>;
type ResolvedServiceRow = NonNullable<ServiceRow>;
type ResolvedProjectRow = NonNullable<ProjectRow>;

const MAX_AUDIT_KEYS = 50;

interface EnvTarget {
  project: ResolvedProjectRow;
  service: ResolvedServiceRow;
  runtimeProject: ResolvedProjectRow;
}

function isManagedService(kind: string): boolean {
  return (MANAGED_SERVICE_KINDS as readonly string[]).includes(kind);
}

async function envServiceCandidates(services: ResolvedServiceRow[], appCtx: AppCtx) {
  return Promise.all(
    services.map(async (service) => {
      const project = await appCtx.db.getProject(service.project_id);
      return {
        serviceId: service.id,
        serviceName: service.name,
        projectId: service.project_id,
        projectName: project?.name ?? service.project_id,
        kind: service.kind,
        source: service.source,
      };
    }),
  );
}

async function throwEnvServiceSelectionRequired(
  appCtx: AppCtx,
  message: string,
  candidates: ResolvedServiceRow[],
): Promise<never> {
  throw new OpenLanderError(message, 'SERVICE_SELECTION_REQUIRED', 400, {
    candidates: await envServiceCandidates(candidates, appCtx),
  });
}

async function resolveProjectScope(appCtx: AppCtx, projectName: string) {
  if (!projectName) return undefined;
  return (
    (await appCtx.db.getProject(projectName)) ?? (await appCtx.db.getProjectByName(projectName))
  );
}

async function resolveSingleDeployableProjectAlias(
  appCtx: AppCtx,
  projectName: string,
): Promise<ResolvedServiceRow | undefined> {
  const project = await resolveProjectScope(appCtx, projectName);
  if (!project) return undefined;

  const deployables = await appCtx.db.getDeployablesByGroup(project.id);
  const filtered = deployables.filter((item) => !isManagedService(item.kind));
  if (filtered.length > 1) {
    await throwEnvServiceSelectionRequired(
      appCtx,
      `Project '${project.name}' has ${String(filtered.length)} deployable services. Specify service_name or service_id.`,
      filtered,
    );
  }
  return filtered[0];
}

async function resolveEnvTarget(args: Record<string, unknown>, appCtx: AppCtx): Promise<EnvTarget> {
  const serviceId = typeof args['service_id'] === 'string' ? args['service_id'].trim() : '';
  const serviceName = typeof args['service_name'] === 'string' ? args['service_name'].trim() : '';
  const projectName = typeof args['project_name'] === 'string' ? args['project_name'].trim() : '';

  let service: ServiceRow | undefined;
  let project: ProjectRow | undefined;

  if (serviceId) {
    service = await appCtx.db.getService(serviceId);
    if (!service) throw new ServiceNotFoundError(serviceId);
    project = await appCtx.db.getProject(service.project_id);
  } else if (serviceName) {
    const projectScope = await resolveProjectScope(appCtx, projectName);
    if (projectName && !projectScope) throw new ProjectNotFoundError(projectName);

    const services = await appCtx.db.listServices();
    const namedServices = services.filter((item) => item.name === serviceName);
    const scopedServices = projectScope
      ? namedServices.filter((item) => item.project_id === projectScope.id)
      : namedServices;
    const deployableServices = scopedServices.filter((item) => !isManagedService(item.kind));

    if (deployableServices.length > 1) {
      await throwEnvServiceSelectionRequired(
        appCtx,
        `Multiple deployable services named '${serviceName}' found. Specify project_name or service_id.`,
        deployableServices,
      );
    }

    service = deployableServices[0] ?? scopedServices[0];
    if (!service && !projectName) {
      service = await resolveSingleDeployableProjectAlias(appCtx, serviceName);
    }
    if (!service) {
      throw new ServiceNotFoundError(
        projectName ? `${serviceName} in ${projectName}` : serviceName,
      );
    }
    project = projectScope ?? (await appCtx.db.getProject(service.project_id));
  } else if (projectName) {
    project = await resolveProjectScope(appCtx, projectName);
    if (!project) throw new ProjectNotFoundError(projectName);
    const deployables = await appCtx.db.getDeployablesByGroup(project.id);
    if (deployables.length !== 1) {
      await throwEnvServiceSelectionRequired(
        appCtx,
        `Project '${project.name}' has ${String(deployables.length)} deployable services. Specify service_name or service_id.`,
        deployables,
      );
    }
    service = deployables[0];
  }

  if (!service) {
    throw new ServiceNotFoundError(serviceId || serviceName || projectName || 'unknown');
  }
  if (isManagedService(service.kind)) {
    throw new OpenLanderError(
      `Environment variables are supported for deployable services, not managed ${service.kind} services.`,
      'SERVICE_OPERATION_UNSUPPORTED',
      400,
      { serviceId: service.id, serviceName: service.name, kind: service.kind },
    );
  }
  project ??= await appCtx.db.getProject(service.project_id);
  if (!project) throw new ProjectNotFoundError(service.project_id);

  if (projectName && projectName !== project.id && projectName !== project.name) {
    throw new ServiceNotFoundError(`${service.name} in ${projectName}`);
  }

  const runtimeProjectId = deployableServiceIdToProjectId(service.id);
  const runtimeProject = (await appCtx.db.getProject(runtimeProjectId)) ?? project;

  return { project, service, runtimeProject };
}

function parseEnvVariables(raw: unknown): Record<string, string> {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new OpenLanderError(
        'variables must be a valid JSON object string or an object with string values.',
        'BAD_REQUEST',
        400,
        {
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
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
  target: EnvTarget,
  changed: boolean,
  deferRedeploy: boolean,
  trigger: ToolDeployTrigger,
): Promise<{
  redeployed: boolean;
  needsRedeploy: boolean;
  redeploySkipped?: { reason: string; message: string };
}> {
  const { project, service, runtimeProject } = target;
  const status = service.status;
  const hasRuntimeContainer =
    typeof service.container_id === 'string' && service.container_id.trim().length > 0;
  const statusImpliesRuntime = ['running', 'healthy', 'unhealthy', 'degraded'].includes(
    String(status),
  );
  const needsRedeploy = changed && (hasRuntimeContainer || statusImpliesRuntime);
  if (!needsRedeploy || deferRedeploy) {
    return { redeployed: false, needsRedeploy };
  }

  const sessionId = `mcp-set-env-${service.id}-${Date.now().toString(36)}`;
  const lockAcquired = appCtx.agentPool
    ? appCtx.agentPool.acquireProjectLock(runtimeProject.id, sessionId)
    : true;
  if (!lockAcquired) {
    const lock = appCtx.agentPool?.getProjectLock(runtimeProject.id);
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
    await appCtx.pipeline.redeploy(runtimeProject.id, { trigger });
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
          message: `Env vars saved but redeploy was skipped for ${project.name}/${service.name}: ${err.message}`,
        },
      };
    }
    throw err;
  } finally {
    appCtx.agentPool?.releaseProjectLock(runtimeProject.id, sessionId);
  }
}

export const envToolDefs: ToolDef[] = [
  {
    name: 'list_env_vars',
    riskLevel: 'low',
    description:
      'List all environment variables for a deployable service. Values are masked by default; pass reveal=true to return raw values for audit/export workflows. Public prefixes (NEXT_PUBLIC_, PUBLIC_, VITE_PUBLIC_, NUXT_PUBLIC_) are not masked. Returns { variables, count, revealed }.',
    mcpDescription: 'List service-scoped environment variables. Pass reveal=true for raw values.',
    inputSchema: listEnvVarsSchema,
    execute: async (_args, { appCtx }) => {
      const reveal = (_args['reveal'] as boolean | undefined) ?? false;
      const target = await resolveEnvTarget(_args, appCtx);
      await appCtx.db.assertEnvToolSchemaReady();
      const vars = reveal
        ? await appCtx.env.getAllForService(target.project.id, target.service.id)
        : await appCtx.env.getAllForServiceMasked(target.project.id, target.service.id);
      return Promise.resolve({
        project: target.project.name,
        service: target.service.name,
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
      'Get the unmasked value of a single service environment variable for debugging. Use when you need to verify the exact value was set correctly (e.g., connection strings with special characters). Returns { key, value }. Throws NOT_FOUND error if key does not exist.',
    mcpDescription: 'Get a single service environment variable value.',
    inputSchema: getEnvVarSchema,
    execute: async (_args, { appCtx }) => {
      const key = _args['key'] as string;
      const target = await resolveEnvTarget(_args, appCtx);
      await appCtx.db.assertEnvToolSchemaReady();
      const vars = await appCtx.env.getAllForService(target.project.id, target.service.id);
      if (key in vars) {
        return Promise.resolve({
          project: target.project.name,
          service: target.service.name,
          key,
          value: vars[key],
        });
      }
      throw new OpenLanderError(`Environment variable "${key}" not found`, 'NOT_FOUND', 404, {
        key,
        serviceId: target.service.id,
      });
    },
  },
  {
    name: 'set_env_vars',
    riskLevel: 'medium',
    description:
      'Set environment variables for a deployable service. By default this saves only and does NOT redeploy; call redeploy_app separately to apply to a running container, or pass defer_redeploy=false for immediate apply. variables may be an object or JSON-stringified object with string values only; null is rejected. Returns { status, project, service, keys, changed, needs_redeploy }.',
    mcpDescription:
      'Set service-scoped env vars. Default saves only; call redeploy_app to apply, or pass defer_redeploy=false.',
    inputSchema: setEnvVarsSchema,
    execute: async (args, context) => {
      const { appCtx } = context;
      const target = await resolveEnvTarget(args, appCtx);
      const vars = parseEnvVariables(args['variables']);
      const deferRedeploy = (args['defer_redeploy'] as boolean | undefined) ?? true;
      await appCtx.db.assertEnvToolSchemaReady();

      const changes = await appCtx.env.setBulkForServiceDetailed(
        target.project.id,
        target.service.id,
        vars,
      );
      const changed = changes.some((change) => change.op !== 'noop');
      const mismatches = await appCtx.env.verifyRoundTripForService(
        target.project.id,
        target.service.id,
        vars,
      );

      if (mismatches.length > 0) {
        return {
          status: 'error',
          project: target.project.name,
          service: target.service.name,
          error: `Round-trip verification failed for keys: ${mismatches.join(', ')}. Values may have been mangled during storage.`,
          keys: Object.keys(vars),
        };
      }

      const redeploy = await applyRedeployIfRequested(
        appCtx,
        target,
        changed,
        deferRedeploy,
        deployTriggerForToolContext(context),
      );
      await recordEnvActivity(appCtx, target.project.id, 'set', Object.keys(vars), {
        service_id: target.service.id,
        service_name: target.service.name,
        changed_count: changes.filter((change) => change.op !== 'noop').length,
        needs_redeploy: redeploy.needsRedeploy,
        deferred: deferRedeploy,
      });

      if (redeploy.redeployed) {
        return {
          status: 'updated_and_redeployed',
          project: target.project.name,
          service: target.service.name,
          keys: Object.keys(vars),
          changed: changes,
          needs_redeploy: false,
        };
      }

      if (redeploy.redeploySkipped) {
        return {
          status: 'updated_redeploy_skipped',
          project: target.project.name,
          service: target.service.name,
          keys: Object.keys(vars),
          changed: changes,
          needs_redeploy: true,
          reason: redeploy.redeploySkipped.reason,
          message: redeploy.redeploySkipped.message,
        };
      }

      return {
        status: 'updated',
        project: target.project.name,
        service: target.service.name,
        keys: Object.keys(vars),
        changed: changes,
        needs_redeploy: redeploy.needsRedeploy,
        _agent_guidance: {
          next_steps: redeploy.needsRedeploy
            ? ['Redeploy required: call redeploy_app to apply env changes.']
            : ['No redeploy required for these env changes.'],
        },
      };
    },
  },
  {
    name: 'export_env_vars',
    riskLevel: 'medium',
    description:
      'Export all environment variables for a service as .env text with raw unmasked values. This is intended for audit/migration workflows and records an audit activity without storing values.',
    mcpDescription: 'Export service env vars as .env text with raw values.',
    inputSchema: exportEnvVarsSchema,
    execute: async (args, { appCtx }) => {
      const target = await resolveEnvTarget(args, appCtx);
      await appCtx.db.assertEnvToolSchemaReady();
      const vars = await appCtx.env.getAllForService(target.project.id, target.service.id);
      const keys = Object.keys(vars).sort();
      await recordEnvActivity(appCtx, target.project.id, 'export', keys, {
        service_id: target.service.id,
        service_name: target.service.name,
      });
      return {
        project: target.project.name,
        service: target.service.name,
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
      'Delete one service environment variable. By default this saves only and does NOT redeploy; call redeploy_app separately to apply to a running container, or pass defer_redeploy=false.',
    mcpDescription: 'Delete one service env var. Default saves only; call redeploy_app to apply.',
    inputSchema: deleteEnvVarSchema,
    execute: async (args, context) => {
      const { appCtx } = context;
      const key = args['key'] as string;
      const deferRedeploy = (args['defer_redeploy'] as boolean | undefined) ?? true;
      const target = await resolveEnvTarget(args, appCtx);
      await appCtx.db.assertEnvToolSchemaReady();
      const deleted = await appCtx.env.deleteForService(target.project.id, target.service.id, key);
      const redeploy = await applyRedeployIfRequested(
        appCtx,
        target,
        deleted,
        deferRedeploy,
        deployTriggerForToolContext(context),
      );
      if (deleted) {
        await recordEnvActivity(appCtx, target.project.id, 'delete', [key], {
          service_id: target.service.id,
          service_name: target.service.name,
          needs_redeploy: redeploy.needsRedeploy,
          deferred: deferRedeploy,
        });
      }
      return {
        status: deleted ? 'deleted' : 'not_found',
        project: target.project.name,
        service: target.service.name,
        key,
        needs_redeploy: redeploy.needsRedeploy,
      };
    },
  },
  {
    name: 'bulk_delete_env_vars',
    riskLevel: 'high',
    description:
      'Delete multiple service environment variables. Omitting confirm=true returns a dry-run preview only. By default confirmed deletes do NOT redeploy; call redeploy_app separately to apply, or pass defer_redeploy=false.',
    mcpDescription: 'Bulk delete service env vars with confirm-gated dry-run behavior.',
    inputSchema: bulkDeleteEnvVarsSchema,
    execute: async (args, context) => {
      const { appCtx } = context;
      const keys = args['keys'] as string[];
      const confirm = (args['confirm'] as boolean | undefined) ?? false;
      const deferRedeploy = (args['defer_redeploy'] as boolean | undefined) ?? true;
      const target = await resolveEnvTarget(args, appCtx);
      await appCtx.db.assertEnvToolSchemaReady();
      const existing = await appCtx.env.getAllForService(target.project.id, target.service.id);
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

      const result = await appCtx.env.deleteBulkForService(
        target.project.id,
        target.service.id,
        keys,
      );
      const redeploy = await applyRedeployIfRequested(
        appCtx,
        target,
        result.changed,
        deferRedeploy,
        deployTriggerForToolContext(context),
      );
      if (result.deleted.length > 0) {
        await recordEnvActivity(appCtx, target.project.id, 'bulk_delete', result.deleted, {
          service_id: target.service.id,
          service_name: target.service.name,
          needs_redeploy: redeploy.needsRedeploy,
          deferred: deferRedeploy,
        });
      }
      return {
        status: 'deleted',
        project: target.project.name,
        service: target.service.name,
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
      'Create a temporary public URL for a project using the configured tunnel backend. This optional feature requires tunnel infrastructure on the OpenLander host. Use when the user wants a quick external share URL without changing app source code. Returns { status, project, publicUrl }. The URL is temporary and may change on restart. Errors: PROJECT_NOT_FOUND, "not running" if project has no port — deploy it first. For stable domains, use domain routing instead.',
    mcpDescription:
      'Generate a temporary public share URL using the configured tunnel backend. Optional; requires tunnel infrastructure.',
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
          next_steps: [
            'Access the app via the publicUrl above',
            'If expose_public fails because the tunnel backend is unavailable, use the normal service URL or configure public access first.',
          ],
        },
      };
    },
  },
  {
    name: 'unexpose_public',
    riskLevel: 'medium',
    description:
      'Remove the temporary public share URL for a project. Use when the user wants to make a project private again. Returns { status, project }. Errors: PROJECT_NOT_FOUND.',
    mcpDescription: 'Remove a temporary public share URL.',
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
