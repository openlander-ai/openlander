import { z } from 'zod';
import type { ToolContext, ToolDef } from '../tools/defs/types.js';
import { maybeHandleMcpSafety } from './destructive-safety.js';
import {
  HUMAN_UI_ONLY_ALIASES,
  HUMAN_UI_ONLY_ALIAS_SET,
  PROJECT_LIFECYCLE_ALIAS_SET,
} from './mcp-restricted-actions.js';
import {
  buildActionContract,
  suggestedParamsForRetry,
  unknownTopLevelParams,
  type ToolInputContract,
} from './schema-guidance.js';

/**
 * MCP Composite Tool Mapping
 *
 * Maps non-platform MCP-exposed ToolDefs into 5 composite action groups.
 * Platform tools (13 total) are gated separately via config.mcp.platformTools,
 * which defaults to false in v0.1.
 *
 * Mapping Principles:
 * - Default MCP surface: 5 composite tools
 * - Platform total: 13 direct tools (gated by config.mcp.platformTools; default false)
 */

/**
 * openlander_deploy: Deployment lifecycle & orchestration
 * - Deploy plan creation, execution, validation
 * - Deploy strategies (rollback, preview)
 * - Build logs & history
 * - Git integration (repo scanning)
 * - Infrastructure analysis
 * Total: 18 tools
 */
export const DEPLOY_ACTIONS = [
  'create_deploy_plan',
  'get_deploy_plan',
  'update_deploy_plan',
  'execute_deploy_plan',
  'validate_deploy_plan',
  'cancel_deploy',
  'deploy_app',
  'get_deploy_status',
  'get_deploy_history',
  'preview_deploy',
  'cleanup_preview',
  'list_previews',
  'rollback_service',
  'get_build_log',
  'list_github_repos',
  'search_github_repos',
  'scan_dockerfiles',
  'analyze_infrastructure',
] as const;

/**
 * openlander_project: Projects & configuration
 * - Create empty Projects for project-first deploy flows
 * - Global secrets (shared across all projects)
 * - Secret files (encrypted credential files)
 * - Temporary public share URLs
 * Total: 17 tools
 */
export const PROJECT_ACTIONS = [
  'create_project',
  'list_projects',
  'archive_project',
  'unarchive_project',
  'list_env_vars',
  'get_env_var',
  'set_env_vars',
  'export_env_vars',
  'delete_env_var',
  'bulk_delete_env_vars',
  'set_global_secret',
  'list_global_secrets',
  'upload_secret_file',
  'list_secret_files',
  'remove_secret_file',
  'expose_public',
  'unexpose_public',
] as const;

/**
 * openlander_managed_service (rc.2): Database/Cache/Storage resources.
 * Renamed from `SERVICE_ACTIONS` — see plan §6.7. The 21-action list is
 * frozen verbatim from the rc.1 SERVICE_ACTIONS baseline.
 * - Database/Cache/Storage resource provisioning (PostgreSQL, MySQL, Redis, MongoDB, MinIO)
 * - Resource lifecycle (start, stop, remove)
 * - Resource credentials & connection strings
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
 * openlander_service: Applications/Compose workloads.
 * Total: 22 tools
 */
export const SERVICE_ACTIONS = [
  'list_archived_services',
  'archive_service',
  'unarchive_service',
  'restart_service',
  'redeploy_app',
  'rollback_service',
  'update_service_config',
  'list_env_vars',
  'get_env_var',
  'set_env_vars',
  'export_env_vars',
  'delete_env_var',
  'bulk_delete_env_vars',
  'set_global_secret',
  'list_global_secrets',
  'upload_secret_file',
  'list_secret_files',
  'remove_secret_file',
  'expose_public',
  'unexpose_public',
  'add_domain_route',
  'list_domain_routes',
] as const;

/**
 * openlander_monitor: Monitoring, alerting & operations
 * - Container logs & system stats
 * - Health alerts & dismissal
 * - Project statistics
 * - Host/endpoint connectivity probing
 * - One-shot service diagnostics
 * - Host resource pressure diagnosis
 * Total: 11 tools
 */
export const MONITOR_ACTIONS = [
  'get_instance_info',
  'get_logs',
  'diagnose_service',
  'diagnose_host_resources',
  'get_system_stats',
  'get_alerts',
  'dismiss_alert',
  'get_project_stats',
  'get_topology',
  'probe_host',
  'mcp_action_status',
] as const;

