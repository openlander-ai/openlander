import { z } from 'zod';
import type { ToolContext, ToolDef } from '../tools/defs/types.js';

/**
 * MCP Composite Tool Mapping
 *
 * Maps all 70 non-platform MCP-exposed tools into 4 composite action groups.
 * Platform tools (11 total) are gated separately via config.mcp.platformTools.
 *
 * Mapping Principles:
 * - Each tool appears in exactly ONE composite
 * - 4 composites + 1 platform group = 81 total tools
 * - Non-platform total: 70 tools (verified by test/mcp/tool-registry-snapshot.test.ts)
 * - Platform total: 11 tools (gated by config.mcp.platformTools)
 */

/**
 * openlander_deploy: Deployment lifecycle & orchestration
 * - Deploy plan creation, execution, validation
 * - Deploy strategies (blue-green, rollback, preview)
 * - Build debugging & history
 * - Git integration (repo scanning)
 * - Infrastructure analysis
 * Total: 20 tools
 */
export const DEPLOY_ACTIONS = [
  'create_deploy_plan',
  'update_deploy_plan',
  'execute_deploy_plan',
  'validate_deploy_plan',
  'deploy',
  'get_deploy_status',
  'get_deploy_history',
  'preview_deploy',
  'cleanup_preview',
  'list_previews',
  'rollback_project',
  'deploy_blue_green',
  'get_build_log',
  'debug_build_error',
  'list_github_repos',
  'search_github_repos',
  'scan_dockerfiles',
  'analyze_infrastructure',
  'map_domain',
  'list_domains',
] as const;

/**
 * openlander_project: Project management & configuration
 * - Project lifecycle (stop, start, restart, archive)
 * - Project configuration updates
 * - Environment variables (project-scoped)
 * - Global secrets (shared across all projects)
 * - Secret files (encrypted credential files)
 * - Public URL exposure (Cloudflare tunnel)
 * - Webhook configuration
 * Total: 21 tools
 */
export const PROJECT_ACTIONS = [
  'list_projects',
  'stop_project',
  'start_project',
  'restart_project',
  'redeploy_project',
  'archive_project',
  'unarchive_project',
  'update_project_config',
  'list_env_vars',
  'get_env_var',
  'set_env_vars',
  'set_global_secret',
  'list_global_secrets',
  'upload_secret_file',
  'list_secret_files',
  'remove_secret_file',
  'expose_public',
  'unexpose_public',
  'enable_webhook',
  'disable_webhook',
  'get_webhook_config',
] as const;

/**
 * PROJECT_TO_SERVICE_ALIASES: Maps legacy *_project action names to their
 * canonical *_service equivalents (rc.2 vocabulary). Used by openlander_project
 * composite to accept both old and new names in rc.1 while emitting deprecation
 * warnings for legacy callers.
 *
 * CRITICAL: these aliases are intentionally NOT added to SERVICE_ACTIONS —
 * that array is for managed infrastructure services (Postgres, Redis, etc.)
 * and `start_service` there means "start managed Postgres", not "start app".
 * The aliases are only surfaced through openlander_project in rc.1.
 */
export const PROJECT_TO_SERVICE_ALIASES: Record<(typeof PROJECT_ACTIONS)[number], string> = {
  list_projects: 'list_projects',
  stop_project: 'stop_service',
  start_project: 'start_service',
  restart_project: 'restart_service',
  redeploy_project: 'deploy_service',
  archive_project: 'archive_service',
  unarchive_project: 'unarchive_service',
  update_project_config: 'update_service_config',
  list_env_vars: 'list_env_vars',
  get_env_var: 'get_env_var',
  set_env_vars: 'set_env_vars',
  set_global_secret: 'set_global_secret',
  list_global_secrets: 'list_global_secrets',
  upload_secret_file: 'upload_secret_file',
  list_secret_files: 'list_secret_files',
  remove_secret_file: 'remove_secret_file',
  expose_public: 'expose_public',
  unexpose_public: 'unexpose_public',
  enable_webhook: 'enable_webhook',
  disable_webhook: 'disable_webhook',
  get_webhook_config: 'get_webhook_config',
};

