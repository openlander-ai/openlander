import net from 'node:net';
import { createModuleLogger } from '../../lib/logger.js';
import {
  OpenLanderError,
  ProjectNotFoundError,
  ServiceNotFoundError,
  ServiceOperationUnsupportedError,
} from '../../errors.js';
import { MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import { deployableServiceIdToProjectId } from '../../db/service-ids.js';
import { formatStatsSummary, getSystemStats } from '../../monitor/stats.js';
import { BUILD_TIME_PREFIXES } from '../../pipeline/build-args.js';
import {
  diagnoseServiceSchema,
  dismissAlertSchema,
  getAlertsSchema,
  getLogsSchema,
  getProjectStatsSchema,
  getSystemStatsSchema,
  mcpActionStatusSchema,
  probeHostSchema,
} from './schemas.js';
import type { ToolDef } from './types.js';
import type { ToolContext } from './types.js';

const log = createModuleLogger('monitoring-tools');

type AppCtx = ToolContext['appCtx'];
type ServiceRow = NonNullable<Awaited<ReturnType<AppCtx['db']['getService']>>>;
type ProjectRow = NonNullable<Awaited<ReturnType<AppCtx['db']['getProject']>>>;
type DeployLogRow = Awaited<ReturnType<AppCtx['db']['getDeployLogs']>>[number];

interface ResolvedDeployableService {
  service: ServiceRow;
  project: ProjectRow;
  runtimeProject: ProjectRow;
}

export const monitoringToolDefs: ToolDef[] = [
  {
    name: 'get_logs',
    riskLevel: 'low',
    description:
      'Get recent container stdout/stderr logs for a deployable project/app container. Use when user asks about errors, crashes, or app behavior. Returns { project, logs } where logs is a string of recent lines (agent default: 20, MCP default: 50). Errors: PROJECT_NOT_FOUND. If logs show a build error, call get_build_log for the raw build output. For deployment history (past deploys, triggers, durations), use get_deploy_history instead.',
    mcpDescription: 'Get recent deployable project logs. MCP default is 50 lines.',
    inputSchema: getLogsSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const projectName = args['project_name'] as string;
      const project = await appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      const lines = (args['lines'] as number | undefined) ?? (context.target === 'agent' ? 20 : 50);
      const logs = await appCtx.pipeline.getLogs(project.id, lines);
      return { project: projectName, logs };
    },
  },
  {
    name: 'get_system_stats',
    riskLevel: 'low',
    description:
      'Get host system resource usage — CPU load, memory, and disk space. Use when user asks about server health, capacity, or before deploying to check if resources are available. Returns { summary, cpu, memory, disk } with percentage usage and warnings. Always available, no errors.',
    mcpDescription: 'Get host system resource usage.',
    inputSchema: getSystemStatsSchema,
    execute: () => {
      const stats = getSystemStats();
      return Promise.resolve({
        summary: formatStatsSummary(stats),
        ...stats,
      });
    },
  },
  {
    name: 'get_alerts',
    riskLevel: 'low',
    description:
      'Get current system alerts for resource issues, inactive projects, and container problems. Returns active alerts with severity, message, and suggested actions. Use when user asks about system health, problems, or "show alerts". Always available.',
    mcpDescription: 'Get active system alerts and notifications.',
    inputSchema: getAlertsSchema,
    execute: (_args, context) => {
      const alerts = context.appCtx.alertMonitor.getActiveAlerts();
      return Promise.resolve({
        count: alerts.length,
        alerts: alerts.map((alert) => ({
          id: alert.id,
          type: alert.type,
          severity: alert.severity,
          message: alert.message,
          suggestion: alert.suggestion,
          createdAt: alert.createdAt.toISOString(),
        })),
      });
    },
  },
  {
    name: 'dismiss_alert',
    riskLevel: 'medium',
    description:
      'Dismiss a specific alert by ID so it no longer appears in active alerts. Use when user acknowledges an alert. Returns { status, alertId }.',
    mcpDescription: 'Dismiss an active alert by ID.',
    inputSchema: dismissAlertSchema,
    execute: (args, context) => {
      const alertId = args['alert_id'] as string;
      context.appCtx.alertMonitor.dismissAlert(alertId);
      return Promise.resolve({ status: 'dismissed', alertId });
    },
  },
  {
    name: 'get_project_stats',
    riskLevel: 'low',
    description:
      'Get CPU, memory, restarts, and uptime for a specific project container. Use when user asks about resource usage, container health, or performance metrics. Returns { cpu_percent, memory_usage_mb, memory_limit_mb, restarts, uptime_seconds, status }. Errors: PROJECT_NOT_FOUND.',
    mcpDescription: 'Get per-container CPU, memory, restarts, and uptime for a project.',
    inputSchema: getProjectStatsSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const projectName = args['project_name'] as string;
      const project = await appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      // PR 4.5: canonical-first read of runtime fields with `??` fallback to
      // legacy `projects` columns through migration 0012.
      const deployable = await appCtx.db.getDeployableForProject(project.id);
      const status = deployable?.status ?? project.status;
      const containerId = deployable?.container_id ?? project.container_id;

      if (!containerId || status !== 'running') {
        return {
          project: projectName,
          status,
          cpu_percent: 0,
          memory_usage_mb: 0,
          memory_limit_mb: 0,
          restarts: 0,
          uptime_seconds: 0,
        };
      }

      try {
        const stats = (await appCtx.docker.getContainerStats(containerId)) as {
          cpu_stats: {
            cpu_usage: { total_usage: number; percpu_usage?: unknown };
            system_cpu_usage: number;
          };
          precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
          memory_stats: { usage: number; limit: number };
        };
        const inspect = await appCtx.docker.inspectContainer(containerId);
        // Calculate CPU percentage
        const cpuDelta =
          stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const cpuCount =
          (stats.cpu_stats.cpu_usage.percpu_usage as { length?: number } | undefined)?.length ?? 1;
        const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;
        // Convert bytes to MB
        const memoryUsageMb = Math.round((stats.memory_stats.usage / 1024 / 1024) * 10) / 10;
        const memoryLimitMb = Math.round((stats.memory_stats.limit / 1024 / 1024) * 10) / 10;

        // Get restart count
        const restarts = inspect.RestartCount || 0;

        // Calculate uptime in seconds
        const startedAt = new Date(inspect.State.StartedAt).getTime();
        const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);

        return {
          project: projectName,
          status,
          cpu_percent: Math.round(cpuPercent * 10) / 10,
          memory_usage_mb: memoryUsageMb,
          memory_limit_mb: memoryLimitMb,
          restarts,
          uptime_seconds: uptimeSeconds,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn({ err, projectName, containerId }, 'Failed to fetch container stats');
        return {
          project: projectName,
          status,
          cpu_percent: 0,
          memory_usage_mb: 0,
          memory_limit_mb: 0,
          restarts: 0,
          uptime_seconds: 0,
          error: `Stats unavailable: ${errMsg}`,
          _agent_guidance: {
            message: 'Container stats could not be retrieved.',
            next_steps: [
              'Verify the container is running with get_logs',
              'Try redeploying if the container crashed',
            ],
          },
        };
      }
    },
  },
  {
    name: 'diagnose_service',
    riskLevel: 'low',
    description:
      'Diagnose a deployable app/worker service in one MCP call. Returns service/source summary, masked env key inventory, build-time env warnings, sanitized recent deployment status/log tail, container status, sanitized service logs, local HTTP probe, dependency probes, and recommended next actions. Use this after redeploy_app or get_deploy_status reports a failure, timeout, DB connection problem, or confusing runtime behavior. For raw container logs only use get_logs; for full untruncated build output use get_build_log.',
    mcpDescription:
      'One-shot service diagnostics after deploy/runtime failures. For raw logs use get_logs; for full build output use get_build_log.',
    inputSchema: diagnoseServiceSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const { service, project, runtimeProject } = await resolveDeployableServiceForDiagnosis(
        args,
        context,
      );
      const lines = (args['lines'] as number | undefined) ?? 80;
      const timeoutMs = (args['timeout_ms'] as number | undefined) ?? 5000;
      const pathArg = (args['path'] as string | undefined)?.trim();
      const probePathSource = pathArg || service.health_check_path || '/';
      const probePath = probePathSource.startsWith('/') ? probePathSource : `/${probePathSource}`;

      const [groupEnv, serviceEnv, deployLogs] = await Promise.all([
        appCtx.db.getEnvVars(project.id),
        appCtx.db.getEnvVarsForService(project.id, service.id),
        appCtx.db.getDeployLogs(runtimeProject.id, 5),
      ]);
      const effectiveEnv = { ...groupEnv, ...serviceEnv };

      const container = await summarizeContainer(appCtx, service);
      const runtimeLogs = await readServiceLogs(appCtx, runtimeProject.id, lines);
      const recentDeployment = summarizeRecentDeployments(deployLogs);
      const buildDiagnostics = diagnoseBuildTimeEnv(effectiveEnv, deployLogs);
      const httpCheck = await probeServiceHttp(service, probePath, timeoutMs);
      const dependencies = await probeEnvDependencies(appCtx, effectiveEnv, timeoutMs);
      const nextSteps = buildDiagnoseNextSteps({
        service,
        recentDeployment,
        buildDiagnostics,
        container,
        httpCheck,
        dependencies,
      });

      return {
        project: {
          id: project.id,
          name: project.name,
          runtimeProjectId: runtimeProject.id,
        },
        service: {
          id: service.id,
          name: service.name,
          kind: service.kind,
          source: service.source,
          status: service.status,
          repoUrl: sanitizeRepoUrl(service.repo_url),
          image: service.image_url ?? service.image_tag ?? null,
          dockerfilePath: service.dockerfile_path,
          dockerTarget: service.docker_target,
          buildContext: service.build_context,
          assignedPort: service.assigned_port,
          containerPort: service.container_port,
        },
        env: summarizeEnvKeys(groupEnv, serviceEnv),
        buildTimeEnv: buildDiagnostics,
        recentDeployment,
        container,
        logs: runtimeLogs,
        httpCheck,
        dependencies,
        _agent_guidance: {
          next_steps: nextSteps,
        },
      };
    },
  },
  {
    name: 'probe_host',
    riskLevel: 'low',
    description:
      'Check if a host, URL, or container endpoint is reachable. Use internal=true to probe from inside the Docker network (container-to-container DNS).',
    mcpDescription: 'Check connectivity to a host, URL, or container endpoint.',
    inputSchema: probeHostSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const target = args['target'] as string;
      const portArg = args['port'] as number | undefined;
      const protocolArg = args['protocol'] as 'http' | 'https' | 'tcp' | undefined;
      const pathArg = (args['path'] as string | undefined) ?? '/';
      const timeoutMs = (args['timeout_ms'] as number | undefined) ?? 5000;
      const internal = (args['internal'] as boolean | undefined) ?? false;

      const { protocol, host, port, url } = resolveTarget(target, portArg, protocolArg, pathArg);
      const targetResolved = url ?? `${protocol}://${host}:${String(port)}`;
      const startedAt = Date.now();

      if (internal) {
        return probeInternal(appCtx, protocol, host, port, pathArg, timeoutMs, targetResolved);
      }

      if (protocol === 'tcp') {
        return probeTcp(host, port, timeoutMs, targetResolved);
      }

      return probeHttp(
        url ?? `${protocol}://${host}:${String(port)}${pathArg}`,
        timeoutMs,
        protocol,
        targetResolved,
        startedAt,
      );
    },
  },
  {
    name: 'mcp_action_status',
    riskLevel: 'low',
    description: 'Check the status of a destructive MCP action that was routed to human approval.',
    mcpDescription: 'Check pending/approved/rejected/failed status for a held MCP action.',
    inputSchema: mcpActionStatusSchema,
    execute: async (args, context) => {
      const actionRunId = args['action_run_id'] as string;
      const run = await context.appCtx.db.getActionRun(actionRunId);
      if (!run) {
        return {
          status: 'not_found',
          error: 'NOT_FOUND',
          code: 'NOT_FOUND',
          message: `Action run ${actionRunId} was not found.`,
        };
      }

      const status =
        run.approval_status === 'rejected'
          ? 'rejected'
          : run.status === 'pending_approval'
            ? run.approval_status === 'approved'
              ? 'approved_executing'
              : 'pending'
            : run.status;

      return {
        actionRunId: run.id,
        status,
        projectId: run.project_id || null,
        approvalStatus: run.approval_status,
        approvalTool: run.approval_tool,
        error: run.error_message,
        requestedAt: run.approval_requested_at,
        resolvedAt: run.approval_resolved_at,
      };
    },
  },
];