/**
 * Platform tools: Admin/debug operations (gated by config.mcp.platformTools; default false)
 * - System health & diagnostics
 * - Container & Docker inspection
 * - Database inspection
 * - Event logging & audit
 * - Orphan cleanup & reconciliation
 * - Force removal & recovery
 * Total: 13 tools
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
  'platform_adopt_orphan_service',
  'platform_cleanup_orphans',
  'platform_reconcile',
  'platform_force_remove',
  'recover_platform',
] as const;

/**
 * Verification: Total tool counts
 * - DEPLOY_ACTIONS: 18 tools
 * - PROJECT_ACTIONS: 17 tools
 * - MANAGED_SERVICE_ACTIONS: 21 tools
 * - SERVICE_ACTIONS: 22 tools
 * - MONITOR_ACTIONS: 11 tools
 * - PLATFORM_ACTIONS: 13 tools (gated separately)
 * - Platform tools: 13 direct tools (gated separately)
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
 * `openlander_service` is Applications/Compose workloads.
 * `openlander_managed_service` is Database/Cache/Storage resources.
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

/**
 * Actions that intentionally do NOT exist as MCP operations because the
 * underlying flow is human UI-only (project/app hard delete, purge, and
 * legacy app lifecycle aliases).
 *
 * Agents reaching for these names get a `HUMAN_UI_ONLY` response with a
 * clear pointer to the web UI instead of a generic `UNKNOWN_ACTION`. That
 * keeps a "삭제해줘" prompt from spiraling into adjacent destructive tools
 * like `remove_service` or `cleanup_docker`.
 */
export const HUMAN_UI_ONLY_ACTIONS = HUMAN_UI_ONLY_ALIASES;

export type HumanUiOnlyAction = (typeof HUMAN_UI_ONLY_ACTIONS)[number];

export function isHumanUiOnlyAction(action: string): boolean {
  return HUMAN_UI_ONLY_ALIAS_SET.has(action);
}

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

function isMcpTargeted(def: ToolDef): boolean {
  return !def.targets || def.targets.includes('mcp');
}

function buildCompositeToolDefs(allToolDefs: ToolDef[], actions: readonly string[]): ToolDef[] {
  return actions
    .map((name) => allToolDefs.find((def) => def.name === name))
    .filter((def): def is ToolDef => def !== undefined && isMcpTargeted(def));
}

function invalidParamsResponse(
  toolName: string,
  action: string,
  contract: ToolInputContract,
  details: string,
  params: Record<string, unknown>,
  unknownParams: string[] = [],
): Record<string, unknown> {
  const retryParams = suggestedParamsForRetry(params, contract);
  const hasRequiredOneOf =
    contract.required_one_of !== undefined && contract.required_one_of.length > 0;
  const hasAnyRequiredOneOf =
    !hasRequiredOneOf ||
    contract.required_one_of?.some((group) => group.every((name) => name in params));
  const shouldSuggestRetry =
    unknownParams.length > 0 ||
    contract.required_params.some((name) => !(name in params)) ||
    !hasAnyRequiredOneOf;
  const suggestedCall = shouldSuggestRetry
    ? { tool: toolName, arguments: { action, params: retryParams } }
    : { tool: toolName, arguments: { action: 'help', params: { action_name: action } } };

  return {
    error: 'INVALID_PARAMS',
    action,
    composite: toolName,
    details,
    unknown_params: unknownParams,
    allowed_params: contract.allowed_params,
    required_params: contract.required_params,
    optional_params: contract.optional_params,
    ...(contract.required_one_of ? { required_one_of: contract.required_one_of } : {}),
    input_schema: contract.input_schema,
    suggested_call: suggestedCall,
    _agent_guidance: {
      message:
        unknownParams.length > 0
          ? `Unknown parameter(s) for action "${action}": ${unknownParams.join(', ')}. Use the allowed_params list from this response and retry.`
          : shouldSuggestRetry
            ? `Invalid parameters for action "${action}". Retry the suggested_call after replacing any placeholder values.`
            : `Invalid parameter combination for action "${action}". Read details, then inspect the scoped help if needed.`,
      next_steps: shouldSuggestRetry
        ? [
            'Retry the suggested_call after replacing any placeholder values.',
            `If still unsure, call ${toolName} with { action: "help", params: { action_name: "${action}" } } to inspect this action only.`,
          ]
        : [
            'Read details for the semantic validation reason before retrying.',
            `Call ${toolName} with { action: "help", params: { action_name: "${action}" } } to inspect this action only.`,
          ],
    },
  };
}

