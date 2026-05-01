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
  /**
   * Codex MEDIUM-2 fix: rate-limit recorder to once-per-N ticks. The
   * recorder issues `docker exec du -sb`, Docker stats, and adapter
   * connection probes per call — heavy on busy daemons. Sampling every
   * 5th tick (default) keeps the per-service-detail sparkline fresh
   * (1 sample / 2.5 min at the 30s default tick) while keeping the
   * sweep tight enough that the `checking` guard never suppresses a
   * follow-on tick. Tests can override this to 1 to assert the legacy
   * "every tick" behaviour or to a high value to assert skip behaviour.
   */
  recordSampleEveryNTicks?: number;
}

export interface ServiceCheckResult {
  healthy: boolean;
  error?: string;
}

const DEFAULT_INTERVAL_MS = 30_000;
const INITIAL_STAGGER_MS = 5_000;
/**
 * Codex MEDIUM-2: cadence chosen so a 30s tick produces a metric
 * sample roughly every 2.5 minutes — fast enough that the v4 service
 * detail sparkline stays useful, slow enough that recorder stalls
 * (heavy `du -sb` on busy daemons) cannot stretch a sweep past the
 * tick boundary and trip the `checking` guard.
 */
const DEFAULT_RECORD_SAMPLE_EVERY_N_TICKS = 5;

export class ServiceHealthMonitor {
  private readonly intervalMs: number;
  private readonly serviceManager?: ServiceManager;
  private readonly recordSampleEveryNTicks: number;
  private intervalId?: ReturnType<typeof setInterval>;
  private initialTimerId?: ReturnType<typeof setTimeout>;
  private checking = false;
  /**
   * Per-service tick counter. Incremented on every successful health
   * check (running container path); the recorder fires only when
   * `tickCount % recordSampleEveryNTicks === 0`. Stored as a Map to
   * avoid leaking entries onto ServiceRow and to reset cleanly when a
   * service is removed.
   */
  private readonly serviceTickCounts = new Map<string, number>();

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly events: EventBus,
    options?: ServiceHealthMonitorOptions,
  ) {
    void this.events;
    this.intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.serviceManager = options?.serviceManager;
    const everyN = options?.recordSampleEveryNTicks ?? DEFAULT_RECORD_SAMPLE_EVERY_N_TICKS;
    // Defensive: a value <= 0 would zero-divide via `%`. Coerce to 1 so
    // callers that pass `0` (e.g. accidentally) still get correct
    // every-tick behaviour rather than crashing.
    this.recordSampleEveryNTicks = everyN > 0 ? everyN : 1;
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
    const containerRef = service.container_id ?? service.container_name ?? '';

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
    const containerRef = service.container_id ?? service.container_name ?? '';

    try {
      const info = await this.docker.inspectContainer(containerRef);

      if (!info.State.Running) {
        if (service.status === 'running') {
          this.db.updateService(service.id, { status: 'stopped' });
          const conns = this.db.listServiceConnectionsByService(service.id);
          const affectedProjects = [...new Set(conns.map((c) => c.service_id_consumer))];

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

      // Record one metric sample every Nth tick so the v4 service-detail
      // sparkline has time-series data to render without paying the
      // recorder's `docker exec du -sb` + Docker stats + adapter probe
      // cost on every health tick. Wrapped in try/catch so a recorder
      // failure (DB write hiccup, transient stats fetch error) never
      // poisons the health-check loop.
      //
      // Codex MEDIUM-2: previously the recorder fired inline on every
      // tick, which on busy daemons could stretch a sweep enough that
      // the `checking` guard suppressed the next interval, lowering
      // effective health-check cadence. Rate-limiting decouples
      // sparkline cadence from health-check cadence.
      if (this.serviceManager) {
        const nextCount = (this.serviceTickCounts.get(service.id) ?? 0) + 1;
        this.serviceTickCounts.set(service.id, nextCount);

        // Always sample on the FIRST tick a service is observed
        // healthy (so the sparkline gets a data point immediately
        // when a service comes up), then sample every Nth tick. This
        // keeps `nextCount === 1` and `nextCount === N+1` etc. as
        // sample points rather than waiting N ticks for the first.
        const isFirstTick = nextCount === 1;
        const isPeriodicTick = nextCount % this.recordSampleEveryNTicks === 0;

        if (isFirstTick || isPeriodicTick) {
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
            const conns2 = this.db.listServiceConnectionsByService(service.id);
            const affectedProjects2 = [...new Set(conns2.map((c) => c.service_id_consumer))];
            this.recordServiceDownIncident(service, affectedProjects2);
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
      const conns3 = this.db.listServiceConnectionsByService(service.id);
      const affectedProjects3 = [...new Set(conns3.map((c) => c.service_id_consumer))];

      this.recordServiceDownIncident(service, affectedProjects3);
    }
  }

  private recordServiceDownIncident(service: ServiceRow, affectedProjects: string[]): void {
    try {
      this.db.createRuntimeIncident({
        projectId: affectedProjects[0] ?? 'unknown',
        category: 'service_down',
        errorSnippet: JSON.stringify({
          serviceName: service.name,
          serviceType: service.kind,
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
