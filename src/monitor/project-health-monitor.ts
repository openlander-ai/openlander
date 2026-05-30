import type { Database, ProjectRow, ServiceRow } from '../db/index.js';
import {
  loadServiceViewRecord,
  loadServiceViewRecords,
  serviceViewFromRows,
  type ServiceView,
  type ServiceViewRecord,
} from '../db/views/service-view.js';
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
    const record = project ? await loadServiceViewRecord(this.db, project) : undefined;
    return this.checkProjectRows(projectId, project, record);
  }

  private async checkProjectRows(
    projectId: string,
    project: ProjectRow | undefined | null,
    record: ServiceViewRecord | undefined,
  ): Promise<ProjectCheckResult> {
    const previousFailures = this.consecutiveFailures.get(projectId) ?? 0;

    if (!project) {
      return {
        healthy: false,
        responseTimeMs: 0,
        error: 'Project not found',
        consecutiveFailures: previousFailures,
      };
    }

    const profile = resolveMonitoringProfile(project, record?.service ?? undefined);
    if (profile.health.strategy === 'none') {
      this.consecutiveFailures.set(projectId, 0);
      return {
        healthy: true,
        responseTimeMs: 0,
        consecutiveFailures: 0,
      };
    }

    const view = record?.view ?? serviceViewFromRows(project, null);
    const probeContext: ProbeContext = {
      projectId,
      containerId: this.resolveProbeContainerRef(record) ?? '',
      assignedPort: view.assignedPort ?? undefined,
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

  private resolveProbeContainerRef(record: ServiceViewRecord | undefined): string | null {
    if (!record) return null;
    const { service, view } = record;
    // Preserve the historic probe target order:
    // service.container_id → service.container_name → project.container_id.
    // ServiceView.containerId intentionally contains the project fallback.
    if (service && !service.container_id) {
      return view.containerName ?? view.containerId;
    }
    return view.containerId ?? view.containerName;
  }

  private async checkAllProjects(): Promise<void> {
    if (this.checking) {
      return;
    }

    this.checking = true;
    try {
      const projects = await this.db.listProjects();
      const recordsByProject = await loadServiceViewRecords(this.db, projects);
      const activeProjects = projects.filter((project) => {
        const status = recordsByProject.get(project.id)?.view.status ?? 'idle';
        return !project.archived_at && (status === 'running' || status === 'error');
      });

      await Promise.all(
        activeProjects.map((project) =>
          this.runCheck(project.id, project, recordsByProject.get(project.id)),
        ),
      );
    } finally {
      this.checking = false;
    }
  }

  private async runCheck(
    projectId: string,
    projectArg?: ProjectRow,
    recordArg?: ServiceViewRecord,
  ): Promise<void> {
    const project = projectArg ?? (await this.db.getProject(projectId));
    if (!project) {
      return;
    }

    const record =
      recordArg ??
      (projectArg === undefined
        ? await loadServiceViewRecord(this.db, project)
        : {
            project,
            service: null,
            view: serviceViewFromRows(project, null),
          });
    const status = record.view.status;
    if ((status !== 'running' && status !== 'error') || project.archived_at) {
      return;
    }

    const result = await this.checkProjectRows(projectId, project, record);

    await this.events.emit('monitor:healthcheck', {
      projectId,
      healthy: result.healthy,
      responseTimeMs: result.responseTimeMs,
    });

    await this.syncStatusFromHealth(projectId, status, result, record.service);

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

  private async syncStatusFromHealth(
    projectId: string,
    currentStatus: ServiceView['status'],
    result: ProjectCheckResult,
    deployable: ServiceRow | null,
  ): Promise<void> {
    if (result.healthy) {
      if (currentStatus === 'error') {
        await this.updateProjectRuntimeStatus(projectId, deployable, 'running');
        await this.events.emit('project:status-changed', {
          projectId,
          from: 'error',
          to: 'running',
          reason: 'health check recovered',
        });
      }
      return;
    }

    if (
      currentStatus === 'running' &&
      result.consecutiveFailures >= this.options.failureThreshold
    ) {
      await this.updateProjectRuntimeStatus(projectId, deployable, 'error');
      await this.events.emit('project:status-changed', {
        projectId,
        from: 'running',
        to: 'error',
        reason: result.error ?? 'health check failed',
      });
    }
  }

  private async updateProjectRuntimeStatus(
    projectId: string,
    deployable: ServiceRow | null,
    status: NonNullable<ServiceRow['status']>,
  ): Promise<void> {
    if (deployable) {
      await this.db.updateService(deployable.id, { status });
      return;
    }

    await this.db.updateProject(projectId, { status });
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
