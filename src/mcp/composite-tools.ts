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
 * openlander_service: Infrastructure services & storage
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
export const SERVICE_ACTIONS = [
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
export type MonitorAction = (typeof MONITOR_ACTIONS)[number];
export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export type CompositeAction = DeployAction | ProjectAction | ServiceAction | MonitorAction;
export type AllAction = CompositeAction | PlatformAction;

/**
 * Composite registry for routing
 */
export const COMPOSITE_REGISTRY = {
  openlander_deploy: DEPLOY_ACTIONS,
  openlander_project: PROJECT_ACTIONS,
  openlander_service: SERVICE_ACTIONS,
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
  return createCompositeTool(
    'openlander_project',
    'Projects, lifecycle, config, env vars, secrets, public exposure, webhook management.',
    toolDefs,
  );
}

export function createOpenLanderServiceCompositeTool(toolDefs: ToolDef[]): CompositeTool {
  return createCompositeTool(
    'openlander_service',
    'Services, credentials, backups, users, buckets, volumes, disk usage, Docker cleanup.',
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
    createOpenLanderMonitorCompositeTool(toolDefs),
  ];
}
