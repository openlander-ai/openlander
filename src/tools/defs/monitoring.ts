import { createModuleLogger } from '../../lib/logger.js';
import { ProjectNotFoundError } from '../../errors.js';
import { formatStatsSummary, getSystemStats } from '../../monitor/stats.js';
import { getPostmortemInstance } from '../../monitor/postmortem.js';
import {
  dismissAlertSchema,
  getAlertsSchema,
  getLogsSchema,
  getPostmortemSchema,
  getProjectStatsSchema,
  getSystemStatsSchema,
  listPostmortemsSchema,
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
        const container = appCtx.docker.getClient().getContainer(project.container_id);
        const stats = await container.stats({ stream: false });
        const inspect = await container.inspect();
        // Calculate CPU percentage
        const cpuDelta =
          stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const cpuCount =
          (stats.cpu_stats.cpu_usage.percpu_usage as unknown as { length?: number } | undefined)
            ?.length ?? 1;
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
    name: 'list_postmortems',
    riskLevel: 'low',
    description:
      'List generated postmortem reports. Returns id, projectId, createdAt, and resolved status for each.',
    mcpDescription: 'List all generated postmortem reports.',
    inputSchema: listPostmortemsSchema,
    execute: () => {
      const generator = getPostmortemInstance();
      if (!generator) {
        return Promise.resolve({
          count: 0,
          postmortems: [],
          _agent_guidance: {
            message: 'Postmortem generator not initialized.',
            next_steps: ['Check if the system is fully started'],
          },
        });
      }
      const postmortems = generator.listPostmortems();
      return Promise.resolve({
        count: postmortems.length,
        postmortems,
      });
    },
  },
  {
    name: 'get_postmortem',
    riskLevel: 'low',
    description:
      'Get a specific postmortem report by ID or project name. Returns the full markdown report with timeline, root cause analysis, and remediation steps.',
    mcpDescription: 'Get a specific postmortem report by ID or project name.',
    inputSchema: getPostmortemSchema,
    execute: (args) => {
      const generator = getPostmortemInstance();
      if (!generator) {
        return Promise.resolve({
          error: 'Postmortem generator not initialized',
          _agent_guidance: {
            message: 'Postmortem generator not initialized.',
            next_steps: ['Check if the system is fully started'],
          },
        });
      }
      const identifier = args['identifier'] as string;
      const postmortem = generator.getPostmortem(identifier);
      if (!postmortem) {
        return Promise.resolve({
          error: `Postmortem not found for identifier: ${identifier}`,
          _agent_guidance: {
            message: 'Postmortem not found.',
            next_steps: [
              'Use list_postmortems to see available postmortems',
              'Check the project name or ID',
            ],
          },
        });
      }
      return Promise.resolve({
        id: postmortem.id,
        projectId: postmortem.projectId,
        projectName: postmortem.projectName,
        markdown: postmortem.markdown,
        createdAt: postmortem.createdAt.toISOString(),
      });
    },
  },
];
