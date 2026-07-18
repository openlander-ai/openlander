import { getLogBuffer, type LogEntry } from '../../lib/log-buffer.js';
import { isDockerNotFoundError } from '../../errors.js';
import type {
  ActivityLogRow,
  DeployLogRow,
  ProjectRow,
  ServiceRow,
  TimelineEventRow,
  WebhookConfigRow,
} from '../../db/types.js';
import {
  platformDbInspectSchema,
  platformDockerInspectSchema,
  platformDockerPsSchema,
  platformLogsSchema,
} from './schemas.js';
import type { ToolDef } from './types.js';

const PINO_LEVEL_MAP: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const FORBIDDEN_TABLES = new Set(['global_secrets', 'oauth_tokens', 'secret_files', 'env_vars']);
const SENSITIVE_CONFIG_KEYS = new Set([
  'credentials',
  'env_vars',
  'access_code',
  'access_code_iv',
  'secret',
  'sshKeyPath',
  'gitCredentialId',
  'git_credential_id',
]);

function safeProjectRow(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    display_name: row.display_name,
    description: row.description,
    tags: row.tags,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    server_id: row.server_id,
  };
}

function safeServiceRow(row: ServiceRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    kind: row.kind,
    parent_service_id: row.parent_service_id,
    status: row.status,
    visibility: row.visibility,
    assigned_port: row.assigned_port,
    container_id: row.container_id,
    container_name: row.container_name,
    container_port: row.container_port,
    image_tag: row.image_tag,
    previous_image_tag: row.previous_image_tag,
    public_url: row.public_url,
    dockerfile_path: row.dockerfile_path,
    docker_target: row.docker_target,
    build_context: row.build_context,
    build_method: row.build_method,
    source: row.source,
    repo_url: row.repo_url,
    branch: row.branch,
    image_url: row.image_url,
    image_cmd: row.image_cmd,
    is_preview: row.is_preview,
    pr_number: row.pr_number,
    project_type: row.project_type,
    health_check_strategy: row.health_check_strategy,
    health_check_path: row.health_check_path,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
    server_id: row.server_id,
  };
}

function safeDeployLogRow(row: DeployLogRow, projectId?: string) {
  return {
    id: row.id,
    service_id: row.service_id,
    environment_id: row.environment_id,
    status: row.status,
    trigger: row.trigger,
    trigger_detail: row.trigger_detail,
    commit_sha: row.commit_sha,
    commit_message: row.commit_message,
    representative_traffic_json: row.representative_traffic_json,
    duration_ms: row.duration_ms,
    created_at: row.created_at,
    ...(projectId ? { project_id: projectId } : {}),
  };
}

function safeTimelineEventRow(row: TimelineEventRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    deploy_id: row.deploy_id,
    type: row.type,
    message: row.message,
    severity: row.severity,
    percent: row.percent,
    tool_name: row.tool_name,
    created_at: row.created_at,
  };
}

function safeWebhookConfigRow(row: WebhookConfigRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    source: row.source,
    branch_filter: row.branch_filter,
    enabled: row.enabled,
    created_at: row.created_at,
  };
}

function safeActivityLogRow(row: ActivityLogRow) {
  return {
    id: row.id,
    event_type: row.event_type,
    activity_type: row.activity_type,
    severity: row.severity,
    project_id: row.project_id,
    correlation_id: row.correlation_id,
    title: row.title,
    description: row.description,
    status: row.status,
    created_at: row.created_at,
  };
}

function sanitizeDeployConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeDeployConfig(entry));
  if (!value || typeof value !== 'object') return value;

  const safe: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!SENSITIVE_CONFIG_KEYS.has(key)) safe[key] = sanitizeDeployConfig(entry);
  }
  return safe;
}

function mapManagedContainer(container: {
  id: string;
  name: string;
  status: string;
  port?: number;
  imageTag?: string;
  labels?: Record<string, string>;
}) {
  return {
    id: container.id,
    name: container.name,
    image: container.imageTag ?? '',
    status: container.status,
    state: container.status,
    created: 0,
    labels: container.labels ?? {},
    ports:
      container.port !== undefined
        ? [{ PublicPort: container.port, Type: 'tcp' as const }]
        : ([] as Array<{ PublicPort?: number; Type?: 'tcp' }>),
  };
}

