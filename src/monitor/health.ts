import type { Docker } from '../pipeline/docker.js';
import type { Database, ProjectRow } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import type { LanguageModel } from 'ai';
import { createModuleLogger } from '../lib/logger.js';
import { shouldRunCleanup, diskThresholdCleanup } from '../pipeline/cleanup.js';
import type { RecoveryCategory } from '../pipeline/recovery-dispatch.js';
import { createLocalProbeRunner } from '../health/probe-runner.js';
import { resolveMonitoringProfile } from '../health/profile-resolver.js';
import type { ProbeContext } from '../health/types.js';

const log = createModuleLogger('health');

export interface HealthMonitorOptions {
  intervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  aiProvider?: LanguageModel | null;
}

type MonitorTimingOptions = Omit<HealthMonitorOptions, 'aiProvider'>;

export interface HealthCheckResult {
  projectId: string;
  healthy: boolean;
  responseTimeMs: number;
  statusCode?: number;
  error?: string;
  checkedAt: Date;
  consecutiveFailures: number;
}

const DEFAULT_OPTIONS: Required<MonitorTimingOptions> = {
  intervalMs: 30000,
  timeoutMs: 5000,
  maxRetries: 3,
};

const INACTIVE_FAILURE_THRESHOLD = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CLEANUP_COOLDOWN_MS = 10 * 60 * 1000;
const STABILITY_WINDOW_MS = 5 * 60_000;
const INCIDENT_ERROR_SNIPPET_LINES = 40;

export class HealthMonitor {
  private readonly docker: Docker;
  private readonly db: Database;
  private readonly events: EventBus;
  private readonly options: Required<MonitorTimingOptions>;
  private readonly aiProvider: LanguageModel | null;
  private readonly status = new Map<string, HealthCheckResult>();
  private readonly previousRestartCounts = new Map<string, number>();
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private checking = false;
  private lastCleanupAt = 0;

