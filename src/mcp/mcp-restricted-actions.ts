/**
 * Single source of truth for MCP actions that are restricted in OpenLander 0.1.
 *
 * Both the enforcement layer (`destructive-safety.ts`) and the composite
 * catalog/alias layer (`composite-tools.ts`) derive their sets from here, so the
 * "what is blocked / held / aliased" policy can't drift across files (it used to
 * live in three places with `delete_service` duplicated).
 *
 * Three tiers:
 * - HUMAN_UI_ONLY_TOOLS: real tool defs that exist but are blocked from MCP
 *   execution (managed-infrastructure destruction). Invoking via MCP returns
 *   OPERATION_REQUIRES_HUMAN_UI.
 * - HUMAN_UI_ONLY_ALIASES: names that are NOT MCP tools at all (hard delete /
 *   purge and legacy app lifecycle aliases). The composite intercepts them
 *   with a HUMAN_UI_ONLY pointer to the safe MCP action or web UI so a "delete it"
 *   prompt doesn't spiral into adjacent destructive tools.
 * - APPROVAL_HOLD_TOOLS: tools the approval executor can run. Lifecycle tools
 *   always enter the queue; resource deletion tools enter it only when the
 *   effective Security permission is `approval_required`.
 */

export const HUMAN_UI_ONLY_TOOLS = [
  'platform_force_remove',
  'recover_platform',
  'platform_cleanup_orphans',
  'cleanup_docker',
] as const;

export const HUMAN_UI_ONLY_ALIASES = [
  'archive_app',
  'delete_app',
  'delete_project',
  'delete_service',
  'destroy_app',
  'destroy_project',
  'purge_app',
  'purge_project',
  'remove_app',
  'remove_project',
  'unarchive_app',
  'finalize_delivery',
  'finalize_delivery_receipt',
] as const;

export const PROJECT_LIFECYCLE_ALIASES = ['archive_app', 'unarchive_app'] as const;

export const APPROVAL_HOLD_TOOLS = [
  'remove_service',
  'remove_volume',
  'delete_bucket',
  'archive_project',
  'unarchive_project',
  'archive_service',
  'unarchive_service',
  'bulk_delete_env_vars',
  'remove_secret_file',
  'remove_git_credential',
  'remove_unused_docker_network',
] as const;

export type HumanUiOnlyTool = (typeof HUMAN_UI_ONLY_TOOLS)[number];
export type HumanUiOnlyAlias = (typeof HUMAN_UI_ONLY_ALIASES)[number];
export type ProjectLifecycleAlias = (typeof PROJECT_LIFECYCLE_ALIASES)[number];
export type ApprovalHoldTool = (typeof APPROVAL_HOLD_TOOLS)[number];

export const HUMAN_UI_ONLY_TOOL_SET: ReadonlySet<string> = new Set(HUMAN_UI_ONLY_TOOLS);
export const HUMAN_UI_ONLY_ALIAS_SET: ReadonlySet<string> = new Set(HUMAN_UI_ONLY_ALIASES);
export const PROJECT_LIFECYCLE_ALIAS_SET: ReadonlySet<string> = new Set(PROJECT_LIFECYCLE_ALIASES);
export const APPROVAL_HOLD_TOOL_SET: ReadonlySet<string> = new Set(APPROVAL_HOLD_TOOLS);
