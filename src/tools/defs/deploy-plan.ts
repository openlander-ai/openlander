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
      "PREFERRED way to deploy. Analyzes a repo and creates a deployment plan. Returns plan_id, status ('ready' or 'needs_input'), detected services, and missing env vars. If status is 'needs_input', call update_deploy_plan with missing values. If 'ready', call execute_deploy_plan. For subdirectory Dockerfiles, use dockerfile_path — build context is set automatically. For compose repos needing specific services, execute_deploy_plan supports deploy_only param. Upload secret files via upload_secret_file BEFORE executing the plan.",
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
      };
    },
  },
  {
    name: 'update_deploy_plan',
    description:
      'Update a deployment plan with missing values (env vars, Dockerfile selection, service config). Call after create_deploy_plan when status is "needs_input".',
    mcpDescription:
      'Update a deployment plan to resolve \'needs_input\' status. Pass updates as JSON string: {"env": {"provided": {"KEY": "value"}}} for env vars, {"build": {"dockerfile": "path/to/Dockerfile"}} for Dockerfile selection. Returns updated plan with new status. When status becomes \'ready\', call execute_deploy_plan.',
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
      "Execute a deployment plan. Returns IMMEDIATELY with 'building' status — does NOT wait for completion. Use get_deploy_status after estimated_seconds to check result. Use deploy_only param to select specific compose services. Plan must be in 'ready' status — use update_deploy_plan to resolve 'needs_input' first.",
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
        };
      } else {
        return {
          plan_id: result.plan_id,
          status: 'failed',
          error: result.error,
        };
      }
    },
  },
];