function isManagedService(kind: string): boolean {
  return (MANAGED_SERVICE_KINDS as readonly string[]).includes(kind);
}

async function resolveProjectScope(
  projectName: string,
  context: ToolContext,
): Promise<ProjectRow | undefined> {
  if (!projectName) return undefined;
  return (
    (await context.appCtx.db.getProject(projectName)) ??
    (await context.appCtx.db.getProjectByName(projectName))
  );
}

async function serviceSelectionCandidates(
  services: ServiceRow[],
  context: ToolContext,
): Promise<Array<Record<string, unknown>>> {
  return Promise.all(
    services.map(async (service) => {
      const project = await context.appCtx.db.getProject(service.project_id);
      return {
        serviceId: service.id,
        serviceName: service.name,
        projectId: service.project_id,
        projectName: project?.name ?? service.project_id,
        kind: service.kind,
        source: service.source,
      };
    }),
  );
}

async function resolveDeployableServiceForDiagnosis(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ResolvedDeployableService> {
  const serviceId = typeof args.service_id === 'string' ? args.service_id.trim() : '';
  const serviceName = typeof args.service_name === 'string' ? args.service_name.trim() : '';
  const projectName = typeof args.project_name === 'string' ? args.project_name.trim() : '';

  let service: ServiceRow | undefined;
  let projectScope: ProjectRow | undefined;

  if (serviceId) {
    service = await context.appCtx.db.getService(serviceId);
  } else if (serviceName) {
    projectScope = await resolveProjectScope(projectName, context);
    if (projectName && !projectScope) {
      throw new ProjectNotFoundError(projectName);
    }
    const services = await context.appCtx.db.listServices();
    const named = services.filter((item) => item.name === serviceName);
    const projectScopeId = projectScope?.id;
    const scoped = projectScopeId
      ? named.filter((item) => item.project_id === projectScopeId)
      : named;
    const deployable = scoped.filter((item) => !isManagedService(item.kind));
    if (deployable.length > 1) {
      throw new OpenLanderError(
        `Multiple deployable services named '${serviceName}' found. Specify project_name or service_id.`,
        'SERVICE_SELECTION_REQUIRED',
        400,
        {
          serviceName,
          candidates: await serviceSelectionCandidates(deployable, context),
        },
      );
    }
    service = deployable[0] ?? scoped[0];
  } else if (projectName) {
    projectScope = await resolveProjectScope(projectName, context);
    if (!projectScope) {
      throw new ProjectNotFoundError(projectName);
    }
    const deployables =
      typeof context.appCtx.db.getDeployablesByGroup === 'function'
        ? await context.appCtx.db.getDeployablesByGroup(projectScope.id)
        : (await context.appCtx.db.listServices()).filter(
            (item) => item.project_id === projectScope?.id,
          );
    const filtered = deployables.filter((item) => !isManagedService(item.kind));
    if (filtered.length > 1) {
      throw new OpenLanderError(
        `Project '${projectName}' has multiple deployable services. Specify service_id or service_name.`,
        'SERVICE_SELECTION_REQUIRED',
        400,
        {
          projectName,
          candidates: await serviceSelectionCandidates(filtered, context),
        },
      );
    }
    service = filtered[0];
  }

  if (!service) {
    throw new ServiceNotFoundError(serviceId || serviceName || projectName || 'unknown');
  }
  if (isManagedService(service.kind)) {
    throw new ServiceOperationUnsupportedError('diagnose_service', service.kind);
  }

  const project = await context.appCtx.db.getProject(service.project_id);
  if (!project) {
    throw new ProjectNotFoundError(service.project_id);
  }
  if (projectName && projectName !== project.id && projectName !== project.name) {
    throw new ServiceNotFoundError(`${service.name} in ${projectName}`);
  }

  const runtimeProjectId = deployableServiceIdToProjectId(service.id);
  const runtimeProject = (await context.appCtx.db.getProject(runtimeProjectId)) ?? project;
  return { service, project, runtimeProject };
}

function sanitizeRepoUrl(repoUrl: string | null): string | null {
  if (!repoUrl) return null;
  try {
    const parsed = new URL(repoUrl);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? '***' : '';
      parsed.password = parsed.password ? '***' : '';
    }
    return parsed.toString();
  } catch {
    return repoUrl.replace(/:\/\/[^/@]+@/, '://***@');
  }
}

