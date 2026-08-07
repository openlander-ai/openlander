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
  publicAccessTargetSchema,
  removeSecretFileSchema,
  setEnvVarsSchema,
  setGlobalSecretSchema,
  uploadSecretFileSchema,
} from './schemas.js';
import { resolveDeployableTarget } from './deployable-target.js';
import { deployTriggerForToolContext } from './helpers.js';
import type { ToolDeployTrigger } from './helpers.js';
import {
  parseEnvironmentKeyOrThrow,
  resolveEnvironmentByKeyOrThrow,
  type EnvironmentKey,
} from '../../pipeline/env-scope.js';
import { BUILD_TIME_PREFIXES } from '../../pipeline/build-args.js';

type AppCtx = Parameters<ToolDef['execute']>[1]['appCtx'];
type ServiceRow = Awaited<ReturnType<AppCtx['db']['getService']>>;
type ProjectRow = Awaited<ReturnType<AppCtx['db']['getProject']>>;
type ResolvedServiceRow = NonNullable<ServiceRow>;
type ResolvedProjectRow = NonNullable<ProjectRow>;
type EnvWriteScope = 'project' | 'project_environment' | 'service' | 'service_environment';
type EnvApplyMode = 'same_image_recreate' | 'full_redeploy';
type RuntimeRecreateOutcome = Awaited<ReturnType<AppCtx['pipeline']['recreateServiceRuntime']>>;
type EnvRuntimeApply =
  | {
      mode: 'same_image_recreate';
      status: 'verified' | 'applied';
      readiness: RuntimeRecreateOutcome['readiness'];
      route_switched: boolean;
      route_verification: { status: 'verified' } | { status: 'skipped'; reason: string };
      previous_version_still_serving: boolean;
      container_id?: string;
      port?: number;
    }
  | {
      mode: 'same_image_recreate';
      status: 'failed';
      code: string;
      error: string;
      readiness: RuntimeRecreateOutcome['readiness'];
      route_switched: boolean;
      route_verification: { status: 'failed' } | { status: 'skipped'; reason: string };
      previous_version_still_serving: boolean;
      fallback: 'redeploy_app';
    }
  | {
      mode: 'full_redeploy';
      status: 'started';
      reason: 'build_time_env' | 'compose_project_env';
      build_time_keys?: string[];
    }
  | {
      mode: EnvApplyMode;
      status: 'skipped';
      reason: string;
      message: string;
    };

const MAX_AUDIT_KEYS = 50;
const ENV_WRITE_SCOPES: readonly EnvWriteScope[] = [
  'project',
  'project_environment',
  'service',
  'service_environment',
];

function publicAccessStatusCall(serviceId: string, provider: 'protected_share' | 'cloudflare') {
  return {
    tool: 'openlander_service',
    arguments: {
      action: 'get_public_access',
      params: {
        service_id: serviceId,
        ...(provider === 'cloudflare' ? { provider } : {}),
      },
    },
  };
}

async function resolvePublicAccessProject(appCtx: AppCtx, args: Record<string, unknown>) {
  const target = await resolveDeployableTarget(appCtx, args, 'get_public_access');
  return { project: target.project, serviceId: target.service.id };
}

interface EnvTarget {
  project: ResolvedProjectRow;
  service: ResolvedServiceRow;
  runtimeProject: ResolvedProjectRow;
}

interface EnvWriteTarget {
  scope: EnvWriteScope;
  scopeExplicit: boolean;
  project: ResolvedProjectRow;
  service?: ResolvedServiceRow;
  runtimeProject?: ResolvedProjectRow;
  environmentId?: string;
  environmentKey?: EnvironmentKey;
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
      `Project '${project.name}' has ${String(filtered.length)} Applications/Compose workloads. Specify service_name or service_id.`,
      filtered,
    );
  }
  return filtered[0];
}

