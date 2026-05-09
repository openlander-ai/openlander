import type { Database } from '../db/index.js';
import type { Docker } from '../pipeline/docker.js';
import type { EventBus } from '../events/index.js';
import { createLocalProbeRunner } from '../health/probe-runner.js';
import { resolveMonitoringProfile } from '../health/profile-resolver.js';
import type { ProbeContext } from '../health/types.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('project-health-monitor');

interface ProjectHealthMonitorOptions {
  intervalMs?: number;
  timeoutMs?: number;
  failureThreshold?: number;
}

type ProjectCheckResult = {
  healthy: boolean;
  responseTimeMs: number;
  error?: string;
  consecutiveFailures: number;
};

const DEFAULT_OPTIONS: Required<ProjectHealthMonitorOptions> = {
  intervalMs: 30000,
  timeoutMs: 5000,
  failureThreshold: 3,
};

const INITIAL_STAGGER_MS = 7_000;

export class ProjectHealthMonitor {
  private readonly options: Required<ProjectHealthMonitorOptions>;
  private intervalId?: ReturnType<typeof setInterval>;
  private initialTimerId?: ReturnType<typeof setTimeout>;
  private readonly consecutiveFailures = new Map<string, number>();
  private readonly probeRunner;
  private checking = false;

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly events: EventBus,
    options?: ProjectHealthMonitorOptions,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.probeRunner = createLocalProbeRunner(this.docker);
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      void this.checkAllProjects();
    }, this.options.intervalMs);

    // Stagger first check to avoid Docker API thundering herd at startup.
    this.initialTimerId = setTimeout(() => {
      this.initialTimerId = undefined;
      void this.checkAllProjects();
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

  async checkProject(projectId: string): Promise<ProjectCheckResult> {
    const project = await this.db.getProject(projectId);
    const previousFailures = this.consecutiveFailures.get(projectId) ?? 0;

    if (!project) {
      return {
        healthy: false,
        responseTimeMs: 0,
        error: 'Project not found',
        consecutiveFailures: previousFailures,
      };
    }

    const deployable = await this.db.getDeployableForProject(projectId);
    const profile = resolveMonitoringProfile(project, deployable);
    if (profile.health.strategy === 'none') {
      this.consecutiveFailures.set(projectId, 0);
      return {
        healthy: true,
        responseTimeMs: 0,
        consecutiveFailures: 0,
      };
    }

    // PR 4.5: canonical-first read of runtime columns with `??` fallback.
    const probeContext: ProbeContext = {
      projectId,
      containerId: deployable?.container_id ?? project.container_id ?? '',
      assignedPort: deployable?.assigned_port ?? project.assigned_port ?? undefined,
    };

    const probeConfig = {
      ...profile.health,
      timeoutMs: this.options.timeoutMs,
      failureThreshold: this.options.failureThreshold,
    };

    try {
      const probeResult = await this.probeRunner.runProbe(probeConfig, probeContext);
      const consecutiveFailures = probeResult.healthy ? 0 : previousFailures + 1;
      this.consecutiveFailures.set(projectId, consecutiveFailures);

      return {
        healthy: probeResult.healthy,
        responseTimeMs: probeResult.responseTimeMs ?? 0,
        error: probeResult.error,
        consecutiveFailures,
      };
    } catch (error) {
      const consecutiveFailures = previousFailures + 1;
      const message = error instanceof Error ? error.message : String(error);
      this.consecutiveFailures.set(projectId, consecutiveFailures);

      return {
        healthy: false,
        responseTimeMs: 0,
        error: message,
        consecutiveFailures,
      };
    }
  }

  private async checkAllProjects(): Promise<void> {
    if (this.checking) {
      return;
    }

    this.checking = true;
    try {
      const runningProjects = (await this.db.listProjects('running')).map((project) => project.id);
      const errorProjects = (await this.db.listProjects('error')).map((project) => project.id);
      const activeProjectIds = [...new Set([...runningProjects, ...errorProjects])];

      await Promise.all(activeProjectIds.map((projectId) => this.runCheck(projectId)));
    } finally {
      this.checking = false;
    }
  }

  private async runCheck(projectId: string): Promise<void> {
    const project = await this.db.getProject(projectId);
    if (!project) {
      return;
    }

    // PR 4.5: canonical-first status read with `??` fallback.
    const deployable = await this.db.getDeployableForProject(projectId);
    const status = deployable?.status ?? project.status;
    if ((status !== 'running' && status !== 'error') || project.archived_at) {
      return;
    }

    const result = await this.checkProject(projectId);

    await this.events.emit('monitor:healthcheck', {
      projectId,
      healthy: result.healthy,
      responseTimeMs: result.responseTimeMs,
    });

    if (!result.healthy && result.consecutiveFailures >= this.options.failureThreshold) {
      log.warn(
        {
          projectId,
          consecutiveFailures: result.consecutiveFailures,
          error: result.error ?? null,
        },
        'Project health degraded',
      );

      await this.events.emit('health:degraded', {
        projectId,
        consecutiveFailures: result.consecutiveFailures,
        lastError: result.error ?? null,
      });
    }
  }
}

export function createProjectHealthMonitor(
  docker: Docker,
  db: Database,
  events: EventBus,
  options?: ProjectHealthMonitorOptions,
): ProjectHealthMonitor {
  return new ProjectHealthMonitor(docker, db, events, options);
}
