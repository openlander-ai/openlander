import type { Docker } from '../pipeline/docker.js';
import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import type { LanguageModel } from 'ai';
import { createModuleLogger } from '../lib/logger.js';
import { shouldRunCleanup, diskThresholdCleanup } from '../pipeline/cleanup.js';
import type { RecoveryCategory } from '../pipeline/recovery-dispatch.js';
import { diagnoseRuntimeCrash } from './llm-diagnosis.js';

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

  async checkProject(projectId: string): Promise<HealthCheckResult> {
    const project = this.db.getProject(projectId);
    if (!project || project.status !== 'running' || project.assigned_port == null) {
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

    const result = await this.checkPort(projectId, project.assigned_port);
    this.status.set(projectId, result);

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

      const projects = this.db
        .listProjects('running')
        .filter((project) => project.assigned_port != null);

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
          const container = this.docker.getClient().getContainer(containerRef);
          const info = await container.inspect();

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

  private async checkPort(projectId: string, port: number): Promise<HealthCheckResult> {
    let lastResult: HealthCheckResult | undefined;
    for (let attempt = 0; attempt < this.options.maxRetries; attempt += 1) {
      const result = await this.runSingleCheck(projectId, port);
      lastResult = result;
      if (result.healthy) {
        return result;
      }
    }

    if (!lastResult) {
      return {
        projectId,
        healthy: false,
        responseTimeMs: 0,
        error: 'Health check did not run',
        checkedAt: new Date(),
        consecutiveFailures: (this.status.get(projectId)?.consecutiveFailures ?? 0) + 1,
      };
    }

    const project = this.db.getProject(projectId);
    const containerId = project?.container_id;

    if (!containerId) {
      return lastResult;
    }
    const ensuredContainerId = containerId;

    try {
      const container = this.docker.getClient().getContainer(ensuredContainerId);
      const info = await container.inspect();

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
        const incidentId = this.recordRuntimeIncident({
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
        this.triggerRuntimeCrashDiagnosis({
          projectId,
          incidentId,
          category: 'runtime_crash',
          errorSnippet,
          restartCount,
        });
        log.warn(
          { projectId, containerId: ensuredContainerId, restartCount },
          'Container in crash loop — marking project as error',
        );
        this.markProjectAndEnvironmentsError(projectId);
        await this.events.emit('deploy:failed', {
          projectId,
          error: `Container crash loop detected (${String(restartCount)} restarts)`,
          step: 'run',
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
            'Container restarted with failing health check — marking as error',
          );
          this.markProjectAndEnvironmentsError(projectId);
          await this.events.emit('deploy:failed', {
            projectId,
            error: `Container restarted (${String(restartCount)}x) and health check failing`,
            step: 'run',
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
        const incidentId = this.recordRuntimeIncident({
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
        this.triggerRuntimeCrashDiagnosis({
          projectId,
          incidentId,
          category: 'runtime_crash',
          errorSnippet,
          restartCount,
        });
        log.warn(
          { projectId, containerId: ensuredContainerId, exitCode },
          'Container crashed — marking project as error',
        );
        this.markProjectAndEnvironmentsError(projectId);
        await this.events.emit('deploy:failed', {
          projectId,
          error: `Container exited with code ${String(exitCode)}`,
          step: 'run',
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
        'Container not found — marking project as error',
      );
      this.markProjectAndEnvironmentsError(projectId);
    }

    return lastResult;
  }

  private async runSingleCheck(projectId: string, port: number): Promise<HealthCheckResult> {
    const startedAt = Date.now();
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort();
    }, this.options.timeoutMs);

    try {
      const response = await fetch(`http://localhost:${String(port)}/`, {
        method: 'GET',
        signal: timeoutController.signal,
      });

      const responseTimeMs = Date.now() - startedAt;
      const healthy = response.ok;
      const consecutiveFailures = healthy
        ? 0
        : (this.status.get(projectId)?.consecutiveFailures ?? 0) + 1;

      return {
        projectId,
        healthy,
        responseTimeMs,
        statusCode: response.status,
        error: healthy ? undefined : `HTTP ${String(response.status)}`,
        checkedAt: new Date(),
        consecutiveFailures,
      };
    } catch (error) {
      const responseTimeMs = Date.now() - startedAt;
      const message =
        error instanceof Error
          ? error.name === 'AbortError'
            ? `Timeout after ${String(this.options.timeoutMs)}ms`
            : error.message
          : String(error);

      return {
        projectId,
        healthy: false,
        responseTimeMs,
        error: message,
        checkedAt: new Date(),
        consecutiveFailures: (this.status.get(projectId)?.consecutiveFailures ?? 0) + 1,
      };
    } finally {
      clearTimeout(timeoutId);
    }
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

  private markProjectAndEnvironmentsError(projectId: string): void {
    this.db.updateProject(projectId, { status: 'error' });

    const maybeDb = this.db as {
      getEnvironmentsByProject?: (id: string) => Array<{ id: string }>;
      updateEnvironment?: (id: string, updates: { status: 'error' }) => void;
    };

    if (
      typeof maybeDb.getEnvironmentsByProject !== 'function' ||
      typeof maybeDb.updateEnvironment !== 'function'
    ) {
      return;
    }

    for (const environment of maybeDb.getEnvironmentsByProject(projectId)) {
      maybeDb.updateEnvironment(environment.id, { status: 'error' });
    }
  }

  private async getContainerStderrSnippet(
    containerId: string,
    tail = INCIDENT_ERROR_SNIPPET_LINES,
  ): Promise<string | null> {
    try {
      const container = this.docker.getClient().getContainer(containerId);
      const logs = await container.logs({
        stdout: false,
        stderr: true,
        tail,
        follow: false,
      });
      const buffer = Buffer.isBuffer(logs) ? logs : Buffer.from(logs as string);
      const decoded = stripDockerStreamHeaders(buffer).trim();
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

  private triggerRuntimeCrashDiagnosis(opts: {
    projectId: string;
    incidentId: string | null;
    category: RecoveryCategory;
    errorSnippet: string | null;
    restartCount: number | null;
  }): void {
    if (!opts.incidentId || opts.restartCount == null || opts.restartCount < 3) {
      return;
    }

    const projectName = this.db.getProject(opts.projectId)?.name;

    void diagnoseRuntimeCrash({
      db: this.db,
      incidentId: opts.incidentId,
      errorSnippet: opts.errorSnippet ?? '',
      category: opts.category,
      restartCount: opts.restartCount,
      projectName,
      aiProvider: this.aiProvider,
    }).catch((err: unknown) => {
      log.warn(
        { err, incidentId: opts.incidentId, projectId: opts.projectId },
        'LLM diagnosis failed',
      );
    });
  }
}

function stripDockerStreamHeaders(buffer: Buffer): string {
  if (buffer.length === 0) return '';

  const firstByte = buffer[0];
  if (firstByte !== 0 && firstByte !== 1 && firstByte !== 2) {
    return buffer.toString('utf8');
  }

  const HEADER_SIZE = 8;
  const chunks: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + HEADER_SIZE > buffer.length) {
      chunks.push(buffer.subarray(offset).toString('utf8'));
      break;
    }

    const payloadSize = buffer.readUInt32BE(offset + 4);
    const payloadStart = offset + HEADER_SIZE;
    const payloadEnd = payloadStart + payloadSize;

    if (payloadEnd > buffer.length) {
      chunks.push(buffer.subarray(payloadStart).toString('utf8'));
      break;
    }

    chunks.push(buffer.subarray(payloadStart, payloadEnd).toString('utf8'));
    offset = payloadEnd;
  }

  return chunks.join('');
}
