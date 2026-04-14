import type { Database, ServiceRow } from '../db/index.js';
import type { Docker } from '../pipeline/docker.js';
import type { EventBus } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('service-health-monitor');

export interface ServiceHealthMonitorOptions {
  intervalMs?: number;
}

export interface ServiceCheckResult {
  healthy: boolean;
  error?: string;
}

const DEFAULT_INTERVAL_MS = 30_000;

export class ServiceHealthMonitor {
  private readonly intervalMs: number;
  private intervalId?: ReturnType<typeof setInterval>;
  private checking = false;

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly events: EventBus,
    options?: ServiceHealthMonitorOptions,
  ) {
    void this.events;
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      void this.checkAllServices();
    }, this.intervalMs);

    void this.checkAllServices();
  }

  stop(): void {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = undefined;
  }

  async checkAllServices(): Promise<void> {
    if (this.checking) {
      return;
    }

    this.checking = true;
    try {
      const services = this.db
        .listServices()
        .filter((service) => service.container_id !== null || service.container_name.length > 0);

      await Promise.all(services.map((service) => this.runServiceCheck(service)));
    } finally {
      this.checking = false;
    }
  }

  async checkService(service: ServiceRow): Promise<ServiceCheckResult> {
    const containerRef = service.container_id ?? service.container_name;

    try {
      const info = await this.docker.inspectContainer(containerRef);

      if (!info.State.Running) {
        return { healthy: false, error: 'Container is not running' };
      }

      return { healthy: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { healthy: false, error: message };
    }
  }

  private async runServiceCheck(service: ServiceRow): Promise<void> {
    const containerRef = service.container_id ?? service.container_name;

    try {
      const info = await this.docker.inspectContainer(containerRef);

      if (!info.State.Running) {
        if (service.status === 'running') {
          this.db.updateService(service.id, { status: 'stopped' });
          const projects = this.db.listServiceConnectionsByService(service.id);
          const affectedProjects = [...new Set(projects.map((project) => project.project_id))];

          this.recordServiceDownIncident(service, affectedProjects);

          log.warn(
            {
              serviceId: service.id,
              serviceName: service.name,
              containerRef,
              affectedProjects,
            },
            'Service container is down — incident recorded',
          );
        }
        return;
      }

      if (service.status === 'stopped' || service.status === 'error') {
        this.db.updateService(service.id, { status: 'running' });
      }
    } catch (error) {
      log.warn(
        {
          serviceId: service.id,
          serviceName: service.name,
          containerRef,
          error,
        },
        'Failed to inspect service container',
      );

      if (service.status !== 'running') {
        return;
      }

      this.db.updateService(service.id, { status: 'error' });
      const projects = this.db.listServiceConnectionsByService(service.id);
      const affectedProjects = [...new Set(projects.map((project) => project.project_id))];

      this.recordServiceDownIncident(service, affectedProjects);
    }
  }

  private recordServiceDownIncident(service: ServiceRow, affectedProjects: string[]): void {
    try {
      this.db.createRuntimeIncident({
        projectId: affectedProjects[0] ?? 'unknown',
        category: 'service_down',
        errorSnippet: JSON.stringify({
          serviceName: service.name,
          serviceType: service.type,
          affectedProjects,
        }),
      });
    } catch (incidentError) {
      log.warn(
        {
          serviceId: service.id,
          serviceName: service.name,
          error: incidentError,
        },
        'Failed to persist service-down incident',
      );
    }
  }
}

export function createServiceHealthMonitor(
  docker: Docker,
  db: Database,
  events: EventBus,
  options?: ServiceHealthMonitorOptions,
): ServiceHealthMonitor {
  return new ServiceHealthMonitor(docker, db, events, options);
}