/**
 * Reverse map: alias → legacy action name (for openlander_project dispatcher).
 * Built once at module load — not user-configurable.
 */
const SERVICE_ALIAS_TO_PROJECT_ACTION = new Map<string, (typeof PROJECT_ACTIONS)[number]>(
  (Object.entries(PROJECT_TO_SERVICE_ALIASES) as [(typeof PROJECT_ACTIONS)[number], string][])
    .filter(([legacy, alias]) => alias !== legacy)
    .map(([legacy, alias]) => [alias, legacy]),
);

/**
 * In-memory dedup set for deprecation warnings.
 * Key: `${sessionId}:${actionName}` — warn only once per session per action.
 */
const deprecationWarnedKeys = new Set<string>();

/**
 * openlander_managed_service (rc.2): Infrastructure services & storage.
 * Renamed from `SERVICE_ACTIONS` — see plan §6.7. The 21-action list is
 * frozen verbatim from the rc.1 SERVICE_ACTIONS baseline.
 * - Service provisioning (PostgreSQL, MySQL, Redis, MongoDB, MinIO)
 * - Service lifecycle (start, stop, remove)
 * - Service credentials & connection strings
 * - Service backups & restoration
 * - Database & user management
 * - S3 bucket management (MinIO)
 * - Container execution
 * - Persistent volumes
 * - Disk usage monitoring
 * Total: 21 tools
 */
export const MANAGED_SERVICE_ACTIONS = [
  'create_service',
  'list_services',
  'get_service_status',
  'get_service_credentials',
  'get_service_logs',
  'start_service',
  'stop_service',
  'remove_service',
  'backup_service',
  'restore_service',
  'list_service_backups',
  'create_service_user',
  'create_bucket',
  'list_buckets',
  'delete_bucket',
  'exec_service_container',
  'add_volume',
  'list_volumes',
  'remove_volume',
  'get_disk_usage',
  'cleanup_docker',
] as const;

/**
 * openlander_service (rc.2): Deployable-vocab composite — apps + workers.
 * Plan §6.7 lines 834-857. These actions are aliases of the corresponding
 * *_project actions, surfaced under the deployable namespace.
 *
 * Handler routing for overlapping action names (`start_service`,
 * `stop_service`, `restart_service`, `remove_service`):
 *   - Kind-first lookup (Architect iter-2 fix): inspect services.kind by
 *     service_id. kind ∈ managed kinds → managed handler; else deployable.
 *   - Param-shape fallback: presence of `database_type`/`image` keys ⇒ managed.
 *   - Hard error last resort: ambiguous params + unresolved kind.
 *
 * Total: 21 tools
 */
export const SERVICE_ACTIONS = [
  'list_services',
  'stop_service',
  'start_service',
  'restart_service',
  'deploy_service',
  'archive_service',
  'unarchive_service',
  'update_service_config',
  'list_env_vars',
  'get_env_var',
  'set_env_vars',
  'set_global_secret',
  'list_global_secrets',
  'upload_secret_file',
  'list_secret_files',
  'remove_secret_file',
  'expose_public',
  'unexpose_public',
  'enable_webhook',
  'disable_webhook',
  'get_webhook_config',
] as const;

/**
 * openlander_monitor: Monitoring, alerting & operations
 * - Container logs & system stats
 * - Health alerts & dismissal
 * - Project statistics
 * - Recovery automation policy
 * - Host/endpoint connectivity probing
 * Total: 8 tools
 */
export const MONITOR_ACTIONS = [
  'get_logs',
  'get_system_stats',
  'get_alerts',
  'dismiss_alert',
  'get_project_stats',
  'get_automation_policy',
  'set_automation_policy',
  'probe_host',
] as const;

