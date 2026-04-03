import type { ToolDef } from './types.js';
import type { DeployPlan } from '../../pipeline/deploy-plan/types.js';
import type { PlanUpdates, ExecutePlanResult } from '../../pipeline/deploy-plan/engine.js';
import { eventBus } from '../../events/index.js';
import { getDockerHostType } from '../../pipeline/docker.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import { getProjectUrls } from '../../pipeline/traefik.js';
import { markMcpDeploy } from '../../pipeline/auto-recovery.js';
import { SHARED_NETWORK_NAME } from '../../config/index.js';

import {
  createDeployPlanSchema,
  updateDeployPlanSchema,
  executeDeployPlanSchema,
  deploySchema,
  validateDeployPlanSchema,
} from './schemas.js';

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
                  'If DATABASE_URL is missing, call create_service with template="postgres" to provision a database with persistent volume.',
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
    riskLevel: 'medium',
    description:
      'Execute a deployment plan. Plan must be in "ready" status. Provisions services, injects env vars, and deploys the application.',
    mcpDescription:
      'Execute a deployment plan asynchronously. Returns immediately with project_id and status. Use get_deploy_status to poll progress. Plan must be in "ready" status. Provisions services, injects env vars, and starts deployment.',
    inputSchema: executeDeployPlanSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const planId = args['plan_id'] as string;

      const deployOnly = (args['deploy_only'] as string[] | undefined) ?? undefined;
      const planRow =
        typeof appCtx.db.getDeployPlan === 'function' ? appCtx.db.getDeployPlan(planId) : undefined;
      if (planRow) {
        const planData = JSON.parse(planRow.plan_json) as DeployPlan;
        if (planData.project_id) {
          markMcpDeploy(planData.project_id);
        }
      }
      let result: ExecutePlanResult;
      try {
        result = await appCtx.planEngine.executePlan(planId, deployOnly);
      } catch (err) {
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
              'Call get_build_log for raw build output',
              'Call debug_build_error for AI diagnosis',
              'Fix the issue, then create_deploy_plan + execute_deploy_plan to retry',
            ],
          },
        };
      }
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
      const envVarsRaw = (args['env_vars'] as string | undefined) ?? undefined;
      const envVars = envVarsRaw ? (JSON.parse(envVarsRaw) as Record<string, string>) : undefined;
      const wait = (args['wait'] as boolean | undefined) ?? true;
      const timeoutSec = (args['timeout'] as number | undefined) ?? 300;

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
          _agent_guidance: {
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
      const result: ExecutePlanResult = await appCtx.planEngine.executePlan(plan.plan_id);

      if (result.project_id) {
        markMcpDeploy(result.project_id);
      }

      if (result.status === 'failed') {
        return {
          plan_id: plan.plan_id,
          status: 'failed',
          project_name: result.project_name,
          error: result.error,
          _agent_guidance: {
            next_steps: [
              'Call debug_build_error for AI diagnosis',
              'Fix the issue, then call deploy again to retry',
            ],
          },
        };
      }

      if (!wait) {
        return {
          plan_id: plan.plan_id,
          status: 'building',
          project_name: result.project_name,
          project_id: result.project_id,
          estimated_seconds: result.estimated_seconds,
          _agent_guidance: {
            next_steps: ['Poll get_deploy_status to monitor build progress'],
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

        const resolveSuccess = (
          payload: { url?: string; totalDurationMs?: number },
          timedOut: boolean,
        ): void => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve({
            plan_id: plan.plan_id,
            status: 'done',
            project_name: result.project_name,
            project_id: projectId,
            urls: payload.url ? [payload.url] : getProjectUrls(result.project_name),
            internal_host: projectContainerName(result.project_name),
            docker_host: getDockerHostType(),
            ...(payload.totalDurationMs
              ? { elapsed: `${String(Math.round(payload.totalDurationMs / 1000))}s` }
              : {}),
            ...(timedOut ? { timeout: true } : {}),
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
              next_steps: [
                'Call debug_build_error for AI diagnosis',
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
          if (matchesProject(payload)) resolveSuccess(payload, false);
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
          if (currentJob.phase === 'done') resolveSuccess({}, false);
          else resolveFailed({ error: currentJob.errorSummary }, false);
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
    execute: (args, context) => {
      const appCtx = context.appCtx;
      const planId = args['plan_id'] as string;

      const row = appCtx.db.getDeployPlan(planId);
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
            message: `${String(needsCreation.length)} service(s) will be auto-provisioned: ${needsCreation.map((s) => s.type).join(', ')}`,
          });
        }
        const reusable = plan.services.filter((s) => s.action === 'reuse');
        if (reusable.length > 0) {
          checks.push({
            name: 'services',
            status: 'pass',
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
