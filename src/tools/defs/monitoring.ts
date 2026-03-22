import { ProjectNotFoundError } from '../../errors.js';
import { formatStatsSummary, getSystemStats } from '../../monitor/stats.js';
import {
  dismissAlertSchema,
  getAlertsSchema,
  getLogsSchema,
  getProjectStatsSchema,
  getSystemStatsSchema,
} from './schemas.js';
import type { ToolDef } from './types.js';

export const monitoringToolDefs: ToolDef[] = [
  {
    name: 'get_logs',
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
    targets: ['agent'],
  },
  {
    name: 'dismiss_alert',
    description:
      'Dismiss a specific alert by ID so it no longer appears in active alerts. Use when user acknowledges an alert. Returns { status, alertId }.',
    mcpDescription: 'Dismiss an active alert by ID.',
    inputSchema: dismissAlertSchema,
    execute: (args, context) => {
      const alertId = args['alert_id'] as string;
      context.appCtx.alertMonitor.dismissAlert(alertId);
      return Promise.resolve({ status: 'dismissed', alertId });
    },
    targets: ['agent'],
  },
  {
    name: 'get_project_stats',
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
        const container = appCtx.docker.getClient().getContainer(project.container_id);
        const stats = await container.stats({ stream: false });
        const inspect = await container.inspect();

        // Calculate CPU percentage
        const cpuDelta =
          stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const cpuPercent =
          systemDelta > 0
            ? (cpuDelta / systemDelta) * stats.cpu_stats.cpu_usage.percpu_usage.length * 100
            : 0;

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
      } catch (_err) {
        // Return zeros if stats fetch fails
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
    },
  },
];