/**
 * Platform tools: Admin/debug operations (gated by config.mcp.platformTools)
 * - System health & diagnostics
 * - Container & Docker inspection
 * - Database inspection
 * - Event logging & audit
 * - Orphan cleanup & reconciliation
 * - Force removal & recovery
 * Total: 11 tools
 */
export const PLATFORM_ACTIONS = [
  'platform_health',
  'platform_event_log',
  'platform_container_audit',
  'platform_config',
  'platform_logs',
  'platform_docker_ps',
  'platform_docker_inspect',
  'platform_db_inspect',
  'platform_cleanup_orphans',
  'platform_force_remove',
  'recover_platform',
] as const;

/**
 * Verification: Total tool counts
 * - DEPLOY_ACTIONS: 20 tools
 * - PROJECT_ACTIONS: 21 tools
 * - SERVICE_ACTIONS: 20 tools
 * - MONITOR_ACTIONS: 8 tools
 * - PLATFORM_ACTIONS: 11 tools (gated separately)
 * - Total non-platform: 70 tools (verified against test/mcp/tool-registry-snapshot.test.ts)
 * - Total with platform: 81 tools (11 platform)
 * Note: DEPLOY_ACTIONS(20) + PROJECT_ACTIONS(21) + SERVICE_ACTIONS(20) + MONITOR_ACTIONS(8) = 69, not 70
 * The 1-off is because create_database / list_databases were not included (create_service_database merged into create_database, but create_database itself is service.ts:205-235 which targets 'agent')
 */

/**
 * Type-safe composite action unions for routing
 */
export type DeployAction = (typeof DEPLOY_ACTIONS)[number];
export type ProjectAction = (typeof PROJECT_ACTIONS)[number];
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];
export type ManagedServiceAction = (typeof MANAGED_SERVICE_ACTIONS)[number];
export type MonitorAction = (typeof MONITOR_ACTIONS)[number];
export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export type CompositeAction =
  | DeployAction
  | ProjectAction
  | ServiceAction
  | ManagedServiceAction
  | MonitorAction;
export type AllAction = CompositeAction | PlatformAction;

/**
 * Composite registry for routing.
 *
 * rc.2: `openlander_service` is the deployable-vocab composite (21 actions);
 * the rc.1 managed-only set is exported as `openlander_managed_service`.
 * Plan §6.7 lines 859-866.
 */
export const COMPOSITE_REGISTRY = {
  openlander_deploy: DEPLOY_ACTIONS,
  openlander_project: PROJECT_ACTIONS,
  openlander_service: SERVICE_ACTIONS,
  openlander_managed_service: MANAGED_SERVICE_ACTIONS,
  openlander_monitor: MONITOR_ACTIONS,
} as const;

export const PLATFORM_REGISTRY = {
  platform: PLATFORM_ACTIONS,
} as const;

export interface CompositeTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute: (args: unknown, context: ToolContext) => Promise<unknown>;
}

const compositeToolInputSchema = z.object({
  action: z
    .string()
    .describe('Operation to perform. Use action="help" to list available operations.'),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Parameters for the operation. See action="help" for parameter details.'),
});

function buildCompositeToolDefs(allToolDefs: ToolDef[], actions: readonly string[]): ToolDef[] {
  return actions
    .map((name) => allToolDefs.find((def) => def.name === name))
    .filter((def): def is ToolDef => def !== undefined);
}