function humanUiOnlyResponse(toolName: string, action: string): Record<string, unknown> {
  const lifecycleReason = PROJECT_LIFECYCLE_ALIAS_SET.has(action)
    ? ' For whole Projects, use archive_project or unarchive_project with project_id/project_name and wait for human approval. For one Application/worker, use archive_service or unarchive_service with service_id. Archive is reversible cleanup; use list_archived_services to inspect archived Applications.'
    : '';
  const isRestore = action.startsWith('unarchive');
  const isServiceAction = action.includes('service');
  const safeAlternativeAction = isRestore
    ? isServiceAction
      ? 'unarchive_service'
      : 'unarchive_project'
    : isServiceAction
      ? 'archive_service'
      : 'archive_project';
  const safeAlternativeTool = isServiceAction ? 'openlander_service' : 'openlander_project';

  return {
    error: 'HUMAN_UI_ONLY',
    action,
    blocked_action: action,
    composite: toolName,
    web_ui: {
      surface: 'project_settings_danger',
      requires_human: true,
    },
    safe_alternatives: [
      {
        tool: safeAlternativeTool,
        action: safeAlternativeAction,
        approval_required: true,
        effect: 'reversible_cleanup',
      },
    ],
    do_not_substitute: ['remove_service', 'cleanup_docker'],
    _agent_guidance: {
      message: `"${action}" is not exposed to MCP. Project/Application hard delete and purge are human UI-only operations; tell the user to use the web UI: Settings → Danger zone for that Project or resource.${lifecycleReason} Do not substitute remove_service, cleanup_docker, or other destructive tools — those target Database/Cache/Storage resources or Docker hosts, not Applications/Projects.`,
    },
  };
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
        const requestedAction =
          params && typeof params['action_name'] === 'string' ? params['action_name'] : undefined;
        if (requestedAction) {
          const requestedDef = toolDefs.find((def) => def.name === requestedAction);
          if (!requestedDef) {
            if (isHumanUiOnlyAction(requestedAction)) {
              return humanUiOnlyResponse(toolName, requestedAction);
            }
            return {
              error: 'UNKNOWN_ACTION',
              action: requestedAction,
              composite: toolName,
              available_actions: toolDefs.map((item) => item.name).sort(),
              suggested_call: {
                tool: toolName,
                arguments: { action: 'help' },
              },
              _agent_guidance: {
                message: `Unknown action "${requestedAction}". Use action="help" without params to list available operations.`,
              },
            };
          }

          return {
            composite: toolName,
            description,
            action: buildActionContract(requestedDef),
            _agent_guidance: {
              message: `Use params matching input_schema for action "${requestedAction}".`,
            },
          };
        }

        return {
          composite: toolName,
          description,
          actions: toolDefs.map(buildActionContract),
          _agent_guidance: {
            message: `Pick an action and call with params that match input_schema. Example: { action: "${toolDefs[0]?.name ?? 'help'}", params: { ... } }. For one action only, call { action: "help", params: { action_name: "..." } }.`,
          },
        };
      }

      const def = toolDefs.find((item) => item.name === action);
      if (!def) {
        if (isHumanUiOnlyAction(action)) {
          return humanUiOnlyResponse(toolName, action);
        }
        return {
          error: 'UNKNOWN_ACTION',
          action,
          composite: toolName,
          available_actions: toolDefs.map((item) => item.name).sort(),
          suggested_call: {
            tool: toolName,
            arguments: { action: 'help' },
          },
          _agent_guidance: {
            message: `Unknown action "${action}". Use action="help" to see available operations.`,
          },
        };
      }

      const contract = buildActionContract(def);
      const unknownParams = unknownTopLevelParams(params ?? {}, contract);
      if (unknownParams.length > 0) {
        return invalidParamsResponse(
          toolName,
          action,
          contract,
          `Unknown parameter(s): ${unknownParams.join(', ')}`,
          params ?? {},
          unknownParams,
        );
      }

      const parsed = def.inputSchema.safeParse(params ?? {});
      if (!parsed.success) {
        return invalidParamsResponse(
          toolName,
          action,
          contract,
          parsed.error.message,
          params ?? {},
        );
      }

      const safetyResult = await maybeHandleMcpSafety(def, parsed.data, context);
      if (safetyResult !== undefined) {
        return safetyResult;
      }

      const result = await def.execute(parsed.data, context);
      return def.mcp?.transformResult ? def.mcp.transformResult(result) : result;
    },
  };
}

export function createOpenLanderDeployCompositeTool(toolDefs: ToolDef[]): CompositeTool {
  return createCompositeTool(
    'openlander_deploy',
    'Deploy front door for new apps plus plans, validation, execution, status, build logs, Git scans, and previews. Domain routes live under openlander_service.add_domain_route.',
    toolDefs,
  );
}

export function createOpenLanderProjectCompositeTool(toolDefs: ToolDef[]): CompositeTool {
  return createCompositeTool(
    'openlander_project',
    'Projects and shared config. Projects organize Applications, Compose stacks, and Database/Cache/Storage resources; env actions route to workload targets.',
    toolDefs,
  );
}

export function createOpenLanderServiceCompositeTool(toolDefs: ToolDef[]): CompositeTool {
  return createCompositeTool(
    'openlander_service',
    'Applications/Compose workloads: redeploy, restart, rollback, config, env vars, domains, and temporary public URLs. Prefer compatibility field service_id.',
    toolDefs,
  );
}

export function createOpenLanderManagedServiceCompositeTool(toolDefs: ToolDef[]): CompositeTool {
  return createCompositeTool(
    'openlander_managed_service',
    'Database/Cache/Storage resources (Postgres, MySQL, Redis, Mongo, MinIO): provisioning, credentials, backups, users, buckets, volumes, disk usage, Docker cleanup.',
    toolDefs,
  );
}

export function createOpenLanderMonitorCompositeTool(toolDefs: ToolDef[]): CompositeTool {
  return createCompositeTool(
    'openlander_monitor',
    'Diagnostics first: instance info, service diagnosis, logs, system stats, alerts, project stats, and host probing.',
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
