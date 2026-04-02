import { createModuleLogger } from '../../lib/logger.js';
import type { ServiceNode } from '../orchestrator.js';

const log = createModuleLogger('deploy');

/**
 * Detects dependencies between monorepo services by scanning env vars for sibling container
 * name patterns (e.g. `ol-mono-api`). Updates `dependsOn` arrays in place.
 * Falls back to empty dependsOn if circular dependencies are detected.
 */
export function detectMonorepoDependencies(
  services: ServiceNode[],
  parentName: string,
  getEnvVarsForService: (serviceName: string) => Record<string, string>,
): void {
  const parentNormalized = parentName.replace(/\//g, '-');
  const containerToService = new Map<string, string>();

  for (const service of services) {
    containerToService.set(`ol-${parentNormalized}-${service.name}`, service.name);
  }

  for (const service of services) {
    const envVars = getEnvVarsForService(service.name);
    const dependencies = new Set<string>();

    for (const value of Object.values(envVars)) {
      for (const [containerName, siblingName] of containerToService.entries()) {
        if (siblingName === service.name) {
          continue;
        }
        if (value.includes(containerName)) {
          dependencies.add(siblingName);
        }
      }
    }

    service.dependsOn = [...dependencies];
  }

  if (hasCircularDependency(services)) {
    log.warn(
      { parentName, services: services.map((service) => service.name) },
      'Circular dependency detected in monorepo services — falling back to parallel deploy',
    );
    for (const service of services) {
      service.dependsOn = [];
    }
  }
}

function hasCircularDependency(services: ServiceNode[]): boolean {
  const serviceMap = new Map(services.map((service) => [service.name, service]));
  const visited = new Set<string>();
  const inStack = new Set<string>();

  const dfs = (name: string): boolean => {
    if (inStack.has(name)) {
      return true;
    }
    if (visited.has(name)) {
      return false;
    }

    visited.add(name);
    inStack.add(name);

    const service = serviceMap.get(name);
    if (service) {
      for (const dependency of service.dependsOn) {
        if (!serviceMap.has(dependency)) {
          continue;
        }
        if (dfs(dependency)) {
          return true;
        }
      }
    }

    inStack.delete(name);
    return false;
  };

  for (const service of services) {
    if (!visited.has(service.name) && dfs(service.name)) {
      return true;
    }
  }

  return false;
}
