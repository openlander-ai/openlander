import {
  StatefulServiceChangeBlockedError,
  StatefulServiceRemovalBlockedError,
} from '../errors.js';
import type { ComposeRuntimeRole } from './compose.js';

export interface ExistingComposeRuntime {
  name: string;
  runtimeRole: ComposeRuntimeRole;
}

export function assertComposeStatefulChangesSafe(options: {
  currentServiceNames: ReadonlySet<string>;
  currentRuntimeRoles: ReadonlyMap<string, ComposeRuntimeRole>;
  existingServices: readonly ExistingComposeRuntime[];
  previousFingerprints?: Readonly<Record<string, string>>;
  currentFingerprints: Readonly<Record<string, string>>;
}): void {
  for (const existing of options.existingServices) {
    if (existing.runtimeRole !== 'resource') continue;
    if (!options.currentServiceNames.has(existing.name)) {
      throw new StatefulServiceRemovalBlockedError(existing.name);
    }
  }

  if (!options.previousFingerprints) return;
  for (const [serviceName, role] of options.currentRuntimeRoles) {
    if (role !== 'resource') continue;
    if (!options.existingServices.some((service) => service.name === serviceName)) continue;
    const previous = options.previousFingerprints[serviceName];
    const current = options.currentFingerprints[serviceName];
    // A v1 snapshot has no fingerprint. Record the current definition on this
    // deploy instead of blocking an unverifiable legacy state.
    if (previous !== undefined && current !== undefined && previous !== current) {
      throw new StatefulServiceChangeBlockedError(serviceName);
    }
  }
}
