import type { DeployPlanComplexity, PlanEnvEntry } from './types.js';

/**
 * Computes required environment variables that are still missing.
 * Checks provided, auto-detected, and existing (database) env vars.
 */
export function computeMissingEnvVars(
  entries: PlanEnvEntry[],
  provided: Record<string, string>,
  autoDetected: Record<string, string>,
  existingEnvVars: Record<string, string> = {},
  plannedServiceKeys: ReadonlySet<string> = new Set<string>(),
): PlanEnvEntry[] {
  const missing: PlanEnvEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry.required || seen.has(entry.key)) {
      continue;
    }

    seen.add(entry.key);

    const isProvided = entry.key in provided;
    const isAutoDetected = entry.key in autoDetected;
    const isInDb = entry.key in existingEnvVars;
    const isPlannedServiceKey = plannedServiceKeys.has(entry.key);

    if (!isProvided && !isAutoDetected && !isInDb && !isPlannedServiceKey) {
      missing.push(entry);
    }
  }

  return missing;
}

/**
 * Computes deploy plan complexity from missing env and service counts.
 */
export function computeComplexity(params: {
  missingCount: number;
  serviceCount: number;
  isCompose: boolean;
}): DeployPlanComplexity {
  const { missingCount, serviceCount, isCompose } = params;

  if (missingCount === 0 && serviceCount === 0 && !isCompose) {
    return 'simple';
  }

  if (missingCount > 3 || serviceCount >= 2) {
    return 'complex';
  }

  return 'standard';
}
