import { nanoid } from 'nanoid';
import { DeployLockedError, OpenLanderError } from '../../errors.js';
import type { ToolContext, ToolDef } from './types.js';
import type { DeployPlan } from '../../pipeline/deploy-plan/types.js';
import type { PlanUpdates, ExecutePlanResult } from '../../pipeline/deploy-plan/engine.js';
import { eventBus } from '../../events/index.js';
import { getDockerHostType } from '../../pipeline/docker.js';
import { createModuleLogger } from '../../lib/logger.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import {
  getDeployableServiceRouteName,
  getDeployableServiceUrls,
  getPreferredDeployableServiceUrl,
  getPreferredProjectUrl,
  getProjectUrls,
} from '../../pipeline/traefik.js';
import { markMcpDeploy } from '../../pipeline/auto-recovery.js';
import { MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import { deployableServiceIdToProjectId } from '../../db/service-ids.js';
import { targetIdentityResolver } from '../../db/target-identity-resolver.js';
import {
  loadServiceViewRecords,
  serviceViewFromRows,
  type ServiceViewRecord,
} from '../../db/views/service-view.js';
import {
  buildDeployLockedResponse,
  deployTriggerForToolContext,
  tryAcquireDeployLockOrResponse,
} from './helpers.js';
import {
  runDeployableServiceAction,
  runUpdateApplicationSourceAction,
} from './deployable-service.js';
import {
  inferEnvValueRequirement,
  mergeEnvValueRequirement,
  validateEnvValue,
  type EnvValueIssue,
  type EnvValueRequirement,
} from '../../pipeline/env-requirements.js';

import {
  createDeployPlanSchema,
  getDeployPlanSchema,
  updateDeployPlanSchema,
  executeDeployPlanSchema,
  cancelDeploySchema,
  deploySchema,
  validateDeployPlanSchema,
} from './schemas.js';
import { resolveDeployableTarget } from './deployable-target.js';
import {
  observeRepresentativeTraffic,
  representativeTrafficFailed,
  representativeTrafficToJson,
  representativeTrafficWarning,
  type RepresentativeTrafficObservation,
} from './representative-traffic.js';

type AppCtx = ToolContext['appCtx'];
type ProjectRow = NonNullable<Awaited<ReturnType<AppCtx['db']['getProject']>>>;
type DeployPlanRow = NonNullable<Awaited<ReturnType<AppCtx['db']['getDeployPlan']>>>;
type DeployLogRow = NonNullable<Awaited<ReturnType<AppCtx['db']['getDeployLog']>>>;
type ServiceRow = NonNullable<Awaited<ReturnType<AppCtx['db']['getService']>>>;
type DeploymentReadiness = 'healthy' | 'starting' | 'unhealthy' | 'no_healthcheck';

const log = createModuleLogger('tools-defs-deploy-plan');

const POST_DEPLOY_STABILITY_OBSERVE_MS = 12_000;
const POST_DEPLOY_STABILITY_POLL_MS = 2_000;

// Pipeline success events emit `url` for both internal and tunnel deploys —
// most regular deploys pass an internal getProjectUrl-derived value
// (`{name}.localhost` or `*.sslip.io`) which is exactly what we want to
// replace with the port-aware preferred URL. Only treat the payload URL as
// authoritative when it advertises an external host (tunnel, custom domain,
// configured OPENLANDER_PUBLIC_HOST, etc.).
function isExternalDeployUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    if (host === 'localhost') return false;
    if (host.endsWith('.localhost')) return false;
    if (host.endsWith('.sslip.io')) return false;
    return true;
  } catch {
    return false;
  }
}

interface ReadinessResult {
  readiness: DeploymentReadiness;
  ready: boolean;
  message?: string;
}

interface StabilityObservation {
  status: 'stable' | 'unstable' | 'skipped';
  observed_ms: number;
  readiness: DeploymentReadiness;
  message?: string;
  result: ReadinessResult;
}

interface PlanInputRequirement {
  key: string;
  source: string;
  required: boolean;
  requirement: EnvValueRequirement;
}

type ContainerState = {
  Running?: boolean;
  Restarting?: boolean;
  ExitCode?: number;
  StartedAt?: string;
  Health?: { Status?: string };
};

type ContainerInspectState = {
  RestartCount?: number;
  State?: ContainerState;
};

function isRecentContainerStart(value: unknown, maxAgeMs: number): boolean {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && Date.now() - parsed >= 0 && Date.now() - parsed <= maxAgeMs;
}

function readinessGuidance(readiness: DeploymentReadiness): string | undefined {
  if (readiness === 'unhealthy') {
    return 'Container is running but healthcheck is failing. Call openlander_monitor.diagnose_service for logs, env, dependency checks, and probe output before reporting success.';
  }
  if (readiness === 'starting') {
    return 'Container is running but still warming up. Poll openlander_monitor.diagnose_service or get_deploy_status before reporting success.';
  }
  if (readiness === 'no_healthcheck') {
    return 'Container has no Docker HEALTHCHECK. Treat the deploy as running, but verify the app with openlander_monitor.diagnose_service or an HTTP probe if correctness matters.';
  }
  return undefined;
}

async function loadProjectServiceRecord(
  appCtx: AppCtx,
  projectId: string,
): Promise<ServiceViewRecord | undefined> {
  const project = await appCtx.db.getProject(projectId);
  if (!project) {
    return undefined;
  }

  if (typeof appCtx.db.getServices === 'function') {
    return (await loadServiceViewRecords(appCtx.db, [project])).get(project.id);
  }

  return {
    project,
    service: null,
    view: serviceViewFromRows(project, null),
  };
}

