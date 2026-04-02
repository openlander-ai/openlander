/**
 * DecisionEngine — Rule-based risk classification for tool execution.
 *
 * Classifies tools into risk levels (low, medium, high) and returns
 * a decision (ALLOW, NOTIFY_THEN_ALLOW, REQUIRE_APPROVAL) for approval gates.
 */

export type RiskLevel = 'low' | 'medium' | 'high';
export type Decision = 'ALLOW' | 'NOTIFY_THEN_ALLOW' | 'REQUIRE_APPROVAL';

/**
 * High-risk tools that require explicit user approval before execution.
 * These are destructive or irreversible operations.
 */
const HIGH_RISK_DEFAULTS = new Set([
  'rollback_project',
  'remove_project',
  'remove_service',
  'create_database',
]);

/**
 * Read-only tools that are safe to execute without approval.
 */
const READ_ONLY_TOOLS = new Set([
  'get_logs',
  'get_deploy_status',
  'get_project_stats',
  'list_projects',
  'list_env_vars',
  'list_services',
  'list_domains',
  'get_server_stats',
  'analyze_infrastructure',
  'get_build_log',
  'get_alerts',
  'get_service_credentials',
  'list_action_runs',
  'get_action_run_details',
]);

/**
 * DecisionEngine — Classifies tool execution risk and returns approval decision.
 */
export class DecisionEngine {
  /**
   * Classify a tool and return an approval decision.
   *
   * @param toolName — The tool name (snake_case)
   * @param riskLevel — Optional explicit risk level (overrides default)
   * @returns Decision: ALLOW, NOTIFY_THEN_ALLOW, or REQUIRE_APPROVAL
   */
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

  /**
   * Get the default risk level for a tool by name.
   * Used as fallback when riskLevel is not explicitly provided.
   *
   * @param toolName — The tool name (snake_case)
   * @returns RiskLevel: 'low', 'medium', or 'high'
   */
  private getDefaultRisk(toolName: string): RiskLevel {
    if (HIGH_RISK_DEFAULTS.has(toolName)) {
      return 'high';
    }
    if (READ_ONLY_TOOLS.has(toolName)) {
      return 'low';
    }
    // Default to medium for unknown tools (state-changing but potentially recoverable)
    return 'medium';
  }
}

/**
 * Singleton instance of DecisionEngine.
 * Import and use directly: `decisionEngine.classify(toolName)`
 */
export const decisionEngine = new DecisionEngine();