function createCompositeTool(
  toolName: keyof typeof COMPOSITE_REGISTRY,
  description: string,
  allToolDefs: ToolDef[],
): CompositeTool {
  const actions = COMPOSITE_REGISTRY[toolName];
  const toolDefs = buildCompositeToolDefs(allToolDefs, actions);

  return {
    name: toolName,
    description,
    inputSchema: compositeToolInputSchema,
    execute: async (args, context) => {
      const { action, params } = args as { action: string; params?: Record<string, unknown> };

      if (action === 'help') {
        return {
          composite: toolName,
          description,
          actions: toolDefs.map((def) => ({
            name: def.name,
            description: def.mcpDescription ?? def.description,
          })),
          _agent_guidance: {
            message: `Pick an action and call with params. Example: { action: "${toolDefs[0]?.name ?? 'help'}", params: { ... } }`,
          },
        };
      }

      const def = toolDefs.find((item) => item.name === action);
      if (!def) {
        return {
          error: 'UNKNOWN_ACTION',
          action,
          composite: toolName,
          available_actions: toolDefs.map((item) => item.name).sort(),
          _agent_guidance: {
            message: `Unknown action "${action}". Use action="help" to see available operations.`,
          },
        };
      }

      const parsed = def.inputSchema.safeParse(params ?? {});
      if (!parsed.success) {
        return {
          error: 'INVALID_PARAMS',
          action,
          composite: toolName,
          details: parsed.error.message,
          _agent_guidance: {
            message: `Invalid parameters for action "${action}". Use action="help" to see parameter details.`,
          },
        };
      }

      const result = await def.execute(parsed.data, context);
      return def.mcp?.transformResult ? def.mcp.transformResult(result) : result;
    },
  };
}

export function createOpenLanderDeployCompositeTool(toolDefs: ToolDef[]): CompositeTool {
  return createCompositeTool(
    'openlander_deploy',
    'Deploy plans, execution, previews, rollbacks, build logs, Git scans, infrastructure, domains.',
    toolDefs,
  );
}

export function createOpenLanderProjectCompositeTool(toolDefs: ToolDef[]): CompositeTool {
  const description =
    'Projects, lifecycle, config, env vars, secrets, public exposure, webhook management.';
  const toolName = 'openlander_project';
  const actions = COMPOSITE_REGISTRY[toolName];
  const compositeToolDefs = buildCompositeToolDefs(toolDefs, actions);

  return {
    name: toolName,
    description,
    inputSchema: compositeToolInputSchema,
    execute: async (args, context) => {
      const { action: rawAction, params } = args as {
        action: string;
        params?: Record<string, unknown>;
      };

      // Resolve alias → legacy action name if caller used the *_service vocabulary
      const legacyAction = SERVICE_ALIAS_TO_PROJECT_ACTION.get(rawAction);
      const action = legacyAction ?? rawAction;

      if (action === 'help') {
        return {
          composite: toolName,
          description,
          actions: compositeToolDefs.map((def) => ({
            name: def.name,
            description: def.mcpDescription ?? def.description,
          })),
          _agent_guidance: {
            message: `Pick an action and call with params. Example: { action: "${compositeToolDefs[0]?.name ?? 'help'}", params: { ... } }`,
          },
        };
      }

      // Emit once-per-session deprecation warning for legacy *_project callers
      // (only when using the old name directly, not via alias)
      if (!legacyAction && PROJECT_TO_SERVICE_ALIASES[action as (typeof PROJECT_ACTIONS)[number]]) {
        const alias = PROJECT_TO_SERVICE_ALIASES[action as (typeof PROJECT_ACTIONS)[number]];
        if (alias !== action) {
          const sessionId = (context as { sessionId?: string }).sessionId ?? 'unknown';
          const warnKey = `${sessionId}:${action}`;
          if (!deprecationWarnedKeys.has(warnKey)) {
            deprecationWarnedKeys.add(warnKey);
            // Use console.warn directly so tests can spy on it (pino is silent in test env)
            console.warn(
              `[mcp][deprecation] action=${action} use=${alias} since=1.0-rc.1 removed_in=2.0`,
            );
          }
        }
      }

      const def = compositeToolDefs.find((item) => item.name === action);
      if (!def) {
        return {
          error: 'UNKNOWN_ACTION',
          action: rawAction,
          composite: toolName,
          available_actions: compositeToolDefs.map((item) => item.name).sort(),
          _agent_guidance: {
            message: `Unknown action "${rawAction}". Use action="help" to see available operations.`,
          },
        };
      }

      const parsed = def.inputSchema.safeParse(params ?? {});
      if (!parsed.success) {
        return {
          error: 'INVALID_PARAMS',
          action: rawAction,
          composite: toolName,
          details: parsed.error.message,
          _agent_guidance: {
            message: `Invalid parameters for action "${rawAction}". Use action="help" to see parameter details.`,
          },
        };
      }

      const result = await def.execute(parsed.data, context);
      return def.mcp?.transformResult ? def.mcp.transformResult(result) : result;
    },
  };
}