function applyLimit<T>(rows: T[], limit: number): T[] {
  if (limit <= 0) {
    return [];
  }
  return rows.slice(0, limit);
}

function applyTailLimit<T>(rows: T[], limit: number): T[] {
  if (limit <= 0) {
    return [];
  }
  return rows.slice(-limit);
}

function filterLogsByLevel(logs: LogEntry[], level: string): LogEntry[] {
  const minLevel = PINO_LEVEL_MAP[level.toLowerCase()];
  if (minLevel === undefined) {
    throw new Error(`INVALID_LEVEL: Unsupported level '${level}'.`);
  }
  return logs.filter((entry) => entry.level >= minLevel);
}

export const platformDebugToolDefs: ToolDef[] = [
  {
    name: 'platform_logs',
    riskLevel: 'low',
    description:
      'Read-only OpenLander process logs from in-memory ring buffer with optional level/module/time filters.',
    mcpDescription: 'Read-only OpenLander process logs.',
    inputSchema: platformLogsSchema,
    execute: (args) => {
      const limit = (args['limit'] as number | undefined) ?? 50;
      const level = args['level'] as string | undefined;
      const moduleName = args['module'] as string | undefined;
      const sinceMinutes = args['since_minutes'] as number | undefined;

      const buffer = getLogBuffer();
      let entries =
        level !== undefined || moduleName !== undefined || sinceMinutes !== undefined
          ? buffer.getAll()
          : buffer.getRecent(limit);

      if (level !== undefined) {
        entries = filterLogsByLevel(entries, level);
      }

      if (moduleName !== undefined) {
        entries = entries.filter((entry) => entry.module === moduleName);
      }

      if (sinceMinutes !== undefined) {
        const cutoff = Date.now() - sinceMinutes * 60_000;
        entries = entries.filter((entry) => entry.timestamp >= cutoff);
      }

      return {
        count: Math.min(entries.length, Math.max(0, limit)),
        total_matched: entries.length,
        logs: applyTailLimit(entries, limit),
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'platform_docker_inspect',
    riskLevel: 'low',
    description:
      'Read-only raw Docker container inspect output for debugging platform/runtime issues.',
    mcpDescription: 'Read-only Docker container inspect output.',
    inputSchema: platformDockerInspectSchema,
    execute: async (args, context) => {
      const containerId = args['container_id'] as string;

      try {
        return await context.appCtx.docker.inspectContainer(containerId);
      } catch (error) {
        if (isDockerNotFoundError(error)) {
          throw new Error(`CONTAINER_NOT_FOUND: ${containerId}`);
        }
        throw error;
      }
    },
    targets: ['mcp'],
  },
  {
    name: 'platform_docker_ps',
    riskLevel: 'low',
    description:
      'Read-only Docker container list for platform debugging. Supports full list or OpenLander-managed filter.',
    mcpDescription: 'Read-only Docker container list for platform debugging.',
    inputSchema: platformDockerPsSchema,
    execute: async (args, context) => {
      const all = (args['all'] as boolean | undefined) ?? true;
      const filterManaged = (args['filter_managed'] as boolean | undefined) ?? false;

      if (filterManaged) {
        const managed = await context.appCtx.docker.listManagedContainers();
        const containers = managed.map(mapManagedContainer);
        return { count: containers.length, containers };
      }

      const allContainers = await context.appCtx.docker.listAllContainers();
      const filtered = all ? allContainers : allContainers.filter((c) => c.state === 'running');
      const containers = filtered.map((c) => ({
        id: c.id,
        name: c.name,
        image: c.image,
        status: c.status,
        state: c.state,
        created: c.created,
        labels: c.labels,
        ports: c.ports,
      }));

      return {
        count: containers.length,
        containers,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'platform_db_inspect',
    riskLevel: 'low',
    description:
      'Read-only structured DB table inspection for platform metadata tables with project-aware filtering.',
    mcpDescription: 'Read-only structured DB table inspection for platform metadata.',
    inputSchema: platformDbInspectSchema,
    execute: async (args, context) => {
      const db = context.appCtx.db;
      const table = args['table'] as string;
      const projectId = args['project_id'] as string | undefined;
      const limit = (args['limit'] as number | undefined) ?? 50;

      if (FORBIDDEN_TABLES.has(table)) {
        throw new Error(`FORBIDDEN_TABLE: ${table}`);
      }

      switch (table) {
        case 'projects': {
          const all = await db.listProjects(undefined, { includeArchived: true });
          const rows = applyLimit(
            all
              .filter((project) => projectId === undefined || project.id === projectId)
              .map(safeProjectRow),
            limit,
          );
          return { table, count: rows.length, rows };
        }
        case 'environments': {
          const rows =
            projectId !== undefined
              ? await db.getEnvironmentsByProject(projectId)
              : applyLimit(
                  (
                    await Promise.all(
                      (await db.listProjects(undefined, { includeArchived: true })).map(
                        async (project) => await db.getEnvironmentsByProject(project.id),
                      ),
                    )
                  ).flat(),
                  limit,
                );
          const selected = projectId !== undefined ? applyLimit(rows, limit) : rows;
          return { table, count: selected.length, rows: selected };
        }
        case 'services': {
          const rows = applyLimit(
            (await db.listServices())
              .filter((service) => projectId === undefined || service.project_id === projectId)
              .map(safeServiceRow),
            limit,
          );
          return { table, count: rows.length, rows };
        }
        case 'deploy_logs': {
          const rows =
            projectId !== undefined
              ? (await db.getDeployLogs(projectId, limit)).map((entry) =>
                  safeDeployLogRow(entry, projectId),
                )
              : applyLimit(
                  (
                    await Promise.all(
                      (await db.listProjects(undefined, { includeArchived: true })).map(
                        async (project) =>
                          (await db.getDeployLogs(project.id, limit)).map((entry) =>
                            safeDeployLogRow(entry, project.id),
                          ),
                      ),
                    )
                  ).flat(),
                  limit,
                );
          return { table, count: rows.length, rows };
        }
        case 'timeline_events': {
          const rows =
            projectId !== undefined
              ? (await db.getTimelineEvents(projectId, limit)).map(safeTimelineEventRow)
              : applyLimit(
                  (
                    await Promise.all(
                      (await db.listProjects(undefined, { includeArchived: true })).map(
                        async (project) =>
                          (await db.getTimelineEvents(project.id, limit)).map(safeTimelineEventRow),
                      ),
                    )
                  ).flat(),
                  limit,
                );
          return { table, count: rows.length, rows };
        }
        case 'domain_mappings': {
          const rows =
            projectId !== undefined
              ? await db.getDomainMappings(projectId)
              : await db.listDomainMappings();
          const selected = applyLimit(rows, limit);
          return { table, count: selected.length, rows: selected };
        }
        case 'webhook_configs': {
          const rows =
            projectId !== undefined
              ? (await db.getWebhookConfigs(projectId)).map(safeWebhookConfigRow)
              : applyLimit(
                  (
                    await Promise.all(
                      (await db.listProjects(undefined, { includeArchived: true })).map(
                        async (project) =>
                          (await db.getWebhookConfigs(project.id)).map(safeWebhookConfigRow),
                      ),
                    )
                  ).flat(),
                  limit,
                );
          const selected = projectId !== undefined ? applyLimit(rows, limit) : rows;
          return { table, count: selected.length, rows: selected };
        }
        case 'deploy_configs': {
          if (projectId !== undefined) {
            const config = await db.loadDeployConfig(projectId);
            const rows = config
              ? [{ project_id: projectId, config: sanitizeDeployConfig(config) }]
              : [];
            return { table, count: rows.length, rows };
          }

          const rows = applyLimit(
            (
              await Promise.all(
                (await db.listProjects(undefined, { includeArchived: true })).map(
                  async (project) => ({
                    project_id: project.id,
                    config: sanitizeDeployConfig(await db.loadDeployConfig(project.id)),
                  }),
                ),
              )
            ).filter((entry) => entry.config != null),
            limit,
          );
          return { table, count: rows.length, rows };
        }
        case 'activity_log': {
          const rows = (
            await db.findActivityLogRecent(limit, {
              ...(projectId !== undefined ? { project_id: projectId } : {}),
            })
          ).map(safeActivityLogRow);
          return { table, count: rows.length, rows };
        }
        default:
          throw new Error(`UNSUPPORTED_TABLE: ${table}`);
      }
    },
    targets: ['mcp'],
  },
];
