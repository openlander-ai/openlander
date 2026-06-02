import { nanoid } from 'nanoid';
import { DeployLockedError } from '../../errors.js';
import type { DeployLogRow, DeployPlanRow, ProjectRow } from '../../db/types.js';
import type { ToolDef } from './types.js';
import type { DeployPlan } from '../../pipeline/deploy-plan/types.js';
import type { PlanUpdates, ExecutePlanResult } from '../../pipeline/deploy-plan/engine.js';
import { eventBus } from '../../events/index.js';
import { getDockerHostType } from '../../pipeline/docker.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import { getProjectUrls } from '../../pipeline/traefik.js';
import { markMcpDeploy } from '../../pipeline/auto-recovery.js';
import { SHARED_NETWORK_NAME } from '../../config/index.js';
import { buildDeployLockedResponse, tryAcquireDeployLockOrResponse } from './helpers.js';

import {
  createDeployPlanSchema,
  getDeployPlanSchema,
  updateDeployPlanSchema,
  executeDeployPlanSchema,
  cancelDeploySchema,
  deploySchema,
  validateDeployPlanSchema,
} from './schemas.js';

function deployStatusCall(projectName?: string): Record<string, unknown> {
  return {
    tool: 'openlander_deploy',
    arguments: {
      action: 'get_deploy_status',
      ...(projectName ? { params: { project_name: projectName } } : {}),
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
      suggested_call: {
        tool: 'openlander_deploy',
        arguments: {
          action: 'update_deploy_plan',
          params: {
            plan_id: plan.plan_id,
            updates: '{"env":{"KEY":"value"}}',
          },
        },
      },
      _agent_guidance: {
        message: 'Plan needs input before execution.',
        next_steps: [
          `Provide missing values: ${plan.missing.join(', ') || 'review missing[]'}`,
          'Call update_deploy_plan, then call execute_deploy_plan.',
        ],
      },
    };
  }

  if (plan.status === 'ready') {
    return {
      ...base,
      suggested_call: {
        tool: 'openlander_deploy',
        arguments: {
          action: 'execute_deploy_plan',
          params: { plan_id: plan.plan_id },
        },
      },
      _agent_guidance: {
        message: 'Plan is ready to execute.',
        next_steps: ['Call execute_deploy_plan to start deployment.'],
      },
    };
  }

  return {
    ...base,
    ...(projectName ? { status_call: deployStatusCall(projectName) } : {}),
  };
}

function serviceIdToProjectId(serviceId: string): string {
  return serviceId.endsWith('__svc') ? serviceId.slice(0, -'__svc'.length) : serviceId;
}

interface CancelResolverContext {
  appCtx: {
    db: {
      getProject: (id: string) => Promise<ProjectRow | undefined> | ProjectRow | undefined;
      getProjectByName: (name: string) => Promise<ProjectRow | undefined> | ProjectRow | undefined;
      getDeployLog: (id: string) => Promise<DeployLogRow | undefined> | DeployLogRow | undefined;
      getService: (
        id: string,
      ) =>
        | Promise<{ project_id?: string | null } | undefined>
        | { project_id?: string | null }
        | undefined;
    };
  };
}

async function resolveCancelProject(
  args: Record<string, unknown>,
  context: CancelResolverContext,
): Promise<
  | { ok: true; project: ProjectRow; deployId?: string; resolvedFrom: string }
  | { ok: false; code: string; message: string; attempted_id?: string }
