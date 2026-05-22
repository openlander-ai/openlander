import { nanoid } from 'nanoid';
import { DeployLockedError, OpenLanderError } from '../../errors.js';
import type { ToolContext, ToolDef } from './types.js';
import type { DeployPlan } from '../../pipeline/deploy-plan/types.js';
import type { PlanUpdates, ExecutePlanResult } from '../../pipeline/deploy-plan/engine.js';
import { eventBus } from '../../events/index.js';
import { getDockerHostType } from '../../pipeline/docker.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import { getPreferredProjectUrl, getProjectUrls } from '../../pipeline/traefik.js';
import { markMcpDeploy } from '../../pipeline/auto-recovery.js';
import { MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import {
  buildDeployLockedResponse,
  deployTriggerForToolContext,
  tryAcquireDeployLockOrResponse,
} from './helpers.js';
import { runDeployableServiceAction } from './deployable-service.js';

import {
  createDeployPlanSchema,
  updateDeployPlanSchema,
  executeDeployPlanSchema,
  deploySchema,
  validateDeployPlanSchema,
} from './schemas.js';

type AppCtx = ToolContext['appCtx'];
type ServiceRow = NonNullable<Awaited<ReturnType<AppCtx['db']['getService']>>>;
type DeploymentReadiness = 'healthy' | 'starting' | 'unhealthy' | 'no_healthcheck';

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

type ContainerState = {
  Running?: boolean;
  Restarting?: boolean;
  ExitCode?: number;
  Health?: { Status?: string };
};

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

async function inspectProjectReadiness(
  appCtx: AppCtx,
  projectId: string,
): Promise<ReadinessResult> {
  const deployable = await appCtx.db.getDeployableForProject(projectId);
  const containerId = deployable?.container_id ?? null;
  if (!containerId) {
    return { readiness: 'starting', ready: false, message: 'No container_id recorded yet.' };
  }

  try {
    const info = (await appCtx.docker.inspectContainer(containerId)) as { State?: ContainerState };
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
          action: 'redeploy_app',
          params: { service_id: primary.service_id },
        }
      : undefined,
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
            'This project already has multiple deployable services. Pick the intended service_id and call deploy_app or openlander_service.redeploy_app with that service_id.',
          next_steps: [
            'Choose one candidate_services[].service_id.',
            'Call openlander_deploy.deploy_app with service_id for a front-door redeploy, or openlander_service.redeploy_app with service_id.',
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
      'Analyze a repository/image and create a deployment plan for a new deployable service. Use name for the project group name. Returns detected services, required env vars, and build config. Use update_deploy_plan to fill missing values before executing.',
    mcpDescription:
      'Create a deployment plan for a new app/service. New app names use name, not project_name. Returns plan_id, status, detected services, missing vars, warnings.',
    inputSchema: createDeployPlanSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const envVars = parseEnvVarsInput(args['env_vars']) ?? {};

      const plan: DeployPlan = await appCtx.planEngine.createPlan({
        repoUrl: (args['repo_url'] as string | undefined) ?? undefined,
        branch: (args['branch'] as string | undefined) ?? undefined,
        name: (args['name'] as string | undefined) ?? undefined,
        source: (args['source'] as 'git' | 'image' | undefined) ?? undefined,
        imageUrl: (args['image'] as string | undefined) ?? undefined,
        imageCmd: (args['cmd'] as string[] | undefined) ?? undefined,
        containerPort: (args['port'] as number | undefined) ?? undefined,
        envVars,
        preferDockerfile: (args['prefer_dockerfile'] as boolean | undefined) ?? undefined,
        dockerfilePath: (args['dockerfile_path'] as string | undefined) ?? undefined,
        dockerTarget: (args['docker_target'] as string | undefined) ?? undefined,
        trigger: deployTriggerForToolContext(context),
      });

      return {
        plan_id: plan.plan_id,
        status: plan.status,
        complexity: plan.complexity,
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
        ...(context.target === 'agent' &&
        typeof context.appCtx.db.getProject === 'function' &&
        plan.status === 'needs_input'
          ? {
              _agent_guidance: {
                next_steps: [
                  `Plan has missing values. Call update_deploy_plan to provide: ${plan.missing.join(', ')}`,
                  'After updating, call execute_deploy_plan to start deployment',
                  "Proposed project-scoped services are listed in services[] with resolution='proposed_project_service'; confirm with the user, then call update_deploy_plan / execute_deploy_plan.",
                ],
              },
            }
          : {}),
        ...(context.target === 'agent' &&
        typeof context.appCtx.db.getProject === 'function' &&
        plan.status === 'needs_approval'
          ? {
              _agent_guidance: {
                next_steps: [
                  'This plan proposes project-scoped managed services (see services[] with resolution="proposed_project_service"). Confirm with the user, then call execute_deploy_plan with approve_all_safe_resources=true or approvals.create_resources=[<identifiers>].',
                ],
              },
            }
          : {}),
        ...(context.target === 'agent' &&
        typeof context.appCtx.db.getProject === 'function' &&
        plan.status === 'ready'
          ? {
              _agent_guidance: {
                next_steps: ['Plan is ready. Call execute_deploy_plan to start deployment'],
              },
            }
          : {}),
      };
    },
  },
  {
    name: 'update_deploy_plan',
    riskLevel: 'medium',
    description:
      'Update a deployment plan with missing values (env vars, Dockerfile selection, service config). Call after create_deploy_plan when status is "needs_input". Returns the full updated plan with plan_id, status, complexity, app, build, services, env, missing, warnings.',
    mcpDescription:
      'Update a deployment plan with missing values. Pass updates as a JSON string with fields like env (environment variables), dockerfile (Dockerfile path), or services (service configuration). Returns the full updated plan with plan_id, status, complexity, app, build, services, env, missing, warnings.',
    inputSchema: updateDeployPlanSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const planId = args['plan_id'] as string;
      const updatesRaw = args['updates'] as string;
      const updates = JSON.parse(updatesRaw) as PlanUpdates;

      const plan: DeployPlan = await appCtx.planEngine.updatePlan(planId, updates);

      return {
        plan_id: plan.plan_id,
        status: plan.status,
        complexity: plan.complexity,
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
      };
    },
  },
  {
    name: 'execute_deploy_plan',
    riskLevel: 'medium',
    description:
      'Execute a deployment plan. A plan in "needs_approval" status lists proposed project-scoped managed services in services[] (resolution="proposed_project_service"); pass approve_all_safe_resources=true or approvals.create_resources=[...] to approve and OpenLander provisions the approved safe managed services (DB/cache), wires their connection env (e.g. DATABASE_URL), and deploys. Unapproved, compose, or not_auto_creatable services are never created — supply their env or create them first. Plans already in "ready" status execute directly.',
    mcpDescription:
      'Execute a deployment plan asynchronously. Returns immediately with project_id and status. Use get_deploy_status to poll progress. A "needs_approval" plan lists proposed managed services in services[]; pass approve_all_safe_resources=true or approvals.create_resources=[...] and OpenLander provisions the approved safe managed services (DB/cache), wires their connection env, and deploys. Unapproved/compose/not_auto_creatable services are not created. "ready" plans execute directly; injects env vars and starts deployment.',
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
        if (msg.includes('missing environment variables')) {
          const planData = planRow ? (JSON.parse(planRow.plan_json) as DeployPlan) : undefined;
          return {
            plan_id: planId,
            status: 'needs_input',
            error: msg,
            missing: planData?.missing ?? [],
            _agent_guidance: {
              next_steps: [
                'Call update_deploy_plan with the missing env vars',
                'Then call execute_deploy_plan again',
              ],
            },
          };
        }
        throw err;
      }

      if (result.status === 'needs_approval') {
        // Engine started nothing. Release the pre-acquired lock so the agent
        // can re-run with approvals.
        if (acquiredLockProjectId) {
          await appCtx.db.releaseDeployLock(acquiredLockProjectId, toolSessionId);
        }
        return {
          plan_id: result.plan_id,
          status: 'needs_approval',
          approval_required: result.approval_required,
          _agent_guidance: result._agent_guidance,
        };
      }

      if (result.status === 'needs_target_project') {
        // New-app guard: the engine created nothing because an approved managed
        // service has no existing target project to provision on. Release the
        // pre-acquired lock (none was created by the engine).
        if (acquiredLockProjectId) {
          await appCtx.db.releaseDeployLock(acquiredLockProjectId, toolSessionId);
        }
        return {
          plan_id: result.plan_id,
          status: 'needs_target_project',
          project_name: result.project_name,
          message: result.message,
          approval_required: result.approval_required,
          _agent_guidance: result._agent_guidance,
        };
      }

      if (result.project_id) {
        markMcpDeploy(result.project_id);
      }

      if (result.status === 'building') {
        return {
          plan_id: result.plan_id,
          status: 'building',
          project_name: result.project_name,
          project_id: result.project_id,
          estimated_seconds: result.estimated_seconds,
          _agent_guidance: {
            next_steps: ['Poll get_deploy_status to monitor build progress'],
          },
        };
      } else {
        return {
          plan_id: result.plan_id,
          status: 'failed',
          error: result.error,
          _agent_guidance: {
            next_steps: [
              'Check the error message above — this is a preflight failure (before build started)',
              'Fix the issue, then create_deploy_plan + execute_deploy_plan to retry',
            ],
          },
        };
      }
    },
  },
  {
    name: 'deploy_app',
    riskLevel: 'medium',
    description:
      'One-call app deploy front door. If service_id/service_name is provided, or name matches an existing project with exactly one deployable service, this redeploys that service. Otherwise it creates a new app from repo_url or image. Combines create_deploy_plan + execute_deploy_plan + get_deploy_status for new apps. Returns final deployment result with URL when done, including internal_host, docker_host, elapsed, and readiness; status "unhealthy" means the container runs but Docker HEALTHCHECK is failing. On failure, returns auto_diagnosis/build_log_tail; timeout may be returned when wait times out. If the plan needs missing env vars, returns status "needs_input" with the missing list; if it proposes project-scoped managed services, returns status "needs_approval" with approval_required (approve via execute_deploy_plan using approve_all_safe_resources / approvals.create_resources).',
    mcpDescription:
      'App deploy front door. New app: pass repo_url/image and use name for the project group name. Existing app: prefer service_id, or use service_name/project_name/name lookup. Poll get_deploy_status; diagnose failures with diagnose_service.',
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

      const frontDoorTarget = await resolveExistingDeployAppTarget(args, context);
      if (frontDoorTarget?.kind === 'needs_selection') {
        return frontDoorTarget.response;
      }
      if (
        frontDoorTarget?.kind === 'service_target' ||
        frontDoorTarget?.kind === 'existing_project'
      ) {
        const redeployParams =
          Object.keys(envVars).length > 0
            ? { ...frontDoorTarget.params, env_vars: envVars }
            : frontDoorTarget.params;
        const redeployResult = await runDeployableServiceAction(
          redeployParams,
          context,
          'redeploy_app',
        );
        const redeployPayload = redeployResult as Record<string, unknown>;
        return {
          ...redeployPayload,
          mode:
            frontDoorTarget.kind === 'service_target'
              ? 'redeploy_service_target'
              : 'redeploy_existing_project',
          ...(frontDoorTarget.kind === 'existing_project'
            ? { existing_service: frontDoorTarget.existingService }
            : {}),
        };
      }

      if ((repoUrl || image) && scopedProjectName && !newAppName) {
        return {
          error: 'INVALID_PARAMS',
          action: 'deploy_app',
          details:
            'project_name scopes existing app lookups only. For new app deploys, use name as the project name.',
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
              'Retry deploy_app with name set to the desired new project name.',
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
              ? 'No existing deployable service matched this name, and no repo_url/image was provided for a new app.'
              : 'deploy_app needs repo_url/image for a new app, or service_id/service_name/name for an existing app.',
            next_steps: [
              'For a new app, call deploy_app with repo_url or source="image" plus image.',
              'For an existing app, call deploy_app with service_id, service_name, or the project name.',
            ],
          },
        };
      }

      // Pre-flight target_project_id checks (CCG findings #1, #2):
      //   #1 (1.0 blocker): wait=false bypasses runPostDeploy, so the
      //      attach step never runs. The deploy completes but stays in a
      //      temp project forever. Reject the combination.
      //   #2 (major): a typo in target_project_id used to silently land as
      //      a warning AFTER the container ran. Validate up front so a bad
      //      id fails the call before any Docker work starts.
      if (targetProjectId) {
        if (!wait) {
          return {
            status: 'failed',
            error: 'INVALID_ARGS',
            message:
              'target_project_id requires wait=true. The attach step runs only after deploy completion; with wait=false the deploy would stay in a temp project. Re-call with wait=true (default).',
          };
        }
        if (!(await appCtx.db.getProject(targetProjectId))) {
          return {
            status: 'failed',
            error: 'TARGET_PROJECT_NOT_FOUND',
            message: `target_project_id "${targetProjectId}" does not exist. Verify the id with list_projects before retrying.`,
          };
        }
      }

      const plan: DeployPlan = await appCtx.planEngine.createPlan({
        repoUrl: (args['repo_url'] as string | undefined) ?? undefined,
        branch: (args['branch'] as string | undefined) ?? undefined,
        name: newAppName,
        source,
        imageUrl: image,
        imageCmd: (args['cmd'] as string[] | undefined) ?? undefined,
        containerPort: (args['port'] as number | undefined) ?? undefined,
        envVars,
        preferDockerfile: (args['prefer_dockerfile'] as boolean | undefined) ?? undefined,
        dockerfilePath: (args['dockerfile_path'] as string | undefined) ?? undefined,
        dockerTarget: (args['docker_target'] as string | undefined) ?? undefined,
        trigger: deployTriggerForToolContext(context),
      });

      if (plan.status === 'needs_input') {
        return {
          plan_id: plan.plan_id,
          status: 'needs_input',
          missing: plan.missing,
          warnings: plan.warnings,
          _agent_guidance: {
            next_steps: [
              `Provide missing values: ${plan.missing.join(', ')}`,
              'Call update_deploy_plan with the values, then execute_deploy_plan',
              'Or call deploy_app again with env_vars including the missing keys',
            ],
          },
        };
      }

      if (plan.status === 'needs_approval') {
        // Surface the approval contract so the agent routes through
        // execute_deploy_plan with approvals. Do NOT proceed to lock or execute —
        // unapproved provisioning creates nothing and the caller must confirm.
        const safeProposals = plan.services.filter(
          (svc) =>
            svc.resolution === 'proposed_project_service' && svc.approval === 'safe_resource',
        );
        return {
          plan_id: plan.plan_id,
          status: 'needs_approval',
          services: plan.services,
          approval_required: {
            create_resources: safeProposals.map((svc) => svc.name ?? svc.type),
          },
          warnings: plan.warnings,
          _agent_guidance: {
            next_steps: [
              'This plan proposes project-scoped managed services (see services[] with resolution="proposed_project_service"). Confirm with the user before proceeding.',
              'Then call execute_deploy_plan with the plan_id and approve_all_safe_resources=true, or approvals.create_resources=[<identifiers>] to approve individually.',
              'Note: for a NEW app, OpenLander cannot auto-provision a managed service yet — execute_deploy_plan returns needs_target_project. To deploy this app now, pass an external connection URL (e.g. DATABASE_URL) in env_vars so nothing needs provisioning; auto-provisioning is available under an existing project.',
            ],
          },
        };
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
          ...existingGuidance,
          _agent_guidance: {
            next_steps: [
              ...(existingGuidance['suggested_call']
                ? [
                    'This project already has a deployable service. Use openlander_service.redeploy_app with the suggested service_id to redeploy it.',
                  ]
                : []),
              'Call openlander_monitor.diagnose_service for service/env/container/log diagnostics',
              'If this is a new app failure, call get_build_log for raw output and analyze it in your external agent',
              'Fix the issue, then retry with redeploy_app for existing services or deploy_app for new apps',
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
        return {
          plan_id: plan.plan_id,
          status: 'building',
          project_name: result.project_name,
          project_id: result.project_id,
          estimated_seconds: result.estimated_seconds,
          _agent_guidance: { next_steps: nextSteps },
        };
      }

      const projectId = result.project_id;
      if (!projectId) {
        return {
          plan_id: plan.plan_id,
          status: 'building',
          project_name: result.project_name,
          estimated_seconds: result.estimated_seconds,
          _agent_guidance: {
            next_steps: ['Poll get_deploy_status to monitor build progress'],
          },
        };
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
              if (proj.assigned_port) {
                extra.public_url = await appCtx.pipeline.exposeTunnel(proj.id, proj.assigned_port);
              }
            } catch (err) {
              warnings.push(`expose failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          let projectIdOverride: string | undefined;
          if (targetProjectId) {
            try {
              const serviceId = `${proj.id}__svc`;
              const moved = await appCtx.db.attachServiceToProject(serviceId, targetProjectId);
              extra.attached_to = moved.targetProjectId;
              extra.merged_from = moved.sourceProjectId;
              projectIdOverride = moved.targetProjectId;
              // CCG #3: surface env_var / secret_file collision losers so the
              // user knows what target-side keys won and which source-side
              // values were dropped on attach.
              if (moved.droppedEnvVarKeys.length > 0 || moved.droppedSecretFiles.length > 0) {
                extra.dropped_on_attach = [...moved.droppedEnvVarKeys, ...moved.droppedSecretFiles];
                const droppedTotal =
                  moved.droppedEnvVarKeys.length + moved.droppedSecretFiles.length;
                warnings.push(
                  `${String(droppedTotal)} env var(s) / secret file(s) collided with target group keys and were dropped (target wins). Re-set them on ${moved.targetProjectId} if needed.`,
                );
              }
            } catch (err) {
              // CCG #2: post-success attach failure is "partial success" —
              // the container is running but not in the target group. Make
              // it loud, not a warning footnote.
              warnings.push(
                `PARTIAL SUCCESS: deploy completed but attach to ${targetProjectId} failed (${err instanceof Error ? err.message : String(err)}). The service is running under temp project ${proj.id}. Re-attach manually, or stop+remove and retry.`,
              );
            }
          }
          return { extra, warnings, projectIdOverride };
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
              const readiness = waitHealthy
                ? await waitForProjectReadiness(appCtx, projectIdOverride ?? projectId, 30_000)
                : await inspectProjectReadiness(appCtx, projectIdOverride ?? projectId);
              const readinessMessage = readiness.message ?? readinessGuidance(readiness.readiness);
              const readinessWarnings =
                readiness.readiness === 'healthy'
                  ? []
                  : [readinessMessage ?? `readiness=${readiness.readiness}`];
              const completionStatus = readiness.ready
                ? 'done'
                : readiness.readiness === 'unhealthy'
                  ? 'unhealthy'
                  : 'timeout';
              const finalProjectId = projectIdOverride ?? projectId;
              const deployable = await appCtx.db
                .getDeployableForProject(finalProjectId)
                .catch(() => undefined);

              const assignedPort = deployable?.assigned_port ?? undefined;
              const portAwareUrls = getProjectUrls(result.project_name, assignedPort);
              const portAwarePreferred = getPreferredProjectUrl(result.project_name, assignedPort);
              const externalUrl = isExternalDeployUrl(payload.url) ? payload.url : undefined;
              resolve({
                plan_id: plan.plan_id,
                status: completionStatus,
                project_name: result.project_name,
                project_id: finalProjectId,
                preferred_url: externalUrl ?? portAwarePreferred,
                urls: externalUrl ? [externalUrl, ...portAwareUrls] : portAwareUrls,
                internal_host: projectContainerName(result.project_name),
                docker_host: getDockerHostType(),
                readiness: readiness.readiness,
                ...(readinessMessage ? { readiness_message: readinessMessage } : {}),
                ...(payload.totalDurationMs
                  ? { elapsed: `${String(Math.round(payload.totalDurationMs / 1000))}s` }
                  : {}),
                ...(timedOut || completionStatus === 'timeout' ? { timeout: true } : {}),
                ...postDeploy,
                ...([...readinessWarnings, ...(postDeployWarnings ?? [])].length > 0
                  ? { warnings: [...readinessWarnings, ...(postDeployWarnings ?? [])] }
                  : {}),
                ...(readiness.ready && readiness.readiness === 'healthy'
                  ? {}
                  : {
                      _agent_guidance: {
                        message:
                          readinessMessage ??
                          'Deployment container is running, but readiness is not confirmed.',
                        next_steps: [
                          'Call openlander_monitor.diagnose_service for service/env/container/log diagnostics',
                          ...(readiness.readiness === 'no_healthcheck'
                            ? ['Probe the service URL before reporting end-user success']
                            : ['Wait and poll again, or inspect logs before reporting success']),
                        ],
                      },
                    }),
              });
            })
            .catch(async (err: unknown) => {
              const finalProjectId = projectIdOverride ?? projectId;
              const deployable = await appCtx.db
                .getDeployableForProject(finalProjectId)
                .catch(() => undefined);

              const assignedPort = deployable?.assigned_port ?? undefined;
              const portAwareUrls = getProjectUrls(result.project_name, assignedPort);
              const portAwarePreferred = getPreferredProjectUrl(result.project_name, assignedPort);
              const externalUrl = isExternalDeployUrl(payload.url) ? payload.url : undefined;
              resolve({
                plan_id: plan.plan_id,
                status: 'done',
                project_name: result.project_name,
                project_id: finalProjectId,
                preferred_url: externalUrl ?? portAwarePreferred,
                urls: externalUrl ? [externalUrl, ...portAwareUrls] : portAwareUrls,
                internal_host: projectContainerName(result.project_name),
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
                  next_steps: [
                    ...(existingGuidance['suggested_call']
                      ? [
                          'This project already has a deployable service. Use openlander_service.redeploy_app with the suggested service_id to redeploy it.',
                        ]
                      : []),
                    'Call openlander_monitor.diagnose_service for service/env/container/log diagnostics',
                    ...(!job?.autoDiagnosis
                      ? ['Call get_build_log for raw output and analyze it in your external agent']
                      : []),
                    'Fix the issue, then retry with redeploy_app for existing services or deploy_app for new apps',
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
            _agent_guidance: {
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
          if (expose || targetProjectId) {
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
            if (expose || targetProjectId) {
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
        throw new Error(`Deploy plan not found: ${planId}`);
      }
      const plan = JSON.parse(row.plan_json) as DeployPlan;

      interface ValidationCheck {
        name: string;
        status: 'pass' | 'warning' | 'info' | 'fail';
        message: string;
      }
      const checks: ValidationCheck[] = [];

      const LOCALHOST_PATTERNS = [
        /localhost/i,
        /127\.0\.0\.1/,
        /0\.0\.0\.0/,
        /host\.docker\.internal/i,
      ];
      const PLACEHOLDER_PATTERNS = [
        /^(changeme|change_me|replace_me|your[_-]?.*here|xxx+|todo|fixme|placeholder)$/i,
        /^(password|secret|token|key)$/i,
        /^<.*>$/,
      ];

      const envEntries = Object.entries(plan.env.provided);
      const urlKeys = envEntries.filter(([key]) =>
        /_(URL|URI|HOST|DSN|ENDPOINT|CONNECTION)$/i.test(key),
      );

      for (const [key, value] of urlKeys) {
        if (LOCALHOST_PATTERNS.some((p) => p.test(value))) {
          checks.push({
            name: 'env_vars',
            status: 'warning',
            message: `${key} points to localhost ("${value}") — this won't work inside a container. Use the service hostname (e.g., ol-<project>-postgres) or Docker network address.`,
          });
        }
      }

      for (const [key, value] of envEntries) {
        if (PLACEHOLDER_PATTERNS.some((p) => p.test(value))) {
          checks.push({
            name: 'env_vars',
            status: 'warning',
            message: `${key} looks like a placeholder ("${value}") — set the real value before deploying.`,
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
            status: 'fail',
            message:
              'Compose `ports:` host mappings are not supported. OpenLander manages public routing through Traefik; remove `ports:` and use `expose:` or the service container port instead. Affected services: ' +
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
            'Project-scoped app and managed-service containers are isolated on the project Docker network. Do NOT create Docker networks manually.',
            'Use managed services created in the same project as the default app DB/cache path.',
            'Networks are auto-managed by OpenLander. Manual docker network commands will cause conflicts.',
          ],
        },
      });
    },
  },
];
