import type { ToolDef } from './types.js';
import type { AppContext } from '../../app.js';
import type { PlanEngine } from '../../pipeline/deploy-plan/engine.js';
import type { DeployPlan } from '../../pipeline/deploy-plan/types.js';
import {
  createDeployPlanSchema,
  updateDeployPlanSchema,
  executeDeployPlanSchema,
} from './schemas.js';

/** Temporary accessor until planEngine is added to AppContext interface */
function getPlanEngine(appCtx: AppContext): PlanEngine {
  return (appCtx as unknown as Record<string, unknown>).planEngine as PlanEngine;
}

export const deployPlanToolDefs: ToolDef[] = [
  {
    name: 'create_deploy_plan',
    description:
      'Analyze a repository and create a deployment plan. Returns a plan with detected services, required env vars, and build config. Use update_deploy_plan to fill missing values before executing.',
    mcpDescription:
      'Analyze a repository and create a deployment plan. Returns plan_id, status, complexity, and lists of missing environment variables and warnings. If status is "needs_input", call update_deploy_plan to provide missing values.',
    inputSchema: createDeployPlanSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const envVarsRaw = (args['env_vars'] as string | undefined) ?? undefined;
      const envVars = envVarsRaw ? (JSON.parse(envVarsRaw) as Record<string, string>) : undefined;

      const plan: DeployPlan = await getPlanEngine(appCtx).createPlan({
        repoUrl: args['repo_url'] as string,
        branch: (args['branch'] as string | undefined) ?? undefined,
        name: (args['name'] as string | undefined) ?? undefined,
        envVars,
        preferDockerfile: (args['prefer_dockerfile'] as boolean | undefined) ?? undefined,
      });

      return {
        plan_id: plan.plan_id,
        status: plan.status,
        complexity: plan.complexity,
        app_name: plan.app.name,
        services: plan.services.length,
        missing: plan.missing,
        warnings: plan.warnings,
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
      const updates = JSON.parse(updatesRaw) as Record<string, unknown>;

      const plan: DeployPlan = getPlanEngine(appCtx).updatePlan(planId, updates);

      return {
        plan_id: plan.plan_id,
        status: plan.status,
        missing: plan.missing,
      };
    },
  },
  {
    name: 'execute_deploy_plan',
    description:
      'Execute a deployment plan. Plan must be in "ready" status. Provisions services, injects env vars, and deploys the application.',
    mcpDescription:
      'Execute a deployment plan. Plan must be in "ready" status. Provisions required services, injects environment variables, and starts the deployment. Returns success status and project ID on success, or error message on failure.',
    inputSchema: executeDeployPlanSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const planId = args['plan_id'] as string;

      const result = await getPlanEngine(appCtx).executePlan(planId);

      if (result.success) {
        return {
          plan_id: planId,
          status: 'completed',
          project_id: result.projectId,
        };
      } else {
        return {
          plan_id: planId,
          status: 'failed',
          error: result.error,
        };
      }
    },
  },
];