async function resolveEnvTarget(args: Record<string, unknown>, appCtx: AppCtx): Promise<EnvTarget> {
  const serviceId = typeof args['service_id'] === 'string' ? args['service_id'].trim() : '';
  const serviceName = typeof args['service_name'] === 'string' ? args['service_name'].trim() : '';
  const projectName = typeof args['project_name'] === 'string' ? args['project_name'].trim() : '';
  const projectId = typeof args['project_id'] === 'string' ? args['project_id'].trim() : '';
  const projectRef = projectId || projectName;

  let service: ServiceRow | undefined;
  let project: ProjectRow | undefined;

  if (serviceId) {
    service = await appCtx.db.getService(serviceId);
    if (!service) throw new ServiceNotFoundError(serviceId);
    project = await appCtx.db.getProject(service.project_id);
  } else if (serviceName) {
    const projectScope = await resolveProjectScope(appCtx, projectRef);
    if (projectRef && !projectScope) throw new ProjectNotFoundError(projectRef);

    const services = await appCtx.db.listServices();
    const namedServices = services.filter((item) => item.name === serviceName);
    const scopedServices = projectScope
      ? namedServices.filter((item) => item.project_id === projectScope.id)
      : namedServices;
    const deployableServices = scopedServices.filter((item) => !isManagedService(item.kind));

    if (deployableServices.length > 1) {
      await throwEnvServiceSelectionRequired(
        appCtx,
        `Multiple Applications/Compose workloads named '${serviceName}' found. Specify project_name or service_id.`,
        deployableServices,
      );
    }

    service = deployableServices[0] ?? scopedServices[0];
    if (!service && !projectName) {
      service = await resolveSingleDeployableProjectAlias(appCtx, serviceName);
    }
    if (!service) {
      throw new ServiceNotFoundError(projectRef ? `${serviceName} in ${projectRef}` : serviceName);
    }
    project = projectScope ?? (await appCtx.db.getProject(service.project_id));
  } else if (projectRef) {
    project = await resolveProjectScope(appCtx, projectRef);
    if (!project) throw new ProjectNotFoundError(projectRef);
    const deployables = await appCtx.db.getDeployablesByGroup(project.id);
    if (deployables.length !== 1) {
      await throwEnvServiceSelectionRequired(
        appCtx,
        `Project '${project.name}' has ${String(deployables.length)} Applications/Compose workloads. Specify service_name or service_id.`,
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
      `Environment variables are supported for Applications/Compose workloads, not ${service.kind} resources.`,
      'SERVICE_OPERATION_UNSUPPORTED',
      400,
      { serviceId: service.id, serviceName: service.name, kind: service.kind },
    );
  }
  project ??= await appCtx.db.getProject(service.project_id);
  if (!project) throw new ProjectNotFoundError(service.project_id);

  if (projectRef && projectRef !== project.id && projectRef !== project.name) {
    throw new ServiceNotFoundError(`${service.name} in ${projectRef}`);
  }

  const runtimeProjectId = deployableServiceIdToProjectId(service.id);
  const runtimeProject = (await appCtx.db.getProject(runtimeProjectId)) ?? project;

  return { project, service, runtimeProject };
}

function parseEnvWriteScope(raw: unknown): EnvWriteScope {
  if (raw === undefined) return 'service';
  if (typeof raw === 'string' && ENV_WRITE_SCOPES.includes(raw as EnvWriteScope)) {
    return raw as EnvWriteScope;
  }
  throw new OpenLanderError(
    `scope must be one of: ${ENV_WRITE_SCOPES.join(', ')}`,
    'INVALID_FIELD',
    400,
    { allowed: ENV_WRITE_SCOPES },
  );
}

async function resolveProjectWriteTarget(
  args: Record<string, unknown>,
  appCtx: AppCtx,
): Promise<ResolvedProjectRow> {
  const projectId = typeof args['project_id'] === 'string' ? args['project_id'].trim() : '';
  const projectName = typeof args['project_name'] === 'string' ? args['project_name'].trim() : '';
  const projectRef = projectId || projectName;

  if (projectRef) {
    const project = await resolveProjectScope(appCtx, projectRef);
    if (!project) throw new ProjectNotFoundError(projectRef);
    return project;
  }

  const target = await resolveEnvTarget(args, appCtx);
  return target.project;
}

async function resolveEnvWriteTarget(
  args: Record<string, unknown>,
  appCtx: AppCtx,
): Promise<EnvWriteTarget> {
  const scopeExplicit = args['scope'] !== undefined;
  const scope = parseEnvWriteScope(args['scope']);

  if (args['environment_key'] !== undefined && !scope.endsWith('_environment')) {
    throw new OpenLanderError(
      `scope must be ${scope === 'project' ? 'project_environment' : 'service_environment'} when environment_key is provided`,
      'INVALID_FIELD',
      400,
      { scope, environment_key: args['environment_key'] },
    );
  }

  if (scope === 'project' || scope === 'project_environment') {
    const project = await resolveProjectWriteTarget(args, appCtx);
    const environmentKey =
      scope === 'project_environment'
        ? parseEnvironmentKeyOrThrow(args['environment_key'])
        : undefined;
    const environment =
      environmentKey === undefined
        ? undefined
        : await resolveEnvironmentByKeyOrThrow(appCtx.db, project.id, environmentKey);
    return {
      scope,
      scopeExplicit,
      project,
      environmentId: environment?.id,
      environmentKey,
    };
  }

  const target = await resolveEnvTarget(args, appCtx);
  const environmentKey =
    scope === 'service_environment'
      ? parseEnvironmentKeyOrThrow(args['environment_key'])
      : undefined;
  const environment =
    environmentKey === undefined
      ? undefined
      : await resolveEnvironmentByKeyOrThrow(appCtx.db, target.project.id, environmentKey);
  return {
    scope,
    scopeExplicit,
    project: target.project,
    service: target.service,
    runtimeProject: target.runtimeProject,
    environmentId: environment?.id,
    environmentKey,
  };
}

function targetResponseFields(target: EnvWriteTarget): Record<string, unknown> {
  return {
    ...(target.service ? { service: target.service.name } : {}),
    ...(target.scopeExplicit || target.scope !== 'service' ? { scope: target.scope } : {}),
    ...(target.environmentKey ? { environment_key: target.environmentKey } : {}),
  };
}

async function getRawEnvVarsForTarget(
  appCtx: AppCtx,
  target: EnvWriteTarget,
): Promise<Record<string, string>> {
  if (target.service === undefined) {
    return target.environmentId === undefined
      ? await appCtx.env.getAll(target.project.id)
      : await appCtx.env.getAll(target.project.id, target.environmentId);
  }

  return target.environmentId === undefined
    ? await appCtx.env.getAllForService(target.project.id, target.service.id)
    : await appCtx.env.getAllForService(target.project.id, target.service.id, target.environmentId);
}

async function getMaskedEnvVarsForTarget(
  appCtx: AppCtx,
  target: EnvWriteTarget,
): Promise<Record<string, string>> {
  if (target.service === undefined) {
    return target.environmentId === undefined
      ? await appCtx.env.getAllMasked(target.project.id)
      : await appCtx.env.getAllMasked(target.project.id, target.environmentId);
  }

  return target.environmentId === undefined
    ? await appCtx.env.getAllForServiceMasked(target.project.id, target.service.id)
    : await appCtx.env.getAllForServiceMasked(
        target.project.id,
        target.service.id,
        target.environmentId,
      );
}

async function deleteEnvVarForTarget(
  appCtx: AppCtx,
  target: EnvWriteTarget,
  key: string,
): Promise<boolean> {
  if (target.service === undefined) {
    return target.environmentId === undefined
      ? await appCtx.env.delete(target.project.id, key)
      : await appCtx.env.delete(target.project.id, key, target.environmentId);
  }

  return target.environmentId === undefined
    ? await appCtx.env.deleteForService(target.project.id, target.service.id, key)
    : await appCtx.env.deleteForService(
        target.project.id,
        target.service.id,
        key,
        target.environmentId,
      );
}

async function deleteBulkEnvVarsForTarget(
  appCtx: AppCtx,
  target: EnvWriteTarget,
  keys: string[],
): Promise<{ deleted: string[]; notFound: string[]; changed: boolean }> {
  if (target.service === undefined) {
    return target.environmentId === undefined
      ? await appCtx.env.deleteBulk(target.project.id, keys)
      : await appCtx.env.deleteBulk(target.project.id, keys, target.environmentId);
  }

  return target.environmentId === undefined
    ? await appCtx.env.deleteBulkForService(target.project.id, target.service.id, keys)
    : await appCtx.env.deleteBulkForService(
        target.project.id,
        target.service.id,
        keys,
        target.environmentId,
      );
}

async function computeRedeployForTarget(
  appCtx: AppCtx,
  target: EnvWriteTarget,
  changed: boolean,
  changedKeys: string[],
  deferRedeploy: boolean,
  trigger: ToolDeployTrigger,
): Promise<{
  redeployed: boolean;
  needsRedeploy: boolean;
  applyMode?: EnvApplyMode;
  runtimeApply?: EnvRuntimeApply;
  redeploySkipped?: { reason: string; message: string };
}> {
  if (target.service && target.runtimeProject) {
    return await applyRedeployIfRequested(
      appCtx,
      {
        project: target.project,
        service: target.service,
        runtimeProject: target.runtimeProject,
      },
      changed,
      changedKeys,
      deferRedeploy,
      trigger,
    );
  }

  return {
    redeployed: false,
    needsRedeploy: await projectScopeNeedsRedeploy(appCtx, target.project, changed),
  };
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

function serviceNeedsRedeploy(service: ResolvedServiceRow): boolean {
  if (service.kind === 'compose') {
    return true;
  }
  const status = service.status;
  const hasRuntimeContainer =
    typeof service.container_id === 'string' && service.container_id.trim().length > 0;
  const statusImpliesRuntime = ['running', 'healthy', 'unhealthy', 'degraded'].includes(
    String(status),
  );
  return hasRuntimeContainer || statusImpliesRuntime;
}

function isBuildTimeEnvKey(key: string): boolean {
  return BUILD_TIME_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function changedEnvKeys(changes: Array<{ key: string; op: string }>): string[] {
  return changes.filter((change) => change.op !== 'noop').map((change) => change.key);
}

function sameImageRuntimeApply(result: RuntimeRecreateOutcome): EnvRuntimeApply {
  const routeSwitched = result.route_switched === true;
  if (result.success) {
    return {
      mode: 'same_image_recreate',
      status: routeSwitched ? 'verified' : 'applied',
      readiness: result.readiness ?? 'healthy',
      route_switched: routeSwitched,
      route_verification: routeSwitched
        ? { status: 'verified' }
        : { status: 'skipped', reason: 'missing_health_check_path' },
      previous_version_still_serving: result.previous_version_still_serving === true,
      ...(result.containerId ? { container_id: result.containerId } : {}),
      ...(result.port ? { port: result.port } : {}),
    };
  }

  const code = result.code ?? 'RUNTIME_ENV_RECREATE_FAILED';
  return {
    mode: 'same_image_recreate',
    status: 'failed',
    code,
    error: result.error ?? 'same-image recreate failed',
    readiness: result.readiness ?? 'unknown',
    route_switched: routeSwitched,
    route_verification:
      code === 'RUNTIME_ENV_ROUTE_VERIFY_FAILED'
        ? { status: 'failed' }
        : { status: 'skipped', reason: 'recreate_failed_before_route_probe' },
    previous_version_still_serving: result.previous_version_still_serving === true,
    fallback: 'redeploy_app',
  };
}

function runtimeApplyFields(redeploy: {
  applyMode?: EnvApplyMode;
  runtimeApply?: EnvRuntimeApply;
}) {
  return {
    ...(redeploy.applyMode ? { apply_mode: redeploy.applyMode } : {}),
    ...(redeploy.runtimeApply ? { runtime_apply: redeploy.runtimeApply } : {}),
  };
}

function runtimeApplyGuidance(runtimeApply: EnvRuntimeApply | undefined): string[] {
  if (!runtimeApply) return [];
  switch (runtimeApply.status) {
    case 'started':
      return [
        runtimeApply.reason === 'compose_project_env'
          ? 'A full Compose redeploy was started so the parent environment change reaches the child services.'
          : 'A full redeploy was started because at least one changed env key is read at build time.',
        'After the deploy reaches a terminal status, call diagnostic_call to verify runtime health.',
      ];
    case 'verified':
      return [
        'Same-image runtime apply completed and route verification passed.',
        'diagnostic_call is optional unless the user still sees a failure.',
      ];
    case 'applied':
      return [
        'Same-image runtime apply completed, but route verification was skipped because no health_check_path is configured.',
        'Call diagnostic_call to verify runtime health before reporting success.',
      ];
    case 'failed':
      return [
        runtimeApply.previous_version_still_serving
          ? 'Runtime apply failed, but the previous version is still serving.'
          : 'Runtime apply failed and OpenLander could not confirm a previous version is still serving.',
        'Call diagnostic_call before deciding whether a full redeploy is required.',
      ];
    case 'skipped':
      return [
        `Runtime apply was skipped: ${runtimeApply.reason}.`,
        'Call diagnostic_call if you need to inspect the current runtime before retrying.',
      ];
  }
}

async function projectScopeNeedsRedeploy(
  appCtx: AppCtx,
  project: ResolvedProjectRow,
  changed: boolean,
): Promise<boolean> {
  if (!changed) return false;
  const deployables = await appCtx.db.getDeployablesByGroup(project.id);
  return deployables.some((service) => serviceNeedsRedeploy(service));
}

async function applyRedeployIfRequested(
  appCtx: AppCtx,
  target: EnvTarget,
  changed: boolean,
  changedKeys: string[],
  deferRedeploy: boolean,
  trigger: ToolDeployTrigger,
): Promise<{
  redeployed: boolean;
  needsRedeploy: boolean;
  applyMode?: EnvApplyMode;
  runtimeApply?: EnvRuntimeApply;
  redeploySkipped?: { reason: string; message: string };
}> {
  const { project, service, runtimeProject } = target;
  const needsRedeploy = changed && serviceNeedsRedeploy(service);
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
      runtimeApply: {
        mode: changedKeys.some(isBuildTimeEnvKey) ? 'full_redeploy' : 'same_image_recreate',
        status: 'skipped',
        reason: 'PROJECT_BUSY',
        message: `Another deploy is in progress (session ${lock?.sessionId ?? 'unknown'}).`,
      },
      redeploySkipped: {
        reason: 'PROJECT_BUSY',
        message: `Env vars saved but redeploy was skipped: another deploy is in progress (session ${lock?.sessionId ?? 'unknown'}).`,
      },
    };
  }

  try {
    if (service.kind === 'compose' || changedKeys.some(isBuildTimeEnvKey)) {
      const buildTimeKeys = changedKeys.filter(isBuildTimeEnvKey);
      await appCtx.pipeline.redeployService(service.id, { trigger });
      return {
        redeployed: true,
        needsRedeploy: false,
        applyMode: 'full_redeploy',
        runtimeApply: {
          mode: 'full_redeploy',
          status: 'started',
          reason: service.kind === 'compose' ? 'compose_project_env' : 'build_time_env',
          ...(buildTimeKeys.length > 0 ? { build_time_keys: buildTimeKeys } : {}),
        },
      };
    }

    const result = await appCtx.pipeline.recreateServiceRuntime(service.id, { trigger });
    const runtimeApply = sameImageRuntimeApply(result);
    if (result.success) {
      return {
        redeployed: true,
        needsRedeploy: false,
        applyMode: 'same_image_recreate',
        runtimeApply,
      };
    }

    return {
      redeployed: false,
      needsRedeploy: true,
      applyMode: 'same_image_recreate',
      runtimeApply,
      redeploySkipped: {
        reason: result.code ?? 'RUNTIME_ENV_RECREATE_FAILED',
        message: `Env vars saved but runtime apply was skipped for ${project.name}/${service.name}: ${result.error ?? 'same-image recreate failed'}`,
      },
    };
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
        runtimeApply: {
          mode: changedKeys.some(isBuildTimeEnvKey) ? 'full_redeploy' : 'same_image_recreate',
          status: 'skipped',
          reason: err.code,
          message: err.message,
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
      'List environment variables for a project/service scope. Defaults to legacy service scope. Pass scope and environment_key to inspect environment-specific vars. Values are masked by default; pass reveal=true to return raw values for audit/export workflows. Public prefixes (NEXT_PUBLIC_, PUBLIC_, VITE_PUBLIC_, NUXT_PUBLIC_) are not masked. Returns { variables, count, revealed }.',
    mcpDescription:
      'List project/service env vars. Use scope and environment_key for environment-specific vars.',
    inputSchema: listEnvVarsSchema,
    execute: async (_args, { appCtx }) => {
      const reveal = (_args['reveal'] as boolean | undefined) ?? false;
      const target = await resolveEnvWriteTarget(_args, appCtx);
      await appCtx.db.assertEnvToolSchemaReady();
      const vars = reveal
        ? await getRawEnvVarsForTarget(appCtx, target)
        : await getMaskedEnvVarsForTarget(appCtx, target);
      return Promise.resolve({
        project: target.project.name,
        ...targetResponseFields(target),
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
      'Get the unmasked value of a single project/service environment variable for debugging. Use scope and environment_key for environment-specific vars. Returns { key, value }. Throws NOT_FOUND error if key does not exist.',
    mcpDescription: 'Get a single project/service environment variable value.',
    inputSchema: getEnvVarSchema,
    execute: async (_args, { appCtx }) => {
      const key = _args['key'] as string;
      const target = await resolveEnvWriteTarget(_args, appCtx);
      await appCtx.db.assertEnvToolSchemaReady();
      const vars = await getRawEnvVarsForTarget(appCtx, target);
      if (key in vars) {
        return Promise.resolve({
          project: target.project.name,
          ...targetResponseFields(target),
          key,
          value: vars[key],
        });
      }
      throw new OpenLanderError(`Environment variable "${key}" not found`, 'NOT_FOUND', 404, {
        key,
        scope: target.scope,
        ...(target.service ? { serviceId: target.service.id } : {}),
        ...(target.environmentKey ? { environmentKey: target.environmentKey } : {}),
      });
    },
  },
  {
    name: 'set_env_vars',
    riskLevel: 'medium',
    description:
      'Set environment variables for a Project or Application/Compose workload. Defaults to legacy service scope. Pass scope=project/project_environment/service/service_environment; environment scopes require environment_key. By default this saves only and does NOT redeploy; call update_app separately to apply to a running container, or pass defer_redeploy=false for immediate workload redeploy. variables may be an object or JSON-stringified object with string values only; null is rejected. Returns { status, project, service?, scope when explicit or non-service, keys, changed, needs_redeploy }.',
    mcpDescription:
      'Set project/service env vars. Use scope and environment_key for environment-specific writes. Default saves only.',
    inputSchema: setEnvVarsSchema,
    execute: async (args, context) => {
      const { appCtx } = context;
      const target = await resolveEnvWriteTarget(args, appCtx);
      const vars = parseEnvVariables(args['variables']);
      const deferRedeploy = (args['defer_redeploy'] as boolean | undefined) ?? true;
      await appCtx.db.assertEnvToolSchemaReady();

      const changes =
        target.service === undefined
          ? target.environmentId === undefined
            ? await appCtx.env.setBulkDetailed(target.project.id, vars)
            : await appCtx.env.setBulkDetailed(target.project.id, vars, target.environmentId)
          : target.environmentId === undefined
            ? await appCtx.env.setBulkForServiceDetailed(target.project.id, target.service.id, vars)
            : await appCtx.env.setBulkForServiceDetailed(
                target.project.id,
                target.service.id,
                vars,
                target.environmentId,
              );
      const changed = changes.some((change) => change.op !== 'noop');
      const mismatches =
        target.service === undefined
          ? target.environmentId === undefined
            ? await appCtx.env.verifyRoundTrip(target.project.id, vars)
            : await appCtx.env.verifyRoundTrip(target.project.id, vars, target.environmentId)
          : target.environmentId === undefined
            ? await appCtx.env.verifyRoundTripForService(target.project.id, target.service.id, vars)
            : await appCtx.env.verifyRoundTripForService(
                target.project.id,
                target.service.id,
                vars,
                target.environmentId,
              );

      if (mismatches.length > 0) {
        return {
          status: 'error',
          project: target.project.name,
          ...(target.service ? { service: target.service.name } : {}),
          ...(target.scopeExplicit || target.scope !== 'service' ? { scope: target.scope } : {}),
          ...(target.environmentKey ? { environment_key: target.environmentKey } : {}),
          error: `Round-trip verification failed for keys: ${mismatches.join(', ')}. Values may have been mangled during storage.`,
          keys: Object.keys(vars),
        };
      }

      const redeploy =
        target.service && target.runtimeProject
          ? await applyRedeployIfRequested(
              appCtx,
              {
                project: target.project,
                service: target.service,
                runtimeProject: target.runtimeProject,
              },
              changed,
              changedEnvKeys(changes),
              deferRedeploy,
              deployTriggerForToolContext(context),
            )
          : {
              redeployed: false,
              needsRedeploy: await projectScopeNeedsRedeploy(appCtx, target.project, changed),
            };
      await recordEnvActivity(appCtx, target.project.id, 'set', Object.keys(vars), {
        scope: target.scope,
        ...(target.service
          ? { service_id: target.service.id, service_name: target.service.name }
          : {}),
        ...(target.environmentKey ? { environment_key: target.environmentKey } : {}),
        changed_count: changes.filter((change) => change.op !== 'noop').length,
        needs_redeploy: redeploy.needsRedeploy,
        deferred: deferRedeploy,
        ...(redeploy.applyMode ? { apply_mode: redeploy.applyMode } : {}),
      });

      if (redeploy.redeployed) {
        return {
          status: 'updated_and_redeployed',
          project: target.project.name,
          ...(target.service ? { service: target.service.name } : {}),
          ...(target.scopeExplicit || target.scope !== 'service' ? { scope: target.scope } : {}),
          ...(target.environmentKey ? { environment_key: target.environmentKey } : {}),
          keys: Object.keys(vars),
          changed: changes,
          needs_redeploy: false,
          ...runtimeApplyFields(redeploy),
          ...(target.service
            ? {
                diagnostic_call: {
                  tool: 'openlander_monitor',
                  action: 'diagnose_service',
                  params: { service_id: target.service.id },
                },
              }
            : {}),
          _agent_guidance: {
            next_steps: runtimeApplyGuidance(redeploy.runtimeApply),
          },
        };
      }

      if (redeploy.redeploySkipped) {
        return {
          status: 'updated_redeploy_skipped',
          project: target.project.name,
          ...(target.service ? { service: target.service.name } : {}),
          ...(target.scopeExplicit || target.scope !== 'service' ? { scope: target.scope } : {}),
          ...(target.environmentKey ? { environment_key: target.environmentKey } : {}),
          keys: Object.keys(vars),
          changed: changes,
          needs_redeploy: true,
          reason: redeploy.redeploySkipped.reason,
          message: redeploy.redeploySkipped.message,
          ...runtimeApplyFields(redeploy),
          ...(target.service
            ? {
                diagnostic_call: {
                  tool: 'openlander_monitor',
                  action: 'diagnose_service',
                  params: { service_id: target.service.id },
                },
              }
            : {}),
          _agent_guidance: {
            next_steps: runtimeApplyGuidance(redeploy.runtimeApply),
          },
        };
      }

      return {
        status: 'updated',
        project: target.project.name,
        ...(target.service ? { service: target.service.name } : {}),
        ...(target.scopeExplicit || target.scope !== 'service' ? { scope: target.scope } : {}),
        ...(target.environmentKey ? { environment_key: target.environmentKey } : {}),
        keys: Object.keys(vars),
        changed: changes,
        needs_redeploy: redeploy.needsRedeploy,
        _agent_guidance: {
          next_steps: redeploy.needsRedeploy
            ? ['Update required: call update_app to apply env changes.']
            : ['No redeploy required for these env changes.'],
        },
      };
    },
  },
  {
    name: 'export_env_vars',
    riskLevel: 'medium',
    description:
      'Export all environment variables for a project/service scope as .env text with raw unmasked values. Use scope and environment_key for environment-specific vars. This is intended for audit/migration workflows and records an audit activity without storing values.',
    mcpDescription: 'Export project/service env vars as .env text with raw values.',
    inputSchema: exportEnvVarsSchema,
    execute: async (args, { appCtx }) => {
      const target = await resolveEnvWriteTarget(args, appCtx);
      await appCtx.db.assertEnvToolSchemaReady();
      const vars = await getRawEnvVarsForTarget(appCtx, target);
      const keys = Object.keys(vars).sort();
      await recordEnvActivity(appCtx, target.project.id, 'export', keys, {
        scope: target.scope,
        ...(target.service
          ? { service_id: target.service.id, service_name: target.service.name }
          : {}),
        ...(target.environmentKey ? { environment_key: target.environmentKey } : {}),
      });
      return {
        project: target.project.name,
        ...targetResponseFields(target),
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
      'Delete one Project or Application/Compose environment variable. Use scope and environment_key for environment-specific vars. By default this saves only and does NOT redeploy; call update_app separately to apply to a running workload, or pass defer_redeploy=false for immediate redeploy.',
    mcpDescription: 'Delete one project/service env var. Default saves only.',
    inputSchema: deleteEnvVarSchema,
    execute: async (args, context) => {
      const { appCtx } = context;
      const key = args['key'] as string;
      const deferRedeploy = (args['defer_redeploy'] as boolean | undefined) ?? true;
      const target = await resolveEnvWriteTarget(args, appCtx);
      await appCtx.db.assertEnvToolSchemaReady();
      const deleted = await deleteEnvVarForTarget(appCtx, target, key);
      const redeploy = await computeRedeployForTarget(
        appCtx,
        target,
        deleted,
        deleted ? [key] : [],
        deferRedeploy,
        deployTriggerForToolContext(context),
      );
      if (deleted) {
        await recordEnvActivity(appCtx, target.project.id, 'delete', [key], {
          scope: target.scope,
          ...(target.service
            ? { service_id: target.service.id, service_name: target.service.name }
            : {}),
          ...(target.environmentKey ? { environment_key: target.environmentKey } : {}),
          needs_redeploy: redeploy.needsRedeploy,
          deferred: deferRedeploy,
          ...(redeploy.applyMode ? { apply_mode: redeploy.applyMode } : {}),
        });
      }
      return {
        status: deleted ? 'deleted' : 'not_found',
        project: target.project.name,
        ...targetResponseFields(target),
        key,
        needs_redeploy: redeploy.needsRedeploy,
        ...runtimeApplyFields(redeploy),
      };
    },
  },
  {
    name: 'bulk_delete_env_vars',
    riskLevel: 'high',
    description:
      'Delete multiple Project or Application/Compose environment variables. Use scope and environment_key for environment-specific vars. Omitting confirm=true returns a dry-run preview only. By default confirmed deletes do NOT redeploy; call update_app separately to apply, or pass defer_redeploy=false for immediate redeploy.',
    mcpDescription: 'Bulk delete project/service env vars with confirm-gated dry-run behavior.',
    inputSchema: bulkDeleteEnvVarsSchema,
    execute: async (args, context) => {
      const { appCtx } = context;
      const keys = args['keys'] as string[];
      const confirm = (args['confirm'] as boolean | undefined) ?? false;
      const deferRedeploy = (args['defer_redeploy'] as boolean | undefined) ?? true;
      const target = await resolveEnvWriteTarget(args, appCtx);
      await appCtx.db.assertEnvToolSchemaReady();
      const existing = await getRawEnvVarsForTarget(appCtx, target);
      const wouldDelete = keys.filter((key) => key in existing);
      const notFound = keys.filter((key) => !(key in existing));

      if (!confirm) {
        return {
          ...(target.scopeExplicit || target.scope !== 'service'
            ? { project: target.project.name, ...targetResponseFields(target) }
            : {}),
          would_delete: wouldDelete,
          not_found: notFound,
          count_to_delete: wouldDelete.length,
          confirm_required: true,
        };
      }

      const result = await deleteBulkEnvVarsForTarget(appCtx, target, keys);
      const redeploy = await computeRedeployForTarget(
        appCtx,
        target,
        result.changed,
        result.deleted,
        deferRedeploy,
        deployTriggerForToolContext(context),
      );
      if (result.deleted.length > 0) {
        await recordEnvActivity(appCtx, target.project.id, 'bulk_delete', result.deleted, {
          scope: target.scope,
          ...(target.service
            ? { service_id: target.service.id, service_name: target.service.name }
            : {}),
          ...(target.environmentKey ? { environment_key: target.environmentKey } : {}),
          needs_redeploy: redeploy.needsRedeploy,
          deferred: deferRedeploy,
          ...(redeploy.applyMode ? { apply_mode: redeploy.applyMode } : {}),
        });
      }
      return {
        status: 'deleted',
        project: target.project.name,
        ...targetResponseFields(target),
        deleted: result.deleted,
        not_found: result.notFound,
        count_deleted: result.deleted.length,
        needs_redeploy: redeploy.needsRedeploy,
        ...runtimeApplyFields(redeploy),
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
      'Publish one HTTP Application at a stable HTTPS URL protected by an access code. Prefer service_id. project_id/project_name are accepted only when the Project has one deployable workload. Set rotate_access_code=true to replace the code and invalidate existing sessions.',
    mcpDescription:
      'Enable protected public sharing at a stable HTTPS URL for an Application/Compose workload. Returns the generated access_code once when created or rotated; call get_public_access for later status. Set provider=cloudflare for optional Connected Publish.',
    inputSchema: publicAccessTargetSchema,
    execute: async (args, { appCtx }) => {
      const target = await resolveDeployableTarget(appCtx, args, 'expose_public');
      const provider = args['provider'] === 'cloudflare' ? 'cloudflare' : 'protected_share';
      if (provider === 'cloudflare' && args['rotate_access_code'] === true) {
        throw new OpenLanderError(
          'rotate_access_code is only supported by provider=protected_share.',
          'INVALID_FIELD',
          400,
        );
      }
      const result =
        provider === 'cloudflare'
          ? await appCtx.cloudflare.requestPublicAccess({
              projectId: target.project.id,
              serviceId: target.service.id,
            })
          : await appCtx.publicShare.expose({
              projectId: target.project.id,
              serviceId: target.service.id,
              rotateAccessCode: args['rotate_access_code'] === true,
            });
      return {
        ...result,
        project_id: target.project.id,
        service_id: target.service.id,
        provider,
        status_call: publicAccessStatusCall(target.service.id, provider),
        _agent_guidance: {
          message:
            provider === 'cloudflare'
              ? 'Cloudflare Connected Publish is provisioning or serving the stable URL.'
              : 'access_code' in result && result.access_code
                ? 'Protected public sharing is ready. The access code is shown only in this response.'
                : 'Protected public sharing is ready. Rotate the code if the operator no longer has it.',
          next_steps: [
            provider === 'cloudflare'
              ? 'Poll status_call until status is public or error.'
              : 'access_code' in result && result.access_code
                ? 'Return public_url and access_code to the user through a secure channel.'
                : 'Return public_url to the user.',
          ],
        },
      };
    },
  },
  {
    name: 'get_public_access',
    riskLevel: 'low',
    description:
      'Get protected public sharing status and the stable URL for an Application/Compose workload.',
    mcpDescription: 'Get protected public access status. Returns private or public.',
    inputSchema: publicAccessTargetSchema,
    execute: async (args, { appCtx }) => {
      const target = await resolvePublicAccessProject(appCtx, args);
      const provider = args['provider'] === 'cloudflare' ? 'cloudflare' : 'protected_share';
      const result =
        provider === 'cloudflare'
          ? await appCtx.cloudflare.getPublicAccess(target.project.id)
          : await appCtx.publicShare.getPublicAccess({
              projectId: target.project.id,
              ...(target.serviceId ? { serviceId: target.serviceId } : {}),
            });
      return {
        ...result,
        provider,
        ...(result.service_id
          ? { status_call: publicAccessStatusCall(result.service_id, provider) }
          : {}),
        _agent_guidance: {
          message:
            result.status === 'public'
              ? 'The stable public URL is ready.'
              : result.status === 'private'
                ? 'The Application is private.'
                : `Cloudflare Connected Publish is ${result.status}.`,
          next_steps:
            result.status === 'public'
              ? ['Return public_url to the user.']
              : provider === 'cloudflare' && result.status !== 'private'
                ? ['Poll status_call until status is public, private, or error.']
                : [],
        },
      };
    },
  },
  {
    name: 'unexpose_public',
    riskLevel: 'medium',
    description:
      'Disable protected public sharing. The hostname is retained for reuse and all existing share sessions are invalidated.',
    mcpDescription:
      'Make the Application private while preserving its stable hostname reservation for republish.',
    inputSchema: publicAccessTargetSchema,
    execute: async (args, { appCtx }) => {
      const target = await resolvePublicAccessProject(appCtx, args);
      const provider = args['provider'] === 'cloudflare' ? 'cloudflare' : 'protected_share';
      const result =
        provider === 'cloudflare'
          ? await appCtx.cloudflare.requestPrivateAccess(target.project.id)
          : await appCtx.publicShare.unexpose({
              projectId: target.project.id,
              ...(target.serviceId ? { serviceId: target.serviceId } : {}),
            });
      return {
        ...result,
        provider,
        ...(target.serviceId
          ? { status_call: publicAccessStatusCall(target.serviceId, provider) }
          : {}),
        _agent_guidance: {
          message:
            result.status === 'private'
              ? 'The Application is private.'
              : 'Protected public sharing is being disabled.',
          next_steps:
            result.status === 'private'
              ? []
              : ['Poll status_call until status is private or error.'],
        },
      };
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
