import { describe, expect, it } from 'vitest';
import { debugToolDefs } from '../../src/tools/defs/debug.js';
import { deployToolDefs } from '../../src/tools/defs/deploy.js';
import { deployPlanToolDefs } from '../../src/tools/defs/deploy-plan.js';
import { envToolDefs } from '../../src/tools/defs/env.js';
import { gitToolDefs } from '../../src/tools/defs/git.js';
import { infraToolDefs } from '../../src/tools/defs/infra.js';
import { monitoringToolDefs } from '../../src/tools/defs/monitoring.js';
import { opsAutomationToolDefs } from '../../src/tools/defs/ops-automation.js';
import { projectOpsToolDefs } from '../../src/tools/defs/project-ops.js';
import { serviceToolDefs } from '../../src/tools/defs/service.js';
import { volumeToolDefs } from '../../src/tools/defs/volume.js';
import { webhookToolDefs } from '../../src/tools/defs/webhook.js';
import type { ToolDef } from '../../src/tools/defs/types.js';

/**
 * Snapshot of MCP-exposed tools (non-platform, baseline for regression testing).
 * This list was captured after T2 deletions (8 tools removed).
 * Used to validate that the MCP tool registry doesn't accidentally expose/hide tools.
 */
const EXPECTED_TOOLS = [
  'add_volume',
  'analyze_infrastructure',
  'archive_project',
  'backup_service',
  'bulk_delete_env_vars',
  'cleanup_docker',
  'cleanup_preview',
  'create_bucket',
  'create_deploy_plan',
  'create_service',
  'create_service_user',
  'debug_build_error',
  'delete_bucket',
  'delete_env_var',
  'deploy',
  'deploy_blue_green',
  'disable_webhook',
  'dismiss_alert',
  'enable_webhook',
  'exec_service_container',
  'execute_deploy_plan',
  'export_env_vars',
  'expose_public',
  'get_alerts',
  'get_automation_policy',
  'get_build_log',
  'get_deploy_history',
  'get_deploy_status',
  'get_disk_usage',
  'get_env_var',
  'get_logs',
  'get_project_stats',
  'get_service_credentials',
  'get_service_logs',
  'get_service_status',
  'get_system_stats',
  'get_webhook_config',
  'list_buckets',
  'list_domains',
  'list_env_vars',
  'list_github_repos',
  'list_global_secrets',
  'list_previews',
  'list_projects',
  'list_secret_files',
  'list_service_backups',
  'list_services',
  'list_volumes',
  'map_domain',
  'preview_deploy',
  'probe_host',
  'redeploy_project',
  'remove_secret_file',
  'remove_service',
  'remove_volume',
  'restart_project',
  'restore_service',
  'rollback_project',
  'rollback_service',
  'scan_dockerfiles',
  'search_github_repos',
  'set_automation_policy',
  'set_env_vars',
  'set_global_secret',
  'start_project',
  'start_service',
  'stop_project',
  'stop_service',
  'unarchive_project',
  'unexpose_public',
  'update_deploy_plan',
  'update_project_config',
  'upload_secret_file',
  'validate_deploy_plan',
];

function getMcpToolDefs(platformToolsEnabled: boolean): ToolDef[] {
  return [
    ...deployToolDefs,
    ...deployPlanToolDefs,
    ...projectOpsToolDefs,
    ...envToolDefs,
    ...serviceToolDefs,
    ...volumeToolDefs,
    ...infraToolDefs,
    ...gitToolDefs,
    ...monitoringToolDefs,
    ...opsAutomationToolDefs,
    ...debugToolDefs,
    ...webhookToolDefs,
    ...(platformToolsEnabled ? [] : []),
  ];
}

function isMcpTargeted(def: ToolDef): boolean {
  return !def.targets || def.targets.includes('mcp');
}

describe('MCP Tool Registry Snapshot', () => {
  it('captures current non-platform MCP tools (baseline for regression)', () => {
    const toolDefs = getMcpToolDefs(false);
    const mcpTools = toolDefs
      .filter(isMcpTargeted)
      .map((t) => t.name)
      .sort();

    expect(mcpTools).toEqual(EXPECTED_TOOLS);
  });

  it('maintains exactly 74 non-platform MCP tools', () => {
    const toolDefs = getMcpToolDefs(false);
    const mcpTools = toolDefs.filter(isMcpTargeted);

    expect(mcpTools).toHaveLength(74);
  });

  it('all MCP tools have valid names (snake_case)', () => {
    const toolDefs = getMcpToolDefs(false);
    const mcpTools = toolDefs.filter(isMcpTargeted);

    for (const tool of mcpTools) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
    }
  });

  it('all MCP tools have descriptions', () => {
    const toolDefs = getMcpToolDefs(false);
    const mcpTools = toolDefs.filter(isMcpTargeted);

    for (const tool of mcpTools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('all MCP tools have input schemas', () => {
    const toolDefs = getMcpToolDefs(false);
    const mcpTools = toolDefs.filter(isMcpTargeted);

    for (const tool of mcpTools) {
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('all MCP tools have execute functions', () => {
    const toolDefs = getMcpToolDefs(false);
    const mcpTools = toolDefs.filter(isMcpTargeted);

    for (const tool of mcpTools) {
      expect(typeof tool.execute).toBe('function');
    }
  });
});
