import type { Database, ProjectRow, ServiceRow } from '../db/index.js';
import { projectIdToDeployableServiceId } from '../db/service-ids.js';
import { serviceViewFromRows, type ServiceView } from '../db/views/service-view.js';
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

type DeployableByProject = Map<string, ServiceRow | undefined>;

const DEFAULT_OPTIONS: Required<ProjectHealthMonitorOptions> = {
  intervalMs: 30000,
  timeoutMs: 5000,
  failureThreshold: 3,
};

const INITIAL_STAGGER_MS = 7_000;

function probeContainerRef(view: ServiceView, deployable: ServiceRow | undefined): string {
  // Preserve the monitor's historic probe order:
  // service.container_id → service.container_name → project.container_id.
  // ServiceView.containerId intentionally contains the project fallback.
  const ref =
    deployable && !deployable.container_id
      ? (view.containerName ?? view.containerId)
      : (view.containerId ?? view.containerName);
  return ref ?? '';
}

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
    const deployable = project ? await this.db.getDeployableForProject(projectId) : undefined;
    return this.checkProjectRows(projectId, project, deployable);
  }

  private async checkProjectRows(
    projectId: string,
    project: ProjectRow | undefined | null,
    deployable: ServiceRow | undefined,
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

    const profile = resolveMonitoringProfile(project, deployable);
    if (profile.health.strategy === 'none') {
      this.consecutiveFailures.set(projectId, 0);
      return {
        healthy: true,
        responseTimeMs: 0,
        consecutiveFailures: 0,
      };
    }

    const view = serviceViewFromRows(project, deployable);
    const probeContext: ProbeContext = {
      projectId,
      containerId: probeContainerRef(view, deployable),
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

  private async loadDeployablesByProject(
    projects: readonly ProjectRow[],
  ): Promise<DeployableByProject> {
    const deployableIds = new Set(
      projects.map((project) => projectIdToDeployableServiceId(project.id)),
    );
    const services = await this.db.listServices();
    const byProject: DeployableByProject = new Map();
    for (const service of services) {
      if (!deployableIds.has(service.id)) continue;
      byProject.set(service.project_id, service);
    }
    return byProject;
  }

  private async checkAllProjects(): Promise<void> {
    if (this.checking) {
      return;
    }

    this.checking = true;
    try {
      const projects = await this.db.listProjects();
      const deployablesByProject = await this.loadDeployablesByProject(projects);
      const activeProjects = projects.filter((project) => {
        const deployable = deployablesByProject.get(project.id);
        const status = serviceViewFromRows(project, deployable).status;
        return !project.archived_at && (status === 'running' || status === 'error');
      });

      await Promise.all(
        activeProjects.map((project) =>
          this.runCheck(project.id, project, deployablesByProject.get(project.id)),
        ),
      );
    } finally {
      this.checking = false;
    }
  }

  private async runCheck(
    projectId: string,
    projectArg?: ProjectRow,
    deployableArg?: ServiceRow,
  ): Promise<void> {
    const project = projectArg ?? (await this.db.getProject(projectId));
    if (!project) {
      return;
    }

    const deployable =
      deployableArg ??
      (projectArg === undefined ? await this.db.getDeployableForProject(projectId) : undefined);
    const status = serviceViewFromRows(project, deployable).status;
    if ((status !== 'running' && status !== 'error') || project.archived_at) {
      return;
    }

    const result = await this.checkProjectRows(projectId, project, deployable);

    await this.events.emit('monitor:healthcheck', {
      projectId,
      healthy: result.healthy,
      responseTimeMs: result.responseTimeMs,
    });

    await this.syncStatusFromHealth(projectId, status, result, deployable);

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
    currentStatus: ProjectRow['status'] | ServiceRow['status'],
    result: ProjectCheckResult,
    deployable: ServiceRow | undefined,
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
    deployable: ServiceRow | undefined,
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
