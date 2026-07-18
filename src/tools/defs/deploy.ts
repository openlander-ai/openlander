import { ProjectNotFoundError } from '../../errors.js';
import { eventBus } from '../../events/index.js';
import { parseDBTimestamp } from '../../lib/parse-db-timestamp.js';
import {
  deployableServiceIdToProjectId,
  projectIdToDeployableServiceId,
} from '../../db/service-ids.js';
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
import type { DeployLogRow, ProjectRow } from '../../db/types.js';
import { loadServiceView, type ServiceView } from '../../db/views/service-view.js';
import type { ToolContext, ToolDef } from './types.js';
import { resolveDeployableTarget } from './deployable-target.js';
import {
  observeRepresentativeTraffic,
  parseRepresentativeTraffic,
  representativeTrafficFailed,
  representativeTrafficToJson,
  representativeTrafficWarning,
} from './representative-traffic.js';
import {
  cleanupPreviewSchema,
  deployHistorySchema,
  deployStatusSchema,
  listPreviewsSchema,
  previewDeploySchema,
} from './schemas.js';

const toolLog = createModuleLogger('tools-defs-deploy');

type AppCtx = ToolContext['appCtx'];
type DeployStatusReadiness = 'healthy' | 'starting' | 'unhealthy' | 'no_healthcheck';

