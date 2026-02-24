import type { Docker } from '../pipeline/docker.js';
import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';

export interface HealthMonitorOptions {
  intervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface HealthCheckResult {
  projectId: string;
  healthy: boolean;
  responseTimeMs: number;
  statusCode?: number;
  error?: string;
  checkedAt: Date;
  consecutiveFailures: number;
}

const DEFAULT_OPTIONS: Required<HealthMonitorOptions> = {
  intervalMs: 30000,
  timeoutMs: 5000,
  maxRetries: 3,
};

const INACTIVE_FAILURE_THRESHOLD = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class HealthMonitor {
  private readonly docker: Docker;
  private readonly db: Database;
  private readonly events: EventBus;
  private readonly options: Required<HealthMonitorOptions>;
  private readonly status = new Map<string, HealthCheckResult>();
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private checking = false;

  constructor(docker: Docker, db: Database, events: EventBus, options?: HealthMonitorOptions) {
    this.docker = docker;
    this.db = db;
    this.events = events;
    this.options = { ...DEFAULT_OPTIONS, ...options };
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

      await Promise.all(projects.map((project) => this.checkProject(project.id)));
    } finally {
      this.checking = false;
    }
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
}
