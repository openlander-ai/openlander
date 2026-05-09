import type { EventBus } from '../../events/index.js';
import { RingBuffer } from '../../lib/ring-buffer.js';
import { getLogBuffer } from '../../lib/log-buffer.js';
import {
  collectKnownContainerNames,
  containerName as projectContainerName,
} from '../../pipeline/helpers.js';
import { VERSION } from '../../version.js';
import {
  platformConfigSchema,
  platformContainerAuditSchema,
  platformEventLogSchema,
  platformHealthSchema,
} from './schemas.js';
import type { ToolDef } from './types.js';

interface CapturedEvent {
  type: string;
  payload: unknown;
}

const EVENT_BUFFER_CAPACITY = 1000;
const eventBuffer = new RingBuffer<CapturedEvent>(EVENT_BUFFER_CAPACITY);
const REDACTED = '***REDACTED***';
const SECRET_CONFIG_KEYS = new Set([
  'apikey',
  'apitoken',
  'authtoken',
  'accesstoken',
  'refreshtoken',
  'token',
  'signingsecret',
  'webhooksecret',
  'clientsecret',
  'password',
  'secret',
]);

export function getEventBuffer(): RingBuffer<CapturedEvent> {
  return eventBuffer;
}

export function wireEventCapture(bus: EventBus): void {
  bus.setCaptureHook((event, payload) => {
    eventBuffer.push({ type: event, payload });
  });
}

function getVersion(): string {
  return VERSION;
}

function shouldRedactConfigKey(key: string): boolean {
  return SECRET_CONFIG_KEYS.has(key.replace(/[_-]/g, '').toLowerCase());
}

function sanitizeConfig(config: unknown): unknown {
  if (Array.isArray(config)) {
    return config.map((item) => sanitizeConfig(item));
  }

  if (config === null || typeof config !== 'object') {
    return config;
  }

  const input = config as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    sanitized[key] = shouldRedactConfigKey(key) ? REDACTED : sanitizeConfig(value);
  }

  if (typeof sanitized['llm'] === 'object' && sanitized['llm'] !== null) {
    const llm = sanitized['llm'] as Record<string, unknown>;
    llm['apiKey'] = REDACTED;
    llm['authToken'] = REDACTED;
  }

  if (typeof sanitized['cloudflare'] === 'object' && sanitized['cloudflare'] !== null) {
    const cloudflare = sanitized['cloudflare'] as Record<string, unknown>;
    cloudflare['apiToken'] = REDACTED;
  }

  if (typeof sanitized['gitProviders'] === 'object' && sanitized['gitProviders'] !== null) {
    const providers = sanitized['gitProviders'] as Record<string, unknown>;

    if (typeof providers['github'] === 'object' && providers['github'] !== null) {
      (providers['github'] as Record<string, unknown>)['token'] = REDACTED;
    }
    if (typeof providers['gitlab'] === 'object' && providers['gitlab'] !== null) {
      (providers['gitlab'] as Record<string, unknown>)['token'] = REDACTED;
    }
  }

  if (typeof sanitized['channels'] === 'object' && sanitized['channels'] !== null) {
    const channels = sanitized['channels'] as Record<string, unknown>;

    if (typeof channels['slack'] === 'object' && channels['slack'] !== null) {
      const slack = channels['slack'] as Record<string, unknown>;
      slack['token'] = REDACTED;
      slack['signingSecret'] = REDACTED;
    }
    if (typeof channels['discord'] === 'object' && channels['discord'] !== null) {
      const discord = channels['discord'] as Record<string, unknown>;
      discord['token'] = REDACTED;
    }
    if (typeof channels['telegram'] === 'object' && channels['telegram'] !== null) {
      const telegram = channels['telegram'] as Record<string, unknown>;
      telegram['token'] = REDACTED;
      telegram['webhookSecret'] = REDACTED;
    }
  }

  return sanitized;
}