/**
 * Set of action names that exist in BOTH the deployable and managed
 * composites. When a caller invokes one of these via `openlander_service`
 * the dispatcher must disambiguate (kind-first lookup → param-shape
 * fallback → hard error). Plan §6.7 line 871.
 */
const OVERLAPPING_SERVICE_ACTIONS = new Set<string>(
  (SERVICE_ACTIONS as readonly string[]).filter((name) =>
    (MANAGED_SERVICE_ACTIONS as readonly string[]).includes(name),
  ),
);

/** Managed `services.kind` values per plan §6.3. */
const MANAGED_KINDS = new Set<string>(['postgres', 'mysql', 'redis', 'mongo', 'minio']);

/**
 * Per-session dedup set for the rc.2 `[mcp:rename]` deprecation warning.
 * Plan §6.7 line 869.
 */
const renameWarnedKeys = new Set<string>();

interface DbWithGetService {
  getService?: (id: string) => { kind?: string | null } | undefined;
}

/**
 * Disambiguation for overlapping action names invoked under
 * `openlander_service`. Returns:
 *   - `'managed'` → route to `MANAGED_SERVICE_ACTIONS` handler
 *   - `'deployable'` → route to `SERVICE_ACTIONS` handler (default)
 *   - `'ambiguous'` → caller must explicitly disambiguate; hard error
 *
 * Resolution order (Architect iter-2 fix):
 *   1. Kind-first lookup: services.kind by service_id
 *   2. Param-shape fallback: presence of database_type/image
 *   3. Default: deployable
 */
function disambiguateOverlappingService(
  params: Record<string, unknown> | undefined,
  context: ToolContext,
): 'managed' | 'deployable' | 'ambiguous' {
  const serviceId =
    typeof params?.service_id === 'string' && params.service_id.length > 0
      ? params.service_id
      : undefined;

  // (1) Kind-first DB lookup. Best-effort: if appCtx.db.getService is
  // unavailable (test fixture), fall through to param-shape inspection.
  if (serviceId) {
    const appCtx = (context as { appCtx?: { db?: DbWithGetService } }).appCtx;
    const db = appCtx?.db;
    if (db && typeof db.getService === 'function') {
      try {
        const svc = db.getService(serviceId);
        if (svc) {
          const kind = svc.kind ?? null;
          if (kind && MANAGED_KINDS.has(kind)) return 'managed';
          if (kind) return 'deployable';
        }
      } catch {
        // DB may be partially mocked in tests — fall through.
      }
    }
  }

  // (2) Param-shape fallback.
  if (params) {
    if (typeof params.database_type === 'string' && params.database_type.length > 0) {
      return 'managed';
    }
    if (typeof params.image === 'string' && params.image.length > 0) {
      return 'managed';
    }
  }

  // (3) When the caller supplied a service_id we couldn't resolve and
  // the params shape is silent, the request is ambiguous.
  if (serviceId) {
    return 'ambiguous';
  }

  return 'deployable';
}