  constructor(docker: Docker, db: Database, events: EventBus, options?: HealthMonitorOptions) {
    const { aiProvider = null, ...monitorOptions } = options ?? {};
    this.docker = docker;
    this.db = db;
    this.events = events;
    this.options = { ...DEFAULT_OPTIONS, ...monitorOptions };
    this.aiProvider = aiProvider;
    void this.aiProvider;
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      void this.runChecks();
    }, this.options.intervalMs);

    void this.runChecks();
  }

  stop(): void {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = undefined;
  }

  // TODO(refactor): Deprecated project health-check scheduler logic. Migrate callers to
  // ProjectHealthMonitor and remove checkProject/checkPort here in Task 20.
  async checkProject(projectId: string): Promise<HealthCheckResult> {
    const project = this.db.getProject(projectId);
    if (
      !project ||
      (project.status !== 'running' && project.status !== 'error') ||
      project.assigned_port == null
    ) {
      const previous = this.status.get(projectId);
      const result: HealthCheckResult = {
        projectId,
        healthy: false,
        responseTimeMs: 0,
        error: !project ? 'Project not found' : 'Project is not running or has no assigned port',
        checkedAt: new Date(),
        consecutiveFailures: previous?.consecutiveFailures ?? 0,
      };

      this.status.set(projectId, result);
      return result;
    }

    const result = await this.checkPort(project);
    this.status.set(projectId, result);

    if (result.healthy) {
      const cbState = this.db.getCircuitBreakerState(projectId);
      if (cbState && cbState.failure_count > 0 && cbState.last_failure_at) {
        const stableMs = Date.now() - cbState.last_failure_at;
        if (stableMs >= STABILITY_WINDOW_MS) {
          this.db.resetCircuitBreaker(projectId);
          log.info(
            { projectId, stableMinutes: Math.round(stableMs / 60_000) },
            'Project stable after recovery — circuit breaker reset',
          );
        }
      }
    }

    await this.events.emit('monitor:healthcheck', {
      projectId,
      healthy: result.healthy,
      responseTimeMs: result.responseTimeMs,
    });

    if (!result.healthy && result.consecutiveFailures > INACTIVE_FAILURE_THRESHOLD) {
      await this.events.emit('monitor:inactive', {
        projectId,
        daysSinceLastAccess: (result.consecutiveFailures * this.options.intervalMs) / MS_PER_DAY,
      });
    }

    return result;
  }

  getStatus(): Map<string, HealthCheckResult> {
    return new Map(this.status);
  }

  private async runChecks(): Promise<void> {
    if (this.checking) {
      return;
    }

    this.checking = true;
    try {
      const dockerAvailable = await this.docker.ping();
      if (!dockerAvailable) {
        return;
      }

      const runningProjects = this.db
        .listProjects('running')
        .filter((project) => project.assigned_port != null);
      const errorProjects = this.db
        .listProjects('error')
        .filter((project) => project.assigned_port != null);
      const projects = [...runningProjects, ...errorProjects];

      await Promise.all([
        Promise.all(projects.map((project) => this.checkProject(project.id))),
        this.checkServiceHealth(),
      ]);

      const now = Date.now();
      if (shouldRunCleanup() && now - this.lastCleanupAt >= CLEANUP_COOLDOWN_MS) {
        const building = this.db.listProjects('building');
        if (building.length > 0) {
          log.info({ count: building.length }, 'Deferred disk cleanup — builds in progress');
        } else {
          this.lastCleanupAt = now;
          log.info('Disk usage above threshold — triggering cleanup');
          diskThresholdCleanup();
        }
      }
    } finally {
      this.checking = false;
    }
  }

  private async checkServiceHealth(): Promise<void> {
    const services = this.db
      .listServices()
      .filter((service) => service.container_id !== null || service.container_name.length > 0);

    await Promise.all(
      services.map(async (service) => {
        const containerRef = service.container_id ?? service.container_name;

        try {
          const info = await this.docker.inspectContainer(containerRef);

          if (!info.State.Running) {
            if (service.status === 'running') {
              this.db.updateService(service.id, { status: 'stopped' });
              const projects = this.db.listServiceConnectionsByService(service.id);
              const affectedProjects = [...new Set(projects.map((project) => project.project_id))];

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
                    containerRef,
                    error: incidentError,
                  },
                  'Failed to persist service-down incident',
                );
              }

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
                containerRef,
                error: incidentError,
              },
              'Failed to persist service-down incident after inspect failure',
            );
          }
        }
      }),
    );
  }

  // TODO(refactor): Deprecated probe execution path retained temporarily for compatibility.
  private async checkPort(project: ProjectRow): Promise<HealthCheckResult> {
    const projectId = project.id;

    const profile = resolveMonitoringProfile(project);

    if (profile.health.strategy === 'none') {
      return {
        projectId,
        healthy: true,
        responseTimeMs: 0,
        checkedAt: new Date(),
        consecutiveFailures: 0,
      };
    }

    const probeContext: ProbeContext = {
      projectId,
      containerId: project.container_id ?? '',
      assignedPort: project.assigned_port ?? undefined,
    };

    const probeRunner = createLocalProbeRunner(this.docker);
    let lastResult: HealthCheckResult;

    try {
      const probeResult = await probeRunner.runProbe(profile.health, probeContext);

      lastResult = {
        projectId,
        healthy: probeResult.healthy,
        responseTimeMs: probeResult.responseTimeMs ?? 0,
        error: probeResult.error,
        checkedAt: new Date(),
        consecutiveFailures: probeResult.healthy
          ? 0
          : (this.status.get(projectId)?.consecutiveFailures ?? 0) + 1,
      };
    } catch (error) {
      lastResult = {
        projectId,
        healthy: false,
        responseTimeMs: 0,
        error: error instanceof Error ? error.message : String(error),
        checkedAt: new Date(),
        consecutiveFailures: (this.status.get(projectId)?.consecutiveFailures ?? 0) + 1,
      };
    }

    if (lastResult.healthy) {
      return lastResult;
    }

    const containerId = project.container_id;

    if (!containerId) {
      return lastResult;
    }

    // Skip non-running projects — no recovery events should be emitted
    if ((project.status !== 'running' && project.status !== 'error') || project.archived_at) {
      return lastResult;
    }

    const ensuredContainerId = containerId;

    try {
      const info = await this.docker.inspectContainer(ensuredContainerId);

      const restartCount = info.RestartCount;

      const previousCount = this.previousRestartCounts.get(ensuredContainerId) ?? 0;
      this.previousRestartCounts.set(ensuredContainerId, restartCount);
      const restartDelta = restartCount - previousCount;

      if (restartDelta > 0 && restartCount < 3) {
        log.info(
          { projectId, containerId: ensuredContainerId, restartCount, restartDelta },
          'Container restart detected via polling fallback',
        );
      }

      if (restartCount >= 3) {
        const errorSnippet = await this.getContainerStderrSnippet(ensuredContainerId);
        this.recordRuntimeIncident({
          projectId,
          containerId: ensuredContainerId,
          category: 'runtime_crash',
          environmentId: this.resolveIncidentEnvironmentId(projectId, ensuredContainerId),
          exitCode: info.State.ExitCode,
          errorSnippet,
          containerImage: info.Config.Image,
          containerUptimeMs: this.getContainerUptimeMs(info.State.StartedAt),
          restartCount,
        });
        log.warn(
          { projectId, containerId: ensuredContainerId, restartCount },
          'Container in crash loop — emitting health:degraded',
        );
        await this.events.emit('health:degraded', {
          projectId,
          consecutiveFailures: restartCount,
          lastError: `Container crash loop detected (${String(restartCount)} restarts)`,
        });
        return lastResult;
      }

      if (info.State.Running && !info.State.Restarting) {
        if (restartCount > 0) {
          const errorSnippet = await this.getContainerStderrSnippet(ensuredContainerId);
          this.recordRuntimeIncident({
            projectId,
            containerId: ensuredContainerId,
            category: 'runtime_crash',
            environmentId: this.resolveIncidentEnvironmentId(projectId, ensuredContainerId),
            exitCode: info.State.ExitCode,
            errorSnippet,
            containerImage: info.Config.Image,
            containerUptimeMs: this.getContainerUptimeMs(info.State.StartedAt),
            restartCount,
          });
          log.warn(
            { projectId, containerId: ensuredContainerId, restartCount },
            'Container restarted with failing health check — emitting health:degraded',
          );
          await this.events.emit('health:degraded', {
            projectId,
            consecutiveFailures: restartCount,
            lastError: `Container restarted (${String(restartCount)}x) and health check failing`,
          });
          return lastResult;
        }
        return {
          ...lastResult,
          healthy: true,
          error: undefined,
          consecutiveFailures: 0,
        };
      }

      const exitCode = info.State.ExitCode;
      if (!info.State.Running && exitCode !== 0) {
        const errorSnippet = await this.getContainerStderrSnippet(ensuredContainerId);
        this.recordRuntimeIncident({
          projectId,
          containerId: ensuredContainerId,
          category: 'runtime_crash',
          environmentId: this.resolveIncidentEnvironmentId(projectId, ensuredContainerId),
          exitCode,
          errorSnippet,
          containerImage: info.Config.Image,
          containerUptimeMs: this.getContainerUptimeMs(info.State.StartedAt),
          restartCount,
        });
        log.warn(
          { projectId, containerId: ensuredContainerId, exitCode },
          'Container crashed — emitting health:degraded',
        );
        await this.events.emit('health:degraded', {
          projectId,
          consecutiveFailures: lastResult.consecutiveFailures,
          lastError: `Container exited with code ${String(exitCode)}`,
        });
      }
    } catch (error) {
      this.recordRuntimeIncident({
        projectId,
        containerId: ensuredContainerId,
        category: 'runtime_generic',
        environmentId: this.resolveIncidentEnvironmentId(projectId, ensuredContainerId),
        errorSnippet: error instanceof Error ? error.message : String(error),
      });
      log.warn(
        { projectId, containerId: ensuredContainerId },
        'Container not found — emitting health:degraded',
      );
      await this.events.emit('health:degraded', {
        projectId,
        consecutiveFailures: 1,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }

    return lastResult;
  }

  private resolveIncidentEnvironmentId(projectId: string, containerId: string): string | null {
    const maybeDb = this.db as {
      getEnvironmentsByProject?: (id: string) => Array<{
        id: string;
        type: 'production' | 'development';
        container_id: string | null;
      }>;
    };

    if (typeof maybeDb.getEnvironmentsByProject !== 'function') {
      return null;
    }

    const environments = maybeDb.getEnvironmentsByProject(projectId);
    const matchingEnvironment = environments.find(
      (environment) => environment.container_id === containerId,
    );
    if (matchingEnvironment) {
      return matchingEnvironment.id;
    }

    const productionEnvironment = environments.find(
      (environment) => environment.type === 'production',
    );
    return productionEnvironment?.id ?? null;
  }

  private async getContainerStderrSnippet(
    containerId: string,
    tail = INCIDENT_ERROR_SNIPPET_LINES,
  ): Promise<string | null> {
    try {
      const decoded = (await this.docker.getLogs(containerId, tail)).trim();
      return decoded.length > 0 ? decoded : null;
    } catch (error) {
      log.debug({ containerId, error }, 'Failed to read container stderr snippet');
      return null;
    }
  }

  private getContainerUptimeMs(startedAt: string | undefined): number | null {
    if (!startedAt) {
      return null;
    }

    const startedAtMs = Date.parse(startedAt);
    if (Number.isNaN(startedAtMs)) {
      return null;
    }

    return Math.max(0, Date.now() - startedAtMs);
  }

  private recordRuntimeIncident(opts: {
    projectId: string;
    containerId: string;
    category: RecoveryCategory;
    environmentId?: string | null;
    exitCode?: number | null;
    errorSnippet?: string | null;
    containerImage?: string | null;
    containerUptimeMs?: number | null;
    restartCount?: number | null;
  }): string | null {
    try {
      const incident = this.db.createRuntimeIncident({
        projectId: opts.projectId,
        environmentId: opts.environmentId,
        category: opts.category,
        exitCode: opts.exitCode,
        errorSnippet: opts.errorSnippet,
        containerImage: opts.containerImage,
        containerUptimeMs: opts.containerUptimeMs,
        restartCount: opts.restartCount,
      });
      return incident.id;
    } catch (error) {
      log.warn(
        {
          projectId: opts.projectId,
          containerId: opts.containerId,
          category: opts.category,
          error,
        },
        'Failed to persist runtime incident',
      );
      return null;
    }
  }
}