const SECRET_ASSIGNMENT_RE =
  /\b([A-Z0-9_]*(?:DATABASE_URL|REDIS_URL|POSTGRES_URL|MYSQL_URL|MONGO_URL|MONGODB_URI|TOKEN|SECRET|PASSWORD|PASS|PWD|KEY|DSN|URI)[A-Z0-9_]*)\s*=\s*(["']?)[^\s"']+\2/gi;

const FREE_TEXT_SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer ***'],
  [/\bBasic\s+[A-Za-z0-9._~+/-]+=*/gi, 'Basic ***'],
  [/\bgithub_pat_[A-Za-z0-9_-]+\b/g, 'github_pat_***'],
  [/\bgh([pousr])_[A-Za-z0-9_]{8,}\b/g, 'gh$1_***'],
  [/\bxox([baprs])-[A-Za-z0-9-]+\b/g, 'xox$1-***'],
  // Anthropic must precede the OpenAI alternative — `sk-ant-…` would
  // otherwise match the more general `sk-…{20,}` pattern and lose the
  // provider hint in the masked output.
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, 'anthropic_***'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, 'openai_***'],
  [/\b(?:stripe_)?(sk|rk)_(live|test)_[A-Za-z0-9_]+\b/g, '$1_$2_***'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, 'aws_***'],
  [/\bAIza[A-Za-z0-9_-]{35}\b/g, 'google_***'],
  [/\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g, 'sendgrid_***'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, 'jwt_***'],
];

