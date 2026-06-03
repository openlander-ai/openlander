import type { AppContext } from '../app.js';
import { createModuleLogger } from '../lib/logger.js';
import type { OpsAlert } from './ops-types.js';

const log = createModuleLogger('ops-cascade');

function connectionProjectId(connection: {
  project_id?: string | null;
  service_id_consumer: string;
}): string {
  if (connection.project_id) {
    return connection.project_id;
  }
  return connection.service_id_consumer.endsWith('__svc')
    ? connection.service_id_consumer.replace(/__svc$/, '')
    : connection.service_id_consumer;
}

export interface CascadeResult {
  rootServiceId: string;
  rootServiceName: string;
  affectedProjectIds: string[];
  affectedProjectNames: string[];
}

export class CascadeDetector {
  private readonly ctx: AppContext;
  private readonly recentFailures = new Map<string, number>();
  private readonly CORRELATION_WINDOW_MS = 30_000;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async recordFailure(projectId: string): Promise<void> {
    // Skip projects already in error state to avoid cascade false positives
    const project = await this.ctx.db.getProject(projectId);
    // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
    if (project?.status === 'error') return;

    this.recentFailures.set(projectId, Date.now());
  }

  async detectCascade(): Promise<CascadeResult | null> {
    this.cleanupOldFailures();

    const now = Date.now();
    const recentIds: string[] = [];
    for (const [id, ts] of this.recentFailures) {
      if (now - ts <= this.CORRELATION_WINDOW_MS) {
        recentIds.push(id);
      }
    }

    if (recentIds.length < 2) {
      return null;
    }

    const graph = await this.buildDependencyGraph();
    return this.findRootCause(recentIds, graph);
  }

  private async buildDependencyGraph(): Promise<Map<string, string[]>> {
    const graph = new Map<string, string[]>();

    try {
      const services = await this.ctx.db.listServices();

      for (const service of services) {
        const connections = await this.ctx.db.listServiceConnectionsByService(service.id);
        for (const conn of connections) {
          // provider → project consumers mapping. Hydrated project_id wins when
          // the consumer service id is an attached runtime workload id.
          const existing = graph.get(conn.service_id_provider) ?? [];
          existing.push(connectionProjectId(conn));
          graph.set(conn.service_id_provider, existing);
        }
      }
    } catch (err) {
      log.warn({ err }, 'Failed to build dependency graph');
    }

    return graph;
  }

  private async findRootCause(
    failedProjectIds: string[],
    graph: Map<string, string[]>,
  ): Promise<CascadeResult | null> {
    for (const [serviceId, dependentProjects] of graph.entries()) {
      const dependentSet = new Set(dependentProjects);
      const affectedIds = failedProjectIds.filter((id) => dependentSet.has(id));

      if (affectedIds.length < 2) {
        continue;
      }

      const affectedNames = await Promise.all(
        affectedIds.map(async (id) => (await this.ctx.db.getProject(id))?.name ?? id),
      );
      const service = await this.ctx.db.getService(serviceId);

      log.warn({ serviceId, affectedCount: affectedIds.length }, 'Cascade failure detected');

      return {
        rootServiceId: serviceId,
        rootServiceName: service?.name ?? serviceId,
        affectedProjectIds: affectedIds,
        affectedProjectNames: affectedNames,
      };
    }

    return null;
  }

  buildCascadeAlert(result: CascadeResult, incidentId?: string): OpsAlert {
    const projectList = result.affectedProjectNames.join(', ');

    return {
      severity: 'critical',
      project: { id: result.rootServiceId, name: result.rootServiceName },
      event_type: 'cascade_failure',
      title: `Cascading Failure: ${result.rootServiceName} affecting ${String(result.affectedProjectIds.length)} projects`,
      description: `Service "${result.rootServiceName}" appears to be down, affecting: ${projectList}`,
      context: {
        rootService: { id: result.rootServiceId, name: result.rootServiceName },
        affectedProjects: result.affectedProjectIds,
      },
      suggestion: `Check ${result.rootServiceName} service status first before investigating individual projects`,
      actions_taken: [],
      incident_id: incidentId ?? null,
      timestamp: Date.now(),
    };
  }

  cleanupOldFailures(): void {
    const now = Date.now();
    for (const [projectId, ts] of this.recentFailures.entries()) {
      if (now - ts > this.CORRELATION_WINDOW_MS) {
        this.recentFailures.delete(projectId);
      }
    }
  }
}