export const platformReadToolDefs: ToolDef[] = [
  {
    name: 'platform_health',
    riskLevel: 'low',
    description:
      'Read-only platform health summary with runtime, Docker/DB availability, event/log buffer sizes, and managed object counts.',
    mcpDescription: 'Read-only OpenLander platform health summary.',
    inputSchema: platformHealthSchema,
    execute: async (_args, context) => {
      const appCtx = context.appCtx;
      let managedContainerCount = 0;
      let projectCount = 0;
      let dockerStatus: 'running' | 'error' = 'running';
      let dbStatus: 'ok' | 'error' = 'ok';

      try {
        const containers = await appCtx.docker.listManagedContainers();
        managedContainerCount = containers.length;
      } catch {
        dockerStatus = 'error';
      }

      try {
        const projects = await appCtx.db.listProjects();
        projectCount = projects.length;
      } catch {
        dbStatus = 'error';
      }

      return {
        version: getVersion(),
        uptime_seconds: Math.floor(process.uptime()),
        node_version: process.version,
        docker_status: dockerStatus,
        db_status: dbStatus,
        event_bus_buffer_size: getEventBuffer().size,
        log_buffer_size: getLogBuffer().size,
        managed_container_count: managedContainerCount,
        project_count: projectCount,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'platform_event_log',
    riskLevel: 'low',
    description:
      'Read-only event ring buffer query with optional limit, prefix event type filtering, and time-window filtering.',
    mcpDescription: 'Read-only query for captured platform events from in-memory ring buffer.',
    inputSchema: platformEventLogSchema,
    execute: (args) => {
      const limit = (args['limit'] as number | undefined) ?? 50;
      const eventTypePrefix = args['event_type'] as string | undefined;
      const sinceMinutes = args['since_minutes'] as number | undefined;

      const since = sinceMinutes !== undefined ? Date.now() - sinceMinutes * 60 * 1000 : undefined;

      const recent =
        since !== undefined ? getEventBuffer().getAll() : getEventBuffer().getRecent(limit);

      const filtered = recent.filter((entry) => {
        const matchesType = eventTypePrefix ? entry.data.type.startsWith(eventTypePrefix) : true;
        const matchesTime = since !== undefined ? entry.timestamp >= since : true;
        return matchesType && matchesTime;
      });

      const selected = filtered.slice(-limit);

      return {
        count: selected.length,
        events: selected.map((entry) => ({
          type: entry.data.type,
          payload: entry.data.payload,
          timestamp: entry.timestamp,
        })),
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'platform_container_audit',
    riskLevel: 'low',
    description:
      'Read-only Docker/DB consistency audit. Detects orphan containers, ghost DB project records, and healthy project-container matches.',
    mcpDescription: 'Read-only audit comparing managed Docker containers and DB metadata.',
    inputSchema: platformContainerAuditSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const projectName = args['project_name'] as string | undefined;

      const managedContainers = await appCtx.docker.listManagedContainers();
      const allProjects = await appCtx.db.listProjects();
      const services = await appCtx.db.listServices();
      const projects =
        projectName !== undefined
          ? allProjects.filter((project) => project.name === projectName)
          : allProjects;

      const { knownIds, knownNames } = collectKnownContainerNames(
        allProjects,
        () => [],
        (projectName) => projectContainerName(projectName),
        services,
      );

      const dockerIds = new Set(managedContainers.map((container) => container.id));
      const dockerNames = new Set(managedContainers.map((container) => container.name));

      // PR 4.5: batch-resolve deployable rows so each container_id read uses
      // canonical-first with `??` fallback to legacy `projects` columns
      // through migration 0012.
      const deployableContainerIds = new Map<string, string | null>();
      for (const p of projects) {
        const d = await appCtx.db.getDeployableForProject(p.id);
        deployableContainerIds.set(p.id, d?.container_id ?? p.container_id ?? null);
      }

      const orphanContainers = managedContainers
        .filter((container) => {
          if (
            container.labels?.['openlander.role'] &&
            container.labels['openlander.role'] !== 'service'
          ) {
            return false;
          }
          const hasOpenLanderLabel = Object.keys(container.labels ?? {}).some((key) =>
            key.startsWith('openlander.'),
          );
          if (!hasOpenLanderLabel) {
            return false;
          }
          return !knownIds.has(container.id) && !knownNames.has(container.name);
        })
        .map((container) => ({
          id: container.id,
          name: container.name,
          labels: container.labels,
        }));

      const ghostRecords = projects
        .filter((project) => {
          const cid = deployableContainerIds.get(project.id);
          return cid !== null && cid !== undefined && !dockerIds.has(cid);
        })
        .map((project) => ({
          project_id: project.id,
          project_name: project.name,
          container_id: deployableContainerIds.get(project.id) ?? null,
        }));

      const healthy = projects
        .filter((project) => {
          const cid = deployableContainerIds.get(project.id);
          if (cid && dockerIds.has(cid)) {
            return true;
          }
          return dockerNames.has(projectContainerName(project.name));
        })
        .map((project) => ({
          project_id: project.id,
          project_name: project.name,
          container_id: deployableContainerIds.get(project.id) ?? null,
        }));

      return {
        total_docker: managedContainers.length,
        total_db: projects.length,
        orphan_containers: orphanContainers,
        ghost_records: ghostRecords,
        healthy,
      };
    },
    targets: ['mcp'],
  },
  {
    name: 'platform_config',
    riskLevel: 'low',
    description:
      'Read-only platform config snapshot with sensitive fields redacted. Optional section filter returns only one top-level config section.',
    mcpDescription: 'Read-only redacted platform configuration.',
    inputSchema: platformConfigSchema,
    execute: (args, context) => {
      const section = args['section'] as string | undefined;
      const sanitized = sanitizeConfig(context.appCtx.config) as Record<string, unknown>;

      if (section === undefined) {
        return sanitized;
      }

      const sectionValue = sanitized[section];
      if (sectionValue === undefined) {
        return {};
      }

      return {
        [section]: sectionValue,
      };
    },
    targets: ['mcp'],
  },
];