/**
 * rc.2: openlander_service composite — deployable-vocab actions with
 * kind-first dispatch into the managed composite for overlapping names.
 *
 * Plan §6.7 lines 868-871:
 *   - `create_service` is managed-only — auto-route to
 *     `openlander_managed_service.create_service` with a
 *     `[mcp:rename] tool=openlander_service action=create_service
 *     redirected_to=openlander_managed_service since=1.0-rc.2 removed_in=2.0`
 *     warning logged once per session.
 *   - Overlapping names (`start_service`, `stop_service`, `restart_service`,
 *     `remove_service`) disambiguate per `disambiguateOverlappingService`.
 *   - All other deployable actions go to the deployable handler directly.
 */
export function createOpenLanderServiceCompositeTool(toolDefs: ToolDef[]): CompositeTool {
  const description =
    'Deployable services (apps + workers): lifecycle, config, env vars, secrets, public exposure, webhook management.';
  const toolName = 'openlander_service';
  const deployableActions = COMPOSITE_REGISTRY[toolName];
  const managedActions = COMPOSITE_REGISTRY.openlander_managed_service;
  // Resolve every deployable-vocab action name (e.g. `deploy_service`) to the
  // underlying ToolDef by walking the rc.1 alias map first
  // (SERVICE_ALIAS_TO_PROJECT_ACTION). This lets the deployable composite
  // reuse the existing *_project handlers without duplicating tool defs.
  const deployableToolDefs: ToolDef[] = deployableActions
    .map((alias) => {
      // Try direct lookup first (e.g. list_services hits a real tool def).
      const direct = toolDefs.find((def) => def.name === alias);
      if (direct) return direct;
      // Otherwise resolve via the alias → *_project map (e.g.
      // `deploy_service` → `redeploy_project`, `stop_service` → `stop_project`).
      const legacyName = SERVICE_ALIAS_TO_PROJECT_ACTION.get(alias);
      if (legacyName) {
        const aliased = toolDefs.find((def) => def.name === legacyName);
        if (aliased) {
          // Surface the deployable-vocab name so help / errors carry the
          // canonical rc.2 vocabulary, not the legacy *_project names.
          return { ...aliased, name: alias };
        }
      }
      return undefined;
    })
    .filter((def): def is ToolDef => def !== undefined);
  const managedToolDefs = buildCompositeToolDefs(toolDefs, managedActions);

  // Cache the once-per-session dedup id from context.
  const emitRenameWarn = (action: string, redirectedTo: string, context: ToolContext): void => {
    const sessionId = (context as { sessionId?: string }).sessionId ?? 'unknown';
    const warnKey = `${sessionId}:${action}->${redirectedTo}`;
    if (renameWarnedKeys.has(warnKey)) return;
    renameWarnedKeys.add(warnKey);
    console.warn(
      `[mcp:rename] tool=openlander_service action=${action} redirected_to=${redirectedTo} since=1.0-rc.2 removed_in=2.0`,
    );
  };

  return {
    name: toolName,
    description,
    inputSchema: compositeToolInputSchema,
    execute: async (args, context) => {
      const { action, params } = args as { action: string; params?: Record<string, unknown> };

      if (action === 'help') {
        return {
          composite: toolName,
          description,
          actions: deployableToolDefs.map((def) => ({
            name: def.name,
            description: def.mcpDescription ?? def.description,
          })),
          _agent_guidance: {
            message: `Pick an action and call with params. Example: { action: "${deployableToolDefs[0]?.name ?? 'help'}", params: { ... } }`,
          },
        };
      }

      // (a) `create_service` is managed-only — auto-route + deprecation warn.
      if (action === 'create_service') {
        emitRenameWarn('create_service', 'openlander_managed_service', context);
        const def = managedToolDefs.find((item) => item.name === 'create_service');
        if (!def) {
          return {
            error: 'UNKNOWN_ACTION',
            action,
            composite: toolName,
            available_actions: deployableToolDefs.map((item) => item.name).sort(),
            _agent_guidance: {
              message: `Unknown action "${action}". Use action="help" to see available operations.`,
            },
          };
        }
        const parsed = def.inputSchema.safeParse(params ?? {});
        if (!parsed.success) {
          return {
            error: 'INVALID_PARAMS',
            action,
            composite: toolName,
            details: parsed.error.message,
            _agent_guidance: {
              message: `Invalid parameters for action "${action}". Use action="help" to see parameter details.`,
            },
          };
        }
        const result = await def.execute(parsed.data, context);
        return def.mcp?.transformResult ? def.mcp.transformResult(result) : result;
      }

      // (b) Overlapping names — kind-first lookup → param-shape fallback → hard error.
      if (OVERLAPPING_SERVICE_ACTIONS.has(action)) {
        const verdict = disambiguateOverlappingService(params, context);
        if (verdict === 'ambiguous') {
          return {
            error: 'AMBIGUOUS_ACTION',
            action,
            composite: toolName,
            _agent_guidance: {
              message: `Ambiguous service action — use openlander_managed_service.${action} for databases or openlander_service.${action} with explicit service_id for deployables.`,
            },
          };
        }
        const targetDefs = verdict === 'managed' ? managedToolDefs : deployableToolDefs;
        const def = targetDefs.find((item) => item.name === action);
        if (!def) {
          // Should not happen — overlapping set guarantees both registries have the action.
          return {
            error: 'UNKNOWN_ACTION',
            action,
            composite: toolName,
            available_actions: deployableToolDefs.map((item) => item.name).sort(),
            _agent_guidance: {
              message: `Unknown action "${action}". Use action="help" to see available operations.`,
            },
          };
        }
        const parsed = def.inputSchema.safeParse(params ?? {});
        if (!parsed.success) {
          return {
            error: 'INVALID_PARAMS',
            action,
            composite: toolName,
            details: parsed.error.message,
            _agent_guidance: {
              message: `Invalid parameters for action "${action}". Use action="help" to see parameter details.`,
            },
          };
        }
        const result = await def.execute(parsed.data, context);
        return def.mcp?.transformResult ? def.mcp.transformResult(result) : result;
      }

      // (c) Pure deployable action — direct dispatch.
      const def = deployableToolDefs.find((item) => item.name === action);
      if (!def) {
        return {
          error: 'UNKNOWN_ACTION',
          action,
          composite: toolName,
          available_actions: deployableToolDefs.map((item) => item.name).sort(),
          _agent_guidance: {
            message: `Unknown action "${action}". Use action="help" to see available operations.`,
          },
        };
      }

      const parsed = def.inputSchema.safeParse(params ?? {});
      if (!parsed.success) {
        return {
          error: 'INVALID_PARAMS',
          action,
          composite: toolName,
          details: parsed.error.message,
          _agent_guidance: {
            message: `Invalid parameters for action "${action}". Use action="help" to see parameter details.`,
          },
        };
      }

      const result = await def.execute(parsed.data, context);
      return def.mcp?.transformResult ? def.mcp.transformResult(result) : result;
    },
  };
}

export function createOpenLanderManagedServiceCompositeTool(toolDefs: ToolDef[]): CompositeTool {
  return createCompositeTool(
    'openlander_managed_service',
    'Managed infrastructure services (Postgres, MySQL, Redis, Mongo, MinIO): provisioning, credentials, backups, users, buckets, volumes, disk usage, Docker cleanup.',
    toolDefs,
  );
}

export function createOpenLanderMonitorCompositeTool(toolDefs: ToolDef[]): CompositeTool {
  return createCompositeTool(
    'openlander_monitor',
    'Logs, system stats, alerts, project stats, automation policy, and host connectivity probing.',
    toolDefs,
  );
}

export function createCompositeTools(toolDefs: ToolDef[]): CompositeTool[] {
  return [
    createOpenLanderDeployCompositeTool(toolDefs),
    createOpenLanderProjectCompositeTool(toolDefs),
    createOpenLanderServiceCompositeTool(toolDefs),
    createOpenLanderManagedServiceCompositeTool(toolDefs),
    createOpenLanderMonitorCompositeTool(toolDefs),
  ];
}
