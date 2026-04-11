import net from 'node:net';
import { createModuleLogger } from '../../lib/logger.js';
import { ProjectNotFoundError } from '../../errors.js';
import { formatStatsSummary, getSystemStats } from '../../monitor/stats.js';
import {
  dismissAlertSchema,
  getAlertsSchema,
  getLogsSchema,
  getProjectStatsSchema,
  getSystemStatsSchema,
  probeHostSchema,
} from './schemas.js';
import type { ToolDef } from './types.js';

const log = createModuleLogger('monitoring-tools');

export const monitoringToolDefs: ToolDef[] = [
  {
    name: 'get_logs',
    riskLevel: 'low',
    description:
      'Get recent container stdout/stderr logs for a project. Use when user asks about errors, crashes, or app behavior. Returns { project, logs } where logs is a string of the most recent 20 lines. Errors: PROJECT_NOT_FOUND. If logs show a build error, suggest debug_build_error for diagnosis. For deployment history (past deploys, triggers, durations), use get_deploy_history instead.',
    mcpDescription: 'Get recent container logs for a project.',
    inputSchema: getLogsSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const projectName = args['project_name'] as string;
      const project = appCtx.db.getProjectByName(projectName);
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
      const project = appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      if (!project.container_id || project.status !== 'running') {
        return {
          project: projectName,
          status: project.status,
          cpu_percent: 0,
          memory_usage_mb: 0,
          memory_limit_mb: 0,
          restarts: 0,
          uptime_seconds: 0,
        };
      }

      try {
        const stats = (await appCtx.docker.getContainerStats(project.container_id)) as {
          cpu_stats: {
            cpu_usage: { total_usage: number; percpu_usage?: unknown };
            system_cpu_usage: number;
          };
          precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage: number };
          memory_stats: { usage: number; limit: number };
        };
        const inspect = await appCtx.docker.inspectContainer(project.container_id);
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
          status: project.status,
          cpu_percent: Math.round(cpuPercent * 10) / 10,
          memory_usage_mb: memoryUsageMb,
          memory_limit_mb: memoryLimitMb,
          restarts,
          uptime_seconds: uptimeSeconds,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn(
          { err, projectName, containerId: project.container_id },
          'Failed to fetch container stats',
        );
        return {
          project: projectName,
          status: project.status,
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
];

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
    cmd = ['nc', '-z', `-w${String(timeoutSec)}`, host, String(port)];
  } else {
    const url = `${protocol}://${host}:${String(port)}${path}`;
    cmd = ['curl', '-sf', '--max-time', String(timeoutSec), url];
  }

  try {
    const result = await appCtx.docker.execSimple(runningContainer.id, cmd);
    const latencyMs = Date.now() - startedAt;
    const reachable = result.exitCode === 0;

    return {
      reachable,
      latency_ms: latencyMs,
      error: reachable
        ? undefined
        : result.stderr.trim() ||
          result.stdout.trim() ||
          `Command exited with code ${String(result.exitCode)}`,
      protocol_used: protocol,
      target_resolved: targetResolved,
      _agent_guidance: {
        message: reachable
          ? `Target is reachable from inside Docker network. ${String(latencyMs)}ms response time.`
          : `Target not reachable from inside Docker network: ${result.stderr.trim() || 'connection failed'}.`,
        next_steps: reachable
          ? [
              'Use get_logs to check application output',
              'Use get_project_stats to monitor resource usage',
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
    log.warn({ err, host, port, containerId: runningContainer.id }, 'Internal probe exec failed');

    return {
      reachable: false,
      latency_ms: latencyMs,
      error: errorMsg,
      protocol_used: protocol,
      target_resolved: targetResolved,
      _agent_guidance: {
        message: `Internal probe failed: ${errorMsg}. The exec container may not have curl/nc installed.`,
        next_steps: [
          'Try without internal=true to probe from the host instead',
          'Check if the exec container has networking tools installed',
        ],
      },
    };
  }
}