function sanitizeDiagnosticText(value: string | null | undefined): string | null {
  if (!value) return null;
  const sanitizedUrl = sanitizeRepoUrl(value) ?? value;
  return FREE_TEXT_SECRET_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    sanitizedUrl.replace(SECRET_ASSIGNMENT_RE, '$1=***'),
  );
}

function sortedKeys(record: Record<string, string>): string[] {
  return Object.keys(record).sort((a, b) => a.localeCompare(b));
}

function isBuildTimeEnvKey(key: string): boolean {
  return BUILD_TIME_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function summarizeEnvKeys(groupEnv: Record<string, string>, serviceEnv: Record<string, string>) {
  const groupKeys = sortedKeys(groupEnv);
  const serviceKeys = sortedKeys(serviceEnv);
  const effectiveKeys = sortedKeys({ ...groupEnv, ...serviceEnv });
  const buildTimeKeys = effectiveKeys.filter(isBuildTimeEnvKey);
  return {
    count: effectiveKeys.length,
    keys: effectiveKeys,
    groupKeys,
    serviceKeys,
    buildTimeKeys,
    runtimeOnlyKeys: effectiveKeys.filter((key) => !isBuildTimeEnvKey(key)),
    masked: true,
    note: 'Only environment variable keys are returned. Values are intentionally not exposed.',
  };
}

function tailLines(text: string | null | undefined, lines: number): string | null {
  if (!text) return null;
  return text.split(/\r?\n/).slice(-lines).join('\n');
}

function sanitizedTailLines(text: string | null | undefined, lines: number): string | null {
  return tailLines(sanitizeDiagnosticText(text), lines);
}

function summarizeRecentDeployments(logs: DeployLogRow[]) {
  const latest = logs[0];
  return {
    count: logs.length,
    latest: latest
      ? {
          id: latest.id,
          status: latest.status,
          trigger: latest.trigger,
          commitSha: latest.commit_sha,
          commitMessage: latest.commit_message,
          durationMs: latest.duration_ms,
          createdAt: latest.created_at,
          buildLogTail: sanitizedTailLines(latest.build_log, 30),
          buildLogTailSanitized: true,
          fullBuildLogHint: 'Call get_build_log for full raw build output.',
        }
      : null,
    history: logs.slice(0, 5).map((entry) => ({
      id: entry.id,
      status: entry.status,
      trigger: entry.trigger,
      commitSha: entry.commit_sha,
      createdAt: entry.created_at,
    })),
  };
}

function diagnoseBuildTimeEnv(env: Record<string, string>, logs: DeployLogRow[]) {
  const text = logs
    .map((entry) =>
      [entry.build_log, entry.runtime_log, entry.trigger_detail].filter(Boolean).join('\n'),
    )
    .join('\n');
  const effectiveKeys = sortedKeys(env);
  const referencedRuntimeOnly = effectiveKeys.filter(
    (key) => !isBuildTimeEnvKey(key) && new RegExp(`\\b${escapeRegExp(key)}\\b`).test(text),
  );
  const missingAtBuild = referencedRuntimeOnly.filter((key) =>
    new RegExp(
      `${escapeRegExp(key)}[^\\n]{0,80}(is not set|missing|required)|(?:is not set|missing|required)[^\\n]{0,80}${escapeRegExp(key)}`,
      'i',
    ).test(text),
  );

  const warnings: string[] = [];
  if (missingAtBuild.length > 0) {
    warnings.push(
      `${missingAtBuild.join(', ')} exists in runtime env but is not passed to Docker build because it does not use an allowed public build-time prefix.`,
    );
  }

  return {
    allowedPrefixes: BUILD_TIME_PREFIXES,
    buildTimeKeys: effectiveKeys.filter(isBuildTimeEnvKey),
    referencedRuntimeOnlyKeys: referencedRuntimeOnly,
    suspectedMissingBuildTimeKeys: missingAtBuild,
    warnings,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return asRecord(record[key]) ?? {};
}

function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function getNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' ? value : null;
}

async function summarizeContainer(
  appCtx: AppCtx,
  service: ServiceRow,
): Promise<Record<string, unknown>> {
  if (!service.container_id) {
    return {
      present: false,
      running: false,
      serviceStatus: service.status,
      reason: 'service has no container_id',
    };
  }

  try {
    const rawInspect = asRecord(await appCtx.docker.inspectContainer(service.container_id)) ?? {};
    const state = getNestedRecord(rawInspect, 'State');
    const config = getNestedRecord(rawInspect, 'Config');
    return {
      present: true,
      id: service.container_id,
      name: service.container_name ?? getString(rawInspect, 'Name')?.replace(/^\//, '') ?? null,
      running: state['Running'] === true,
      status: getString(state, 'Status'),
      exitCode: getNumber(state, 'ExitCode'),
      error: sanitizeDiagnosticText(getString(state, 'Error')),
      startedAt: getString(state, 'StartedAt'),
      finishedAt: getString(state, 'FinishedAt'),
      restartCount: getNumber(rawInspect, 'RestartCount'),
      image: sanitizeDiagnosticText(
        getString(config, 'Image') ?? service.image_tag ?? service.image_url,
      ),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      present: false,
      running: false,
      id: service.container_id,
      error: sanitizeDiagnosticText(message),
      _agent_guidance: {
        next_steps: ['Container inspect failed. Verify the container still exists on the host.'],
      },
    };
  }
}

async function readServiceLogs(
  appCtx: AppCtx,
  runtimeProjectId: string,
  lines: number,
): Promise<Record<string, unknown>> {
  try {
    return {
      available: true,
      tail: sanitizeDiagnosticText(await appCtx.pipeline.getLogs(runtimeProjectId, lines)),
      sanitized: true,
    };
  } catch (err) {
    return {
      available: false,
      error: sanitizeDiagnosticText(err instanceof Error ? err.message : String(err)),
    };
  }
}

async function probeServiceHttp(
  service: ServiceRow,
  path: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  if (!service.assigned_port) {
    return {
      skipped: true,
      reason: 'service has no assigned host port',
    };
  }
  return probeHttp(
    `http://127.0.0.1:${String(service.assigned_port)}${path}`,
    timeoutMs,
    'http',
    `http://127.0.0.1:${String(service.assigned_port)}${path}`,
    Date.now(),
  );
}

interface DependencyTarget {
  key: string;
  protocol: 'tcp' | 'http' | 'https';
  host: string;
  port: number;
  display: string;
}

function defaultPortForProtocol(protocol: string): number | undefined {
  switch (protocol) {
    case 'postgres:':
    case 'postgresql:':
      return 5432;
    case 'mysql:':
      return 3306;
    case 'redis:':
      return 6379;
    case 'mongodb:':
    case 'mongo:':
      return 27017;
    case 'http:':
      return 80;
    case 'https:':
      return 443;
    default:
      return undefined;
  }
}

function envDependencyTargets(env: Record<string, string>): DependencyTarget[] {
  const targets: DependencyTarget[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!/(URL|URI|DSN|DATABASE|REDIS|POSTGRES|MYSQL|MONGO)/i.test(key)) continue;
    try {
      const parsed = new URL(value);
      const port = parsed.port ? Number(parsed.port) : defaultPortForProtocol(parsed.protocol);
      if (!parsed.hostname || !port || port < 1 || port > 65535) continue;
      const probeProtocol =
        parsed.protocol === 'http:' || parsed.protocol === 'https:'
          ? parsed.protocol.slice(0, -1)
          : 'tcp';
      targets.push({
        key,
        protocol: probeProtocol as 'tcp' | 'http' | 'https',
        host: parsed.hostname,
        port,
        display: `${parsed.protocol}//${parsed.hostname}:${String(port)}`,
      });
    } catch {
      continue;
    }
  }
  return targets.slice(0, 8);
}

async function probeEnvDependencies(
  appCtx: AppCtx,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const targets = envDependencyTargets(env);
  if (targets.length === 0) {
    return { count: 0, checks: [] };
  }

  const checks = await Promise.all(
    targets.map(async (target) => {
      const result =
        target.protocol === 'tcp'
          ? await probeInternal(
              appCtx,
              'tcp',
              target.host,
              target.port,
              '/',
              timeoutMs,
              target.display,
            )
          : await probeHttp(
              `${target.protocol}://${target.host}:${String(target.port)}/`,
              timeoutMs,
              target.protocol,
              target.display,
              Date.now(),
            );
      return {
        key: target.key,
        target: target.display,
        protocol: target.protocol,
        host: target.host,
        port: target.port,
        reachable: result['reachable'] === true,
        error: typeof result['error'] === 'string' ? sanitizeDiagnosticText(result['error']) : null,
      };
    }),
  );

  return { count: checks.length, checks };
}

function buildDiagnoseNextSteps(input: {
  service: ServiceRow;
  recentDeployment: Record<string, unknown>;
  buildDiagnostics: Record<string, unknown>;
  container: Record<string, unknown>;
  httpCheck: Record<string, unknown>;
  dependencies: Record<string, unknown>;
}): string[] {
  const nextSteps: string[] = [];
  const suspected = input.buildDiagnostics['suspectedMissingBuildTimeKeys'];
  if (Array.isArray(suspected) && suspected.length > 0) {
    nextSteps.push(
      `${suspected.join(', ')} is currently runtime-only. If the app reads it during Docker/Next build, change the app so build does not require the secret, or add an explicit safe build-time variable path before retrying redeploy_app.`,
    );
  }

  if (input.container['running'] !== true) {
    nextSteps.push(
      'Container is not running. Check recentDeployment.buildLogTail, then call redeploy_app after fixing the cause.',
    );
  } else if (input.httpCheck['reachable'] === false) {
    nextSteps.push(
      'Container is running but HTTP probe failed. Check logs.tail and verify the service listens on the configured container port/path.',
    );
  }

  const depChecks = asRecord(input.dependencies)?.['checks'];
  if (
    Array.isArray(depChecks) &&
    depChecks.some((item) => asRecord(item)?.['reachable'] === false)
  ) {
    nextSteps.push(
      'One or more declared dependency endpoints are unreachable from Docker. Fix service host/port/env values, then call redeploy_app.',
    );
  }

  if (nextSteps.length === 0) {
    nextSteps.push(
      'No obvious backend issue detected. If behavior is still wrong, inspect logs.tail and recentDeployment.latest.buildLogTail for app-level errors.',
    );
  }
  nextSteps.push(
    'For existing services, use openlander_service.redeploy_app. Use openlander_deploy.deploy_app only for creating a new app.',
  );
  return nextSteps;
}

function resolveTarget(
  target: string,
  portArg: number | undefined,
  protocolArg: 'http' | 'https' | 'tcp' | undefined,
  path: string,
): { protocol: 'http' | 'https' | 'tcp'; host: string; port: number; url?: string } {
  if (target.startsWith('http://') || target.startsWith('https://')) {
    const parsed = new URL(target);
    const protocol = protocolArg ?? (parsed.protocol === 'https:' ? 'https' : 'http');
    const host = parsed.hostname;
    const port =
      portArg ?? (parsed.port ? parseInt(parsed.port, 10) : protocol === 'https' ? 443 : 80);
    const fullPath = parsed.pathname === '/' ? path : parsed.pathname;
    return { protocol, host, port, url: `${protocol}://${host}:${String(port)}${fullPath}` };
  }

  const colonIdx = target.lastIndexOf(':');
  if (colonIdx > 0 && !target.includes('/')) {
    const host = target.slice(0, colonIdx);
    const parsedPort = parseInt(target.slice(colonIdx + 1), 10);
    if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
      const protocol = protocolArg ?? (portArg !== undefined || parsedPort ? 'tcp' : 'http');
      return { protocol, host, port: portArg ?? parsedPort };
    }
  }

  const protocol = protocolArg ?? (portArg !== undefined ? 'tcp' : 'http');
  const port = portArg ?? (protocol === 'https' ? 443 : 80);
  return { protocol, host: target, port };
}

