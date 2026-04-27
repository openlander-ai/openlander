import type { Database, ServiceRow } from '../db/index.js';
import type { Docker } from '../pipeline/docker.js';
import type { EventBus } from '../events/index.js';
import type { ServiceManager } from '../pipeline/service-manager.js';
import { ContainerNotFoundError, isDockerNotFoundError } from '../errors.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('service-health-monitor');

export interface ServiceHealthMonitorOptions {
  intervalMs?: number;
  /**
   * Optional ServiceManager — when provided, each successful health check
   * also records a one-row sample into `service_metrics` so the v4 service
   * detail sparkline accumulates time-series data. Optional because some
   * test harnesses construct the monitor without a full service manager;
   * production wiring in `src/app.ts` always supplies one.
   */
  serviceManager?: ServiceManager;
}

export interface ServiceCheckResult {
  healthy: boolean;
  error?: string;
}

const DEFAULT_INTERVAL_MS = 30_000;
const INITIAL_STAGGER_MS = 5_000;

export class ServiceHealthMonitor {
  private readonly intervalMs: number;
  private readonly serviceManager?: ServiceManager;
  private intervalId?: ReturnType<typeof setInterval>;
  private initialTimerId?: ReturnType<typeof setTimeout>;
  private checking = false;

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly events: EventBus,
    options?: ServiceHealthMonitorOptions,
  ) {
    void this.events;
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.serviceManager = options?.serviceManager;
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      void this.checkAllServices();
    }, this.intervalMs);

    // Stagger first check to avoid Docker API thundering herd at startup.
    this.initialTimerId = setTimeout(() => {
      this.initialTimerId = undefined;
      void this.checkAllServices();
    }, INITIAL_STAGGER_MS);
  }

  stop(): void {
    if (this.initialTimerId) {
      clearTimeout(this.initialTimerId);
      this.initialTimerId = undefined;
    }

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
      const services = this.db.listServices().filter((service) => service.container_id !== null);

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
    // Filter ensures container_id is not null, but we keep the fallback for defensive safety
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

      // Record one metric sample per tick so the v4 service-detail
      // sparkline has time-series data to render. Wrapped in try/catch
      // so a recorder failure (DB write hiccup, transient stats fetch
      // error) never poisons the health-check loop.
      if (this.serviceManager) {
        try {
          await this.serviceManager.recordMetricSample(service.id);
        } catch (recorderError) {
          log.warn(
            {
              serviceId: service.id,
              serviceName: service.name,
              error: recorderError,
            },
            'Failed to record service metric sample — continuing health check',
          );
        }
      }
    } catch (error) {
      // Check if container is gone (vs transient docker error)
      const isContainerMissing =
        error instanceof ContainerNotFoundError || isDockerNotFoundError(error);

      if (isContainerMissing) {
        // Clear stale container_id — the container is truly gone
        if (service.container_id !== null) {
          this.db.updateService(service.id, { status: 'stopped', containerId: null });
          log.info(
            { serviceId: service.id, serviceName: service.name, containerRef },
            'Service container missing — cleared stale reference',
          );
          // Record incident only on transition (status was 'running' before)
          if (service.status === 'running') {
            const projects = this.db.listServiceConnectionsByService(service.id);
            const affectedProjects = [...new Set(projects.map((p) => p.project_id))];
            this.recordServiceDownIncident(service, affectedProjects);
          }
        }
        return;
      }

      // Transient error — existing behavior
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