interface DeployStatusReadinessResult {
  readiness: DeployStatusReadiness;
  message?: string;
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

function readinessGuidance(readiness: DeployStatusReadiness): string | undefined {
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

function failedBlueGreenPreservedPreviousVersion(buildLog: string | null | undefined): boolean {
  if (!buildLog) return false;
  return (
    buildLog.includes('Previous version is still serving after failed blue-green deploy') ||
    /Blue-green deploy failed[^.\n]*previous version (?:is )?still serving/i.test(buildLog) ||
    buildLog.includes('[route] Rolled active target back to blue')
  );
}

function previousVersionServingGuidance(): { message: string; next_steps: string[] } {
  return {
    message:
      'Blue-green deploy failed, but the previous version is still serving. Treat this as a safe failed update, not as an outage.',
    next_steps: [
      'Call openlander_monitor.diagnose_service for service/env/container/log diagnostics.',
      'Inspect get_build_log before deciding whether a new update attempt is safe.',
      'Do not immediately retry with strategy="force"; force redeploy can replace the serving version and turn a safe failed update into downtime.',
      'Retry blue-green after fixing the cause, or ask the user before accepting downtime.',
    ],
  };
}

async function inspectContainerReadiness(
  appCtx: AppCtx,
  containerId: string,
): Promise<DeployStatusReadinessResult> {
  try {
    const info = (await appCtx.docker.inspectContainer(containerId)) as ContainerInspectState;
    const state = info.State ?? {};
    if (state.Restarting || state.Running === false) {
      return {
        readiness: 'unhealthy',
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
        message: `Container restarted ${String(restartCount)} times recently. Treat this as a restart loop until diagnose_service/logs confirm the current process is stable.`,
      };
    }

    if (!state.Health) {
      return { readiness: 'no_healthcheck' };
    }
    if (state.Health.Status === 'healthy') {
      return { readiness: 'healthy' };
    }
    if (state.Health.Status === 'unhealthy') {
      return { readiness: 'unhealthy', message: 'Container healthcheck is unhealthy.' };
    }
    return {
      readiness: 'starting',
      message: `Container healthcheck is ${state.Health.Status ?? 'starting'}.`,
    };
  } catch (error) {
    return {
      readiness: 'starting',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

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
          gitCredentialId: args['git_credential_id'] as string | undefined,
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
      'Get deployment status. Prefer service_id/service_name for Application/Compose deploys; project_id/project_name remain compatibility shortcuts for single-workload Projects. Use deploy_id/job_id to look up a completed deploy log. Shows phase (queued/cloning/building/starting/done/failed/cancelled), timing, and progress details. Each job carries a structured status, terminal flag, and elapsed_ms; non-terminal jobs include next_poll_after_ms (suggested poll delay) and a status_call re-lookup envelope. Returns { active, jobs[] }. If no deploys are in progress, returns { active: 0, jobs: [] }. With watch_ms: briefly waits for a change, then returns status=still_running on timeout. With wait=true: blocks until current deploy completion. Without a target, waits for ALL active deploys to finish.',
    mcpDescription:
      'Get current deploy progress by service_id/service_name, compatibility project_id/project_name, or completed history by deploy_id/job_id. Jobs expose status/terminal/elapsed_ms; non-terminal jobs add next_poll_after_ms for poll pacing. In-flight jobs include build progress; completed jobs from deploy logs include status/duration/build_log_tail. Prefer watch_ms for short waits; it returns status=still_running plus status_call on timeout. Wait mode may return timeout=true. IMPORTANT: MCP transport timeout (~30s) overrides the timeout parameter. Prefer polling or watch_ms over long wait=true calls.',
    inputSchema: deployStatusSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const serviceIdTarget = args['service_id'] as string | undefined;
      const serviceNameTarget = args['service_name'] as string | undefined;
      const projectId = args['project_id'] as string | undefined;
      const projectName = args['project_name'] as string | undefined;
      const deployLookupId =
        (args['deploy_id'] as string | undefined) ?? (args['job_id'] as string | undefined);
      const wait = args['wait'] as boolean | undefined;
      const timeoutSec = (args['timeout'] as number | undefined) ?? 300;
      const rawWatchMs = args['watch_ms'] as number | undefined;
      const watchMs =
        typeof rawWatchMs === 'number' && Number.isFinite(rawWatchMs)
          ? Math.min(25000, Math.max(1, Math.trunc(rawWatchMs)))
          : undefined;
      const shouldWait = Boolean(wait) || watchMs !== undefined;
      const waitTimeoutMs = watchMs ?? Math.max(1, timeoutSec) * 1000;

      // Cache of project_id → ServiceView so status/URL projections all use
      // the same service-first read model instead of each caller hand-rolling
      // `deployable?.X ?? project.X`.
      const serviceViewCache = new Map<string, ServiceView | null>();
      const portCache = new Map<string, number | undefined>();
      const resolveServiceView = async (
        projectId: string,
        project?: ProjectRow,
      ): Promise<ServiceView | null> => {
        if (serviceViewCache.has(projectId)) return serviceViewCache.get(projectId) ?? null;
        try {
          const projectRow = project ?? (await appCtx.db.getProject(projectId));
          if (!projectRow) {
            serviceViewCache.set(projectId, null);
            return null;
          }
          const view = await loadServiceView(appCtx.db, projectRow);
          serviceViewCache.set(projectId, view);
          return view;
        } catch {
          serviceViewCache.set(projectId, null);
          return null;
        }
      };
      const resolveAssignedPort = async (
        projectId: string,
        project?: ProjectRow,
      ): Promise<number | undefined> => {
        if (portCache.has(projectId)) return portCache.get(projectId);
        const view = await resolveServiceView(projectId, project);
        const port = view?.assignedPort ?? undefined;
        portCache.set(projectId, port);
        return port;
      };

      const isTerminalPhase = (phase: string): boolean => phase === 'done' || phase === 'failed';

      const jobStatusString = (phase: string): string => {
        if (phase === 'done') return 'success';
        if (phase === 'failed') return 'failed';
        if (phase === 'cancelled') return 'cancelled';
        return 'running';
      };

      const nextPollAfterMs = (phase: string): number => {
        if (phase === 'building') return 5000;
        if (phase === 'starting') return 2000;
        if (phase === 'queued' || phase === 'cloning') return 3000;
        return 3000;
      };

      const isRecord = (value: unknown): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null && !Array.isArray(value);

      const hasInFlightJobs = (payload: Record<string, unknown>): boolean => {
        const active = payload['active'];
        if (typeof active === 'number' && active > 0) {
          return true;
        }

        const jobs = payload['jobs'];
        return (
          Array.isArray(jobs) && jobs.some((job) => isRecord(job) && job['terminal'] === false)
        );
      };

      const inferNextPollMs = (payload: Record<string, unknown>): number => {
        const jobs = payload['jobs'];
        if (!Array.isArray(jobs)) {
          return 3000;
        }

        for (const job of jobs) {
          if (isRecord(job) && typeof job['next_poll_after_ms'] === 'number') {
            return job['next_poll_after_ms'];
          }
        }

        return 3000;
      };

      const addWatchTimeoutMetadata = (
        payload: Record<string, unknown>,
        params: {
          service_id?: string;
          service_name?: string;
          project_id?: string;
          project_name?: string;
          deploy_id?: string;
        },
      ): Record<string, unknown> => {
        if (watchMs === undefined || payload['timeout'] !== true || !hasInFlightJobs(payload)) {
          return payload;
        }

        payload['status'] = 'still_running';
        payload['next_poll_after_ms'] = inferNextPollMs(payload);
        payload['status_call'] = {
          tool: 'openlander_deploy',
          action: 'get_deploy_status',
          params: {
            ...params,
            watch_ms: watchMs,
          },
        };
        return payload;
      };

      const formatJob = (
        job: {
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
        },
        deployId?: string,
      ) => {
        // Pull the cached port (populated by primeAssignedPort before each
        // formatJob call site). When the cache miss happens we still emit a
        // URL, just without the localhost:{port} hint — strictly better than
        // the pre-fix bridge-IP sslip URL.
        const assignedPort = portCache.get(job.projectId);
        const serviceId = job.projectId ? projectIdToDeployableServiceId(job.projectId) : undefined;
        const statusCallParams = serviceId
          ? { service_id: serviceId }
          : { project_id: job.projectId };
        const terminal = isTerminalPhase(job.phase);
        const previousVersionServing =
          job.phase === 'failed' &&
          typeof job.errorSummary === 'string' &&
          /previous version (?:is )?still serving/i.test(job.errorSummary);
        const safeFailedUpdateGuidance = previousVersionServing
          ? previousVersionServingGuidance()
          : undefined;
        return {
          ...(deployId ? { deploy_id: deployId } : {}),
          project_id: job.projectId,
          ...(serviceId ? { service_id: serviceId } : {}),
          name: job.projectName,
          phase: job.phase,
          status: jobStatusString(job.phase),
          terminal,
          elapsed: `${String(Math.round((Date.now() - job.startedAt.getTime()) / 1000))}s`,
          elapsed_ms: Date.now() - job.startedAt.getTime(),
          error: job.errorSummary,
          ...(terminal ? {} : { next_poll_after_ms: nextPollAfterMs(job.phase) }),
          ...(terminal
            ? {}
            : {
                status_call: {
                  tool: 'openlander_deploy',
                  action: 'get_deploy_status',
                  params: statusCallParams,
                },
              }),
          ...(job.phase === 'failed' && serviceId
            ? {
                diagnostic_call: {
                  tool: 'openlander_monitor',
                  action: 'diagnose_service',
                  params: { service_id: serviceId },
                },
              }
            : {}),
          ...(job.phase === 'done'
            ? {
                preferred_url: getPreferredProjectUrl(job.projectName, assignedPort),
                urls: getProjectUrls(job.projectName, assignedPort),
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
                ...(previousVersionServing ? { previous_version_still_serving: true } : {}),
                ...(previousVersionServing
                  ? {
                      warnings: [
                        'Previous version is still serving. Avoid force redeploy until diagnostics identify a safe fix.',
                      ],
                    }
                  : {}),
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
                  ...(safeFailedUpdateGuidance?.message
                    ? { message: safeFailedUpdateGuidance.message }
                    : {}),
                  next_steps: [
                    ...(safeFailedUpdateGuidance?.next_steps ?? [
                      ...(!job.buildLogTail ? ['Call get_build_log for raw build output'] : []),
                      ...(!job.autoDiagnosis
                        ? ['Analyze the build log in your external agent']
                        : []),
                      'Call get_deploy_history for deployment history and trends',
                      'Fix the issue, then create_deploy_plan + execute_deploy_plan to retry',
                    ]),
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
        };
      };

      // Prime the port cache for the supplied project ids so formatJob can
      // surface localhost:{assignedPort} synchronously. Best-effort: a DB
      // error just leaves the cache empty and the URL falls back to the
      // pre-port behavior, never silently picks up a bridge IP.
      const primeAssignedPort = async (projectId: string): Promise<void> => {
        await resolveAssignedPort(projectId);
      };

      const tailLines = (value: string | null | undefined, lines: number): string | null => {
        if (!value) return null;
        return value.split(/\r?\n/).slice(-lines).join('\n');
      };

      const terminalStatusPrecedesLock = (
        status: { phase: string; startedAt: Date; completedAt?: Date } | undefined,
        currentLockInfo: { lockedAt: string } | null,
      ): boolean => {
        if (!status || !currentLockInfo || !isTerminalPhase(status.phase)) {
          return false;
        }
        const lockAtMs = parseDBTimestamp(currentLockInfo.lockedAt).getTime();
        return status.startedAt.getTime() < lockAtMs;
      };

      const formatDeployLogJob = async (log: DeployLogRow) => {
        const service =
          typeof appCtx.db.getService === 'function'
            ? await appCtx.db.getService(log.service_id)
            : undefined;
        const inferredProjectId =
          service?.project_id ?? log.project_id ?? deployableServiceIdToProjectId(log.service_id);
        const project = await appCtx.db.getProject(inferredProjectId);
        const view = await resolveServiceView(inferredProjectId, project);
        const assignedPort = service?.assigned_port ?? view?.assignedPort ?? undefined;
        const routeService = service
          ? {
              name: service.name,
              assigned_port: assignedPort ?? null,
              public_url: service.public_url ?? view?.publicUrl ?? null,
            }
          : undefined;
        const routeName = routeService ? getDeployableServiceRouteName(routeService) : undefined;
        const serviceUrls = routeService ? getDeployableServiceUrls(routeService) : undefined;
        const preferredUrl = routeService
          ? getPreferredDeployableServiceUrl(routeService)
          : undefined;
        const phase =
          log.status === 'success' ? 'done' : log.status === 'failed' ? 'failed' : 'cancelled';
        const previousVersionServing =
          log.status === 'failed' && failedBlueGreenPreservedPreviousVersion(log.build_log);
        const safeFailedUpdateGuidance = previousVersionServing
          ? previousVersionServingGuidance()
          : undefined;
        let representativeTraffic = parseRepresentativeTraffic(log.representative_traffic_json);
        let representativeTrafficPersistenceWarning: string | undefined;
        if (!representativeTraffic && phase === 'done' && routeName) {
          try {
            representativeTraffic = await observeRepresentativeTraffic(appCtx, routeName, '/');
            if (
              representativeTraffic.status !== 'skipped' &&
              typeof appCtx.db.updateDeployLogRepresentativeTraffic === 'function'
            ) {
              await appCtx.db.updateDeployLogRepresentativeTraffic(
                log.id,
                representativeTrafficToJson(representativeTraffic),
              );
            }
          } catch (err) {
            representativeTrafficPersistenceWarning =
              err instanceof Error ? err.message : String(err);
            toolLog.warn(
              { err, deployId: log.id, serviceId: log.service_id, routeName },
              'Failed to observe representative traffic for deploy status',
            );
          }
        }
        const trafficFailure = representativeTrafficFailed(representativeTraffic);
        const trafficWarning = representativeTrafficWarning(representativeTraffic);
        const readiness =
          phase === 'done' && view?.containerId
            ? await inspectContainerReadiness(appCtx, view.containerId)
            : undefined;
        const readinessMessage =
          readiness?.message ?? (readiness ? readinessGuidance(readiness.readiness) : undefined);
        const status =
          trafficFailure || (phase === 'done' && readiness?.readiness === 'unhealthy')
            ? 'unhealthy'
            : log.status;
        const health = trafficFailure
          ? 'unhealthy'
          : (readiness?.readiness ??
            (view?.status === 'idle' ? 'unknown' : (view?.status ?? 'unknown')));
        const completedAt = parseDBTimestamp(log.created_at);
        const durationMs =
          typeof log.duration_ms === 'number' && Number.isFinite(log.duration_ms)
            ? Math.max(0, log.duration_ms)
            : undefined;
        const startedAt =
          durationMs === undefined
            ? log.created_at
            : new Date(completedAt.getTime() - durationMs).toISOString();
        return {
          id: log.id,
          deploy_id: log.id,
          project_id: inferredProjectId,
          service_id: log.service_id,
          name: project?.name ?? inferredProjectId,
          phase,
          status,
          terminal: true,
          trigger: log.trigger,
          commit_sha: log.commit_sha,
          commit_message: log.commit_message,
          duration_ms: log.duration_ms,
          duration:
            typeof log.duration_ms === 'number'
              ? `${String(Math.round(log.duration_ms / 1000))}s`
              : null,
          health,
          ...(readiness ? { readiness: readiness.readiness } : {}),
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
          ...(phase === 'done' && readiness?.readiness === 'unhealthy'
            ? {
                post_deploy_stability: {
                  status: 'unstable',
                  source: 'current_container_inspect',
                  readiness: readiness.readiness,
                  ...(readinessMessage ? { message: readinessMessage } : {}),
                },
              }
            : {}),
          created_at: startedAt,
          completed_at: completedAt.toISOString(),
          ...(phase === 'done'
            ? {
                preferred_url:
                  preferredUrl ??
                  getPreferredProjectUrl(project?.name ?? inferredProjectId, assignedPort),
                urls:
                  serviceUrls ?? getProjectUrls(project?.name ?? inferredProjectId, assignedPort),
                internal_host: projectContainerName(
                  routeName ?? project?.name ?? inferredProjectId,
                ),
                docker_host: getDockerHostType(),
              }
            : {}),
          ...(phase === 'failed' ? { docker_host: getDockerHostType() } : {}),
          ...(previousVersionServing ? { previous_version_still_serving: true } : {}),
          ...(log.status === 'failed' && log.build_log
            ? { build_log_tail: tailLines(log.build_log, 30) }
            : {}),
          status_call: {
            tool: 'openlander_deploy',
            action: 'get_deploy_status',
            params: { deploy_id: log.id },
          },
          ...(log.status === 'failed'
            ? {
                diagnostic_call: {
                  tool: 'openlander_monitor',
                  action: 'diagnose_service',
                  params: { service_id: log.service_id },
                },
              }
            : {}),
          ...(phase === 'done' && (readiness?.readiness === 'unhealthy' || trafficFailure)
            ? {
                diagnostic_call: {
                  tool: 'openlander_monitor',
                  action: 'diagnose_service',
                  params: { service_id: log.service_id },
                },
                warnings: [
                  ...(readiness?.readiness === 'unhealthy'
                    ? [
                        readinessMessage ??
                          'Deployment log is successful, but current container readiness is unhealthy.',
                      ]
                    : []),
                  ...(trafficWarning ? [trafficWarning] : []),
                  ...(representativeTrafficPersistenceWarning
                    ? [
                        `Representative traffic probe was not persisted: ${representativeTrafficPersistenceWarning}`,
                      ]
                    : []),
                ],
              }
            : previousVersionServing
              ? {
                  warnings: [
                    'Previous version is still serving. Avoid force redeploy until diagnostics identify a safe fix.',
                  ],
                }
              : {}),
          _agent_guidance: {
            ...(safeFailedUpdateGuidance?.message
              ? { message: safeFailedUpdateGuidance.message }
              : phase === 'done' && trafficFailure
                ? {
                    message:
                      representativeTraffic?.message ??
                      'Deployment health passed, but representative public traffic failed.',
                  }
                : phase === 'done' && readiness?.readiness === 'unhealthy'
                  ? {
                      message:
                        readinessMessage ??
                        'The deploy log is successful, but the current container is unhealthy.',
                    }
                  : {}),
            next_steps:
              safeFailedUpdateGuidance?.next_steps ??
              (log.status === 'failed'
                ? [
                    'Call get_build_log with this deploy_id for full raw build output.',
                    'Fix the issue, then redeploy the service.',
                  ]
                : phase === 'done' && trafficFailure
                  ? [
                      'Call openlander_monitor.diagnose_service for service/env/container/log diagnostics.',
                      'Do not report end-user success until representative public traffic returns a non-5xx response.',
                    ]
                  : phase === 'done' && readiness?.readiness === 'unhealthy'
                    ? [
                        'Call openlander_monitor.diagnose_service for service/env/container/log diagnostics.',
                        'Inspect logs before reporting the deployment as healthy.',
                      ]
                    : ['Use get_deploy_history for nearby deploys if you need broader context.']),
          },
        };
      };

      if (deployLookupId) {
        const activeStatus = appCtx.jobManager.getStatus(deployLookupId);
        if (activeStatus) {
          const buildActiveLookupResult = async (
            status: typeof activeStatus,
            timedOut = false,
          ): Promise<Record<string, unknown>> => {
            if (status.phase === 'done') await primeAssignedPort(status.projectId);
            const payload = {
              active: status.phase === 'done' || status.phase === 'failed' ? 0 : 1,
              jobs: [formatJob(status, deployLookupId)],
              status: 'found',
              ...(timedOut ? { timeout: true } : {}),
            };
            return addWatchTimeoutMetadata(payload, { deploy_id: deployLookupId });
          };

          if (watchMs !== undefined && !isTerminalPhase(activeStatus.phase)) {
            const watchedProjectId = activeStatus.projectId;
            return await new Promise((resolve) => {
              let settled = false;
              const cleanup = (): void => {
                clearTimeout(timer);
                unsubSuccess();
                unsubFailed();
              };
              const matchesProject = (payload: {
                projectId: string;
                parentProjectId?: string;
              }): boolean =>
                payload.projectId === watchedProjectId ||
                payload.parentProjectId === watchedProjectId;
              const resolveWithCurrent = async (timedOut: boolean): Promise<void> => {
                if (settled) return;
                settled = true;
                cleanup();

                const current =
                  appCtx.jobManager.getStatus(deployLookupId) ??
                  appCtx.jobManager.getStatus(watchedProjectId);
                if (current) {
                  resolve(await buildActiveLookupResult(current, timedOut));
                  return;
                }

                const deployLog = await appCtx.db.getDeployLog(deployLookupId);
                if (deployLog) {
                  resolve({
                    active: 0,
                    jobs: [await formatDeployLogJob(deployLog)],
                    status: 'found',
                    ...(timedOut ? { timeout: true } : {}),
                  });
                  return;
                }

                resolve({
                  active: 0,
                  jobs: [],
                  status: 'not_found',
                  code: 'DEPLOY_STATUS_NOT_FOUND',
                  deploy_id: deployLookupId,
                  ...(timedOut ? { timeout: true } : {}),
                });
              };

              const unsubSuccess = eventBus.on('deploy:success', (payload) => {
                if (matchesProject(payload)) void resolveWithCurrent(false);
              });
              const unsubFailed = eventBus.on('deploy:failed', (payload) => {
                if (matchesProject(payload)) void resolveWithCurrent(false);
              });
              const timer = setTimeout(() => {
                void resolveWithCurrent(true);
              }, waitTimeoutMs);
            });
          }

          return await buildActiveLookupResult(activeStatus);
        }

        const deployLog = await appCtx.db.getDeployLog(deployLookupId);
        if (deployLog) {
          return {
            active: 0,
            jobs: [await formatDeployLogJob(deployLog)],
            status: 'found',
          };
        }

        return {
          active: 0,
          jobs: [],
          status: 'not_found',
          code: 'DEPLOY_STATUS_NOT_FOUND',
          deploy_id: deployLookupId,
          _agent_guidance: {
            next_steps: [
              'If you only have a project name, call get_deploy_history to list recent deploy ids.',
              'If a deploy is currently running, call get_deploy_status with service_id when available.',
            ],
          },
        };
      }

      if (serviceIdTarget || serviceNameTarget || projectId || projectName) {
        let project: ProjectRow;
        let projectForStatus: ProjectRow;
        let targetServiceId: string | undefined;

        if (serviceIdTarget || serviceNameTarget) {
          const resolved = await resolveDeployableTarget(appCtx, args, 'get_deploy_status');
          project = resolved.project;
          projectForStatus = resolved.runtimeProject;
          targetServiceId = resolved.service.id;
        } else {
          const resolvedProject = projectId
            ? await appCtx.db.getProject(projectId)
            : await appCtx.db.getProjectByName(projectName ?? '');
          if (!resolvedProject) {
            if (projectId) {
              throw new ProjectNotFoundError(projectId);
            }
            const missingProjectName = projectName ?? 'unknown';
            const plans = await appCtx.db.listDeployPlans(missingProjectName);
            const activePlan = plans.find((p) => {
              // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
              return p.status === 'executing' || p.status === 'ready' || p.status === 'draft';
            });
            if (activePlan) {
              return {
                active: 1,
                jobs: [
                  {
                    project: missingProjectName,
                    phase: 'initializing',
                    status: activePlan.status,
                    plan_id: activePlan.id,
                  },
                ],
              };
            }
            throw new ProjectNotFoundError(missingProjectName);
          }

          project = resolvedProject;
          const deployables =
            typeof appCtx.db.getDeployablesByGroup === 'function'
              ? await appCtx.db.getDeployablesByGroup(project.id)
              : [];
          const singleDeployable = deployables.length === 1 ? deployables[0] : undefined;
          targetServiceId = singleDeployable?.id;
          const statusProject =
            singleDeployable !== undefined
              ? await appCtx.db.getProject(deployableServiceIdToProjectId(singleDeployable.id))
              : undefined;
          projectForStatus = statusProject ?? project;
        }

        const statusParams = targetServiceId
          ? { service_id: targetServiceId }
          : { project_id: projectForStatus.id };
        const getLastDeployLogForTarget = async (): Promise<DeployLogRow | undefined> =>
          targetServiceId
            ? await appCtx.db.getLastDeployLogForService(targetServiceId)
            : await appCtx.db.getLastDeployLog(projectForStatus.id);

        await primeAssignedPort(projectForStatus.id);

        const buildProjectResult = async (status?: {
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
          if (status && !isActive) {
            const lastLog = await getLastDeployLogForTarget();
            if (lastLog) {
              return {
                active: 0,
                jobs: [await formatDeployLogJob(lastLog)],
              };
            }
          }
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
              projectId: projectForStatus.id,
              projectName: projectForStatus.name,
              phase: 'queued',
              startedAt: parseDBTimestamp(currentLockInfo.lockedAt),
            }),
          ],
          ...(timedOut ? { timeout: true } : {}),
        });

        let status = appCtx.jobManager.getStatus(projectForStatus.id);
        const lockInfo = await appCtx.db.getDeployLockInfo(projectForStatus.id);

        if (!shouldWait) {
          const statusIsStaleForLock = terminalStatusPrecedesLock(status, lockInfo);
          if (statusIsStaleForLock && lockInfo) {
            return buildLockedQueuedResult(lockInfo);
          }
          const result = (await buildProjectResult(status)) as Record<string, unknown>;
          if (lockInfo) {
            result['locked'] = true;
            result['lock_session'] = lockInfo.session;
          }
          if (!status && lockInfo) {
            return buildLockedQueuedResult(lockInfo);
          }
          return result;
        }

        if (terminalStatusPrecedesLock(status, lockInfo) && lockInfo) {
          return buildLockedQueuedResult(lockInfo);
        }

        if (status && (status.phase === 'done' || status.phase === 'failed')) {
          return await buildProjectResult(status);
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

          const resolveFromDeployLog = async (lastLog: DeployLogRow): Promise<void> => {
            if (settled) return;
            settled = true;
            cleanup();

            resolve({
              active: 0,
              jobs: [await formatDeployLogJob(lastLog)],
            });
          };

          const matchesProject = (payload: {
            projectId: string;
            parentProjectId?: string;
          }): boolean =>
            payload.projectId === projectForStatus.id ||
            payload.parentProjectId === projectForStatus.id ||
            payload.parentProjectId === project.id;

          const resolveWithCurrent = async (timedOut: boolean): Promise<void> => {
            if (settled) return;
            settled = true;
            cleanup();

            const current = appCtx.jobManager.getStatus(projectForStatus.id);
            if (current) {
              const lastLog = await getLastDeployLogForTarget();
              const logIsNewer =
                lastLog &&
                parseDBTimestamp(lastLog.created_at).getTime() > current.startedAt.getTime();
              if (
                logIsNewer &&
                lastLog.status === 'success' &&
                (current.phase === 'failed' || current.phase === 'done')
              ) {
                const payload = {
                  active: 0,
                  jobs: [await formatDeployLogJob(lastLog)],
                  ...(timedOut ? { timeout: true } : {}),
                };
                resolve(addWatchTimeoutMetadata(payload, statusParams));
                return;
              }

              const payload = (await buildProjectResult(current)) as Record<string, unknown>;
              if (timedOut) payload['timeout'] = true;
              resolve(addWatchTimeoutMetadata(payload, statusParams));
              return;
            }

            const currentLockInfo = await appCtx.db.getDeployLockInfo(projectForStatus.id);
            if (currentLockInfo) {
              const payload = buildLockedQueuedResult(currentLockInfo, timedOut);
              resolve(addWatchTimeoutMetadata(payload, statusParams));
              return;
            }

            const dbProject = await appCtx.db.getProjectByName(projectForStatus.name);
            const payload = {
              project: projectForStatus.name,
              status: dbProject?.status ?? 'unknown',
              phase: 'none',
              ...(timedOut ? { timeout: true } : {}),
            };
            resolve(addWatchTimeoutMetadata(payload, statusParams));
          };

          const unsubSuccess = eventBus.on('deploy:success', (payload) => {
            if (matchesProject(payload)) void resolveWithCurrent(false);
          });

          const unsubFailed = eventBus.on('deploy:failed', (payload) => {
            if (matchesProject(payload)) void resolveWithCurrent(false);
          });

          const timer = setTimeout(() => {
            void resolveWithCurrent(true);
          }, waitTimeoutMs);

          const pollDeployLog = async (): Promise<void> => {
            if (settled) {
              clearInterval(dbPollInterval);
              return;
            }

            const lastLog = await getLastDeployLogForTarget();
            if (!lastLog || (lastLog.status !== 'success' && lastLog.status !== 'failed')) {
              return;
            }

            // Only consider logs created after we started waiting
            const logTime = parseDBTimestamp(lastLog.created_at).getTime();
            if (logTime < waitStartedAt) {
              return;
            }

            const currentJob = appCtx.jobManager.getStatus(projectForStatus.id);
            const logIsNewer = !currentJob || logTime > currentJob.startedAt.getTime();

            if (logIsNewer) {
              if (lastLog.status === 'failed') {
                settled = true;
                cleanup();
                resolve({
                  active: 0,
                  jobs: [await formatDeployLogJob(lastLog)],
                });
              } else {
                void resolveFromDeployLog(lastLog);
              }
            }
          };

          const dbPollInterval = setInterval(() => {
            void pollDeployLog();
          }, 5000);

          status = appCtx.jobManager.getStatus(projectForStatus.id);
          if (status && (status.phase === 'done' || status.phase === 'failed')) {
            void resolveWithCurrent(false);
          }
        });
      }

      const buildAllResult = async () => {
        const allJobs = appCtx.jobManager.getStatuses();
        const recentJobs = allJobs.filter(
          (j) =>
            (j.phase !== 'done' && j.phase !== 'failed') ||
            (j.completedAt && Date.now() - j.completedAt.getTime() < 5 * 60 * 1000),
        );
        const activeCount = recentJobs.filter(
          (j) => j.phase !== 'done' && j.phase !== 'failed',
        ).length;
        await Promise.all(
          recentJobs.filter((j) => j.phase === 'done').map((j) => primeAssignedPort(j.projectId)),
        );
        return { active: activeCount, jobs: recentJobs.map((j) => formatJob(j)) };
      };

      if (!shouldWait) {
        return await buildAllResult();
      }

      const trackedIds = new Set(
        appCtx.jobManager
          .getStatuses()
          .filter((j) => j.phase !== 'done' && j.phase !== 'failed')
          .map((j) => j.projectId),
      );

      if (trackedIds.size === 0) {
        return await buildAllResult();
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
          void buildAllResult().then((payload) => {
            const out = payload as Record<string, unknown>;
            if (timedOut) out['timeout'] = true;
            resolve(addWatchTimeoutMetadata(out, {}));
          });
        };

        const unsubSuccess = eventBus.on('deploy:success', () => {
          resolveIfAllDone(false);
        });
        const unsubFailed = eventBus.on('deploy:failed', () => {
          resolveIfAllDone(false);
        });

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsubSuccess();
          unsubFailed();
          void buildAllResult().then((payload) => {
            const out = payload as Record<string, unknown>;
            out['timeout'] = true;
            resolve(addWatchTimeoutMetadata(out, {}));
          });
        }, waitTimeoutMs);

        resolveIfAllDone(false);
      });
    },
  },
  {
    name: 'get_deploy_history',
    riskLevel: 'low',
    description:
      'Get deployment history for an Application/Compose service or compatibility Project target. Returns recent deploys with status, trigger, commit, duration. Use service_id when available.',
    mcpDescription: 'Get deployment history with status, duration, trigger, and commit details.',
    inputSchema: deployHistorySchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const serviceId = args['service_id'] as string | undefined;
      const serviceName = args['service_name'] as string | undefined;
      const projectId = args['project_id'] as string | undefined;
      const projectName = args['project_name'] as string | undefined;
      const limit = (args['limit'] as number | undefined) ?? 10;

      let project: ProjectRow;
      let targetServiceId: string | undefined;
      if (serviceId || serviceName) {
        const resolved = await resolveDeployableTarget(appCtx, args, 'get_deploy_history');
        project = resolved.project;
        targetServiceId = resolved.service.id;
      } else {
        const resolvedProject = projectId
          ? await appCtx.db.getProject(projectId)
          : await appCtx.db.getProjectByName(projectName ?? '');
        if (!resolvedProject) throw new ProjectNotFoundError(projectId ?? projectName ?? '');
        project = resolvedProject;
        const deployables =
          typeof appCtx.db.getDeployablesByGroup === 'function'
            ? await appCtx.db.getDeployablesByGroup(project.id)
            : [];
        targetServiceId = deployables.length === 1 ? deployables[0]?.id : undefined;
      }

      const logs = targetServiceId
        ? await appCtx.db.getDeployLogsForService(targetServiceId, limit)
        : await appCtx.db.getDeployLogs(project.id, limit);

      return Promise.resolve({
        project: project.name,
        project_id: project.id,
        ...(targetServiceId ? { service_id: targetServiceId } : {}),
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
