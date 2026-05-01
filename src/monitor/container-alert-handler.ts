import type { Docker } from '../pipeline/docker.js';
import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';
import type { AlertMonitor } from './alerts.js';

const log = createModuleLogger('container-alert-handler');

export class ContainerAlertHandler {
  private unsubscribers: (() => void)[] = [];

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly events: EventBus,
    private readonly alertMonitor: AlertMonitor,
  ) {}

  start(): void {
    if (this.unsubscribers.length > 0) {
      return;
    }

    this.unsubscribers.push(
      this.events.on('deploy:failed', (payload) => {
        if (payload.step === 'run') {
          void this.handleRuntimeCrash(payload.projectId, payload.error);
        }
      }),
      this.events.on('container:die', (payload) => {
        void this.handleContainerDie(payload);
      }),
      this.events.on('container:oom', (payload) => {
        void this.handleContainerOom(payload);
      }),
      this.events.on('container:missing', (payload) => {
        void this.handleContainerMissing(payload);
      }),
    );

    log.debug('Container alert handler started');
  }

  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  private async handleRuntimeCrash(projectId: string, error: string): Promise<void> {
    const project = this.db.getProject(projectId);
    if (!project) return;
    // PR 4.5: canonical-first read of container_id with `??` fallback.
    const deployable = this.db.getDeployableForProject(projectId);
    const containerId = deployable?.container_id ?? project.container_id;
    if (!containerId) return;

    const key = `container-crash:${containerId}`;
    const suggestion = `Check the container logs for errors using "get_logs ${project.name}" and investigate the root cause. The application may be crashing on startup.`;

    await this.alertMonitor.upsertAlert(key, {
      type: 'container-crash',
      severity: 'critical',
      message: `${project.name} container crashed: ${error}`,
      details: {
        projectId: project.id,
        projectName: project.name,
        containerId,
      },
      suggestion,
    });
  }

  private async handleContainerDie(payload: {
    projectId: string;
    containerId: string;
    containerName: string;
    exitCode: number;
  }): Promise<void> {
    const project = this.db.getProject(payload.projectId);
    if (!project) return;

    const key = `container-crash:${payload.containerId}`;
    const suggestion = `Check the container logs for errors using "get_logs ${project.name}" and investigate the root cause.`;

    await this.alertMonitor.upsertAlert(key, {
      type: 'container-crash',
      severity: 'critical',
      message: `Container crashed: ${project.name} (exit code ${String(payload.exitCode)})`,
      details: {
        projectId: project.id,
        projectName: project.name,
        containerId: payload.containerId,
        exitCode: payload.exitCode,
      },
      suggestion,
    });
  }

  private async handleContainerOom(payload: {
    projectId: string;
    containerId: string;
    containerName: string;
  }): Promise<void> {
    const project = this.db.getProject(payload.projectId);
    if (!project) return;

    const key = `container-crash:${payload.containerId}`;
    const info = await this.docker.inspectContainer(payload.containerId).catch(() => null);
    const memoryLimitBytes: number = info ? (info.HostConfig.Memory ?? 0) : 0;
    const memoryLimitMB = memoryLimitBytes > 0 ? Math.floor(memoryLimitBytes / 1024 / 1024) : 0;
    const memoryInfo =
      memoryLimitBytes > 0
        ? `Memory limit: ${String(memoryLimitMB)}MB. `
        : 'No memory limit configured. ';

    const suggestion =
      memoryLimitBytes > 0
        ? `Container ran out of memory (limit: ${String(memoryLimitMB)}MB). Consider increasing memory limits in Settings → Resources or optimizing the application's memory usage. Check logs with "get_logs ${project.name}".`
        : `Container ran out of memory. Set a memory limit in Settings → Resources or optimize the application's memory usage. Check logs with "get_logs ${project.name}".`;

    await this.alertMonitor.upsertAlert(key, {
      type: 'container-crash',
      severity: 'critical',
      message: `Container OOM killed: ${project.name}. ${memoryInfo}`,
      details: {
        projectId: project.id,
        projectName: project.name,
        containerId: payload.containerId,
        reason: 'out_of_memory',
        memoryLimit: memoryLimitBytes,
      },
      suggestion,
    });
  }

  private async handleContainerMissing(payload: {
    projectId: string;
    projectName: string;
    containerId: string;
    suggestion: string;
  }): Promise<void> {
    const key = `container-crash:${payload.containerId}`;
    const message = `${payload.projectName} container was removed externally (docker prune or manual deletion)`;

    await this.alertMonitor.upsertAlert(key, {
      type: 'container-crash',
      severity: 'critical',
      message,
      details: {
        projectId: payload.projectId,
        projectName: payload.projectName,
        containerId: payload.containerId,
        reason: 'container_missing',
      },
      suggestion: payload.suggestion,
    });

    log.warn({ containerId: payload.containerId, projectId: payload.projectId }, message);
  }
}
