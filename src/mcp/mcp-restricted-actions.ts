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
 * - HUMAN_UI_ONLY_ALIASES: names that are NOT MCP tools at all (project
 *   lifecycle, hard delete / purge, and whole-group restore aliases). The composite
 *   intercepts them with a HUMAN_UI_ONLY pointer to the web UI so a "delete it"
 *   prompt doesn't spiral into adjacent destructive tools.
 * - APPROVAL_HOLD_TOOLS: destructive or lifecycle-changing tools allowed via
 *   MCP only behind a human approval hold.
 */

export const HUMAN_UI_ONLY_TOOLS = [
  'remove_service',
  'remove_volume',
  'delete_bucket',
  'platform_force_remove',
  'recover_platform',
  'platform_cleanup_orphans',
  'cleanup_docker',
] as const;

export const HUMAN_UI_ONLY_ALIASES = [
  'archive_app',
  'archive_project',
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
  'unarchive_project',
] as const;

export const PROJECT_LIFECYCLE_ALIASES = [
  'archive_app',
  'archive_project',
  'unarchive_app',
  'unarchive_project',
] as const;

export const APPROVAL_HOLD_TOOLS = [
  'archive_service',
  'unarchive_service',
  'bulk_delete_env_vars',
  'remove_secret_file',
] as const;

export type HumanUiOnlyTool = (typeof HUMAN_UI_ONLY_TOOLS)[number];
export type HumanUiOnlyAlias = (typeof HUMAN_UI_ONLY_ALIASES)[number];
export type ProjectLifecycleAlias = (typeof PROJECT_LIFECYCLE_ALIASES)[number];
export type ApprovalHoldTool = (typeof APPROVAL_HOLD_TOOLS)[number];

export const HUMAN_UI_ONLY_TOOL_SET: ReadonlySet<string> = new Set(HUMAN_UI_ONLY_TOOLS);
export const HUMAN_UI_ONLY_ALIAS_SET: ReadonlySet<string> = new Set(HUMAN_UI_ONLY_ALIASES);
export const PROJECT_LIFECYCLE_ALIAS_SET: ReadonlySet<string> = new Set(PROJECT_LIFECYCLE_ALIASES);
export const APPROVAL_HOLD_TOOL_SET: ReadonlySet<string> = new Set(APPROVAL_HOLD_TOOLS);