> {
  const appCtx = context.appCtx;

  const projectFromId = async (projectId: string): Promise<ProjectRow | undefined> =>
    await appCtx.db.getProject(projectId);
  const projectFromName = async (projectName: string): Promise<ProjectRow | undefined> =>
    await appCtx.db.getProjectByName(projectName);
  const projectFromDeployId = async (
    deployId: string,
  ): Promise<{ project?: ProjectRow; deploy?: DeployLogRow }> => {
    const deploy = await appCtx.db.getDeployLog(deployId);
    if (!deploy) return {};
    const serviceProjectId = deploy.project_id ?? serviceIdToProjectId(deploy.service_id);
    const service = await appCtx.db.getService(deploy.service_id);
    const project = await appCtx.db.getProject(service?.project_id ?? serviceProjectId);
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

  const projectId = args['project_id'];
  if (typeof projectId === 'string' && projectId.length > 0) {
    const project = await projectFromId(projectId);
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
    const project = await projectFromName(projectName);
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
    const byProjectId = await projectFromId(id);
    if (byProjectId) return { ok: true, project: byProjectId, resolvedFrom: 'id:project_id' };
    const byProjectName = await projectFromName(id);
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
    message: 'One of deploy_id, project_id, project_name, or id is required.',
  };
}

export const deployPlanToolDefs: ToolDef[] = [
  {
    name: 'create_deploy_plan',
    riskLevel: 'medium',
    description:
      'Analyze a repository and create a deployment plan. Returns a plan with detected services, required env vars, and build config. Use update_deploy_plan to fill missing values before executing.',
    mcpDescription:
      'Create deployment plan. Compose: build, ports, environment, depends_on, env_file, volumes, profiles, image. Not: command, entrypoint, healthcheck, restart, networks, secrets. Returns plan_id, status, complexity, missing vars, warnings.',
    inputSchema: createDeployPlanSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const envVarsRaw = (args['env_vars'] as string | undefined) ?? undefined;
      const envVars = envVarsRaw ? (JSON.parse(envVarsRaw) as Record<string, string>) : undefined;

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
      });

      return deployPlanResponse(plan);
    },
  },
  {
    name: 'get_deploy_plan',
    riskLevel: 'low',
    description:
      'Retrieve the current deployment plan by plan_id. Use after create_deploy_plan or update_deploy_plan to inspect status, missing inputs, build config, detected services, warnings, and the next suggested call.',
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
            arguments: {
              action: 'create_deploy_plan',
              params: { repo_url: '<repo_url>' },
            },
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
      'Update a deployment plan with missing values. Pass updates as a JSON string with fields like env (environment variables), dockerfile (Dockerfile path), or services (service configuration). Returns the full updated plan with plan_id, status, complexity, app, build, services, env, missing, warnings.',
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
      'Execute a deployment plan. Plan must be in "ready" status. Provisions services, injects env vars, and deploys the application.',
    mcpDescription:
      'Execute a deployment plan asynchronously. Returns immediately with project_id and status. Use get_deploy_status to poll progress. Plan must be in "ready" status. Provisions services, injects env vars, and starts deployment.',
    inputSchema: executeDeployPlanSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const planId = args['plan_id'] as string;
      const toolSessionId = `mcp-execute-plan-${nanoid(12)}`;

      const deployOnly = (args['deploy_only'] as string[] | undefined) ?? undefined;
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
        }
        if (planData.project_id) {
          markMcpDeploy(planData.project_id);
        }
      }
      let result: ExecutePlanResult;
      try {
        result = await appCtx.planEngine.executePlan(planId, deployOnly, toolSessionId);
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
            suggested_call: {
              tool: 'openlander_deploy',
              arguments: {
                action: 'update_deploy_plan',
                params: {
                  plan_id: planId,
                  updates: '{"env":{"KEY":"value"}}',
                },
              },
            },
            _agent_guidance: {
              message: 'The plan still has missing environment variables.',
              next_steps: [
                'Call update_deploy_plan with the missing env vars',
                'Then call execute_deploy_plan again',
              ],
            },
          };
        }
        throw err;
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
          status_call: deployStatusCall(result.project_name),
          _agent_guidance: {
            message: 'Deployment started.',
            next_steps: ['Poll get_deploy_status to monitor build progress'],
          },
        };
      } else {
        return {
          plan_id: result.plan_id,
          status: 'failed',
          error: result.error,
          suggested_call: {
            tool: 'openlander_deploy',
            arguments: {
              action: 'get_deploy_plan',
              params: { plan_id: result.plan_id },
            },
          },
          _agent_guidance: {
            message: 'Deployment failed before the build started.',
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
    name: 'cancel_deploy',
    riskLevel: 'medium',
    description:
      'Cancel an active deployment build by deploy_id, project_id, project_name, or id. Stops the active Docker build stream if one is running and returns a status_call for follow-up.',
    mcpDescription:
      'Cancel an active deployment. Accepts deploy_id, project_id, project_name, or id. Returns cancelled=true only when an active build stream was stopped.',
    inputSchema: cancelDeploySchema,
    execute: async (args, context) => {
      const resolved = await resolveCancelProject(args, context);
      if (!resolved.ok) {
        return {
          status: 'not_found',
          error: resolved.code,
          code: resolved.code,
          message: resolved.message,
          ...(resolved.attempted_id ? { attempted_id: resolved.attempted_id } : {}),
          suggested_call: {
            tool: 'openlander_project',
            arguments: {
              action: 'list_projects',
              params: {},
            },
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
        resolved_from: resolved.resolvedFrom,
        status_call: deployStatusCall(resolved.project.name),
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
    name: 'deploy',
    riskLevel: 'medium',
    description:
      'One-call deploy: analyzes repo, creates plan, executes, and optionally waits for completion. Combines create_deploy_plan + execute_deploy_plan + get_deploy_status into a single call. Returns final deployment result with URL when done, including internal_host, docker_host, elapsed, and on failure auto_diagnosis/build_log_tail; timeout may be returned when wait times out. If the plan needs missing env vars, returns status "needs_input" with the missing list — provide them and call again. Power users can still use the 3-step flow for finer control.',
    mcpDescription:
      'One-call deploy: repo analysis → build → deploy → result. Returns immediately with status. Poll get_deploy_status to track progress. Returns URL on success, error + diagnosis guidance on failure. Use the 3-step flow (create/execute/status) for finer control.',
    inputSchema: deploySchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const toolSessionId = `mcp-deploy-${nanoid(12)}`;
      const envVarsRaw = (args['env_vars'] as string | undefined) ?? undefined;
      const envVars = envVarsRaw ? (JSON.parse(envVarsRaw) as Record<string, string>) : undefined;
      const wait = (args['wait'] as boolean | undefined) ?? true;
      const timeoutSec = (args['timeout'] as number | undefined) ?? 300;
      const expose = (args['expose'] as boolean | undefined) ?? false;
      const domain = (args['domain'] as string | undefined) ?? undefined;
      const targetProjectId = (args['target_project_id'] as string | undefined) ?? undefined;

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
        name: (args['name'] as string | undefined) ?? undefined,
        source: (args['source'] as 'git' | 'image' | undefined) ?? undefined,
        imageUrl: (args['image'] as string | undefined) ?? undefined,
        imageCmd: (args['cmd'] as string[] | undefined) ?? undefined,
        containerPort: (args['port'] as number | undefined) ?? undefined,
        envVars,
        preferDockerfile: (args['prefer_dockerfile'] as boolean | undefined) ?? undefined,
        dockerfilePath: (args['dockerfile_path'] as string | undefined) ?? undefined,
        dockerTarget: (args['docker_target'] as string | undefined) ?? undefined,
      });

      if (plan.status === 'needs_input') {
        return {
          plan_id: plan.plan_id,
          status: 'needs_input',
          missing: plan.missing,
          warnings: plan.warnings,
          suggested_call: {
            tool: 'openlander_deploy',
            arguments: {
              action: 'update_deploy_plan',
              params: {
                plan_id: plan.plan_id,
                updates: '{"env":{"KEY":"value"}}',
              },
            },
          },
          _agent_guidance: {
            message: 'The generated deploy plan needs more input before execution.',
            next_steps: [
              `Provide missing values: ${plan.missing.join(', ')}`,
              'Call update_deploy_plan with the values, then execute_deploy_plan',
              'Or call deploy again with env_vars including the missing keys',
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
        result = await appCtx.planEngine.executePlan(plan.plan_id, undefined, toolSessionId);
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
        return {
          plan_id: plan.plan_id,
          status: 'failed',
          project_name: result.project_name,
          error: result.error,
          diagnostic_call: {
            tool: 'openlander_deploy',
            arguments: {
              action: 'debug_build_error',
              params: { project_name: result.project_name },
            },
          },
          _agent_guidance: {
            message: 'Deployment failed.',
            next_steps: [
              'Call debug_build_error for AI diagnosis',
              'Fix the issue, then call deploy again to retry',
            ],
          },
        };
      }

      if (!wait) {
        const nextSteps = ['Poll get_deploy_status to monitor build progress'];
        if (expose || domain) {
          nextSteps.push(
            'expose/domain require wait=true. After deploy completes, call expose_public or map_domain separately.',
          );
        }
        return {
          plan_id: plan.plan_id,
          status: 'building',
          project_name: result.project_name,
          project_id: result.project_id,
          estimated_seconds: result.estimated_seconds,
          status_call: deployStatusCall(result.project_name),
          _agent_guidance: {
            message: 'Deployment started.',
            next_steps: nextSteps,
          },
        };
      }

      const projectId = result.project_id;
      if (!projectId) {
        return {
          plan_id: plan.plan_id,
          status: 'building',
          project_name: result.project_name,
          estimated_seconds: result.estimated_seconds,
          status_call: deployStatusCall(result.project_name),
          _agent_guidance: {
            message: 'Deployment started.',
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
          if (domain) {
            try {
              await appCtx.cloudflare.createTunnel(proj.id, domain);
              extra.domain = domain;
              extra.domain_url = `https://${domain}`;
            } catch (err) {
              warnings.push(
                `domain mapping failed: ${err instanceof Error ? err.message : String(err)}`,
              );
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
          resolve({
            plan_id: plan.plan_id,
            status: 'done',
            project_name: result.project_name,
            project_id: projectIdOverride ?? projectId,
            status_call: deployStatusCall(result.project_name),
            urls: payload.url ? [payload.url] : getProjectUrls(result.project_name),
            internal_host: projectContainerName(result.project_name),
            docker_host: getDockerHostType(),
            ...(payload.totalDurationMs
              ? { elapsed: `${String(Math.round(payload.totalDurationMs / 1000))}s` }
              : {}),
            ...(timedOut ? { timeout: true } : {}),
            ...postDeploy,
            ...(postDeployWarnings && postDeployWarnings.length > 0
              ? { warnings: postDeployWarnings }
              : {}),
          });
        };

        const resolveFailed = (
          payload: { error?: string; buildLog?: string },
          timedOut: boolean,
        ): void => {
          if (settled) return;
          settled = true;
          cleanup();
          const job = appCtx.jobManager.getStatus(projectId);
          resolve({
            plan_id: plan.plan_id,
            status: 'failed',
            project_name: result.project_name,
            error: payload.error ?? job?.errorSummary,
            status_call: deployStatusCall(result.project_name),
            diagnostic_call: {
              tool: 'openlander_deploy',
              arguments: {
                action: 'debug_build_error',
                params: { project_name: result.project_name },
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
            _agent_guidance: {
              message: 'Deployment failed.',
              next_steps: [
                ...(!job?.autoDiagnosis ? ['Call debug_build_error for AI diagnosis'] : []),
                'Fix the issue, then call deploy again to retry',
              ],
            },
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
            status_call: deployStatusCall(result.project_name),
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
          if (expose || domain || targetProjectId) {
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
            if (expose || domain || targetProjectId) {
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
            arguments: {
              action: 'get_deploy_plan',
              params: { plan_id: planId },
            },
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
            `All containers are on the shared Docker network ("${SHARED_NETWORK_NAME}"). Do NOT create Docker networks manually.`,
            'For inter-container communication, use http://ol-{project-name}:{port} (DNS auto-resolved).',
            'Networks are auto-managed by OpenLander. Manual docker network commands will cause conflicts.',
          ],
        },
      });
    },
  },
];
