import { ProjectNotFoundError } from '../../errors.js';
import { eventBus } from '../../events/index.js';
import { getDockerHostType } from '../../pipeline/docker.js';
import { getProjectUrls } from '../../pipeline/traefik.js';
import type { ToolDef } from './types.js';
import {
  cleanupPreviewSchema,
  deployBlueGreenSchema,
  deployHistorySchema,
  deployStatusSchema,
  listPreviewsSchema,
  previewDeploySchema,
  rollbackProjectSchema,
} from './schemas.js';

export const deployToolDefs: ToolDef[] = [
  {
    name: 'preview_deploy',
    description:
      'Deploy an ephemeral preview environment for a specific branch. Creates a separate container that does not affect the main deployment. Use when user wants to test a PR or feature branch before merging. Returns { previewId, branch, url, port }. The preview is temporary — clean up with cleanup_preview when done.',
    mcpDescription: 'Deploy an ephemeral preview environment for a branch.',
    inputSchema: previewDeploySchema,
    execute: (args, context) => {
      const appCtx = context.appCtx;
      return appCtx.previewDeployer
        .deploy({
          repoUrl: args['repo_url'] as string,
          branch: args['branch'] as string,
          sshKeyPath: appCtx.config.git.sshKeyPath || undefined,
        })
        .then((result) => ({
          ...result,
          _agent_guidance: {
            next_steps: ['Call list_previews to see all active preview deployments.'],
          },
        }));
    },
  },
  {
    name: 'rollback_project',
    description:
      'Rollback a project to its previous Docker image. Use when a recent deploy broke something and user wants to revert. Returns the rollback result with previous image info. Errors: PROJECT_NOT_FOUND, NO_PREVIOUS_IMAGE if this is the first deploy.',
    mcpDescription: 'Rollback a project to its previous image when available.',
    inputSchema: rollbackProjectSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }
      const result = await context.appCtx.pipeline.rollback(project.id);
      return {
        ...result,
        _agent_guidance: {
          next_steps: [
            'Call get_deploy_status to confirm rollback completed successfully.',
            'Call get_logs to verify the application is running correctly.',
          ],
        },
      };
    },
  },
  {
    name: 'deploy_blue_green',
    description:
      'Deploy a project with zero downtime using blue-green strategy. Builds a new version alongside the current one, runs health checks, then switches traffic atomically. Use when downtime is unacceptable. Returns deployment result with old/new container info. Errors: PROJECT_NOT_FOUND, HEALTH_CHECK_FAILED (new version unhealthy — old version kept running).',
    mcpDescription: 'Deploy with zero downtime using blue-green strategy.',
    inputSchema: deployBlueGreenSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }
      const result = await context.appCtx.blueGreen.deploy(project.id, {
        environmentType: 'production',
      });
      return {
        ...result,
        _agent_guidance: {
          next_steps: [
            'Call get_deploy_status to poll blue-green deployment progress. Do NOT use wait=true — it blocks the agent.',
          ],
        },
      };
    },
  },
  {
    name: 'cleanup_preview',
    description:
      'Remove an ephemeral preview deployment created by preview_deploy. Pass the preview_id that was returned. Use when testing is done or to free resources. Returns { status, previewId }. Errors: PREVIEW_NOT_FOUND if the ID is invalid.',
    mcpDescription: 'Remove an ephemeral preview deployment.',
    inputSchema: cleanupPreviewSchema,
    execute: async (args, context) => {
      const previewId = args['preview_id'] as string;
      await context.appCtx.previewDeployer.cleanup(previewId);
      return { status: 'cleaned_up', previewId };
    },
  },
  {
    name: 'list_previews',
    description:
      'List all active preview deployments with branch, URL, port, and creation time. Use to check what previews exist before creating new ones or to find a preview URL. Returns { count, previews[] }. Always available, no errors.',
    mcpDescription: 'List all active preview deployments.',
    inputSchema: listPreviewsSchema,
    execute: (_args, context) => {
      const previews = context.appCtx.previewDeployer.list();
      return Promise.resolve({
        count: previews.length,
        previews: previews.map((preview) => ({
          branch: preview.branch,
          url: preview.url,
          port: preview.port,
          createdAt: preview.createdAt.toISOString(),
        })),
      });
    },
  },
  {
    name: 'get_deploy_status',
    description:
      'Get real-time deployment status for one or all projects currently being built. Shows phase (queued/cloning/building/starting/done/failed), timing, and build progress details. When building, includes current phase and last few lines of build output. When failed, includes error summary and build log tail. Use when user asks "is it done yet?" or "what is building?" during a deploy. Returns { active, jobs[] }. If no deploys are in progress, returns { active: 0, jobs: [] }. With wait=true: blocks until completion. Without project_name, waits for ALL active deploys to finish.',
    mcpDescription:
      'Get real-time deployment status. During build phase, includes build_step, build_step_total, build_step_desc for progress tracking. Poll this tool to monitor deployment progress. For no_cache rebuilds, use timeout=600 (builds may take 3-5+ minutes).',
    inputSchema: deployStatusSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const projectName = args['project_name'] as string | undefined;
      const wait = args['wait'] as boolean | undefined;
      const timeoutSec = (args['timeout'] as number | undefined) ?? 300;

      const formatJob = (job: {
        projectId: string;
        projectName: string;
        phase: string;
        startedAt: Date;
        completedAt?: Date;
        errorSummary?: string;
        buildLogTail?: string;
        autoDiagnosis?: {
          category: string;
          tier: number;
          cause: string;
          autoFixable: boolean;
          suggestedAction?: string;
        };
        buildStep?: number;
        buildStepTotal?: number;
        buildStepDesc?: string;
      }) => ({
        name: job.projectName,
        phase: job.phase,
        elapsed: `${String(Math.round((Date.now() - job.startedAt.getTime()) / 1000))}s`,
        error: job.errorSummary,
        ...(job.phase === 'done'
          ? {
              urls: getProjectUrls(job.projectName),
              internal_host: `ol-${job.projectName}`,
              docker_host: getDockerHostType(),
              completed_at: job.completedAt?.toISOString(),
              health: (() => {
                try {
                  const project = appCtx.db.getProjectByName(job.projectName);
                  return project?.status ?? 'unknown';
                } catch {
                  return 'unknown';
                }
              })(),
              _agent_guidance: {
                next_steps: [
                  'Call get_logs to confirm container is healthy',
                  'Call get_system_stats if resource issues suspected.',
                ],
              },
            }
          : {}),
        ...(job.phase === 'failed'
          ? {
              docker_host: getDockerHostType(),
              ...(job.autoDiagnosis
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
              _agent_guidance: {
                next_steps: [
                  'Call get_build_log for raw build output',
                  'Call debug_build_error for AI diagnosis',
                  'Call get_deploy_history for deployment history and trends',
                  'Fix the issue, then create_deploy_plan + execute_deploy_plan to retry',
                ],
              },
            }
          : {}),
        ...(job.phase === 'building' ||
        job.phase === 'cloning' ||
        job.phase === 'starting' ||
        job.phase === 'queued'
          ? {
              _agent_guidance: {
                next_steps: [
                  'Deploy is in progress. Poll get_deploy_status periodically to check completion. Do NOT use wait=true — it blocks the agent from responding to the user.',
                ],
              },
            }
          : {}),
        ...(job.buildLogTail && (job.phase === 'building' || job.phase === 'failed')
          ? { build_log_tail: job.buildLogTail }
          : {}),
        ...(job.phase === 'building' &&
        job.buildStep !== undefined &&
        job.buildStepTotal !== undefined
          ? {
              build_step: job.buildStep,
              build_step_total: job.buildStepTotal,
              ...(job.buildStepDesc ? { build_step_desc: job.buildStepDesc } : {}),
            }
          : {}),
      });

      if (projectName) {
        const project = appCtx.db.getProjectByName(projectName);
        if (!project) {
          throw new ProjectNotFoundError(projectName);
        }

        const buildProjectResult = (status?: {
          projectId: string;
          projectName: string;
          phase: string;
          startedAt: Date;
          completedAt?: Date;
          errorSummary?: string;
          buildLogTail?: string;
          buildStep?: number;
          buildStepTotal?: number;
          buildStepDesc?: string;
        }) => {
          const isActive = status && status.phase !== 'done' && status.phase !== 'failed';
          return {
            active: isActive ? 1 : 0,
            jobs: status ? [formatJob(status)] : [],
          };
        };

        let status = appCtx.jobManager.getStatus(project.id);

        if (!wait) {
          return buildProjectResult(status);
        }

        if (status && (status.phase === 'done' || status.phase === 'failed')) {
          return buildProjectResult(status);
        }

        return await new Promise((resolve) => {
          let settled = false;

          const matchesProject = (payload: {
            projectId: string;
            parentProjectId?: string;
          }): boolean => payload.projectId === project.id || payload.parentProjectId === project.id;

          const resolveWithCurrent = (timedOut: boolean): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsubSuccess();
            unsubFailed();

            const current = appCtx.jobManager.getStatus(project.id);
            if (current) {
              const payload = buildProjectResult(current) as Record<string, unknown>;
              if (timedOut) payload['timeout'] = true;
              resolve(payload);
              return;
            }

            const dbProject = appCtx.db.getProjectByName(projectName);
            resolve({
              project: projectName,
              status: dbProject?.status ?? 'unknown',
              phase: 'none',
              ...(timedOut ? { timeout: true } : {}),
            });
          };

          const unsubSuccess = eventBus.on('deploy:success', (payload) => {
            if (matchesProject(payload)) resolveWithCurrent(false);
          });

          const unsubFailed = eventBus.on('deploy:failed', (payload) => {
            if (matchesProject(payload)) resolveWithCurrent(false);
          });

          const timer = setTimeout(
            () => {
              resolveWithCurrent(true);
            },
            Math.max(1, timeoutSec) * 1000,
          );

          status = appCtx.jobManager.getStatus(project.id);
          if (status && (status.phase === 'done' || status.phase === 'failed')) {
            resolveWithCurrent(false);
          }
        });
      }

      const buildAllResult = () => {
        const allJobs = appCtx.jobManager.getStatuses();
        const recentJobs = allJobs.filter(
          (j) =>
            (j.phase !== 'done' && j.phase !== 'failed') ||
            (j.completedAt && Date.now() - j.completedAt.getTime() < 5 * 60 * 1000),
        );
        const activeCount = recentJobs.filter(
          (j) => j.phase !== 'done' && j.phase !== 'failed',
        ).length;
        return { active: activeCount, jobs: recentJobs.map(formatJob) };
      };

      if (!wait) {
        return buildAllResult();
      }

      const trackedIds = new Set(
        appCtx.jobManager
          .getStatuses()
          .filter((j) => j.phase !== 'done' && j.phase !== 'failed')
          .map((j) => j.projectId),
      );

      if (trackedIds.size === 0) {
        return buildAllResult();
      }

      return await new Promise((resolve) => {
        let settled = false;

        const resolveIfAllDone = (timedOut: boolean): void => {
          for (const id of trackedIds) {
            const s = appCtx.jobManager.getStatus(id);
            if (s && s.phase !== 'done' && s.phase !== 'failed') return;
          }
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubSuccess();
          unsubFailed();
          const payload = buildAllResult() as Record<string, unknown>;
          if (timedOut) payload['timeout'] = true;
          resolve(payload);
        };

        const unsubSuccess = eventBus.on('deploy:success', () => {
          resolveIfAllDone(false);
        });
        const unsubFailed = eventBus.on('deploy:failed', () => {
          resolveIfAllDone(false);
        });

        const timer = setTimeout(
          () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsubSuccess();
            unsubFailed();
            const payload = buildAllResult() as Record<string, unknown>;
            payload['timeout'] = true;
            resolve(payload);
          },
          Math.max(1, timeoutSec) * 1000,
        );

        resolveIfAllDone(false);
      });
    },
  },
  {
    name: 'get_deploy_history',
    description:
      'Get deployment history for a project. Returns recent deploys with status, trigger, commit, duration. Use to understand why a service is in its current state or to review past deployments.',
    mcpDescription: 'Get deployment history with status, duration, trigger, and commit details.',
    inputSchema: deployHistorySchema,
    execute: (args, context) => {
      const appCtx = context.appCtx;
      const projectName = args['project_name'] as string;
      const limit = (args['limit'] as number | undefined) ?? 10;

      const project = appCtx.db.getProjectByName(projectName);
      if (!project) throw new ProjectNotFoundError(projectName);

      const logs = appCtx.db.getDeployLogs(project.id, limit);

      return Promise.resolve({
        project: projectName,
        count: logs.length,
        history: logs.map((log) => ({
          id: log.id,
          status: log.status,
          trigger: log.trigger,
          commit_sha: log.commit_sha,
          duration: log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : null,
          created_at: log.created_at,
        })),
      });
    },
  },
];
