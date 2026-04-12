import { getLogBuffer, type LogEntry } from '../../lib/log-buffer.js';
import { isDockerNotFoundError } from '../../errors.js';
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
      let entries = buffer.getRecent(limit);

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
        count: entries.length,
        logs: entries,
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
    execute: (args, context) => {
      const db = context.appCtx.db;
      const table = args['table'] as string;
      const projectId = args['project_id'] as string | undefined;
      const limit = (args['limit'] as number | undefined) ?? 50;

      if (FORBIDDEN_TABLES.has(table)) {
        throw new Error(`FORBIDDEN_TABLE: ${table}`);
      }

      switch (table) {
        case 'projects': {
          const rows = applyLimit(db.listProjects(undefined, { includeArchived: true }), limit);
          return { table, count: rows.length, rows };
        }
        case 'environments': {
          const rows =
            projectId !== undefined
              ? db.getEnvironmentsByProject(projectId)
              : applyLimit(
                  db
                    .listProjects(undefined, { includeArchived: true })
                    .flatMap((project) => db.getEnvironmentsByProject(project.id)),
                  limit,
                );
          const selected = projectId !== undefined ? applyLimit(rows, limit) : rows;
          return { table, count: selected.length, rows: selected };
        }
        case 'services': {
          const rows = applyLimit(db.listServices(), limit);
          return { table, count: rows.length, rows };
        }
        case 'deploy_logs': {
          const rows =
            projectId !== undefined
              ? db.getDeployLogs(projectId, limit)
              : applyLimit(
                  db
                    .listProjects(undefined, { includeArchived: true })
                    .flatMap((project) =>
                      db
                        .getDeployLogs(project.id, limit)
                        .map((entry) => ({ ...entry, project_id: project.id })),
                    ),
                  limit,
                );
          return { table, count: rows.length, rows };
        }
        case 'timeline_events': {
          const rows =
            projectId !== undefined
              ? db.getTimelineEvents(projectId, limit)
              : applyLimit(
                  db
                    .listProjects(undefined, { includeArchived: true })
                    .flatMap((project) =>
                      db
                        .getTimelineEvents(project.id, limit)
                        .map((entry) => ({ ...entry, project_id: project.id })),
                    ),
                  limit,
                );
          return { table, count: rows.length, rows };
        }
        case 'domain_mappings': {
          const rows =
            projectId !== undefined ? db.getDomainMappings(projectId) : db.listDomainMappings();
          const selected = applyLimit(rows, limit);
          return { table, count: selected.length, rows: selected };
        }
        case 'webhook_configs': {
          const rows =
            projectId !== undefined
              ? db.getWebhookConfigs(projectId)
              : applyLimit(
                  db
                    .listProjects(undefined, { includeArchived: true })
                    .flatMap((project) =>
                      db
                        .getWebhookConfigs(project.id)
                        .map((entry) => ({ ...entry, project_id: project.id })),
                    ),
                  limit,
                );
          const selected = projectId !== undefined ? applyLimit(rows, limit) : rows;
          return { table, count: selected.length, rows: selected };
        }
        case 'deploy_configs': {
          if (projectId !== undefined) {
            const config = db.loadDeployConfig(projectId);
            const rows = config ? [{ project_id: projectId, config }] : [];
            return { table, count: rows.length, rows };
          }

          const rows = applyLimit(
            db
              .listProjects(undefined, { includeArchived: true })
              .map((project) => ({
                project_id: project.id,
                config: db.loadDeployConfig(project.id),
              }))
              .filter((entry) => entry.config !== undefined),
            limit,
          );
          return { table, count: rows.length, rows };
        }
        default:
          throw new Error(`UNSUPPORTED_TABLE: ${table}`);
      }
    },
    targets: ['mcp'],
  },
];