async function probeTcp(
  host: string,
  port: number,
  timeoutMs: number,
  targetResolved: string,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });

    socket.on('connect', () => {
      const latencyMs = Date.now() - startedAt;
      socket.destroy();
      resolve({
        reachable: true,
        latency_ms: latencyMs,
        protocol_used: 'tcp' as const,
        target_resolved: targetResolved,
        _agent_guidance: {
          message: `Target is reachable. ${String(latencyMs)}ms response time.`,
          next_steps: [
            'Use get_logs to check application output',
            'Use get_project_stats to monitor resource usage',
          ],
        },
      });
    });

    socket.on('timeout', () => {
      const latencyMs = Date.now() - startedAt;
      socket.destroy();
      resolve({
        reachable: false,
        latency_ms: latencyMs,
        error: `TCP connection timed out after ${String(timeoutMs)}ms`,
        protocol_used: 'tcp' as const,
        target_resolved: targetResolved,
        _agent_guidance: {
          message: `Target not reachable: TCP connection timed out after ${String(timeoutMs)}ms. Try internal=true to check from within the Docker network.`,
          next_steps: [
            'Try with internal=true to probe from inside the Docker network',
            'Check if the target host and port are correct',
            'Use get_alerts to check for container issues',
          ],
        },
      });
    });

    socket.on('error', (err) => {
      const latencyMs = Date.now() - startedAt;
      socket.destroy();
      const errorMsg = err.message;
      resolve({
        reachable: false,
        latency_ms: latencyMs,
        error: errorMsg,
        protocol_used: 'tcp' as const,
        target_resolved: targetResolved,
        _agent_guidance: {
          message: `Target not reachable: ${errorMsg}. Try internal=true to check from within the Docker network.`,
          next_steps: [
            'Try with internal=true to probe from inside the Docker network',
            'Check if the target host and port are correct',
            'Use get_alerts to check for container issues',
          ],
        },
      });
    });
  });
}

