import { describe, expect, it } from 'vitest';
import { debugToolDefs } from '../../src/tools/defs/debug.js';
import { deliveryToolDefs } from '../../src/tools/defs/delivery.js';
import { engagementToolDefs } from '../../src/tools/defs/engagement.js';
import {
  agentDeliveryToolDefs,
  projectManifestToolDefs,
} from '../../src/tools/defs/agent-delivery.js';
import { releaseOperationToolDefs } from '../../src/tools/defs/release-operations.js';
import { reportingOperationToolDefs } from '../../src/tools/defs/reporting-operations.js';
import { deployableServiceToolDefs } from '../../src/tools/defs/deployable-service.js';
import { deployToolDefs } from '../../src/tools/defs/deploy.js';
import { deployPlanToolDefs } from '../../src/tools/defs/deploy-plan.js';
import { envToolDefs } from '../../src/tools/defs/env.js';
import { gitToolDefs } from '../../src/tools/defs/git.js';
import { infraToolDefs } from '../../src/tools/defs/infra.js';
import { monitoringToolDefs } from '../../src/tools/defs/monitoring.js';
import { networkOperationToolDefs } from '../../src/tools/defs/network-operations.js';
import { projectOpsToolDefs } from '../../src/tools/defs/project-ops.js';
import { serviceToolDefs } from '../../src/tools/defs/service.js';
import { volumeToolDefs } from '../../src/tools/defs/volume.js';
import type { ToolDef } from '../../src/tools/defs/types.js';

/** Snapshot of non-platform MCP ToolDefs. Legacy project runtime aliases are removed. */
const EXPECTED_TOOLS = [
  'add_domain_route',
  'add_volume',
  'analyze_infrastructure',
  'apply_project_manifest',
  'apply_route_config',
  'archive_engagement',
  'archive_project',
  'archive_service',
  'attach_delivery_url',
  'backup_service',
  'bootstrap_engagement',
  'bulk_delete_env_vars',
  'cancel_delivery_run',
  'cancel_deploy',
  'cleanup_docker',
  'cleanup_preview',
  'complete_delivery',
  'create_bucket',
  'create_delivery',
  'create_deploy_plan',
  'create_evidence_upload',
  'create_git_deploy_key',
  'create_project',
  'create_release',
  'create_service',
  'create_service_user',
  'delete_bucket',
  'delete_env_var',
  'deploy_app',
  'describe_data_source',
  'diagnose_host_resources',
  'diagnose_service',
  'dismiss_alert',
  'evaluate_promotion',
  'exec_service_container',
  'execute_deploy_plan',
  'export_env_vars',
  'expose_public',
  'generate_delivery_receipt_preview',
  'generate_weekly_report',
  'get_ai_ops_briefing',
  'get_alerts',
  'get_build_log',
  'get_delivery',
  'get_delivery_readiness',
  'get_delivery_review_package_status',
  'get_delivery_review_status',
  'get_delivery_run',
  'get_deploy_history',
  'get_deploy_plan',
  'get_deploy_status',
  'get_disk_usage',
  'get_engagement',
  'get_env_var',
  'get_instance_info',
  'get_logs',
  'get_project_context',
  'get_project_manifest',
  'get_project_stats',
  'get_project_update',
  'get_public_access',
  'get_release',
  'get_service_credentials',
  'get_service_logs',
  'get_service_status',
  'get_system_stats',
  'get_topology',
  'get_weekly_report',
  'link_delivery_deploy',
  'link_project_to_engagement',
  'list_ai_ops_briefings',
  'list_archived_services',
  'list_buckets',
  'list_data_sources',
  'list_deliveries',
  'list_docker_networks',
  'list_domain_routes',
  'list_engagements',
  'list_env_vars',
  'list_git_credentials',
  'list_github_repos',
  'list_global_secrets',
  'list_previews',
  'list_projects',
  'list_secret_files',
  'list_service_backups',
  'list_services',
  'list_volumes',
  'mcp_action_status',
  'plan_delivery',
  'prepare_delivery_review_package',
  'preview_deploy',
  'probe_host',
  'promote_release',
  'publish_delivery_review_package',
  'publish_weekly_report',
  'read_data_source',
  'recall_release',
  'record_delivery_feedback',
  'record_delivery_gate_result',
  'record_delivery_run_progress',
  'record_project_update',
  'redeploy_app',
  'register_project_repository',
  'remove_git_credential',
  'remove_secret_file',
  'remove_service',
  'remove_unused_docker_network',
  'remove_volume',
  'request_delivery_review',
  'restart_service',
  'restore_service',
  'resume_delivery_run',
  'rollback_environment',
  'rollback_service',
  'run_quality_gates',
  'scan_dockerfiles',
  'search_github_repos',
  'set_env_vars',
  'set_global_secret',
  'start_delivery_run',
  'start_service',
  'stop_service',
  'submit_delivery_work_item_drafts',
  'unarchive_engagement',
  'unarchive_project',
  'unarchive_service',
  'unexpose_public',
  'unlink_project_from_engagement',
  'update_app',
  'update_application_source',
  'update_delivery_draft',
  'update_deploy_plan',
  'update_engagement_from_brief',
  'update_service_config',
  'upload_secret_file',
  'validate_deploy_plan',
  'verify_git_credential',
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
    ...networkOperationToolDefs,
    ...debugToolDefs,
    ...deliveryToolDefs,
    ...engagementToolDefs,
    ...agentDeliveryToolDefs,
    ...projectManifestToolDefs,
    ...releaseOperationToolDefs,
    ...reportingOperationToolDefs,
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

  it('maintains exactly 138 non-platform MCP tools', () => {
    expect(getMcpToolDefs().filter(isMcpTargeted)).toHaveLength(138);
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
