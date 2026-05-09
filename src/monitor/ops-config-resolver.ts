/**
 * OpsConfig Resolver
 *
 * Resolves the effective automation policy for recovery operations.
 * Implements 3-tier merge: DEFAULT → globalConfig.recovery.automation → projectOverride?.automation
 */

import {
  type ConfigurableRecoveryStep,
  type OpsConfig,
  type ProjectOpsOverride,
  type RecoveryAutomationPolicy,
  DEFAULT_RECOVERY_AUTOMATION,
} from './ops-types.js';

/**
 * Resolves the effective automation policy for a recovery operation.
 * Applies 3-tier merge: DEFAULT → globalConfig.recovery.automation → projectOverride?.automation
 *
 * Returns null if recovery is disabled (globalConfig.recovery.enabled === false).
 *
 * @param globalConfig - The global OpsConfig
 * @param projectOverride - Optional project-level overrides
 * @returns The resolved RecoveryAutomationPolicy, or null if recovery is disabled
 */
export function resolveAutomationPolicy(
  globalConfig: OpsConfig,
  projectOverride?: ProjectOpsOverride,
): RecoveryAutomationPolicy | null {
  if (!globalConfig.recovery.enabled) {
    return null;
  }

  const steps: ConfigurableRecoveryStep[] = ['restart', 'diagnosis', 'apply_fixes', 'rollback'];

  // Start with defaults, then layer global config (required — always present)
  const result: RecoveryAutomationPolicy = { ...DEFAULT_RECOVERY_AUTOMATION };
  const globalAutomation = globalConfig.recovery.automation as Partial<RecoveryAutomationPolicy>;
  for (const step of steps) {
    const val = globalAutomation[step];
    if (val !== undefined) {
      result[step] = val;
    }
  }

  // Layer 3: project override (Partial — only defined steps override)
  if (projectOverride?.automation) {
    for (const step of steps) {
      const override = projectOverride.automation[step];
      if (override !== undefined) {
        result[step] = override;
      }
    }
  }

  return result;
}

/**
 * Returns true if all steps in the policy are set to 'auto' (no human confirmation needed).
 *
 * @param policy - The RecoveryAutomationPolicy to check
 * @returns true if all steps are 'auto', false otherwise
 */
export function isAutopilot(policy: RecoveryAutomationPolicy): boolean {
  const steps: ConfigurableRecoveryStep[] = ['restart', 'diagnosis', 'apply_fixes', 'rollback'];
  return steps.every((step) => policy[step] === 'auto');
}
