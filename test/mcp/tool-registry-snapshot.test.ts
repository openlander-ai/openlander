import { describe, expect, it } from 'vitest';
import { debugToolDefs } from '../../src/tools/defs/debug.js';
import { deployableServiceToolDefs } from '../../src/tools/defs/deployable-service.js';
import { deployToolDefs } from '../../src/tools/defs/deploy.js';
import { deployPlanToolDefs } from '../../src/tools/defs/deploy-plan.js';
import { envToolDefs } from '../../src/tools/defs/env.js';
import { gitToolDefs } from '../../src/tools/defs/git.js';
import { infraToolDefs } from '../../src/tools/defs/infra.js';
import { monitoringToolDefs } from '../../src/tools/defs/monitoring.js';
import { projectOpsToolDefs } from '../../src/tools/defs/project-ops.js';
import { serviceToolDefs } from '../../src/tools/defs/service.js';
import { volumeToolDefs } from '../../src/tools/defs/volume.js';
import type { ToolDef } from '../../src/tools/defs/types.js';

/** Snapshot of non-platform MCP ToolDefs. Legacy project runtime aliases are removed. */
const EXPECTED_TOOLS = [
  'add_domain_route',
  'add_volume',
  'analyze_infrastructure',
  'archive_project',
  'archive_service',
  'backup_service',
  'bulk_delete_env_vars',
  'cleanup_docker',
  'cleanup_preview',
  'create_bucket',
  'create_deploy_plan',
  'create_service',
  'create_service_user',
  'delete_bucket',
  'delete_env_var',
  'deploy_app',
  'diagnose_host_resources',
  'diagnose_service',
  'dismiss_alert',
  'exec_service_container',
  'execute_deploy_plan',
  'export_env_vars',
  'expose_public',
  'get_alerts',
  'get_build_log',
  'get_deploy_history',
  'get_deploy_status',
  'get_disk_usage',
  'get_env_var',
  'get_instance_info',
  'get_logs',
  'get_project_stats',
  'get_service_credentials',
  'get_service_logs',
  'get_service_status',
  'get_system_stats',
  'get_topology',
  'list_archived_services',
  'list_buckets',
  'list_domain_routes',
  'list_env_vars',
  'list_github_repos',
  'list_global_secrets',
  'list_previews',
  'list_projects',
  'list_secret_files',
  'list_service_backups',
  'list_services',
  'list_volumes',
  'mcp_action_status',
  'preview_deploy',
  'probe_host',
  'redeploy_app',
  'remove_secret_file',
  'remove_service',
  'remove_volume',
  'restart_service',
  'restore_service',
  'rollback_service',
  'scan_dockerfiles',
  'search_github_repos',
  'set_env_vars',
  'set_global_secret',
  'start_service',
  'stop_service',
  'unarchive_project',
  'unarchive_service',
  'unexpose_public',
  'update_deploy_plan',
  'update_service_config',
  'upload_secret_file',
  'validate_deploy_plan',
];

const REMOVED_PROJECT_RUNTIME_TOOLS = [
  'redeploy_project',
  'restart_project',
  'rollback_project',
  'start_project',
  'stop_project',
  'update_project_config',
];

function getMcpToolDefs(): ToolDef[] {
  return [
    ...deployToolDefs,
    ...deployableServiceToolDefs,
    ...deployPlanToolDefs,
    ...projectOpsToolDefs,
    ...envToolDefs,
    ...serviceToolDefs,
    ...volumeToolDefs,
    ...infraToolDefs,
    ...gitToolDefs,
    ...monitoringToolDefs,
    ...debugToolDefs,
  ];
}

function isMcpTargeted(def: ToolDef): boolean {
  return !def.targets || def.targets.includes('mcp');
}

describe('MCP Tool Registry Snapshot', () => {
  it('captures current non-platform MCP tools', () => {
    const mcpTools = getMcpToolDefs()
      .filter(isMcpTargeted)
      .map((t) => t.name)
      .sort();

    expect(mcpTools).toEqual(EXPECTED_TOOLS);
    for (const removed of REMOVED_PROJECT_RUNTIME_TOOLS) {
      expect(mcpTools).not.toContain(removed);
    }
  });

  it('maintains exactly 72 non-platform MCP tools', () => {
    expect(getMcpToolDefs().filter(isMcpTargeted)).toHaveLength(72);
  });

  it('all MCP tools have valid names (snake_case)', () => {
    for (const tool of getMcpToolDefs().filter(isMcpTargeted)) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
    }
  });

  it('all MCP tools have descriptions', () => {
    for (const tool of getMcpToolDefs().filter(isMcpTargeted)) {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('all MCP tools have input schemas', () => {
    for (const tool of getMcpToolDefs().filter(isMcpTargeted)) {
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('all MCP tools have execute functions', () => {
    for (const tool of getMcpToolDefs().filter(isMcpTargeted)) {
      expect(typeof tool.execute).toBe('function');
    }
  });
});
