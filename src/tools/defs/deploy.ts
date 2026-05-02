import { nanoid } from 'nanoid';
import {
  CircuitBreakerOpenError,
  DeployLockedError,
  ProjectArchivedError,
  ProjectNotFoundError,
  ProjectRecoveringError,
} from '../../errors.js';
import { eventBus } from '../../events/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { parseDBTimestamp } from '../../lib/parse-db-timestamp.js';
import { getDockerHostType } from '../../pipeline/docker.js';
import { containerName as projectContainerName } from '../../pipeline/helpers.js';
import { getProjectUrls } from '../../pipeline/traefik.js';
import {
  buildDeployLockedResponse,
  buildPolicyRejectionResponse,
  tryAcquireDeployLockOrResponse,
  tryRejectIfNotMutable,
} from './helpers.js';
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

const log = createModuleLogger('tools-defs-deploy');

export const deployToolDefs: ToolDef[] = [
  {
    name: 'preview_deploy',
    riskLevel: 'medium',
    description:
      'Deploy an ephemeral preview environment for a specific branch. Creates a separate container that does not affect the main deployment. Use when user wants to test a PR or feature branch before merging. Returns { success, previewId, branch, url, port, containerId }. The preview is temporary — clean up with cleanup_preview when done.',
    mcpDescription: 'Deploy an ephemeral preview environment for a branch.',
    inputSchema: previewDeploySchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const branch = args['branch'] as string;
      return appCtx.previewDeployer
        .deploy({
          repoUrl: args['repo_url'] as string,
          branch,
          sshKeyPath: appCtx.config.git.sshKeyPath || undefined,
        })
        .then((result) => ({
          ...result,
          branch,
          _agent_guidance: {
            next_steps: ['Call list_previews to see all active preview deployments.'],
          },
        }));
    },
  },
  {
    name: 'rollback_project',
    riskLevel: 'high',
    description:
      'Rollback a project to its previous Docker image. Use when a recent deploy broke something and user wants to revert. Returns { success, projectId, projectName, previousImageTag, rollbackImageTag, containerId, url, port, buildDurationMs } on success, or { success: false, error } on failure. Errors: PROJECT_NOT_FOUND. NO_PREVIOUS_IMAGE is returned in error, not thrown.',
    mcpDescription: 'Rollback a project to its previous image when available.',
    inputSchema: rollbackProjectSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const toolSessionId = `mcp-rollback-${nanoid(12)}`;
      const project = await context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }
      const policyRejection = await tryRejectIfNotMutable(project, context);
      if (policyRejection) {
        return policyRejection;
      }
      const lockResult = await tryAcquireDeployLockOrResponse(project.id, toolSessionId, context);
      if (lockResult) {
        return lockResult;
      }
      // 1.0 GA: replaced global DeployQueue with per-project lock so two
      // different projects can rollback concurrently. The DB lock acquired
      // above by `tryAcquireDeployLockOrResponse` plus this in-memory lock
      // both reject same-project concurrent rollback.
      const memLockAcquired = context.appCtx.agentPool
        ? context.appCtx.agentPool.acquireProjectLock(project.id, toolSessionId)
        : true;
      if (!memLockAcquired) {
        const lock = context.appCtx.agentPool?.getProjectLock(project.id);
        return buildDeployLockedResponse(
          new DeployLockedError(project.id, lock?.sessionId ?? 'unknown'),
        );
      }
      let result;
      try {
        result = await context.appCtx.pipeline.rollback(project.id, undefined, toolSessionId);
      } catch (err) {
        if (err instanceof DeployLockedError) {
          return buildDeployLockedResponse(err);
        }
        // Race-window: project was archived / sent to recovering / circuit
        // tripped between the sync pre-check and the pipeline boundary check.
        if (
          err instanceof ProjectArchivedError ||
          err instanceof ProjectRecoveringError ||
          err instanceof CircuitBreakerOpenError
        ) {
          return buildPolicyRejectionResponse(err, project.name);
        }
        throw err;
      } finally {
        context.appCtx.agentPool?.releaseProjectLock(project.id, toolSessionId);
      }
      return {
        ...result,
        _agent_guidance: result.success
          ? {
              next_steps: [
                'Call get_deploy_status to confirm rollback completed successfully.',
                'Call get_logs to verify the application is running correctly.',
              ],
            }
          : {
              next_steps: [
                'Rollback failed. Check the error field above for details.',
                'Call get_deploy_history to review recent deployment state.',
                'Call get_logs if a container was started to check runtime errors.',
              ],
            },
      };
    },
  },
  {
    name: 'deploy_blue_green',
    riskLevel: 'medium',
    description:
      'Start a zero-downtime blue-green deployment (non-blocking). Returns immediately with { status: "deploying" }. Poll get_deploy_status to track progress. Builds a new version alongside the current one, runs health checks, then switches traffic atomically. Errors: PROJECT_NOT_FOUND, DEPLOY_LOCKED.',
    mcpDescription:
      'Start zero-downtime blue-green deployment (non-blocking). Poll get_deploy_status for progress.',
    inputSchema: deployBlueGreenSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const toolSessionId = `mcp-blue-green-${nanoid(12)}`;
      const healthCheckPath = args['health_check_path'] as string | undefined;
      const project = await context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }
      // Fire-and-forget pre-check: surface archived/recovering/circuit-open
      // immediately instead of returning a fake "deploying" success while
      // the pipeline boundary silently rejects in the background.
      const policyRejection = await tryRejectIfNotMutable(project, context);
      if (policyRejection) {
        return policyRejection;
      }
      const lockResult = await tryAcquireDeployLockOrResponse(project.id, toolSessionId, context);
      if (lockResult) {
        return lockResult;
      }

      void context.appCtx.pipeline
        .redeploy(project.id, {
          strategy: 'blue-green',
          healthCheckPath: healthCheckPath?.trim() || undefined,
          lockSessionId: toolSessionId,
        })
        .catch((err: unknown) => {
          if (err instanceof DeployLockedError) {
            log.warn(
              { err, projectId: project.id },
              'Blue-green deploy skipped: project lock is held',
            );
            return;
          }
          if (
            err instanceof ProjectArchivedError ||
            err instanceof ProjectRecoveringError ||
            err instanceof CircuitBreakerOpenError
          ) {
            log.warn(
              { err, projectId: project.id, code: err.code },
              'Blue-green deploy rejected by mutation policy mid-flight',
            );
            return;
          }
          log.error({ err, projectId: project.id }, 'Blue-green deploy failed');
        })
        .finally(() => {
          return context.appCtx.db
            .releaseDeployLock(project.id, toolSessionId)
            .catch((err: unknown) => {
              log.warn({ err, projectId: project.id }, 'Failed to release blue-green deploy lock');
            });
        });

      return {
        status: 'deploying',
        strategy: 'blue-green',
        project: projectName,
        project_id: project.id,
        lock_session: toolSessionId,
        _agent_guidance: {
          next_steps: [
            'Call get_deploy_status to poll blue-green deployment progress.',
            'Blue-green deploys take 2-5 minutes (build + health check + traffic switch).',
          ],
        },
      };
    },
  },
  {
    name: 'cleanup_preview',
    riskLevel: 'medium',
    description:
      'Remove an ephemeral preview deployment created by preview_deploy. Pass the preview_id that was returned. Use when testing is done or to free resources. Returns { status, previewId }. Silently succeeds if preview was already cleaned up.',
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
    riskLevel: 'low',
    description:
      'List all active preview deployments with branch, URL, port, and creation time. Use to check what previews exist before creating new ones or to find a preview URL. Returns { count, previews[] }. Always available, no errors.',
    mcpDescription: 'List all active preview deployments.',
    inputSchema: listPreviewsSchema,
    execute: (_args, context) => {
      const previews = context.appCtx.previewDeployer.list();
      return Promise.resolve({
        count: previews.length,
        previews: previews.map((preview) => ({
          previewId: preview.previewId,
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
    riskLevel: 'low',
    description:
      'Get real-time deployment status for one or all projects currently being built. Shows phase (queued/cloning/building/starting/done/failed), timing, and progress details. jobs[] may include urls, internal_host, docker_host, completed_at, health (done), build_step/build_step_total/build_step_desc (building), auto_diagnosis (failed), build_log_tail, and timeout. Use when user asks "is it done yet?" or "what is building?" during a deploy. Returns { active, jobs[] }. If no deploys are in progress, returns { active: 0, jobs: [] }. With wait=true: blocks until completion. Without project_name, waits for ALL active deploys to finish.',
    mcpDescription:
      'Get real-time deployment status. During build phase, includes build_step, build_step_total, build_step_desc for progress tracking. Done jobs include urls/internal_host/docker_host/health/completed_at. Failed jobs may include auto_diagnosis and build_log_tail. Wait mode may return timeout=true. IMPORTANT: MCP transport timeout (~30s) overrides the timeout parameter. Prefer polling without wait=true over long waits.',
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
              internal_host: projectContainerName(job.projectName),
              docker_host: getDockerHostType(),
              completed_at: job.completedAt?.toISOString(),
              health: 'unknown',
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
                  ...(!job.buildLogTail ? ['Call get_build_log for raw build output'] : []),
                  ...(!job.autoDiagnosis ? ['Call debug_build_error for AI diagnosis'] : []),
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
        const project = await appCtx.db.getProjectByName(projectName);
        if (!project) {
          const plans = await appCtx.db.listDeployPlans(projectName);
          const activePlan = plans.find((p) => {
            // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
            return p.status === 'executing' || p.status === 'ready' || p.status === 'draft';
          });
          if (activePlan) {
            return {
              active: 1,
              jobs: [
                {
                  project: projectName,
                  phase: 'initializing',
                  status: activePlan.status,
                  plan_id: activePlan.id,
                },
              ],
            };
          }
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

        const buildLockedQueuedResult = (
          currentLockInfo: { session: string; lockedAt: string },
          timedOut = false,
        ) => ({
          active: 1,
          locked: true,
          lock_session: currentLockInfo.session,
          jobs: [
            formatJob({
              projectId: project.id,
              projectName: project.name,
              phase: 'queued',
              startedAt: parseDBTimestamp(currentLockInfo.lockedAt),
            }),
          ],
          ...(timedOut ? { timeout: true } : {}),
        });

        let status = appCtx.jobManager.getStatus(project.id);
        const lockInfo = await appCtx.db.getDeployLockInfo(project.id);

        if (!wait) {
          const result = buildProjectResult(status) as Record<string, unknown>;
          if (lockInfo) {
            result['locked'] = true;
            result['lock_session'] = lockInfo.session;
          }
          if (!status && lockInfo) {
            result['active'] = 1;
            result['jobs'] = [
              formatJob({
                projectId: project.id,
                projectName: project.name,
                phase: 'queued',
                startedAt: parseDBTimestamp(lockInfo.lockedAt),
              }),
            ];
          }
          return result;
        }

        if (status && (status.phase === 'done' || status.phase === 'failed')) {
          return buildProjectResult(status);
        }

        if (lockInfo && !status) {
          return buildLockedQueuedResult(lockInfo);
        }

        const waitStartedAt = Date.now() - 1000;

        return await new Promise((resolve) => {
          let settled = false;

          const cleanup = (): void => {
            clearTimeout(timer);
            clearInterval(dbPollInterval);
            unsubSuccess();
            unsubFailed();
          };

          const resolveFromDeployLog = async (lastLogCreatedAt: string): Promise<void> => {
            if (settled) return;
            settled = true;
            cleanup();

            const dbProject = await appCtx.db.getProjectByName(projectName);
            resolve({
              active: 0,
              jobs: [
                formatJob({
                  projectId: project.id,
                  projectName: project.name,
                  phase: 'done',
                  startedAt: new Date(lastLogCreatedAt),
                  completedAt: new Date(lastLogCreatedAt),
                }),
              ],
              ...(dbProject ? { health: dbProject.status } : {}),
            });
          };

          const matchesProject = (payload: {
            projectId: string;
            parentProjectId?: string;
          }): boolean => payload.projectId === project.id || payload.parentProjectId === project.id;

          const resolveWithCurrent = async (timedOut: boolean): Promise<void> => {
            if (settled) return;
            settled = true;
            cleanup();

            const current = appCtx.jobManager.getStatus(project.id);
            if (current) {
              const lastLog = await appCtx.db.getLastDeployLog(project.id);
              const logIsNewer =
                lastLog &&
                parseDBTimestamp(lastLog.created_at).getTime() > current.startedAt.getTime();
              if (
                logIsNewer &&
                lastLog.status === 'success' &&
                (current.phase === 'failed' || current.phase === 'done')
              ) {
                const freshProject = await appCtx.db.getProjectByName(projectName);
                resolve({
                  active: 0,
                  jobs: [
                    formatJob({
                      projectId: project.id,
                      projectName: project.name,
                      phase: 'done',
                      startedAt: parseDBTimestamp(lastLog.created_at),
                      completedAt: parseDBTimestamp(lastLog.created_at),
                    }),
                  ],
                  ...(freshProject ? { health: freshProject.status } : {}),
                  ...(timedOut ? { timeout: true } : {}),
                });
                return;
              }

              const payload = buildProjectResult(current) as Record<string, unknown>;
              if (timedOut) payload['timeout'] = true;
              resolve(payload);
              return;
            }

            const currentLockInfo = await appCtx.db.getDeployLockInfo(project.id);
            if (currentLockInfo) {
              resolve(buildLockedQueuedResult(currentLockInfo, timedOut));
              return;
            }

            const dbProject = await appCtx.db.getProjectByName(projectName);
            resolve({
              project: projectName,
              status: dbProject?.status ?? 'unknown',
              phase: 'none',
              ...(timedOut ? { timeout: true } : {}),
            });
          };

          const unsubSuccess = eventBus.on('deploy:success', (payload) => {
            if (matchesProject(payload)) void resolveWithCurrent(false);
          });

          const unsubFailed = eventBus.on('deploy:failed', (payload) => {
            if (matchesProject(payload)) void resolveWithCurrent(false);
          });

          const timer = setTimeout(
            () => {
              void resolveWithCurrent(true);
            },
            Math.max(1, timeoutSec) * 1000,
          );

          const pollDeployLog = async (): Promise<void> => {
            if (settled) {
              clearInterval(dbPollInterval);
              return;
            }

            const lastLog = await appCtx.db.getLastDeployLog(project.id);
            if (!lastLog || (lastLog.status !== 'success' && lastLog.status !== 'failed')) {
              return;
            }

            // Only consider logs created after we started waiting
            const logTime = parseDBTimestamp(lastLog.created_at).getTime();
            if (logTime < waitStartedAt) {
              return;
            }

            const currentJob = appCtx.jobManager.getStatus(project.id);
            const logIsNewer = !currentJob || logTime > currentJob.startedAt.getTime();

            if (logIsNewer) {
              if (lastLog.status === 'failed') {
                settled = true;
                cleanup();
                const dbProject = await appCtx.db.getProjectByName(projectName);
                resolve({
                  active: 0,
                  jobs: [
                    formatJob({
                      projectId: project.id,
                      projectName: project.name,
                      phase: 'failed',
                      startedAt: parseDBTimestamp(lastLog.created_at),
                      completedAt: parseDBTimestamp(lastLog.created_at),
                    }),
                  ],
                  ...(dbProject ? { health: dbProject.status } : {}),
                });
              } else {
                void resolveFromDeployLog(lastLog.created_at);
              }
            }
          };

          const dbPollInterval = setInterval(() => {
            void pollDeployLog();
          }, 5000);

          status = appCtx.jobManager.getStatus(project.id);
          if (status && (status.phase === 'done' || status.phase === 'failed')) {
            void resolveWithCurrent(false);
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
    riskLevel: 'low',
    description:
      'Get deployment history for a project. Returns recent deploys with status, trigger, commit, duration. Use to understand why a service is in its current state or to review past deployments.',
    mcpDescription: 'Get deployment history with status, duration, trigger, and commit details.',
    inputSchema: deployHistorySchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const projectName = args['project_name'] as string;
      const limit = (args['limit'] as number | undefined) ?? 10;

      const project = await appCtx.db.getProjectByName(projectName);
      if (!project) throw new ProjectNotFoundError(projectName);

      const logs = await appCtx.db.getDeployLogs(project.id, limit);

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
