export type RiskLevel = 'low' | 'medium' | 'high';
export type Decision = 'ALLOW' | 'NOTIFY_THEN_ALLOW' | 'REQUIRE_APPROVAL';

const HIGH_RISK_DEFAULTS = new Set([
  'rollback_project',
  'rollback_service',
  'archive_project',
  'remove_project',
  'remove_service',
  'create_database',
  'platform_cleanup_orphans',
  'platform_reconcile',
  'platform_force_remove',
  'remove_volume',
]);

const READ_ONLY_TOOLS = new Set([
  'get_logs',
  'get_deploy_status',
  'get_project_stats',
  'get_server_stats',
  'list_projects',
  'list_env_vars',
  'list_services',
  'list_domains',
  'get_project',
  'get_service',
  'get_system_info',
  'list_volumes',
  'get_deploy_logs',
  'get_container_stats',
  'scan_dockerfiles',
  'detect_services',
  'get_build_logs',
]);

export class DecisionEngine {
  classify(toolName: string, riskLevel?: RiskLevel): Decision {
    const level = riskLevel ?? this.getDefaultRisk(toolName);
    switch (level) {
      case 'low':
        return 'ALLOW';
      case 'medium':
        return 'NOTIFY_THEN_ALLOW';
      case 'high':
        return 'REQUIRE_APPROVAL';
    }
  }

  private getDefaultRisk(toolName: string): RiskLevel {
    if (HIGH_RISK_DEFAULTS.has(toolName)) {
      return 'high';
    }
    if (READ_ONLY_TOOLS.has(toolName)) {
      return 'low';
    }
    return 'medium';
  }
}

export const decisionEngine = new DecisionEngine();