async function probeHttp(
  url: string,
  timeoutMs: number,
  protocol: 'http' | 'https' | 'tcp',
  targetResolved: string,
  startedAt: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual',
    });
    const latencyMs = Date.now() - startedAt;
    const reachable = response.status < 400;

    return {
      reachable,
      status_code: response.status,
      latency_ms: latencyMs,
      protocol_used: protocol,
      target_resolved: targetResolved,
      _agent_guidance: {
        message: reachable
          ? `Target is reachable. ${String(latencyMs)}ms response time.`
          : `Target returned HTTP ${String(response.status)}. The host is reachable but returned an error.`,
        next_steps: reachable
          ? [
              'Use get_logs to check application output',
              'Use get_project_stats to monitor resource usage',
            ]
          : [
              'Check application logs with get_logs',
              'Verify the path is correct',
              'Try internal=true to probe from inside the Docker network',
            ],
      },
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const errorMsg =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `HTTP request timed out after ${String(timeoutMs)}ms`
          : err.message
        : String(err);

    return {
      reachable: false,
      latency_ms: latencyMs,
      error: errorMsg,
      protocol_used: protocol,
      target_resolved: targetResolved,
      _agent_guidance: {
        message: `Target not reachable: ${errorMsg}. Try internal=true to check from within the Docker network.`,
        next_steps: [
          'Try with internal=true to probe from inside the Docker network',
          'Check if the target host is correct',
          'Use get_alerts to check for container issues',
        ],
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildInternalTcpProbeCommand(host: string, port: number, timeoutSec: number): string[] {
  return [
    'sh',
    '-c',
    [
      'host="$1"; port="$2"; timeout="$3"',
      'if command -v nc >/dev/null 2>&1; then',
      '  nc -z -w"$timeout" "$host" "$port"',
      'elif command -v bash >/dev/null 2>&1; then',
      '  if command -v timeout >/dev/null 2>&1; then',
      '    timeout "$timeout" bash -c \'cat < /dev/null > /dev/tcp/$1/$2\' _ "$host" "$port"',
      '  else',
      '    bash -c \'cat < /dev/null > /dev/tcp/$1/$2\' _ "$host" "$port"',
      '  fi',
      'elif command -v node >/dev/null 2>&1; then',
      '  node -e \'const net=require("net"); const host=process.argv[1]; const port=Number(process.argv[2]); const timeout=Number(process.argv[3])*1000; const socket=net.createConnection({host,port,timeout},()=>{socket.destroy(); process.exit(0);}); socket.on("timeout",()=>{socket.destroy(); process.exit(124);}); socket.on("error",()=>process.exit(1));\' "$host" "$port" "$timeout"',
      'else',
      '  echo "No TCP probe tool available: install nc, bash, or node in the exec container" >&2',
      '  exit 127',
      'fi',
    ].join('\n'),
    'openlander-probe',
    host,
    String(port),
    String(timeoutSec),
  ];
}

async function probeInternal(
  appCtx: {
    docker: {
      listManagedContainers(): Promise<{ id: string; status: string }[]>;
      execSimple(
        containerId: string,
        cmd: string[],
      ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
    };
  },
  protocol: 'http' | 'https' | 'tcp',
  host: string,
  port: number,
  path: string,
  timeoutMs: number,
  targetResolved: string,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const containers = await appCtx.docker.listManagedContainers();
  const runningContainer = containers.find((c) => c.status === 'running');

  if (!runningContainer) {
    return {
      reachable: false,
      latency_ms: 0,
      error: 'No running managed containers available for internal probe',
      protocol_used: protocol,
      target_resolved: targetResolved,
      _agent_guidance: {
        message:
          'No running managed containers to execute internal probe from. Deploy a project first.',
        next_steps: [
          'Deploy a project first to have a running container',
          'Try without internal=true to probe from the host',
        ],
      },
    };
  }

  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  let cmd: string[];
  if (protocol === 'tcp') {
    cmd = buildInternalTcpProbeCommand(host, port, timeoutSec);
  } else {
    const url = `${protocol}://${host}:${String(port)}${path}`;
    cmd = ['curl', '-sf', '--max-time', String(timeoutSec), url];
  }

  try {
    const result = await appCtx.docker.execSimple(runningContainer.id, cmd);
    const latencyMs = Date.now() - startedAt;
    const reachable = result.exitCode === 0;
    const output = result.stderr.trim() || result.stdout.trim();
    const probeToolUnavailable = result.exitCode === 127;

    return {
      reachable,
      latency_ms: latencyMs,
      error: reachable
        ? undefined
        : output || `Command exited with code ${String(result.exitCode)}`,
      ...(probeToolUnavailable ? { probe_tool_unavailable: true } : {}),
      protocol_used: protocol,
      target_resolved: targetResolved,
      _agent_guidance: {
        message: reachable
          ? `Target is reachable from inside Docker network. ${String(latencyMs)}ms response time.`
          : probeToolUnavailable
            ? `Internal TCP probe could not run inside the selected container: ${output}.`
            : `Target not reachable from inside Docker network: ${output || 'connection failed'}.`,
        next_steps: reachable
          ? [
              'Use get_logs to check application output',
              'Use get_project_stats to monitor resource usage',
            ]
          : probeToolUnavailable
            ? [
                'Try without internal=true to probe from the host instead',
                'Use a container image that includes nc, bash, or node for internal TCP probes',
                'Check target reachability from another container that has network tools',
              ]
            : [
                'Check if the target container is running',
                'Verify the container name and port are correct',
                'Use get_alerts to check for container issues',
              ],
      },
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const errorMsg = err instanceof Error ? err.message : String(err);
    const probeToolUnavailable = /executable file not found|no such file or directory/i.test(
      errorMsg,
    );
    log.warn({ err, host, port, containerId: runningContainer.id }, 'Internal probe exec failed');

    return {
      reachable: false,
      latency_ms: latencyMs,
      error: errorMsg,
      ...(probeToolUnavailable ? { probe_tool_unavailable: true } : {}),
      protocol_used: protocol,
      target_resolved: targetResolved,
      _agent_guidance: {
        message: probeToolUnavailable
          ? `Internal probe could not start inside the selected container: ${errorMsg}.`
          : `Internal probe failed: ${errorMsg}. The exec container may not have curl/nc installed.`,
        next_steps: probeToolUnavailable
          ? [
              'Try without internal=true to probe from the host instead',
              'Use a container image that includes /bin/sh and network tools for internal probes',
            ]
          : [
              'Try without internal=true to probe from the host instead',
              'Check if the exec container has networking tools installed',
            ],
      },
    };
  }
}
