import type { ComposeRuntimeRole, ComposeService } from './compose.js';

export interface ComposeDeploymentSets {
  replaceTargets: Set<string>;
  prerequisites: Set<string>;
  runOnceHooks: Set<string>;
  includedServices: Set<string>;
}

export interface ComposeDeploymentSetOptions {
  services: readonly ComposeService[];
  runtimeRoles: ReadonlyMap<string, ComposeRuntimeRole>;
  selectedServices?: readonly string[];
  existingServices?: ReadonlySet<string>;
  previousFingerprints?: Readonly<Record<string, string>>;
  currentFingerprints?: Readonly<Record<string, string>>;
}

/**
 * Split a Compose deployment into containers that are replaced, dependencies
 * that are only verified, and one-shot jobs that must complete before a direct
 * replacement target starts.
 */
export function planComposeDeploymentSets(
  options: ComposeDeploymentSetOptions,
): ComposeDeploymentSets {
  const serviceByName = new Map(options.services.map((service) => [service.name, service]));
  const selected = new Set(options.selectedServices ?? []);
  const isSelective = selected.size > 0;
  const existing = options.existingServices ?? new Set<string>();
  const replaceTargets = new Set<string>();
  const prerequisites = new Set<string>();
  const runOnceHooks = new Set<string>();

  for (const service of options.services) {
    const role = options.runtimeRoles.get(service.name) ?? 'application';
    if (role !== 'application') continue;

    if (isSelective) {
      if (selected.has(service.name)) replaceTargets.add(service.name);
      continue;
    }

    const previous = options.previousFingerprints?.[service.name];
    const current = options.currentFingerprints?.[service.name];
    const isMissing = !existing.has(service.name);
    const isChanged = previous === undefined || current === undefined || previous !== current;
    if (isMissing || isChanged) {
      replaceTargets.add(service.name);
    } else {
      prerequisites.add(service.name);
    }
  }

  const visitPrerequisite = (serviceName: string): void => {
    if (replaceTargets.has(serviceName) || prerequisites.has(serviceName)) return;
    const service = serviceByName.get(serviceName);
    if (!service) return;

    prerequisites.add(serviceName);
    for (const dependency of service.dependsOn ?? []) {
      // A hook belonging to a reused application must not run. For example,
      // replacing web while reusing api must not re-run api's migration.
      if (service.dependsOnConditions?.[dependency] === 'service_completed_successfully') {
        continue;
      }
      visitPrerequisite(dependency);
    }
  };

  for (const targetName of replaceTargets) {
    const target = serviceByName.get(targetName);
    if (!target) continue;
    for (const dependency of target.dependsOn ?? []) {
      if (target.dependsOnConditions?.[dependency] === 'service_completed_successfully') {
        runOnceHooks.add(dependency);
        const hook = serviceByName.get(dependency);
        for (const hookDependency of hook?.dependsOn ?? []) {
          visitPrerequisite(hookDependency);
        }
      } else {
        visitPrerequisite(dependency);
      }
    }
  }

  if (!isSelective) {
    for (const service of options.services) {
      const role = options.runtimeRoles.get(service.name) ?? 'application';
      if (role === 'resource') prerequisites.add(service.name);
      if (role === 'job' && existing.size === 0) runOnceHooks.add(service.name);
    }
  }

  for (const name of replaceTargets) prerequisites.delete(name);
  for (const name of runOnceHooks) prerequisites.delete(name);

  return {
    replaceTargets,
    prerequisites,
    runOnceHooks,
    includedServices: new Set([...replaceTargets, ...prerequisites, ...runOnceHooks]),
  };
}
