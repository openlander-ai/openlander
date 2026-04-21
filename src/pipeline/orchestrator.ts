import { eventBus, type EventBus } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';
import {
  CircuitBreakerOpenError,
  ProjectArchivedError,
  ProjectRecoveringError,
} from '../errors.js';

const log = createModuleLogger('orchestrator');

export interface ServiceNode {
  name: string;
  dockerfile?: string;
  composePath?: string;
  dependsOn: string[];
  port?: number;
  envVars?: Record<string, string>;
}

export interface ServiceTopology {
  services: ServiceNode[];
  executionOrder: string[][];
  repoUrl: string;
  branch?: string;
  clonePath: string;
  commitSha: string;
}

export interface OrchestrationResult {
  success: boolean;
  services: Array<{
    name: string;
    status:
      | 'deployed'
      | 'failed'
      | 'rolled_back'
      | 'skipped'
      | 'rollback_skipped'
      | 'rollback_failed_due_to_policy'
      | 'rollback_failed';
    projectId?: string;
    url?: string;
    error?: string;
    duration?: number;
  }>;
  totalDuration: number;
}

export interface OrchestrationPipeline {
  deployService(
    service: ServiceNode,
    topology: ServiceTopology,
  ): Promise<{ success: boolean; projectId?: string; url?: string; error?: string }>;
  rollbackService(service: { name: string; projectId?: string; url?: string }): Promise<void>;
  waitForHealthy?(
    service: ServiceNode,
    deployment: { success: boolean; projectId?: string; url?: string; error?: string },
  ): Promise<{ healthy: boolean; error?: string }>;
}

/**
 * Dependency-aware deploy executor with atomic rollback semantics.
 */
export class DeployOrchestrator {
  constructor(private readonly events: EventBus = eventBus) {}

  /**
   * Build a deployment topology from service nodes using Kahn's algorithm.
   */
  buildTopology(
    services: ServiceNode[],
    repoUrl: string,
    clonePath: string,
    commitSha: string,
    branch?: string,
  ): ServiceTopology {
    const nameSet = new Set<string>();
    for (const service of services) {
      if (nameSet.has(service.name)) {
        throw new Error(`Duplicate service name: ${service.name}`);
      }
      nameSet.add(service.name);
    }

    const missingDependencies: string[] = [];
    for (const service of services) {
      for (const dependency of service.dependsOn) {
        if (!nameSet.has(dependency)) {
          missingDependencies.push(`${service.name} -> ${dependency}`);
        }
      }
    }
    if (missingDependencies.length > 0) {
      throw new Error(`Missing dependency references: ${missingDependencies.sort().join(', ')}`);
    }

    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    const orderIndex = new Map<string, number>();

    for (let index = 0; index < services.length; index += 1) {
      const service = services[index];
      if (!service) {
        continue;
      }
      inDegree.set(service.name, service.dependsOn.length);
      adjacency.set(service.name, []);
      orderIndex.set(service.name, index);
    }

    for (const service of services) {
      for (const dependency of service.dependsOn) {
        const dependents = adjacency.get(dependency);
        if (dependents) {
          dependents.push(service.name);
        }
      }
    }

    let currentLayer = services
      .filter((service) => (inDegree.get(service.name) ?? 0) === 0)
      .map((service) => service.name)
      .sort((left, right) => {
        const leftIndex = orderIndex.get(left) ?? 0;
        const rightIndex = orderIndex.get(right) ?? 0;
        return leftIndex - rightIndex;
      });

    const executionOrder: string[][] = [];
    let visitedCount = 0;

    while (currentLayer.length > 0) {
      executionOrder.push(currentLayer);
      visitedCount += currentLayer.length;

      const nextLayer: string[] = [];
      for (const serviceName of currentLayer) {
        const dependents = adjacency.get(serviceName) ?? [];
        for (const dependent of dependents) {
          const nextInDegree = (inDegree.get(dependent) ?? 0) - 1;
          inDegree.set(dependent, nextInDegree);
          if (nextInDegree === 0) {
            nextLayer.push(dependent);
          }
        }
      }

      currentLayer = nextLayer.sort((left, right) => {
        const leftIndex = orderIndex.get(left) ?? 0;
        const rightIndex = orderIndex.get(right) ?? 0;
        return leftIndex - rightIndex;
      });
    }

    if (visitedCount !== services.length) {
      throw new Error('Circular dependency detected in service topology');
    }

    return {
      services,
      executionOrder,
      repoUrl,
      branch,
      clonePath,
      commitSha,
    };
  }