async function inspectProjectReadiness(
  appCtx: AppCtx,
  projectId: string,
): Promise<ReadinessResult> {
  const serviceRecord = await loadProjectServiceRecord(appCtx, projectId);
  const containerId = serviceRecord?.view.containerId ?? null;
  if (!containerId) {
    return { readiness: 'starting', ready: false, message: 'No container_id recorded yet.' };
  }

  try {
    const info = (await appCtx.docker.inspectContainer(containerId)) as ContainerInspectState;
    const state = info.State ?? {};
    if (state.Restarting || state.Running === false) {
      return {
        readiness: 'unhealthy',
        ready: false,
        message:
          state.ExitCode === undefined
            ? 'Container is not running.'
            : `Container is not running (exit code ${String(state.ExitCode)}).`,
      };
    }

    const restartCount = typeof info.RestartCount === 'number' ? info.RestartCount : 0;
    if (
      state.Running === true &&
      restartCount >= 3 &&
      isRecentContainerStart(state.StartedAt, 5 * 60 * 1000)
    ) {
      return {
        readiness: 'unhealthy',
        ready: false,
        message: `Container restarted ${String(restartCount)} times recently. Treat this as a restart loop until diagnose_service/logs confirm the current process is stable.`,
      };
    }

    if (!state.Health) {
      return { readiness: 'no_healthcheck', ready: true };
    }

    if (state.Health.Status === 'healthy') {
      return { readiness: 'healthy', ready: true };
    }

    if (state.Health.Status === 'unhealthy') {
      return {
        readiness: 'unhealthy',
        ready: false,
        message: 'Container healthcheck is unhealthy.',
      };
    }

    return {
      readiness: 'starting',
      ready: false,
      message: `Container healthcheck is ${state.Health.Status ?? 'starting'}.`,
    };
  } catch (error) {
    return {
      readiness: 'starting',
      ready: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForProjectReadiness(
  appCtx: AppCtx,
  projectId: string,
  timeoutMs: number,
): Promise<ReadinessResult> {
  const started = Date.now();
  let last = await inspectProjectReadiness(appCtx, projectId);
  while (last.readiness === 'starting' && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    last = await inspectProjectReadiness(appCtx, projectId);
  }
  return last;
}

async function observeProjectStability(
  appCtx: AppCtx,
  projectId: string,
  initial: ReadinessResult,
  observeMs = POST_DEPLOY_STABILITY_OBSERVE_MS,
): Promise<StabilityObservation> {
  const started = Date.now();
  if (!initial.ready) {
    return {
      status: 'skipped',
      observed_ms: 0,
      readiness: initial.readiness,
      message: initial.message ?? readinessGuidance(initial.readiness),
      result: initial,
    };
  }

  let last = initial;
  while (Date.now() - started < observeMs) {
    const elapsed = Date.now() - started;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(POST_DEPLOY_STABILITY_POLL_MS, observeMs - elapsed)),
    );
    last = await inspectProjectReadiness(appCtx, projectId);
    if (last.readiness === 'unhealthy') {
      return {
        status: 'unstable',
        observed_ms: Date.now() - started,
        readiness: last.readiness,
        message:
          last.message ??
          'Container restarted, exited, or became unhealthy during the post-deploy stability window.',
        result: last,
      };
    }
  }

  return {
    status: 'stable',
    observed_ms: Date.now() - started,
    readiness: last.readiness,
    result: last,
  };
}

interface TargetAttachObservation {
  status?: 'attached' | 'pending' | 'failed';
  fields: Record<string, unknown>;
  warnings: string[];
  error?: string;
}

function buildTargetAttachFields(result: ExecutePlanResult): Record<string, unknown> {
  if (!result.target_project_id) {
    return {};
  }

  const runtimeProjectId = result.runtime_project_id ?? result.project_id;
  // Route every response-path service_id through the single resolver guard so a
  // missing runtime project omits the field instead of fabricating an id. An
  // explicit result.service_id from the engine still wins when present.
  const serviceId =
    result.service_id ?? targetIdentityResolver.deployableServiceIdForResponse(runtimeProjectId);
  return {
    target_project_id: result.target_project_id,
    ...(runtimeProjectId ? { runtime_project_id: runtimeProjectId } : {}),
    ...(serviceId ? { service_id: serviceId } : {}),
  };
}

async function observeTargetAttach(
  appCtx: AppCtx,
  planId: string,
  result: ExecutePlanResult,
): Promise<TargetAttachObservation> {
  const fields = buildTargetAttachFields(result);
  if (!result.target_project_id) {
    return { fields, warnings: [] };
  }

  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const row = await appCtx.db.getDeployPlan(planId);
    const planRow = row as
      | {
          status?: string;
          plan_json?: string;
          error_message?: string | null;
        }
      | undefined
      | null;

    let storedStatus = planRow?.status;
    let storedError = planRow?.error_message ?? undefined;
    if (planRow?.plan_json) {
      try {
        const stored = JSON.parse(planRow.plan_json) as {
          status?: string;
          error_message?: string;
        };
        storedStatus = storedStatus ?? stored.status;
        storedError = storedError ?? stored.error_message;
      } catch {
        // Ignore malformed stored JSON here; the deploy plan engine owns the
        // authoritative terminal state and the caller still gets a poll hint.
      }
    }

    if (storedStatus === 'completed') {
      return { status: 'attached', fields, warnings: [] };
    }
    if (storedStatus === 'failed') {
      return {
        status: 'failed',
        fields,
        warnings: [],
        error: storedError ?? 'Deploy succeeded but target attach failed.',
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return {
    status: 'pending',
    fields,
    warnings: [
      'target_project_id attach is still being finalized by the deploy plan. Poll get_deploy_status or list_projects before taking follow-up actions.',
    ],
  };
}

function parseEnvVarsInput(
  raw: unknown,
  fieldName = 'env_vars',
): Record<string, string> | undefined {
  if (raw === undefined) {
    return undefined;
  }

  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new OpenLanderError(
        `${fieldName} must be a JSON object string or an object with string values.`,
        'BAD_REQUEST',
        400,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OpenLanderError(
      `${fieldName} must be an object with string values.`,
      'BAD_REQUEST',
      400,
    );
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new OpenLanderError(`${fieldName}.${key} must be a string.`, 'BAD_REQUEST', 400, {
        key,
      });
    }
    result[key] = value;
  }
  return result;
}

function deployStatusCall(params: {
  projectId?: string | null;
  projectName?: string | null;
  deployId?: string | null;
}): Record<string, unknown> {
  return {
    tool: 'openlander_deploy',
    action: 'get_deploy_status',
    params: {
      ...(params.projectId ? { project_id: params.projectId } : {}),
      ...(params.projectName ? { project_name: params.projectName } : {}),
      ...(params.deployId ? { deploy_id: params.deployId } : {}),
    },
  };
}

function updateDeployPlanSuggestedCall(planId: string): Record<string, unknown> {
  return {
    tool: 'openlander_deploy',
    action: 'update_deploy_plan',
    params: {
      plan_id: planId,
      updates: '{"env":{"KEY":"value"}}',
    },
  };
}

function executeDeployPlanSuggestedCall(
  planId: string,
  approveAllSafeResources = false,
): Record<string, unknown> {
  return {
    tool: 'openlander_deploy',
    action: 'execute_deploy_plan',
    params: {
      plan_id: planId,
      ...(approveAllSafeResources ? { approve_all_safe_resources: true } : {}),
    },
  };
}

function getDeployPlanSuggestedCall(planId: string): Record<string, unknown> {
  return {
    tool: 'openlander_deploy',
    action: 'get_deploy_plan',
    params: { plan_id: planId },
  };
}

function safeProposedResourceIds(plan: Pick<DeployPlan, 'services'>): string[] {
  return plan.services
    .filter(
      (svc) => svc.resolution === 'proposed_project_service' && svc.approval === 'safe_resource',
    )
    .map((svc) => svc.name ?? svc.type);
}

function buildPlanNeedsInputResponse(params: {
  planId: string;
  missing: string[];
  inputRequirements?: PlanInputRequirement[];
  envIssues?: EnvValueIssue[];
  warnings?: string[];
  message: string;
  nextSteps: string[];
  error?: string;
}): Record<string, unknown> {
  const { planId, missing, inputRequirements, envIssues, warnings, message, nextSteps, error } =
    params;
  return {
    plan_id: planId,
    status: 'needs_input',
    ...(error ? { error } : {}),
    missing,
    ...(inputRequirements && inputRequirements.length > 0
      ? { input_requirements: inputRequirements }
      : {}),
    ...(envIssues && envIssues.length > 0 ? { env_issues: envIssues } : {}),
    action_summary: buildNeedsInputActionSummary({
      planId,
      missing,
      inputRequirements: inputRequirements ?? [],
      envIssues: envIssues ?? [],
    }),
    ...(warnings ? { warnings } : {}),
    suggested_call: updateDeployPlanSuggestedCall(planId),
    _agent_guidance: {
      message,
      next_steps: nextSteps,
    },
  };
}

function buildPlanInputRequirements(plan: {
  env?: DeployPlan['env'];
  missing?: string[];
}): PlanInputRequirement[] {
  if (!plan.env) {
    return [];
  }
  const targetKeys = new Set(plan.missing ?? []);
  for (const issue of plan.env.issues ?? []) {
    if (issue.severity === 'fail') {
      targetKeys.add(issue.key);
    }
  }

  const detectedEnvEntries = Array.isArray(plan.env.detected) ? plan.env.detected : [];
  return detectedEnvEntries
    .flatMap((entry) => {
      if (!targetKeys.has(entry.key) || !entry.requirement) {
        return [];
      }
      const inferred = inferEnvValueRequirement(entry.key);
      const requirement = {
        ...inferred,
        ...entry.requirement,
        guidance: entry.requirement.guidance ?? inferred?.guidance,
      };
      return [
        {
          key: entry.key,
          source: entry.source,
          required: entry.required,
          requirement,
        },
      ];
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function buildNeedsInputActionSummary(params: {
  planId: string;
  missing: string[];
  inputRequirements: PlanInputRequirement[];
  envIssues: EnvValueIssue[];
}): Record<string, unknown> {
  const blockingIssues = params.envIssues.filter((issue) => issue.severity === 'fail');
  const issueByKey = new Map(blockingIssues.map((issue) => [issue.key, issue]));
  const requirementByKey = new Map(params.inputRequirements.map((item) => [item.key, item]));
  const keys = Array.from(
    new Set([...params.missing, ...blockingIssues.map((issue) => issue.key)]),
  ).sort((a, b) => a.localeCompare(b));
  const trustedKeys = keys.filter((key) => {
    const issue = issueByKey.get(key);
    const requirement = requirementByKey.get(key)?.requirement ?? issue?.requirement;
    return (
      issue?.code === 'ENV_VALUE_UNTRUSTED_EXTERNAL' || requirement?.trustedSourceRequired === true
    );
  });
  const firstIssue = blockingIssues[0];
  const firstMissing = keys.find((key) => params.missing.includes(key));
  const reason = firstIssue ? 'invalid_env' : keys.length > 0 ? 'missing_env' : 'input_required';
  const firstBlocker = firstIssue
    ? `${firstIssue.key}: ${firstIssue.message}`
    : firstMissing
      ? `${firstMissing}: value required`
      : 'Plan needs additional input before execution.';
  const providedTemplate = Object.fromEntries(
    keys.map((key) => [key, `<real ${key} value from user>`]),
  );

  return {
    reason,
    first_blocker: firstBlocker,
    required_action: 'update_deploy_plan',
    ask_user_for: keys.map((key) => {
      const issue = issueByKey.get(key);
      const input = requirementByKey.get(key);
      const requirement = input?.requirement ?? issue?.requirement;
      return {
        key,
        prompt:
          issue?.message ??
          requirement?.message ??
          requirement?.guidance ??
          `Provide the real value for ${key}.`,
        ...(requirement ? { requirement } : {}),
        ...(trustedKeys.includes(key) ? { trusted_confirmation_required: true } : {}),
      };
    }),
    update_payload_template: {
      plan_id: params.planId,
      updates: {
        env: {
          provided: providedTemplate,
          ...(trustedKeys.length > 0 ? { trusted: trustedKeys } : {}),
        },
      },
    },
    after_update: 'execute_deploy_plan',
  };
}

function buildNeedsInputNextSteps(plan: { missing?: string[]; env?: DeployPlan['env'] }): string[] {
  const steps: string[] = [];
  const missing = plan.missing ?? [];
  if (missing.length > 0) {
    steps.push(`Provide missing values: ${missing.join(', ')}`);
  }
  const blockingIssues = (plan.env?.issues ?? []).filter((issue) => issue.severity === 'fail');
  if (blockingIssues.length > 0) {
    steps.push(
      `Fix invalid env values: ${blockingIssues.map((issue) => `${issue.key} (${issue.code})`).join(', ')}`,
    );
  }
  if (blockingIssues.some((issue) => issue.code === 'ENV_VALUE_UNTRUSTED_EXTERNAL')) {
    steps.push(
      'For user-owned external services, ask the user for the real value. If the user has supplied or confirmed it, call update_deploy_plan with updates.env.provided plus updates.env.trusted containing those keys.',
    );
  }
  const hasRequirements = (plan.env?.detected ?? []).some((entry) => entry.requirement);
  if (hasRequirements) {
    steps.push(
      'Use input_requirements[].requirement as value-shape guidance; ask the user for real secrets and reachable endpoints.',
    );
  }
  steps.push('Call update_deploy_plan with corrected values, then call execute_deploy_plan.');
  return steps;
}

function buildPlanNeedsApprovalResponse(params: {
  plan: DeployPlan;
  message: string;
  nextSteps: string[];
  includeServices?: boolean;
  includeWarnings?: boolean;
}): Record<string, unknown> {
  const { plan, message, nextSteps, includeServices = false, includeWarnings = false } = params;
  return {
    plan_id: plan.plan_id,
    status: 'needs_approval',
    ...(includeServices ? { services: plan.services } : {}),
    approval_required: {
      create_resources: safeProposedResourceIds(plan),
    },
    suggested_call: executeDeployPlanSuggestedCall(plan.plan_id, true),
    ...(includeWarnings ? { warnings: plan.warnings } : {}),
    _agent_guidance: {
      message,
      next_steps: nextSteps,
    },
  };
}

function buildExecutePlanNeedsApprovalResponse(result: ExecutePlanResult): Record<string, unknown> {
  return {
    plan_id: result.plan_id,
    status: 'needs_approval',
    approval_required: result.approval_required,
    suggested_call: executeDeployPlanSuggestedCall(result.plan_id, true),
    _agent_guidance: result._agent_guidance,
  };
}

function buildExecutePlanNeedsTargetProjectResponse(
  result: ExecutePlanResult,
): Record<string, unknown> {
  return {
    plan_id: result.plan_id,
    status: 'needs_target_project',
    project_name: result.project_name,
    message: result.message,
    approval_required: result.approval_required,
    _agent_guidance: result._agent_guidance,
  };
}

function buildExecutePlanBuildingResponse(params: {
  result: ExecutePlanResult;
  includeTargetAttachFields?: boolean;
  targetAttachStatus?: 'pending';
  nextSteps?: string[];
}): Record<string, unknown> {
  const {
    result,
    includeTargetAttachFields = false,
    targetAttachStatus,
    nextSteps = ['Poll get_deploy_status to monitor build progress'],
  } = params;
  return {
    plan_id: result.plan_id,
    status: 'building',
    project_name: result.project_name,
    ...(result.project_id ? { project_id: result.project_id } : {}),
    ...(includeTargetAttachFields ? buildTargetAttachFields(result) : {}),
    ...(targetAttachStatus ? { target_attach_status: targetAttachStatus } : {}),
    ...(result.estimated_seconds !== undefined
      ? { estimated_seconds: result.estimated_seconds }
      : {}),
    status_call: deployStatusCall({
      projectId: result.project_id,
      projectName: result.project_name,
    }),
    _agent_guidance: {
      message: 'Deployment started.',
      next_steps: nextSteps,
    },
  };
}

function buildExecutePlanPreBuildFailureResponse(
  result: ExecutePlanResult,
): Record<string, unknown> {
  return {
    plan_id: result.plan_id,
    status: 'failed',
    error: result.error,
    suggested_call: getDeployPlanSuggestedCall(result.plan_id),
    _agent_guidance: {
      message: 'Deployment failed before the build started.',
      next_steps: [
        'Check the error message above — this is a preflight failure (before build started)',
        'Fix the issue, then create_deploy_plan + execute_deploy_plan to retry',
      ],
    },
  };
}

function deployPlanResponse(
  plan: DeployPlan,
  row?: Pick<
    DeployPlanRow,
    'project_id' | 'project_name' | 'status' | 'complexity' | 'commit_sha' | 'error_message'
  >,
): Record<string, unknown> {
  const projectName = plan.app.name || row?.project_name || undefined;
  const projectId = plan.project_id ?? row?.project_id ?? undefined;
  const base = {
    plan_id: plan.plan_id,
    status: plan.status,
    stored_status: row?.status,
    complexity: plan.complexity,
    stored_complexity: row?.complexity,
    project_name: projectName,
    project_id: projectId,
    commit_sha: row?.commit_sha ?? undefined,
    error: row?.error_message ?? undefined,
    app: plan.app,
    build: plan.build,
    services: plan.services,
    env: {
      required: plan.env.required,
      auto: plan.env.auto,
      provided_count: Object.keys(plan.env.provided).length,
      detected: plan.env.detected,
    },
    missing: plan.missing,
    warnings: plan.warnings,
    internal_url: plan.internal_url,
    internal_url_note: plan.internal_url_note,
  };

  if (plan.status === 'needs_input') {
    return {
      ...base,
      ...buildPlanNeedsInputResponse({
        planId: plan.plan_id,
        missing: plan.missing,
        inputRequirements: buildPlanInputRequirements(plan),
        envIssues: (plan as Partial<DeployPlan>).env?.issues,
        message: 'Plan needs input before execution.',
        nextSteps: buildNeedsInputNextSteps(plan),
      }),
    };
  }

  if (plan.status === 'needs_approval') {
    return {
      ...base,
      ...buildPlanNeedsApprovalResponse({
        plan,
        message: 'Plan needs user approval before safe Database/Cache resources are provisioned.',
        nextSteps: [
          'Confirm the proposed Database/Cache resources with the user.',
          'Then call execute_deploy_plan with approve_all_safe_resources=true or approvals.create_resources=[...].',
        ],
      }),
    };
  }

  if (plan.status === 'ready') {
    return {
      ...base,
      suggested_call: executeDeployPlanSuggestedCall(plan.plan_id),
      _agent_guidance: {
        message: 'Plan is ready to execute.',
        next_steps: ['Call execute_deploy_plan to start deployment.'],
      },
    };
  }

  return {
    ...base,
    ...(projectId || projectName
      ? { status_call: deployStatusCall({ projectId, projectName }) }
      : {}),
  };
}

async function resolveCancelProject(
  args: Record<string, unknown>,
  appCtx: AppCtx,
): Promise<
  | { ok: true; project: ProjectRow; deployId?: string; serviceId?: string; resolvedFrom: string }
  | { ok: false; code: string; message: string; attempted_id?: string }
> {
  const projectFromDeployId = async (
    deployId: string,
  ): Promise<{ project?: ProjectRow; deploy?: DeployLogRow }> => {
    const deploy = await appCtx.db.getDeployLog(deployId);
    if (!deploy) return {};
    const service = await appCtx.db.getService(deploy.service_id);
    const projectId = service?.project_id ?? deployableServiceIdToProjectId(deploy.service_id);
    const project = await appCtx.db.getProject(projectId);
    return project ? { project, deploy } : { deploy };
  };

  const deployId = args['deploy_id'];
  if (typeof deployId === 'string' && deployId.length > 0) {
    const resolved = await projectFromDeployId(deployId);
    if (resolved.project) {
      return { ok: true, project: resolved.project, deployId, resolvedFrom: 'deploy_id' };
    }
    return {
      ok: false,
      code: 'DEPLOY_NOT_FOUND',
      message: `No deploy log was found for deploy_id "${deployId}".`,
      attempted_id: deployId,
    };
  }

  const serviceId = args['service_id'];
  const serviceName = args['service_name'];
  if (
    (typeof serviceId === 'string' && serviceId.length > 0) ||
    (typeof serviceName === 'string' && serviceName.length > 0)
  ) {
    const resolved = await resolveDeployableTarget(appCtx, args, 'cancel_deploy');
    return {
      ok: true,
      project: resolved.runtimeProject,
      serviceId: resolved.service.id,
      resolvedFrom: serviceId ? 'service_id' : 'service_name',
    };
  }

  const projectId = args['project_id'];
  if (typeof projectId === 'string' && projectId.length > 0) {
    const project = await appCtx.db.getProject(projectId);
    if (project) return { ok: true, project, resolvedFrom: 'project_id' };
    return {
      ok: false,
      code: 'PROJECT_NOT_FOUND',
      message: `No project was found for project_id "${projectId}".`,
      attempted_id: projectId,
    };
  }

  const projectName = args['project_name'];
  if (typeof projectName === 'string' && projectName.length > 0) {
    const project = await appCtx.db.getProjectByName(projectName);
    if (project) return { ok: true, project, resolvedFrom: 'project_name' };
    return {
      ok: false,
      code: 'PROJECT_NOT_FOUND',
      message: `No project was found for project_name "${projectName}".`,
      attempted_id: projectName,
    };
  }

  const id = args['id'];
  if (typeof id === 'string' && id.length > 0) {
    const byDeploy = await projectFromDeployId(id);
    if (byDeploy.project) {
      return { ok: true, project: byDeploy.project, deployId: id, resolvedFrom: 'id:deploy_id' };
    }
    const service = await appCtx.db.getService(id);
    if (service && !isManagedService(service.kind)) {
      const byService = await resolveDeployableTarget(appCtx, { service_id: id }, 'cancel_deploy');
      return {
        ok: true,
        project: byService.runtimeProject,
        serviceId: byService.service.id,
        resolvedFrom: 'id:service_id',
      };
    }
    const byProjectId = await appCtx.db.getProject(id);
    if (byProjectId) return { ok: true, project: byProjectId, resolvedFrom: 'id:project_id' };
    const byProjectName = await appCtx.db.getProjectByName(id);
    if (byProjectName) return { ok: true, project: byProjectName, resolvedFrom: 'id:project_name' };
    return {
      ok: false,
      code: 'TARGET_NOT_FOUND',
      message: `No deploy log, project id, or project name matched id "${id}".`,
      attempted_id: id,
    };
  }

  return {
    ok: false,
    code: 'INVALID_ARGS',
    message:
      'One of deploy_id, service_id, service_name, project_id, project_name, or id is required.',
  };
}

function isManagedService(kind: string): boolean {
  return (MANAGED_SERVICE_KINDS as readonly string[]).includes(kind);
}

async function buildExistingServiceGuidance(
  projectName: string | undefined,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  if (!projectName) return {};
  const project =
    (await context.appCtx.db.getProjectByName(projectName)) ??
    (await context.appCtx.db.getProject(projectName));
  if (!project) return {};

  const services =
    typeof context.appCtx.db.getDeployablesByGroup === 'function'
      ? await context.appCtx.db.getDeployablesByGroup(project.id)
      : typeof context.appCtx.db.listServices === 'function'
        ? (await context.appCtx.db.listServices()).filter(
            (service) => service.project_id === project.id,
          )
        : [];
  const deployables = services.filter((service) => !isManagedService(service.kind));
  if (deployables.length === 0) return {};

  const candidates = deployables.map((service: ServiceRow) => ({
    service_id: service.id,
    service_name: service.name,
    project_id: project.id,
    project_name: project.name,
    kind: service.kind,
    source: service.source,
    status: service.status,
  }));
  const primary = candidates[0];

  return {
    existing_service: primary,
    candidate_services: candidates,
    suggested_call: primary
      ? {
          tool: 'openlander_service',
          action: 'update_app',
          params: { service_id: primary.service_id },
        }
      : undefined,
  };
}

const EXISTING_SERVICE_SOURCE_OVERRIDE_PARAMS = [
  'repo_url',
  'branch',
  'source',
  'image',
  'port',
  'prefer_dockerfile',
  'dockerfile_path',
  'docker_target',
  'git_credential_id',
] as const;

const EXISTING_SERVICE_SOURCE_UPDATE_PARAMS = [
  'repo_url',
  'branch',
  'source',
  'image',
  'port',
  'git_credential_id',
];
const EXISTING_SERVICE_BUILD_CONFIG_PARAMS = ['dockerfile_path', 'docker_target'];

const EXISTING_SERVICE_REDEPLOY_ALLOWED_PARAMS = [
  'service_id',
  'service_name',
  'project_name',
  'name',
  'env_vars',
  'no_cache',
  'strategy',
  'health_check_path',
  'cmd',
] as const;

function existingServiceSourceOverrideParams(args: Record<string, unknown>): string[] {
  return EXISTING_SERVICE_SOURCE_OVERRIDE_PARAMS.filter((name) => args[name] !== undefined);
}

function existingServiceSourceUpdateParams(args: Record<string, unknown>): string[] {
  return EXISTING_SERVICE_SOURCE_UPDATE_PARAMS.filter((name) => args[name] !== undefined);
}

function buildExistingServiceSourceUpdateParams(
  args: Record<string, unknown>,
  targetParams: Record<string, unknown>,
): Record<string, unknown> {
  const sourceUpdateParams: Record<string, unknown> = {
    ...(typeof targetParams['service_id'] === 'string'
      ? { service_id: targetParams['service_id'] }
      : {}),
    ...(typeof targetParams['service_name'] === 'string'
      ? { service_name: targetParams['service_name'] }
      : {}),
    ...(typeof targetParams['project_name'] === 'string'
      ? { project_name: targetParams['project_name'] }
      : {}),
  };
  for (const name of EXISTING_SERVICE_SOURCE_UPDATE_PARAMS) {
    const value = args[name];
    if (value !== undefined) {
      sourceUpdateParams[name === 'port' ? 'container_port' : name] = value;
    }
  }
  return sourceUpdateParams;
}

function buildExistingServiceSourceOverrideResponse(params: {
  invalidParams: string[];
  originalArgs: Record<string, unknown>;
  frontDoorTarget:
    | {
        kind: 'service_target';
        params: Record<string, unknown>;
      }
    | {
        kind: 'existing_project';
        params: Record<string, unknown>;
        existingService: Record<string, unknown>;
      };
}): Record<string, unknown> {
  const serviceId =
    typeof params.frontDoorTarget.params['service_id'] === 'string'
      ? params.frontDoorTarget.params['service_id']
      : undefined;
  const hasSourceUpdate = params.invalidParams.some((name) =>
    EXISTING_SERVICE_SOURCE_UPDATE_PARAMS.includes(name),
  );
  const hasBuildConfig = params.invalidParams.some((name) =>
    EXISTING_SERVICE_BUILD_CONFIG_PARAMS.includes(name),
  );
  const sourceUpdateParams: Record<string, unknown> = serviceId ? { service_id: serviceId } : {};
  for (const name of EXISTING_SERVICE_SOURCE_UPDATE_PARAMS) {
    const value = params.originalArgs[name];
    if (value !== undefined) {
      sourceUpdateParams[name === 'port' ? 'container_port' : name] = value;
    }
  }
  const buildConfigParams: Record<string, unknown> = serviceId ? { service_id: serviceId } : {};
  for (const name of EXISTING_SERVICE_BUILD_CONFIG_PARAMS) {
    const value = params.originalArgs[name];
    if (value !== undefined) {
      buildConfigParams[name] = value;
    }
  }

  return {
    error: 'EXISTING_SERVICE_SOURCE_OVERRIDE_UNSUPPORTED',
    code: 'EXISTING_SERVICE_SOURCE_OVERRIDE_UNSUPPORTED',
    action: 'deploy_app',
    invalid_params: params.invalidParams,
    allowed_params: [...EXISTING_SERVICE_REDEPLOY_ALLOWED_PARAMS],
    ...(params.frontDoorTarget.kind === 'existing_project'
      ? { existing_service: params.frontDoorTarget.existingService }
      : {}),
    ...(serviceId
      ? {
          ...(hasSourceUpdate && hasBuildConfig
            ? {}
            : {
                suggested_call: {
                  tool: 'openlander_service',
                  action: hasSourceUpdate ? 'update_application_source' : 'update_service_config',
                  params: hasSourceUpdate ? sourceUpdateParams : buildConfigParams,
                },
              }),
        }
      : {}),
    _agent_guidance: {
      message:
        'deploy_app resolved an existing Application/Compose service, but the request included source/build override params that this existing-service path does not apply. OpenLander did not start an update.',
      next_steps: [
        'To ship the latest stored source revision, retry deploy_app for the existing target without source/build override params, or call openlander_service.update_app.',
        'To change branch, repo_url, source, image, or saved container_port, call openlander_service.update_application_source, then call update_app.',
        'To change Dockerfile/build config, call openlander_service.update_service_config, then call update_app.',
      ],
    },
  };
}

async function resolveExistingDeployAppTarget(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<
  | {
      kind: 'service_target';
      params: Record<string, unknown>;
    }
  | {
      kind: 'existing_project';
      params: Record<string, unknown>;
      existingService: Record<string, unknown>;
    }
  | {
      kind: 'needs_selection';
      response: Record<string, unknown>;
    }
  | undefined
> {
  const serviceId = typeof args['service_id'] === 'string' ? args['service_id'].trim() : '';
  const serviceName = typeof args['service_name'] === 'string' ? args['service_name'].trim() : '';
  const projectName =
    typeof args['project_name'] === 'string'
      ? args['project_name'].trim()
      : typeof args['name'] === 'string'
        ? args['name'].trim()
        : '';

  if (serviceId || serviceName) {
    return {
      kind: 'service_target',
      params: {
        ...args,
        ...(serviceId ? { service_id: serviceId } : {}),
        ...(serviceName ? { service_name: serviceName } : {}),
        ...(projectName ? { project_name: projectName } : {}),
      },
    };
  }

  if (!projectName || args['target_project_id']) {
    return undefined;
  }

  const project =
    (await context.appCtx.db.getProjectByName(projectName)) ??
    (await context.appCtx.db.getProject(projectName));
  if (!project) {
    return undefined;
  }

  const services =
    typeof context.appCtx.db.getDeployablesByGroup === 'function'
      ? await context.appCtx.db.getDeployablesByGroup(project.id)
      : typeof context.appCtx.db.listServices === 'function'
        ? (await context.appCtx.db.listServices()).filter(
            (service) => service.project_id === project.id,
          )
        : [];
  const deployables = services.filter((service) => !isManagedService(service.kind));
  const candidates = deployables.map((service: ServiceRow) => ({
    service_id: service.id,
    service_name: service.name,
    project_id: project.id,
    project_name: project.name,
    kind: service.kind,
    source: service.source,
    status: service.status,
  }));

  if (candidates.length === 1) {
    const existingService = candidates[0];
    if (!existingService) {
      return undefined;
    }
    return {
      kind: 'existing_project',
      existingService,
      params: {
        service_id: existingService.service_id,
        no_cache: args['no_cache'],
        strategy: args['strategy'],
        health_check_path: args['health_check_path'],
        cmd: args['cmd'],
      },
    };
  }

  if (candidates.length > 1) {
    return {
      kind: 'needs_selection',
      response: {
        status: 'needs_selection',
        code: 'SERVICE_SELECTION_REQUIRED',
        project: { id: project.id, name: project.name },
        candidate_services: candidates,
        _agent_guidance: {
          message:
            'This Project already has multiple Applications/Compose workloads. Pick the intended service_id and call deploy_app or openlander_service.update_app with that service_id.',
          next_steps: [
            'Choose one candidate_services[].service_id.',
            'Call openlander_deploy.deploy_app with service_id for a front-door update, or openlander_service.update_app with service_id.',
          ],
        },
      },
    };
  }

  return undefined;
}

export const deployPlanToolDefs: ToolDef[] = [
  {
    name: 'create_deploy_plan',
    riskLevel: 'medium',
    description:
      'Analyze a repository/image and create a deployment plan for a new Application/Compose workload. Use name for the Project name. Returns detected resources, required env vars, and build config. Use update_deploy_plan to fill missing values before executing.',
    mcpDescription:
      'Create a deployment plan for a new Application/Compose workload. New app names use name, not project_name. Returns plan_id, status, detected resources, missing vars, warnings.',
    inputSchema: createDeployPlanSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const envVars = parseEnvVarsInput(args['env_vars']) ?? {};

      const plan: DeployPlan = await appCtx.planEngine.createPlan({
        repoUrl: (args['repo_url'] as string | undefined) ?? undefined,
        branch: (args['branch'] as string | undefined) ?? undefined,
        gitCredentialId: (args['git_credential_id'] as string | undefined) ?? undefined,
        name: (args['name'] as string | undefined) ?? undefined,
        source: (args['source'] as 'git' | 'image' | undefined) ?? undefined,
        imageUrl: (args['image'] as string | undefined) ?? undefined,
        imageCmd: (args['cmd'] as string[] | undefined) ?? undefined,
        containerPort: (args['port'] as number | undefined) ?? undefined,
        healthCheckPath: (args['health_check_path'] as string | undefined) ?? undefined,
        envVars,
        preferDockerfile: (args['prefer_dockerfile'] as boolean | undefined) ?? undefined,
        dockerfilePath: (args['dockerfile_path'] as string | undefined) ?? undefined,
        dockerTarget: (args['docker_target'] as string | undefined) ?? undefined,
        trafficService: (args['traffic_service'] as string | undefined) ?? undefined,
        composeFile: (args['compose_file'] as string | undefined) ?? undefined,
        composeProfiles: (args['compose_profiles'] as string[] | undefined) ?? undefined,
        environment: (args['environment'] as 'production' | 'development' | undefined) ?? undefined,
        targetProjectId: (args['target_project_id'] as string | undefined) ?? undefined,
        trigger: deployTriggerForToolContext(context),
      });
      return deployPlanResponse(plan);
    },
  },
  {
    name: 'get_deploy_plan',
    riskLevel: 'low',
    description:
      'Retrieve a deployment plan by plan_id. Use after create_deploy_plan or update_deploy_plan to inspect status, missing inputs, approval requirements, build config, detected services, warnings, and the next suggested call.',
    mcpDescription:
      'Get deploy plan details by plan_id. Returns the same compact plan shape as create/update, plus suggested_call for the next step.',
    inputSchema: getDeployPlanSchema,
    execute: async (args, context) => {
      const planId = args['plan_id'] as string;
      const row = await context.appCtx.db.getDeployPlan(planId);
      if (!row) {
        return {
          status: 'not_found',
          error: 'DEPLOY_PLAN_NOT_FOUND',
          code: 'DEPLOY_PLAN_NOT_FOUND',
          plan_id: planId,
          suggested_call: {
            tool: 'openlander_deploy',
            action: 'create_deploy_plan',
            params: { repo_url: '<repo_url>' },
          },
          _agent_guidance: {
            message: 'No deploy plan exists for that plan_id.',
            next_steps: [
              'Verify the plan_id from create_deploy_plan.',
              'If you do not have one, call create_deploy_plan first.',
            ],
          },
        };
      }

      const plan = JSON.parse(row.plan_json) as DeployPlan;
      return deployPlanResponse(plan, row);
    },
  },
  {
    name: 'update_deploy_plan',
    riskLevel: 'medium',
    description:
      'Update a deployment plan with missing values (env vars, Dockerfile selection, service config). Call after create_deploy_plan when status is "needs_input". Returns the full updated plan with plan_id, status, complexity, app, build, services, env, missing, warnings.',
    mcpDescription:
      'Update a deployment plan with missing values. Pass updates as a JSON string with fields like env (environment variables), dockerfile (Dockerfile path), or services (service configuration). For user-owned external env that the user supplied or confirmed, use env:{provided:{KEY:"..."},trusted:["KEY"]}. Returns the full updated plan with plan_id, status, complexity, app, build, services, env, missing, warnings.',
    inputSchema: updateDeployPlanSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const planId = args['plan_id'] as string;
      const updatesRaw = args['updates'] as string;
      const updates = JSON.parse(updatesRaw) as PlanUpdates;

      const plan: DeployPlan = await appCtx.planEngine.updatePlan(planId, updates);

      return deployPlanResponse(plan);
    },
  },
  {
    name: 'execute_deploy_plan',
    riskLevel: 'medium',
    description:
      'Execute a deployment plan. A plan in "needs_approval" status lists proposed Project-scoped Database/Cache resources in services[] (resolution="proposed_project_service"); pass approve_all_safe_resources=true or approvals.create_resources=[...] to approve and OpenLander provisions the approved safe resources, wires their connection env (e.g. DATABASE_URL), and deploys. This auto-wiring is for the deploy-plan approval flow only; standalone compatibility action create_service returns suggested_env and still requires set_env_vars. Unapproved, Compose-declared, or not_auto_creatable resources are never created — supply their env or create them first. Plans already in "ready" status execute directly.',
    mcpDescription:
      'Execute a deployment plan asynchronously. Returns immediately with project_id and status. Use get_deploy_status to poll progress. A "needs_approval" plan lists proposed Database/Cache resources in services[]; pass approve_all_safe_resources=true or approvals.create_resources=[...] and OpenLander provisions the approved safe resources, wires their connection env, and deploys. This auto-wiring is deploy-plan-only; standalone create_service returns suggested_env and still requires set_env_vars. Unapproved/Compose-declared/not_auto_creatable resources are not created. "ready" plans execute directly; injects env vars and starts deployment.',
    inputSchema: executeDeployPlanSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const planId = args['plan_id'] as string;
      const toolSessionId = `mcp-execute-plan-${nanoid(12)}`;

      const deployOnly = (args['deploy_only'] as string[] | undefined) ?? undefined;
      const approveAllSafeResources = args['approve_all_safe_resources'] as boolean | undefined;
      const approvalsArg = args['approvals'] as { create_resources?: string[] } | undefined;
      const approval = {
        ...(approveAllSafeResources !== undefined ? { approveAllSafeResources } : {}),
        ...(approvalsArg?.create_resources
          ? { createResources: approvalsArg.create_resources }
          : {}),
      };
      let acquiredLockProjectId: string | null = null;
      const planRow =
        typeof appCtx.db.getDeployPlan === 'function'
          ? await appCtx.db.getDeployPlan(planId)
          : undefined;
      if (planRow) {
        const planData = JSON.parse(planRow.plan_json) as DeployPlan;
        const lockProjectId =
          planData.project_id ?? (await appCtx.db.getProjectByName(planData.app.name))?.id ?? null;
        if (lockProjectId) {
          const lockResult = await tryAcquireDeployLockOrResponse(
            lockProjectId,
            toolSessionId,
            context,
          );
          if (lockResult) {
            return lockResult;
          }
          acquiredLockProjectId = lockProjectId;
        }
        if (planData.project_id) {
          markMcpDeploy(planData.project_id);
        }
      }
      let result: ExecutePlanResult;
      try {
        result = await appCtx.planEngine.executePlan(
          planId,
          deployOnly,
          toolSessionId,
          deployTriggerForToolContext(context),
          approval,
        );
      } catch (err) {
        if (err instanceof DeployLockedError) {
          return buildDeployLockedResponse(err);
        }
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('missing environment variables') || msg.includes('environment input')) {
          const planData = planRow ? (JSON.parse(planRow.plan_json) as DeployPlan) : undefined;
          return buildPlanNeedsInputResponse({
            planId,
            error: msg,
            missing: planData?.missing ?? [],
            inputRequirements: planData ? buildPlanInputRequirements(planData) : [],
            envIssues: planData?.env.issues,
            message: 'The plan still needs environment input before execution.',
            nextSteps: planData
              ? buildNeedsInputNextSteps(planData)
              : [
                  'Call update_deploy_plan with the missing or corrected env vars.',
                  'Then call execute_deploy_plan again.',
                ],
          });
        }
        throw err;
      }

      if (result.status === 'needs_approval') {
        // Engine started nothing. Release the pre-acquired lock so the agent
        // can re-run with approvals.
        if (acquiredLockProjectId) {
          await appCtx.db.releaseDeployLock(acquiredLockProjectId, toolSessionId);
        }
        return buildExecutePlanNeedsApprovalResponse(result);
      }

      if (result.status === 'needs_target_project') {
        // New-app guard: the engine created nothing because an approved managed
        // service has no existing target project to provision on. Release the
        // pre-acquired lock (none was created by the engine).
        if (acquiredLockProjectId) {
          await appCtx.db.releaseDeployLock(acquiredLockProjectId, toolSessionId);
        }
        return buildExecutePlanNeedsTargetProjectResponse(result);
      }

      if (result.project_id) {
        markMcpDeploy(result.project_id);
      }

      if (result.status === 'building') {
        return buildExecutePlanBuildingResponse({
          result,
          includeTargetAttachFields: true,
          ...(result.target_project_id ? { targetAttachStatus: 'pending' } : {}),
        });
      } else {
        return buildExecutePlanPreBuildFailureResponse(result);
      }
    },
  },
  {
    name: 'cancel_deploy',
    riskLevel: 'medium',
    description:
      'Cancel an active deployment build by deploy_id, service_id, service_name, project_id, project_name, or id. Stops the active Docker build stream for the resolved runtime project if one is running and returns a status_call for follow-up.',
    mcpDescription:
      'Cancel an active deployment. Prefer service_id/service_name when available; deploy_id and legacy Project targets remain supported. Returns cancelled=true only when an active stream was stopped.',
    inputSchema: cancelDeploySchema,
    execute: async (args, context) => {
      const resolved = await resolveCancelProject(args, context.appCtx);
      if (!resolved.ok) {
        return {
          status: 'not_found',
          error: resolved.code,
          code: resolved.code,
          message: resolved.message,
          ...(resolved.attempted_id ? { attempted_id: resolved.attempted_id } : {}),
          suggested_call: {
            tool: 'openlander_project',
            action: 'list_projects',
            params: {},
          },
          _agent_guidance: {
            message: 'Cancel target could not be resolved.',
            next_steps: [
              'Use list_projects to verify project names and IDs.',
              'Use get_deploy_status to check active deployments.',
            ],
          },
        };
      }

      const cancelled = context.appCtx.docker.cancelBuild(resolved.project.id);
      return {
        status: cancelled ? 'cancelled' : 'not_active',
        cancelled,
        project_id: resolved.project.id,
        project_name: resolved.project.name,
        ...(resolved.deployId ? { deploy_id: resolved.deployId } : {}),
        ...(resolved.serviceId ? { service_id: resolved.serviceId } : {}),
        resolved_from: resolved.resolvedFrom,
        status_call: resolved.serviceId
          ? {
              tool: 'openlander_deploy',
              action: 'get_deploy_status',
              params: {
                service_id: resolved.serviceId,
                ...(resolved.deployId ? { deploy_id: resolved.deployId } : {}),
              },
            }
          : deployStatusCall({
              projectId: resolved.project.id,
              projectName: resolved.project.name,
              deployId: resolved.deployId,
            }),
        _agent_guidance: {
          message: cancelled
            ? 'Active deployment cancellation was requested.'
            : 'No active build stream was found for that project.',
          next_steps: ['Call get_deploy_status to confirm the final deployment state.'],
        },
      };
    },
  },
  {
    name: 'deploy_app',
    riskLevel: 'medium',
    description:
      'One-call app deploy front door. If service_id/service_name is provided, or name matches an existing Project with exactly one Application/Compose workload, this redeploys that workload. Otherwise it creates a new app from repo_url or image. Combines create_deploy_plan + execute_deploy_plan + get_deploy_status for new apps. When a new-app plan proposes safe Project-scoped Database/Cache resources, approve them with execute_deploy_plan; OpenLander owns target Project creation, same-project provisioning, and env wiring. target_project_id attaches a newly deployed single Application/worker to an existing Project after successful deploy. expose=true is not supported with target_project_id. Returns final deployment result with URL when done, including internal_host, docker_host, elapsed, and readiness; status "unhealthy" means the container runs but Docker HEALTHCHECK is failing. On failure, returns auto_diagnosis/build_log_tail; timeout may be returned when wait times out. If the plan needs missing env vars, returns status "needs_input" with the missing list; if it proposes Project-scoped Database/Cache resources, returns status "needs_approval" with approval_required (approve via execute_deploy_plan using approve_all_safe_resources / approvals.create_resources).',
    mcpDescription:
      'App deploy front door. New app: pass repo_url/image and use name for the Project name. Existing app: prefer service_id, or use service_name/project_name/name lookup. For approved safe Database/Cache proposals, keep the deploy-plan path; OpenLander provisions them on the same Project/network as the app. To add one new Application/worker into an existing Project, pass target_project_id without expose=true. Poll get_deploy_status; diagnose failures with diagnose_service.',
    inputSchema: deploySchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const toolSessionId = `mcp-deploy-${nanoid(12)}`;
      const envVars = parseEnvVarsInput(args['env_vars']) ?? {};
      const wait = (args['wait'] as boolean | undefined) ?? true;
      const waitHealthy = (args['wait_healthy'] as boolean | undefined) ?? true;
      const timeoutSec = (args['timeout'] as number | undefined) ?? 300;
      const expose = (args['expose'] as boolean | undefined) ?? false;
      const targetProjectId = (args['target_project_id'] as string | undefined) ?? undefined;
      const source = (args['source'] as 'git' | 'image' | undefined) ?? undefined;
      const image = (args['image'] as string | undefined) ?? undefined;
      const repoUrl = (args['repo_url'] as string | undefined) ?? undefined;
      const newAppName = (args['name'] as string | undefined) ?? undefined;
      const scopedProjectName = (args['project_name'] as string | undefined) ?? undefined;
      const projectName = newAppName ?? scopedProjectName ?? undefined;

      if (targetProjectId && expose) {
        return {
          status: 'blocked',
          error: 'TARGET_PROJECT_EXPOSE_UNSUPPORTED',
          code: 'TARGET_PROJECT_EXPOSE_UNSUPPORTED',
          action: 'deploy_app',
          invalid_params: ['target_project_id', 'expose'],
          message:
            'deploy_app target_project_id with expose=true is temporarily disabled until tunnel creation is moved after durable target attach.',
          _agent_guidance: {
            message:
              'OpenLander did not create a temp project. Retry without expose=true, then expose the service after the target attach completes.',
            next_steps: [
              'Retry deploy_app with target_project_id and expose=false or omitted.',
              'After deployment succeeds, use expose_public with project_name if a temporary public URL is still needed.',
            ],
          },
        };
      }

      const frontDoorTarget = await resolveExistingDeployAppTarget(args, context);
      if (frontDoorTarget?.kind === 'needs_selection') {
        return frontDoorTarget.response;
      }
      if (
        frontDoorTarget?.kind === 'service_target' ||
        frontDoorTarget?.kind === 'existing_project'
      ) {
        const invalidParams = existingServiceSourceOverrideParams(args);
        let sourceUpdatePayload: Record<string, unknown> | undefined;
        if (invalidParams.length > 0) {
          const buildConfigParams = invalidParams.filter(
            (name) => !EXISTING_SERVICE_SOURCE_UPDATE_PARAMS.includes(name),
          );
          // Only auto-save source settings when the caller explicitly targeted an
          // existing service (service_id/service_name). When the service was matched
          // by bare project name, deploy_app may have been a new-app intent that
          // collided with an existing single-workload Project — reject and steer to
          // update_application_source rather than silently repointing its source.
          if (buildConfigParams.length > 0 || frontDoorTarget.kind === 'existing_project') {
            return buildExistingServiceSourceOverrideResponse({
              invalidParams,
              originalArgs: args,
              frontDoorTarget,
            });
          }

          const sourceUpdateResult = await runUpdateApplicationSourceAction(
            buildExistingServiceSourceUpdateParams(args, frontDoorTarget.params),
            context,
          );
          sourceUpdatePayload = sourceUpdateResult;
          const changedFields = Array.isArray(sourceUpdatePayload['changed_fields'])
            ? (sourceUpdatePayload['changed_fields'] as unknown[])
            : [];
          log.info(
            {
              serviceId: frontDoorTarget.params['service_id'],
              sourceFields: existingServiceSourceUpdateParams(args),
              changedFields,
            },
            'deploy_app saved existing-service source override before update',
          );
        }

        const redeployParams =
          Object.keys(envVars).length > 0
            ? { ...frontDoorTarget.params, env_vars: envVars }
            : frontDoorTarget.params;
        const redeployResult = await runDeployableServiceAction(
          redeployParams,
          context,
          'update_app',
        );
        const redeployPayload = redeployResult as Record<string, unknown>;
        const redeployGuidance =
          typeof redeployPayload['_agent_guidance'] === 'object' &&
          redeployPayload['_agent_guidance'] !== null &&
          !Array.isArray(redeployPayload['_agent_guidance'])
            ? (redeployPayload['_agent_guidance'] as Record<string, unknown>)
            : {};
        const redeployStarted = redeployPayload['status'] === 'deploying';
        const existingProjectMessage =
          frontDoorTarget.kind === 'existing_project'
            ? redeployStarted
              ? 'This Project already has one Application/Compose workload. OpenLander started an update of the existing workload; do not create a new app. Poll status_call until terminal.'
              : typeof redeployGuidance['message'] === 'string'
                ? redeployGuidance['message']
                : 'This Project already has one Application/Compose workload, but OpenLander did not start an update.'
            : redeployStarted
              ? 'OpenLander started an update of the existing Application/Compose workload. Poll status_call until terminal.'
              : typeof redeployGuidance['message'] === 'string'
                ? redeployGuidance['message']
                : 'OpenLander did not start an update of the existing Application/Compose workload.';
        const redeployNextSteps = Array.isArray(redeployGuidance['next_steps'])
          ? redeployGuidance['next_steps'].filter(
              (step): step is string => typeof step === 'string',
            )
          : [];
        const guidanceMessage =
          invalidParams.length > 0
            ? redeployStarted
              ? 'OpenLander saved the requested source settings for this existing Application/Compose workload, then started update_app. Poll status_call until terminal.'
              : `OpenLander saved the requested source settings for this existing Application/Compose workload, but update_app did not start. ${
                  typeof redeployGuidance['message'] === 'string'
                    ? redeployGuidance['message']
                    : 'Follow the returned guidance before retrying update_app.'
                }`
            : existingProjectMessage;
        return {
          ...redeployPayload,
          delegated_action: 'update_app',
          mode:
            frontDoorTarget.kind === 'service_target'
              ? 'redeploy_service_target'
              : 'redeploy_existing_project',
          ...(frontDoorTarget.kind === 'existing_project'
            ? { existing_service: frontDoorTarget.existingService }
            : {}),
          ...(invalidParams.length > 0
            ? {
                source_update: {
                  status: sourceUpdatePayload?.['status'] ?? 'updated',
                  changed_fields: Array.isArray(sourceUpdatePayload?.['changed_fields'])
                    ? sourceUpdatePayload['changed_fields']
                    : [],
                },
              }
            : {}),
          _agent_guidance: {
            ...redeployGuidance,
            message: guidanceMessage,
            next_steps: [
              ...redeployNextSteps,
              ...(frontDoorTarget.kind === 'existing_project'
                ? [
                    'Do not create a new app for this Project unless the user explicitly asks for another Application/Compose workload.',
                  ]
                : []),
            ],
          },
        };
      }

      if ((repoUrl || image) && scopedProjectName && !newAppName) {
        return {
          error: 'INVALID_PARAMS',
          action: 'deploy_app',
          details:
            'project_name scopes existing app lookups only. For new app deploys, use name as the Project name.',
          invalid_params: ['project_name'],
          allowed_params: [
            'name',
            'repo_url',
            'image',
            'source',
            'branch',
            'port',
            'env_vars',
            'cmd',
            'wait',
            'wait_healthy',
            'timeout',
          ],
          required_params: [],
          _agent_guidance: {
            message:
              'For a new app deploy, pass params.name. Keep params.project_name only for existing project lookup/scoping.',
            next_steps: [
              'Retry deploy_app with name set to the desired new Project name.',
              'If you intended to redeploy an existing app, omit repo_url/image or pass service_id.',
            ],
          },
        };
      }

      if (!repoUrl && !image) {
        return {
          status: 'needs_input',
          missing: source === 'image' ? ['image'] : ['repo_url'],
          project_name: projectName,
          _agent_guidance: {
            message: projectName
              ? 'No existing Application/Compose workload matched this name, and no repo_url/image was provided for a new app.'
              : 'deploy_app needs repo_url/image for a new app, or service_id/service_name/name for an existing app.',
            next_steps: [
              'For a new app, call deploy_app with repo_url or source="image" plus image.',
              'For an existing app, call deploy_app with service_id, service_name, or the Project name.',
            ],
          },
        };
      }

      const plan: DeployPlan = await appCtx.planEngine.createPlan({
        repoUrl: (args['repo_url'] as string | undefined) ?? undefined,
        branch: (args['branch'] as string | undefined) ?? undefined,
        gitCredentialId: (args['git_credential_id'] as string | undefined) ?? undefined,
        name: newAppName,
        source,
        imageUrl: image,
        imageCmd: (args['cmd'] as string[] | undefined) ?? undefined,
        containerPort: (args['port'] as number | undefined) ?? undefined,
        healthCheckPath: (args['health_check_path'] as string | undefined) ?? undefined,
        envVars,
        preferDockerfile: (args['prefer_dockerfile'] as boolean | undefined) ?? undefined,
        dockerfilePath: (args['dockerfile_path'] as string | undefined) ?? undefined,
        dockerTarget: (args['docker_target'] as string | undefined) ?? undefined,
        trafficService: (args['traffic_service'] as string | undefined) ?? undefined,
        composeFile: (args['compose_file'] as string | undefined) ?? undefined,
        composeProfiles: (args['compose_profiles'] as string[] | undefined) ?? undefined,
        environment: (args['environment'] as 'production' | 'development' | undefined) ?? undefined,
        targetProjectId,
        trigger: deployTriggerForToolContext(context),
      });
      const planBuild = (plan as Partial<DeployPlan>).build;

      if (plan.status === 'needs_input') {
        const nextSteps = buildNeedsInputNextSteps(plan);
        if (
          !((plan as Partial<DeployPlan>).env?.issues ?? []).some(
            (issue) => issue.code === 'ENV_VALUE_UNTRUSTED_EXTERNAL',
          )
        ) {
          nextSteps.push(
            'Or call deploy_app again with env_vars including the missing/corrected keys',
          );
        }
        return buildPlanNeedsInputResponse({
          planId: plan.plan_id,
          missing: plan.missing,
          inputRequirements: buildPlanInputRequirements(plan),
          envIssues: (plan as Partial<DeployPlan>).env?.issues,
          warnings: plan.warnings,
          message: 'The generated deploy plan needs more input before execution.',
          nextSteps,
        });
      }

      if (plan.status === 'needs_approval') {
        // Surface the approval contract so the agent routes through
        // execute_deploy_plan with approvals. Do NOT proceed to lock or execute —
        // unapproved provisioning creates nothing and the caller must confirm.
        return buildPlanNeedsApprovalResponse({
          plan,
          includeServices: true,
          includeWarnings: true,
          message: 'The generated deploy plan needs user approval before execution.',
          nextSteps: [
            'This plan proposes Project-scoped Database/Cache resources (see services[] with resolution="proposed_project_service"). Confirm with the user before proceeding.',
            'Then call execute_deploy_plan with the plan_id and approve_all_safe_resources=true, or approvals.create_resources=[<identifiers>] to approve individually.',
            'This auto-provision + env wiring path applies to deploy-plan approval; standalone create_service still returns suggested_env for set_env_vars.',
            ...(targetProjectId
              ? [
                  'Because target_project_id is set, approved Database/Cache resources are provisioned on that existing Project.',
                ]
              : [
                  'For a NEW app, keep using this deploy plan: execute_deploy_plan will create/own the target Project and provision approved Database/Cache resources on the same Project network before app start. If the user already has a real external connection URL, pass it in env_vars instead of creating an OpenLander resource.',
                ]),
          ],
        });
      }

      if (plan.project_id) {
        markMcpDeploy(plan.project_id);
      }
      const lockProjectId =
        plan.project_id ?? (await appCtx.db.getProjectByName(plan.app.name))?.id ?? null;
      if (lockProjectId) {
        const lockResult = await tryAcquireDeployLockOrResponse(
          lockProjectId,
          toolSessionId,
          context,
        );
        if (lockResult) {
          return lockResult;
        }
      }

      let result: ExecutePlanResult;
      try {
        result = await appCtx.planEngine.executePlan(
          plan.plan_id,
          undefined,
          toolSessionId,
          deployTriggerForToolContext(context),
        );
      } catch (err) {
        if (err instanceof DeployLockedError) {
          return buildDeployLockedResponse(err);
        }
        throw err;
      }

      if (result.project_id) {
        markMcpDeploy(result.project_id);
      }

      if (result.status === 'failed') {
        const existingGuidance = await buildExistingServiceGuidance(result.project_name, context);
        return {
          plan_id: plan.plan_id,
          status: 'failed',
          project_name: result.project_name,
          error: result.error,
          ...buildTargetAttachFields(result),
          ...existingGuidance,
          ...(result.project_id || result.project_name
            ? {
                status_call: deployStatusCall({
                  projectId: result.project_id,
                  projectName: result.project_name,
                }),
              }
            : {}),
          diagnostic_call: {
            tool: 'openlander_monitor',
            action: 'diagnose_service',
            params: result.service_id
              ? { service_id: result.service_id }
              : result.project_id
                ? {
                    service_id: targetIdentityResolver.deployableServiceIdForRuntimeProject(
                      result.project_id,
                    ),
                  }
                : { project_name: result.project_name },
          },
          _agent_guidance: {
            message: 'Deployment failed.',
            next_steps: [
              ...(existingGuidance['suggested_call']
                ? [
                    'This Project already has an Application/Compose workload. Use openlander_service.update_app with the suggested service_id to update it.',
                  ]
                : []),
              'Call openlander_monitor.diagnose_service for service/env/container/log diagnostics',
              'If this is a new app failure, call get_build_log for raw output and analyze it in your external agent',
              'Fix the issue, then retry with update_app for existing services or deploy_app for new apps',
            ],
          },
        };
      }

      if (!wait) {
        const nextSteps = ['Poll get_deploy_status to monitor build progress'];
        if (expose) {
          nextSteps.push(
            'expose requires wait=true. After deploy completes, call expose_public separately.',
          );
        }
        if (result.target_project_id) {
          nextSteps.push(
            'The new Application will attach to target_project_id after the deploy succeeds; use the returned service_id for follow-up workload actions.',
          );
        }
        return buildExecutePlanBuildingResponse({
          result,
          includeTargetAttachFields: true,
          ...(result.target_project_id ? { targetAttachStatus: 'pending' } : {}),
          nextSteps,
        });
      }

      const projectId = result.project_id;
      if (!projectId) {
        return buildExecutePlanBuildingResponse({
          result,
          includeTargetAttachFields: true,
          ...(result.target_project_id ? { targetAttachStatus: 'pending' } : {}),
        });
      }

      return await new Promise((resolve) => {
        let settled = false;

        const cleanup = (): void => {
          clearTimeout(timer);
          unsubSuccess();
          unsubFailed();
        };

        const runPostDeploy = async (): Promise<{
          extra: Record<string, unknown>;
          warnings: string[];
          projectIdOverride?: string;
        }> => {
          const extra: Record<string, unknown> = {};
          const warnings: string[] = [];
          const proj = await appCtx.db.getProjectByName(result.project_name);
          if (!proj) return { extra, warnings };
          if (expose) {
            try {
              let exposeProject = proj;
              if (planBuild?.method === 'compose' && planBuild.traffic_service) {
                const trafficService = planBuild.traffic_service;
                const children = await appCtx.db.getComposeChildProjects(proj.id);
                exposeProject =
                  children.find((child) => child.name === `${proj.name}/${trafficService}`) ?? proj;
              }
              if (exposeProject.assigned_port) {
                extra.public_url = await appCtx.pipeline.exposeTunnel(
                  exposeProject.id,
                  exposeProject.assigned_port,
                );
              }
            } catch (err) {
              warnings.push(`expose failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          return { extra, warnings };
        };

        const resolveSuccess = (
          payload: { url?: string; totalDurationMs?: number },
          timedOut: boolean,
          postDeploy?: Record<string, unknown>,
          postDeployWarnings?: string[],
          projectIdOverride?: string,
        ): void => {
          if (settled) return;
          settled = true;
          cleanup();
          void Promise.resolve()
            .then(async () => {
              const targetAttach = await observeTargetAttach(appCtx, plan.plan_id, result);
              if (targetAttach.status === 'failed') {
                resolve({
                  plan_id: plan.plan_id,
                  status: 'failed',
                  project_name: result.project_name,
                  project_id: projectId,
                  ...targetAttach.fields,
                  target_attach_status: 'failed',
                  error: targetAttach.error,
                  status_call: deployStatusCall({
                    projectId,
                    projectName: result.project_name,
                  }),
                  diagnostic_call: {
                    tool: 'openlander_monitor',
                    action: 'diagnose_service',
                    params: {
                      service_id:
                        targetIdentityResolver.deployableServiceIdForRuntimeProject(projectId),
                    },
                  },
                  docker_host: getDockerHostType(),
                  _agent_guidance: {
                    message:
                      'The deploy finished, but OpenLander could not attach the service to target_project_id.',
                    next_steps: [
                      'Inspect the failed deploy plan before retrying.',
                      'Archive any stray runtime project only after confirming the service was not attached.',
                    ],
                  },
                });
                return;
              }

              const finalProjectId = projectIdOverride ?? projectId;
              let diagnosticProjectId = finalProjectId;
              if (planBuild?.method === 'compose' && planBuild.traffic_service) {
                const parent = await appCtx.db.getProject(finalProjectId);
                const children = await appCtx.db.getComposeChildProjects(finalProjectId);
                const trafficChild = parent
                  ? children.find(
                      (child) =>
                        child.name === `${parent.name}/${planBuild.traffic_service as string}`,
                    )
                  : undefined;
                if (trafficChild) {
                  diagnosticProjectId = trafficChild.id;
                }
              }
              const hasRepresentativeTarget =
                planBuild?.method !== 'compose' || Boolean(planBuild.traffic_service);
              const readiness = hasRepresentativeTarget
                ? waitHealthy
                  ? await waitForProjectReadiness(appCtx, diagnosticProjectId, 30_000)
                  : await inspectProjectReadiness(appCtx, diagnosticProjectId)
                : {
                    readiness: 'healthy' as const,
                    ready: true,
                    message: 'Compose project has no representative traffic service.',
                  };
              const stability =
                waitHealthy && readiness.ready && hasRepresentativeTarget
                  ? await observeProjectStability(appCtx, diagnosticProjectId, readiness)
                  : undefined;
              const finalReadiness =
                stability?.status === 'unstable' ? stability.result : readiness;
              const readinessMessage =
                finalReadiness.message ?? readinessGuidance(finalReadiness.readiness);
              const stabilityWarning =
                stability?.status === 'unstable'
                  ? (stability.message ??
                    'Container restarted, exited, or became unhealthy after deploy success.')
                  : undefined;
              const readinessWarnings =
                finalReadiness.readiness === 'healthy'
                  ? []
                  : [readinessMessage ?? `readiness=${finalReadiness.readiness}`];
              const completionStatus = finalReadiness.ready
                ? 'done'
                : finalReadiness.readiness === 'unhealthy'
                  ? 'unhealthy'
                  : 'timeout';
              const serviceRecord = await loadProjectServiceRecord(
                appCtx,
                diagnosticProjectId,
              ).catch(() => undefined);
              const attachedServiceId =
                typeof targetAttach.fields['service_id'] === 'string'
                  ? targetAttach.fields['service_id']
                  : undefined;
              const attachedService =
                attachedServiceId && typeof appCtx.db.getService === 'function'
                  ? await appCtx.db.getService(attachedServiceId).catch(() => undefined)
                  : undefined;

              const resolvedRouteService =
                attachedService ??
                (diagnosticProjectId !== finalProjectId ? serviceRecord?.service : undefined);
              const assignedPort =
                resolvedRouteService?.assigned_port ??
                serviceRecord?.view.assignedPort ??
                undefined;
              const routeService = resolvedRouteService
                ? {
                    name: resolvedRouteService.name,
                    assigned_port: assignedPort ?? null,
                    public_url:
                      resolvedRouteService.public_url ?? serviceRecord?.view.publicUrl ?? null,
                  }
                : null;
              const routeName = routeService
                ? getDeployableServiceRouteName(routeService)
                : result.project_name;
              const portAwareUrls = routeService
                ? getDeployableServiceUrls(routeService)
                : getProjectUrls(routeName, assignedPort);
              const portAwarePreferred =
                (routeService ? getPreferredDeployableServiceUrl(routeService) : null) ??
                getPreferredProjectUrl(routeName, assignedPort);
              const externalUrl = isExternalDeployUrl(payload.url) ? payload.url : undefined;
              const representativeTraffic =
                waitHealthy && finalReadiness.ready && hasRepresentativeTarget
                  ? await observeRepresentativeTraffic(appCtx, routeName, '/').catch(
                      (err: unknown): RepresentativeTrafficObservation => ({
                        status: 'skipped',
                        path: '/',
                        severity: 'warning',
                        message: err instanceof Error ? err.message : String(err),
                      }),
                    )
                  : undefined;
              if (representativeTraffic) {
                try {
                  const deployLog = attachedServiceId
                    ? await appCtx.db.getLastDeployLogForService(attachedServiceId)
                    : await appCtx.db.getLastDeployLog(projectId);
                  if (deployLog) {
                    if (typeof appCtx.db.updateDeployLogRepresentativeTraffic === 'function') {
                      await appCtx.db.updateDeployLogRepresentativeTraffic(
                        deployLog.id,
                        representativeTrafficToJson(representativeTraffic),
                      );
                    }
                  }
                } catch (err) {
                  log.warn(
                    { err, projectId, attachedServiceId, routeName },
                    'Failed to persist representative traffic observation for deploy_app result',
                  );
                }
              }
              const trafficFailure = representativeTrafficFailed(representativeTraffic);
              const trafficWarning = representativeTrafficWarning(representativeTraffic);
              const effectiveCompletionStatus = trafficFailure ? 'unhealthy' : completionStatus;
              resolve({
                plan_id: plan.plan_id,
                status: effectiveCompletionStatus,
                project_name: result.project_name,
                project_id: finalProjectId,
                status_call: deployStatusCall({
                  projectId: finalProjectId,
                  projectName: result.project_name,
                }),
                ...(effectiveCompletionStatus === 'unhealthy'
                  ? {
                      diagnostic_call: {
                        tool: 'openlander_monitor',
                        action: 'diagnose_service',
                        params: {
                          service_id:
                            attachedServiceId ??
                            targetIdentityResolver.deployableServiceIdForRuntimeProject(
                              diagnosticProjectId,
                            ),
                        },
                      },
                    }
                  : {}),
                ...targetAttach.fields,
                ...(targetAttach.status ? { target_attach_status: targetAttach.status } : {}),
                preferred_url: externalUrl ?? portAwarePreferred,
                urls: externalUrl ? [externalUrl, ...portAwareUrls] : portAwareUrls,
                internal_host: projectContainerName(routeName),
                docker_host: getDockerHostType(),
                readiness: finalReadiness.readiness,
                ...(readinessMessage ? { readiness_message: readinessMessage } : {}),
                ...(representativeTraffic
                  ? {
                      representative_traffic: {
                        status: representativeTraffic.status,
                        severity: representativeTraffic.severity,
                        path: representativeTraffic.path,
                        ...(representativeTraffic.status_code
                          ? { status_code: representativeTraffic.status_code }
                          : {}),
                        ...(representativeTraffic.attempts
                          ? { attempts: representativeTraffic.attempts }
                          : {}),
                        ...(representativeTraffic.elapsed_ms !== undefined
                          ? { elapsed_ms: representativeTraffic.elapsed_ms }
                          : {}),
                        ...(representativeTraffic.message
                          ? { message: representativeTraffic.message }
                          : {}),
                      },
                    }
                  : {}),
                ...(stability
                  ? {
                      post_deploy_stability: {
                        status: stability.status,
                        observed_ms: stability.observed_ms,
                        readiness: stability.readiness,
                        ...(stability.message ? { message: stability.message } : {}),
                      },
                    }
                  : {}),
                ...(payload.totalDurationMs
                  ? { elapsed: `${String(Math.round(payload.totalDurationMs / 1000))}s` }
                  : {}),
                ...(timedOut || completionStatus === 'timeout' ? { timeout: true } : {}),
                ...postDeploy,
                ...([
                  ...readinessWarnings,
                  ...(stabilityWarning ? [stabilityWarning] : []),
                  ...(trafficWarning ? [trafficWarning] : []),
                  ...(postDeployWarnings ?? []),
                  ...targetAttach.warnings,
                ].length > 0
                  ? {
                      warnings: [
                        ...readinessWarnings,
                        ...(stabilityWarning ? [stabilityWarning] : []),
                        ...(trafficWarning ? [trafficWarning] : []),
                        ...(postDeployWarnings ?? []),
                        ...targetAttach.warnings,
                      ],
                    }
                  : {}),
                ...(targetAttach.status === 'pending'
                  ? {
                      _agent_guidance: {
                        message:
                          'Deployment finished; target_project_id attach is still being finalized.',
                        next_steps: [
                          'Poll get_deploy_status or list_projects before taking follow-up workload actions.',
                          'Use the returned service_id once it appears under the target Project.',
                        ],
                      },
                    }
                  : finalReadiness.ready && finalReadiness.readiness === 'healthy'
                    ? trafficFailure
                      ? {
                          _agent_guidance: {
                            message:
                              representativeTraffic?.message ??
                              'Deployment health passed, but representative public traffic failed.',
                            next_steps: [
                              'Call openlander_monitor.diagnose_service for service/env/container/log diagnostics',
                              'Do not report end-user success until the public route returns a non-5xx response',
                            ],
                          },
                        }
                      : {
                          _agent_guidance: {
                            message:
                              'Deployment verified. Report preferred_url to the user; no additional deploy or expose action is needed.',
                            next_steps: [
                              'Use preferred_url as the app URL.',
                              'Do not call expose_public unless the user explicitly asks for a temporary tunnel URL.',
                            ],
                          },
                        }
                    : {
                        _agent_guidance: {
                          message:
                            readinessMessage ??
                            'Deployment container is running, but readiness is not confirmed.',
                          next_steps: [
                            'Call openlander_monitor.diagnose_service for service/env/container/log diagnostics',
                            ...(finalReadiness.readiness === 'no_healthcheck'
                              ? ['Probe the service URL before reporting end-user success']
                              : ['Wait and poll again, or inspect logs before reporting success']),
                          ],
                        },
                      }),
              });
            })
            .catch(async (err: unknown) => {
              const targetAttachFields = buildTargetAttachFields(result);
              const finalProjectId = projectIdOverride ?? projectId;
              const serviceRecord = await loadProjectServiceRecord(appCtx, finalProjectId).catch(
                () => undefined,
              );
              const attachedServiceId =
                typeof targetAttachFields['service_id'] === 'string'
                  ? targetAttachFields['service_id']
                  : undefined;
              const attachedService =
                attachedServiceId && typeof appCtx.db.getService === 'function'
                  ? await appCtx.db.getService(attachedServiceId).catch(() => undefined)
                  : undefined;

              const assignedPort =
                attachedService?.assigned_port ?? serviceRecord?.view.assignedPort ?? undefined;
              const routeService = attachedService
                ? {
                    name: attachedService.name,
                    assigned_port: assignedPort ?? null,
                    public_url: attachedService.public_url ?? serviceRecord?.view.publicUrl ?? null,
                  }
                : null;
              const routeName = routeService
                ? getDeployableServiceRouteName(routeService)
                : result.project_name;
              const portAwareUrls = routeService
                ? getDeployableServiceUrls(routeService)
                : getProjectUrls(routeName, assignedPort);
              const portAwarePreferred =
                (routeService ? getPreferredDeployableServiceUrl(routeService) : null) ??
                getPreferredProjectUrl(routeName, assignedPort);
              const externalUrl = isExternalDeployUrl(payload.url) ? payload.url : undefined;
              resolve({
                plan_id: plan.plan_id,
                status: 'done',
                project_name: result.project_name,
                project_id: finalProjectId,
                status_call: deployStatusCall({
                  projectId: finalProjectId,
                  projectName: result.project_name,
                }),
                ...targetAttachFields,
                ...(result.target_project_id ? { target_attach_status: 'pending' } : {}),
                preferred_url: externalUrl ?? portAwarePreferred,
                urls: externalUrl ? [externalUrl, ...portAwareUrls] : portAwareUrls,
                internal_host: projectContainerName(routeName),
                docker_host: getDockerHostType(),
                readiness: 'starting',
                readiness_message: err instanceof Error ? err.message : String(err),
                ...(timedOut ? { timeout: true } : {}),
                ...postDeploy,
                ...(postDeployWarnings && postDeployWarnings.length > 0
                  ? { warnings: postDeployWarnings }
                  : {}),
              });
            });
        };

        const resolveFailed = (
          payload: { error?: string; buildLog?: string },
          timedOut: boolean,
        ): void => {
          if (settled) return;
          settled = true;
          cleanup();
          void Promise.resolve()
            .then(async () => {
              const job = appCtx.jobManager.getStatus(projectId);
              const existingGuidance = await buildExistingServiceGuidance(
                result.project_name,
                context,
              );
              resolve({
                plan_id: plan.plan_id,
                status: 'failed',
                project_name: result.project_name,
                error: payload.error ?? job?.errorSummary,
                status_call: deployStatusCall({
                  projectId,
                  projectName: result.project_name,
                }),
                diagnostic_call: {
                  tool: 'openlander_monitor',
                  action: 'diagnose_service',
                  params: {
                    service_id:
                      targetIdentityResolver.deployableServiceIdForRuntimeProject(projectId),
                  },
                },
                ...(job?.buildLogTail ? { build_log_tail: job.buildLogTail } : {}),
                ...(job?.autoDiagnosis
                  ? {
                      auto_diagnosis: {
                        category: job.autoDiagnosis.category,
                        tier: job.autoDiagnosis.tier,
                        cause: job.autoDiagnosis.cause,
                        auto_fixable: job.autoDiagnosis.autoFixable,
                        ...(job.autoDiagnosis.suggestedAction
                          ? { suggested_action: job.autoDiagnosis.suggestedAction }
                          : {}),
                      },
                    }
                  : {}),
                docker_host: getDockerHostType(),
                ...(timedOut ? { timeout: true } : {}),
                ...existingGuidance,
                _agent_guidance: {
                  message: 'Deployment failed.',
                  next_steps: [
                    ...(existingGuidance['suggested_call']
                      ? [
                          'This Project already has an Application/Compose workload. Use openlander_service.update_app with the suggested service_id to update it.',
                        ]
                      : []),
                    'Call openlander_monitor.diagnose_service for service/env/container/log diagnostics',
                    ...(!job?.autoDiagnosis
                      ? ['Call get_build_log for raw output and analyze it in your external agent']
                      : []),
                    'Fix the issue, then retry with update_app for existing services or deploy_app for new apps',
                  ],
                },
              });
            })
            .catch((err: unknown) => {
              resolve({
                plan_id: plan.plan_id,
                status: 'failed',
                project_name: result.project_name,
                error: err instanceof Error ? err.message : String(err),
                status_call: deployStatusCall({
                  projectId,
                  projectName: result.project_name,
                }),
                diagnostic_call: {
                  tool: 'openlander_monitor',
                  action: 'diagnose_service',
                  params: {
                    service_id:
                      targetIdentityResolver.deployableServiceIdForRuntimeProject(projectId),
                  },
                },
                docker_host: getDockerHostType(),
                ...(timedOut ? { timeout: true } : {}),
              });
            });
        };

        const resolveTimeout = (): void => {
          if (settled) return;
          settled = true;
          cleanup();
          const job = appCtx.jobManager.getStatus(projectId);
          if (job?.phase === 'done') {
            resolveSuccess({}, true);
            return;
          }
          if (job?.phase === 'failed') {
            resolveFailed({ error: job.errorSummary }, true);
            return;
          }
          resolve({
            plan_id: plan.plan_id,
            status: job?.phase ?? 'unknown',
            project_name: result.project_name,
            timeout: true,
            readiness: 'starting',
            status_call: deployStatusCall({
              projectId,
              projectName: result.project_name,
            }),
            _agent_guidance: {
              message: 'Deploy did not finish before the requested timeout.',
              next_steps: ['Poll get_deploy_status to check current progress'],
            },
          });
        };

        const matchesProject = (payload: {
          projectId: string;
          parentProjectId?: string;
        }): boolean => payload.projectId === projectId || payload.parentProjectId === projectId;

        const unsubSuccess = eventBus.on('deploy:success', (payload) => {
          if (!matchesProject(payload)) return;
          if (expose) {
            void runPostDeploy()
              .then(({ extra, warnings, projectIdOverride }) => {
                resolveSuccess(payload, false, extra, warnings, projectIdOverride);
              })
              .catch(() => {
                resolveSuccess(payload, false);
              });
          } else {
            resolveSuccess(payload, false);
          }
        });

        const unsubFailed = eventBus.on('deploy:failed', (payload) => {
          if (matchesProject(payload)) resolveFailed(payload, false);
        });

        const timer = setTimeout(
          () => {
            resolveTimeout();
          },
          Math.max(1, timeoutSec) * 1000,
        );

        const currentJob = appCtx.jobManager.getStatus(projectId);
        if (currentJob && (currentJob.phase === 'done' || currentJob.phase === 'failed')) {
          if (currentJob.phase === 'done') {
            if (expose) {
              void runPostDeploy()
                .then(({ extra, warnings, projectIdOverride }) => {
                  resolveSuccess({}, false, extra, warnings, projectIdOverride);
                })
                .catch(() => {
                  resolveSuccess({}, false);
                });
            } else {
              resolveSuccess({}, false);
            }
          } else {
            resolveFailed({ error: currentJob.errorSummary }, false);
          }
        }
      });
    },
  },
  {
    name: 'validate_deploy_plan',
    riskLevel: 'low',
    description:
      'Validate a deployment plan before executing. Checks for common mistakes: env vars pointing to localhost, placeholder secrets, missing HEALTHCHECK, port conflicts, and Dockerfile issues. Call after create_deploy_plan (or update_deploy_plan) and before execute_deploy_plan to catch problems early.',
    mcpDescription:
      'Pre-flight validation for a deploy plan. Returns structured checks with pass/warning/info status for env vars, Dockerfile, ports, and services. Catches DATABASE_URL=localhost, placeholder secrets, missing HEALTHCHECK, and other common mistakes before execution.',
    inputSchema: validateDeployPlanSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const planId = args['plan_id'] as string;

      const row = await appCtx.db.getDeployPlan(planId);
      if (!row) {
        return {
          status: 'not_found',
          error: 'DEPLOY_PLAN_NOT_FOUND',
          code: 'DEPLOY_PLAN_NOT_FOUND',
          plan_id: planId,
          suggested_call: {
            tool: 'openlander_deploy',
            action: 'get_deploy_plan',
            params: { plan_id: planId },
          },
          _agent_guidance: {
            message: 'No deploy plan exists for that plan_id.',
            next_steps: [
              'Verify the plan_id from create_deploy_plan.',
              'If you do not have a plan_id, call create_deploy_plan first.',
            ],
          },
        };
      }
      const plan = JSON.parse(row.plan_json) as DeployPlan;

      interface ValidationCheck {
        name: string;
        status: 'pass' | 'warning' | 'info' | 'fail';
        message: string;
      }
      const checks: ValidationCheck[] = [];

      const envEntries = Object.entries(plan.env.provided);
      const detectedEnvEntries = Array.isArray(plan.env.detected) ? plan.env.detected : [];
      const envEntryByKey = new Map(detectedEnvEntries.map((entry) => [entry.key, entry]));
      const trustedEnvKeys = new Set(
        (plan.env.trusted ?? []).filter((key) => key in plan.env.provided),
      );
      for (const [key, value] of envEntries) {
        const entry = envEntryByKey.get(key);
        const requirement = mergeEnvValueRequirement(key, entry?.requirement);
        const issues = validateEnvValue(key, value, requirement, entry?.required ?? false, {
          trustedSource: trustedEnvKeys.has(key),
        });
        for (const issue of issues) {
          checks.push({
            name: 'env_vars',
            status: issue.severity,
            message: issue.message,
          });
        }
      }

      if (plan.missing.length > 0) {
        checks.push({
          name: 'env_vars',
          status: 'fail',
          message: `Missing required env vars: ${plan.missing.join(', ')}`,
        });
      }

      const hasEnvIssues = checks.some((c) => c.name === 'env_vars');
      if (!hasEnvIssues) {
        checks.push({
          name: 'env_vars',
          status: 'pass',
          message: `${String(envEntries.length)} env var(s) configured, no issues detected`,
        });
      }

      if (plan.build.method === 'dockerfile') {
        // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
        const hasExpose = plan.build.compose_services?.some((s) => s.port !== undefined);
        const hasGeneratedDockerfile = plan.build.generated_dockerfile !== undefined;

        if (!hasExpose && !hasGeneratedDockerfile) {
          checks.push({
            name: 'dockerfile',
            status: 'info',
            message:
              'No EXPOSE port detected in plan. OpenLander will auto-detect the port at build time, but adding EXPOSE in your Dockerfile is recommended.',
          });
        } else {
          checks.push({
            name: 'dockerfile',
            status: 'pass',
            message: hasGeneratedDockerfile
              ? 'Dockerfile will be auto-generated'
              : 'Dockerfile detected',
          });
        }
      }

      if (plan.build.method === 'compose') {
        const services = plan.build.compose_services ?? [];
        const servicesWithHostPorts = services.filter(
          (service) => service.host_ports && service.host_ports.length > 0,
        );

        if (servicesWithHostPorts.length > 0) {
          checks.push({
            name: 'compose_ports',
            status: 'info',
            message:
              'Compose host ports will be replaced with collision-free OpenLander ports while container ports are preserved. Affected services: ' +
              servicesWithHostPorts
                .map((service) => `${service.name} (${service.host_ports?.join(', ') ?? ''})`)
                .join('; '),
          });
        }

        const withHealth = services.filter((s) => s.healthcheck);
        if (withHealth.length === 0 && services.length > 0) {
          checks.push({
            name: 'health_endpoint',
            status: 'info',
            message: `No HEALTHCHECK defined in any of ${String(services.length)} compose service(s). Consider adding healthchecks for reliability.`,
          });
        } else if (withHealth.length > 0) {
          checks.push({
            name: 'health_endpoint',
            status: 'pass',
            message: `${String(withHealth.length)}/${String(services.length)} service(s) have healthchecks`,
          });
        }
      } else {
        checks.push({
          name: 'health_endpoint',
          status: 'info',
          message:
            'No HEALTHCHECK in Dockerfile. Consider adding a /health endpoint and HEALTHCHECK instruction for better monitoring.',
        });
      }

      if (plan.services.length > 0) {
        const needsCreation = plan.services.filter((s) => s.action === 'create');
        if (needsCreation.length > 0) {
          checks.push({
            name: 'services',
            status: 'info',
            // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
            message: `${String(needsCreation.length)} service(s) will be auto-provisioned: ${needsCreation.map((s) => s.type).join(', ')}`,
          });
        }
        const reusable = plan.services.filter((s) => s.action === 'reuse');
        if (reusable.length > 0) {
          checks.push({
            name: 'services',
            status: 'pass',
            // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
            message: `${String(reusable.length)} existing service(s) will be reused: ${reusable.map((s) => `${s.type}${s.name ? ` (${s.name})` : ''}`).join(', ')}`,
          });
        }
      }

      const passCount = checks.filter((c) => c.status === 'pass').length;
      const warnCount = checks.filter((c) => c.status === 'warning').length;
      const failCount = checks.filter((c) => c.status === 'fail').length;

      return Promise.resolve({
        plan_id: plan.plan_id,
        plan_status: plan.status,
        valid: failCount === 0,
        summary:
          failCount > 0
            ? `${String(failCount)} issue(s) must be resolved before deploying`
            : warnCount > 0
              ? `Ready with ${String(warnCount)} warning(s) — review before deploying`
              : `All ${String(passCount)} check(s) passed`,
        checks,
        warnings: plan.warnings,
        _agent_guidance: {
          networking: [
            'New OpenLander-managed Applications and Database/Cache/Storage resources use Project-scoped Docker networks by default.',
            'Use Database/Cache resources created in the same Project as the default app DB/cache path.',
            'For existing Docker/PaaS migrations, inspect and back up existing volumes before changing network attachments.',
          ],
        },
      });
    },
  },
];
