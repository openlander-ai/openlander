import type { ToolDef } from './types.js';
import type { DeployPlan } from '../../pipeline/deploy-plan/types.js';
import type { PlanUpdates, ExecutePlanResult } from '../../pipeline/deploy-plan/engine.js';

import {
  createDeployPlanSchema,
  updateDeployPlanSchema,
  executeDeployPlanSchema,
} from './schemas.js';

export const deployPlanToolDefs: ToolDef[] = [
  {
    name: 'create_deploy_plan',
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
        repoUrl: args['repo_url'] as string,
        branch: (args['branch'] as string | undefined) ?? undefined,
        name: (args['name'] as string | undefined) ?? undefined,
        envVars,
        preferDockerfile: (args['prefer_dockerfile'] as boolean | undefined) ?? undefined,
        dockerfilePath: (args['dockerfile_path'] as string | undefined) ?? undefined,
        dockerTarget: (args['docker_target'] as string | undefined) ?? undefined,
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
                  'If DATABASE_URL is missing, call provision_database first to auto-create PostgreSQL.',
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
    description:
      'Update a deployment plan with missing values (env vars, Dockerfile selection, service config). Call after create_deploy_plan when status is "needs_input".',
    mcpDescription:
      'Update a deployment plan with missing values. Pass updates as a JSON string with fields like env (environment variables), dockerfile (Dockerfile path), or services (service configuration). Returns updated plan_id, status, and remaining missing values.',
    inputSchema: updateDeployPlanSchema,
    execute: (args, context) => {
      const appCtx = context.appCtx;
      const planId = args['plan_id'] as string;
      const updatesRaw = args['updates'] as string;
      const updates = JSON.parse(updatesRaw) as PlanUpdates;

      const plan: DeployPlan = appCtx.planEngine.updatePlan(planId, updates);

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
    description:
      'Execute a deployment plan. Plan must be in "ready" status. Provisions services, injects env vars, and deploys the application.',
    mcpDescription:
      'Execute a deployment plan asynchronously. Returns immediately with project_id and status. Use get_deploy_status to poll progress. Plan must be in "ready" status. Provisions services, injects env vars, and starts deployment.',
    inputSchema: executeDeployPlanSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const planId = args['plan_id'] as string;

      const deployOnly = (args['deploy_only'] as string[] | undefined) ?? undefined;
      const result: ExecutePlanResult = await appCtx.planEngine.executePlan(planId, deployOnly);

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
              'Call get_build_log for raw build output',
              'Call debug_build_error for AI diagnosis',
              'Fix the issue, then create_deploy_plan + execute_deploy_plan to retry',
            ],
          },
        };
      }
    },
  },
];