  /**
   * Validate topology consistency and port allocation safety.
   */
  validateTopology(
    topology: ServiceTopology,
    usedPorts: number[] = [],
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (topology.services.length === 0) {
      errors.push('Topology is empty: at least one service is required');
      return { valid: false, errors };
    }

    const serviceNames = new Set(topology.services.map((service) => service.name));
    const seenPorts = new Map<number, string>();

    for (const service of topology.services) {
      for (const dependency of service.dependsOn) {
        if (!serviceNames.has(dependency)) {
          errors.push(
            `Missing dependency: ${service.name} depends on unknown service ${dependency}`,
          );
        }
      }

      if (service.port === undefined) {
        continue;
      }

      if (seenPorts.has(service.port)) {
        const conflictingService = seenPorts.get(service.port) ?? 'unknown';
        errors.push(
          `Port conflict in topology: ${service.name} and ${conflictingService} both request ${String(service.port)}`,
        );
      } else {
        seenPorts.set(service.port, service.name);
      }

      if (usedPorts.includes(service.port)) {
        errors.push(
          `Port conflict with existing services: ${service.name} requests in-use port ${String(service.port)}`,
        );
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Execute deployment groups in topological order with atomic rollback on failure.
   */
  async executeOrdered(
    topology: ServiceTopology,
    pipeline: OrchestrationPipeline,
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();
    const serviceMap = new Map(topology.services.map((service) => [service.name, service]));
    const executed: Array<{ name: string; projectId?: string; url?: string }> = [];
    const statuses: OrchestrationResult['services'] = [];
    let failedServiceName: string | null = null;

    await this.events.emit('orchestration:plan', { topology });

    if (topology.services.length === 0) {
      const result: OrchestrationResult = {
        success: false,
        services: [
          {
            name: 'topology',
            status: 'failed',
            error: 'Topology is empty: at least one service is required',
          },
        ],
        totalDuration: Date.now() - startTime,
      };
      await this.events.emit('orchestration:complete', { result });
      return result;
    }

    for (const group of topology.executionOrder) {
      const groupResults = await Promise.all(
        group.map(async (serviceName) => {
          const service = serviceMap.get(serviceName);
          if (!service) {
            return {
              name: serviceName,
              status: 'failed' as const,
              error: `Service not found in topology: ${serviceName}`,
              duration: 0,
            };
          }

          const serviceStart = Date.now();
          await this.events.emit('orchestration:service-start', { serviceName: service.name });

          const deployment = await pipeline.deployService(service, topology);
          if (!deployment.success) {
            const error = deployment.error ?? 'Service deployment failed';
            await this.events.emit('orchestration:service-failed', {
              serviceName: service.name,
              error,
            });
            return {
              name: service.name,
              status: 'failed' as const,
              error,
              projectId: deployment.projectId,
              url: deployment.url,
              duration: Date.now() - serviceStart,
            };
          }

          if (pipeline.waitForHealthy) {
            const health = await pipeline.waitForHealthy(service, deployment);
            if (!health.healthy) {
              const error = health.error ?? 'Health check failed';
              await this.events.emit('orchestration:service-failed', {
                serviceName: service.name,
                error,
              });
              return {
                name: service.name,
                status: 'failed' as const,
                error,
                projectId: deployment.projectId,
                url: deployment.url,
                duration: Date.now() - serviceStart,
              };
            }
          }

          await this.events.emit('orchestration:service-healthy', { serviceName: service.name });
          return {
            name: service.name,
            status: 'deployed' as const,
            projectId: deployment.projectId,
            url: deployment.url,
            duration: Date.now() - serviceStart,
          };
        }),
      );

      for (const result of groupResults) {
        statuses.push(result);
        if (result.status === 'deployed') {
          executed.push({ name: result.name, projectId: result.projectId, url: result.url });
        }
      }

      const failed = groupResults.find((result) => result.status === 'failed');
      if (failed) {
        failedServiceName = failed.name;
        break;
      }
    }

    if (failedServiceName) {
      // Track per-service rollback outcomes so the final status reflects
      // reality. Day 8 Bug #5: previously the orchestrator silently swallowed
      // any rollback exception (typically thrown by the pipeline mutation
      // policy when the service project was archived / recovering / circuit-
      // open between deploy and rollback) and still labelled the service
      // `rolled_back`. That hid partial deployments from operators.
      const rollbackOutcomes = new Map<
        string,
        | { kind: 'rolled_back' }
        | { kind: 'rollback_skipped'; reason: string }
        | { kind: 'rollback_failed_due_to_policy'; reason: string }
        | { kind: 'rollback_failed'; reason: string }
      >();
      for (const service of [...executed].reverse()) {
        try {
          await pipeline.rollbackService(service);
          rollbackOutcomes.set(service.name, { kind: 'rolled_back' });
        } catch (err) {
          log.warn({ err, serviceName: service.name }, 'Service rollback failed');
          if (
            err instanceof ProjectArchivedError ||
            err instanceof ProjectRecoveringError ||
            err instanceof CircuitBreakerOpenError
          ) {
            const reason = err.message;
            // Policy rejections are operator-set states (archived) or
            // automatic safety gates (circuit open / recovering). The
            // service is still deployed — surface as policy-blocked, not
            // as "rolled back".
            rollbackOutcomes.set(service.name, {
              kind: 'rollback_failed_due_to_policy',
              reason,
            });
          } else {
            const reason = err instanceof Error ? err.message : String(err);
            rollbackOutcomes.set(service.name, { kind: 'rollback_failed', reason });
          }
        }
      }

      const statusByName = new Map(statuses.map((status) => [status.name, status]));
      const finalStatuses: OrchestrationResult['services'] = topology.services.map((service) => {
        const current = statusByName.get(service.name);
        if (!current) {
          // Service was never attempted (e.g., topology fan-out broke before
          // its layer ran). Mark as rollback-skipped so the operator knows
          // it's still in whatever state it was before the orchestration.
          return { name: service.name, status: 'rollback_skipped' as const };
        }
        if (current.status === 'deployed') {
          const outcome = rollbackOutcomes.get(service.name);
          if (!outcome) {
            // Should not happen — every executed service got a rollback
            // attempt. Defensive: surface as policy-blocked rather than
            // silently labelling rolled_back.
            return {
              ...current,
              status: 'rollback_skipped' as const,
              error: current.error
                ? `${current.error}; rollback was not attempted`
                : 'rollback was not attempted',
            };
          }
          if (outcome.kind === 'rolled_back') {
            return { ...current, status: 'rolled_back' as const };
          }
          if (outcome.kind === 'rollback_failed_due_to_policy') {
            return {
              ...current,
              status: 'rollback_failed_due_to_policy' as const,
              error: current.error
                ? `${current.error}; rollback blocked: ${outcome.reason}`
                : `rollback blocked: ${outcome.reason}`,
            };
          }
          // F2 (Day 9): Generic rollback failure (non-policy) — distinct from
          // policy rejections so operators can tell apart "operator-set state
          // (archived/recovering/circuit-open)" from "Docker / generic error".
          // The container is still running; surface the underlying reason.
          return {
            ...current,
            status: 'rollback_failed' as const,
            error: current.error
              ? `${current.error}; rollback failed: ${outcome.reason}`
              : `rollback failed: ${outcome.reason}`,
          };
        }
        return current;
      });

      const result: OrchestrationResult = {
        success: false,
        services: finalStatuses,
        totalDuration: Date.now() - startTime,
      };
      await this.events.emit('orchestration:complete', { result });
      return result;
    }

    const result: OrchestrationResult = {
      success: true,
      services: topology.services.map((service) => {
        const status = statuses.find((entry) => entry.name === service.name);
        if (!status) {
          return { name: service.name, status: 'skipped' as const };
        }
        return status;
      }),
      totalDuration: Date.now() - startTime,
    };
    await this.events.emit('orchestration:complete', { result });
    return result;
  }
}
