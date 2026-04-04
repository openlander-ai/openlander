import { nanoid } from 'nanoid';
import type { Docker } from '../pipeline/docker.js';
import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import { getSystemStats } from './stats.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('alerts');

export interface Alert {
  id: string;
  type:
    | 'disk'
    | 'inactive-project'
    | 'restart-loop'
    | 'dangling-images'
    | 'port-conflict'
    | 'container-crash'
    | 'resource-saturation'
    | 'orphan-container';
  severity: 'warning' | 'critical';
  message: string;
  details: Record<string, unknown>;
  suggestion: string;
  createdAt: Date;
  dismissed: boolean;
}

export interface AlertMonitorOptions {
  intervalMs?: number;
}

const DEFAULT_OPTIONS: Required<AlertMonitorOptions> = {
  intervalMs: 30000,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const INACTIVE_DAYS_THRESHOLD = 14;
const RESTART_COUNT_THRESHOLD = 3;
const DANGLING_IMAGES_THRESHOLD = 3;
const CONTAINER_MEMORY_THRESHOLD = 90;
const HOURLY_ALERT_CAP = 3;
const COOLDOWN_MS = 5 * 60 * 1000;

export class AlertMonitor {
  private readonly docker: Docker;
  private readonly db: Database;
  private readonly events: EventBus;
  private readonly options: Required<AlertMonitorOptions>;
  private readonly alerts = new Map<string, Alert>();
  private readonly alertKeys = new Map<string, string>();
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private unsubscribeCrash?: () => void;
  private unsubscribeContainerDie?: () => void;
  private unsubscribeContainerOom?: () => void;
  private checking = false;
  private hourlyCounts: number[] = [];
  private lastAlertTime = 0;

  constructor(docker: Docker, db: Database, events: EventBus, options?: AlertMonitorOptions) {
    this.docker = docker;
    this.db = db;
    this.events = events;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  start(intervalMs?: number): void {
    if (this.intervalId) {
      return;
    }

    const interval = intervalMs ?? this.options.intervalMs;
    this.intervalId = setInterval(() => {
      void this.runChecks();
    }, interval);

    this.unsubscribeCrash = this.events.on('deploy:failed', (payload) => {
      if (payload.step === 'run') {
        void this.handleRuntimeCrashEvent(payload.projectId, payload.error);
      }
    });

    this.unsubscribeContainerDie = this.events.on('container:die', (payload) => {
      void this.handleContainerDieEvent(payload);
    });

    this.unsubscribeContainerOom = this.events.on('container:oom', (payload) => {
      void this.handleContainerOomEvent(payload);
    });

    void this.runChecks();
  }

  stop(): void {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = undefined;
    this.unsubscribeCrash?.();
    this.unsubscribeCrash = undefined;
    this.unsubscribeContainerDie?.();
    this.unsubscribeContainerDie = undefined;
    this.unsubscribeContainerOom?.();
    this.unsubscribeContainerOom = undefined;
  }

  getActiveAlerts(): Alert[] {
    const memoryAlerts = Array.from(this.alerts.values()).filter((a) => !a.dismissed);

    // Also include open/active ops_incidents that may not be in memory
    // (e.g. after server restart, or incidents created by OpsAgent)
    const now = Date.now();
    const recentIncidents = this.db.listOpsIncidentsByDateRange(now - MS_PER_DAY, now);
    const openIncidents = recentIncidents.filter(
      (inc) => inc.status === 'open' || inc.status === 'active',
    );

    const memoryAlertProjectIds = new Set(
      memoryAlerts
        .filter((a) => a.type === 'container-crash')
        .map((a) => (a.details as { projectId?: string }).projectId)
        .filter(Boolean),
    );

    for (const inc of openIncidents) {
      if (memoryAlertProjectIds.has(inc.project_id)) continue;

      const project = this.db.getProject(inc.project_id);
      const projectName = project?.name ?? inc.project_id;

      memoryAlerts.push({
        id: inc.id,
        type: 'container-crash',
        severity: inc.severity === 'info' ? 'warning' : inc.severity,
        message: `Incident: ${projectName} — ${inc.root_cause ?? inc.status}`,
        details: { projectId: inc.project_id, incidentId: inc.id, source: 'ops_incidents' },
        suggestion: `Check ops incidents for project "${projectName}". Use get_logs to investigate.`,
        createdAt: new Date(inc.created_at),
        dismissed: false,
      });
    }

    return memoryAlerts;
  }

  dismissAlert(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      log.debug({ alertId }, 'Attempted to dismiss non-existent alert');
      return;
    }

    alert.dismissed = true;
    const key = `${alert.type}:${this.getTargetId(alert)}`;
    this.alertKeys.delete(key);

    void this.events.emit('alert:dismissed', { alertId });
    log.info({ alertId, type: alert.type }, 'Alert dismissed');
  }

  private getTargetId(alert: Alert): string {
    switch (alert.type) {
      case 'disk':
        return 'root';
      case 'inactive-project': {
        const pid = alert.details['projectId'];
        return typeof pid === 'string' ? pid : 'unknown';
      }
      case 'restart-loop': {
        const cid = alert.details['containerId'];
        return typeof cid === 'string' ? cid : 'unknown';
      }
      case 'dangling-images':
        return 'system';
      case 'port-conflict': {
        const port = alert.details['port'];
        return typeof port === 'number' ? String(port) : 'unknown';
      }
      case 'container-crash':
      case 'resource-saturation':
      case 'orphan-container': {
        const containerId = alert.details['containerId'];
        return typeof containerId === 'string' ? containerId : 'unknown';
      }
      default:
        return 'unknown';
    }
  }

  private async runChecks(): Promise<void> {
    if (this.checking) {
      return;
    }

    this.checking = true;
    try {
      await Promise.all([
        this.checkDiskUsage(),
        this.checkInactiveProjects(),
        this.checkContainerRestartLoops(),
        this.checkContainerCrashes(),
        this.checkContainerMemory(),
        this.checkDanglingImages(),
        this.checkPortConflicts(),
        this.checkOrphanContainers(),
      ]);
    } catch (err) {
      log.error({ err }, 'Error during alert checks');
    } finally {
      this.checking = false;
    }
  }

  private async checkDiskUsage(): Promise<void> {
    const stats = getSystemStats();
    const usagePercent = stats.disk.usagePercent;
    const key = 'disk:root';

    // Remove alert if usage is now normal
    if (usagePercent < 80) {
      this.resolveAlert(key, 'disk');
      return;
    }

    const severity: 'warning' | 'critical' = usagePercent >= 90 ? 'critical' : 'warning';
    const message = `Disk usage is ${usagePercent.toFixed(1)}% (${String(stats.disk.usedGB)}GB / ${String(stats.disk.totalGB)}GB)`;
    const suggestion =
      usagePercent >= 90
        ? 'Critical: Free up disk space immediately. Remove unused Docker images with "docker image prune -a" or clean up old project data.'
        : 'Consider cleaning up unused Docker images with "docker image prune" or removing old unused projects.';

    await this.upsertAlert(key, {
      type: 'disk',
      severity,
      message,
      details: {
        usagePercent,
        usedGB: stats.disk.usedGB,
        freeGB: stats.disk.freeGB,
        totalGB: stats.disk.totalGB,
      },
      suggestion,
    });
  }

  private async checkInactiveProjects(): Promise<void> {
    const projects = this.db.listProjects('running');
    const now = Date.now();

    for (const project of projects) {
      const key = `inactive-project:${project.id}`;
      const updatedAt = new Date(project.updated_at).getTime();
      const daysSinceUpdate = (now - updatedAt) / MS_PER_DAY;

      if (daysSinceUpdate <= INACTIVE_DAYS_THRESHOLD) {
        // Project is active, resolve any existing alert
        this.resolveAlert(key, 'inactive-project');
        continue;
      }

      const message = `Project "${project.name}" has been inactive for ${String(Math.floor(daysSinceUpdate))} days`;
      const suggestion = `Consider stopping this project to free up resources. Use "stop_project ${project.name}" or ask the user if it's still needed.`;

      await this.upsertAlert(key, {
        type: 'inactive-project',
        severity: 'warning',
        message,
        details: {
          projectId: project.id,
          projectName: project.name,
          daysSinceUpdate: Math.floor(daysSinceUpdate),
          lastUpdated: project.updated_at,
          potentialMemorySavings: '~128-512MB depending on container size',
        },
        suggestion,
      });
    }
  }

  private async checkContainerRestartLoops(): Promise<void> {
    const dockerClient = this.docker.getClient();
    const projects = this.db.listProjects('running');

    for (const project of projects) {
      if (!project.container_id) continue;

      const key = `restart-loop:${project.container_id}`;

      try {
        const container = dockerClient.getContainer(project.container_id);
        const info = await container.inspect();
        const restartCount: number = (info.RestartCount as number | undefined) ?? 0;

        // Check if container was restarted recently (within 24h)
        const startedAt = new Date(info.State.StartedAt);
        const hoursSinceStart = (Date.now() - startedAt.getTime()) / (60 * 60 * 1000);
        const isRecent = hoursSinceStart < 24;

        if (restartCount < RESTART_COUNT_THRESHOLD || !isRecent) {
          // No restart loop, resolve any existing alert
          this.resolveAlert(key, 'restart-loop');
          continue;
        }

        const message = `Container for "${project.name}" has restarted ${String(restartCount)} times in the last 24 hours`;
        const suggestion = `Check the container logs for errors using "get_logs ${project.name}" and investigate the root cause. The application may be crashing on startup.`;

        await this.upsertAlert(key, {
          type: 'restart-loop',
          severity: 'critical',
          message,
          details: {
            projectId: project.id,
            projectName: project.name,
            containerId: project.container_id,
            restartCount,
            lastStarted: info.State.StartedAt,
          },
          suggestion,
        });
      } catch (err) {
        log.debug(
          { err, containerId: project.container_id },
          'Failed to inspect container for restart check',
        );
      }
    }
  }

  private async checkDanglingImages(): Promise<void> {
    const key = 'dangling-images:system';

    try {
      const dockerClient = this.docker.getClient();
      const images = await dockerClient.listImages({
        filters: { dangling: ['true'] },
      });

      if (images.length < DANGLING_IMAGES_THRESHOLD) {
        this.resolveAlert(key, 'dangling-images');
        return;
      }

      // Calculate potential disk savings (approximate)
      const totalSize = images.reduce(
        (sum, img) => sum + ((img.Size as number | undefined) ?? 0),
        0,
      );
      const sizeGB = (totalSize / 1e9).toFixed(2);

      const message = `${String(images.length)} dangling Docker images detected, using approximately ${sizeGB}GB of disk space`;
      const suggestion =
        'Clean up dangling images to free disk space with "docker image prune". This is safe and will only remove unused images.';

      await this.upsertAlert(key, {
        type: 'dangling-images',
        severity: 'warning',
        message,
        details: {
          count: images.length,
          totalSizeBytes: totalSize,
          totalSizeGB: parseFloat(sizeGB),
        },
        suggestion,
      });
    } catch (err) {
      log.debug({ err }, 'Failed to check dangling images');
    }
  }

  private async checkPortConflicts(): Promise<void> {
    const projects = this.db.listProjects('running');
    const portMap = new Map<number, string[]>();

    for (const project of projects) {
      if (project.assigned_port != null) {
        const names = portMap.get(project.assigned_port) ?? [];
        names.push(project.name);
        portMap.set(project.assigned_port, names);
      }
    }

    // Track which port-conflict keys are active this cycle
    const activeKeys = new Set<string>();

    for (const [port, names] of portMap) {
      if (names.length < 2) continue;

      const key = `port-conflict:${String(port)}`;
      activeKeys.add(key);

      const altPort = port + 1000;
      await this.upsertAlert(key, {
        type: 'port-conflict',
        severity: 'warning',
        message: `Port ${String(port)} used by ${names.join(', ')}`,
        details: { port, projects: names, suggestedPort: altPort },
        suggestion: `Port ${String(port)} is shared by multiple projects. Consider reassigning one to port ${String(altPort)}.`,
      });
    }

    // Resolve any previous port-conflict alerts that no longer apply
    for (const key of this.alertKeys.keys()) {
      if (key.startsWith('port-conflict:') && !activeKeys.has(key)) {
        this.resolveAlert(key, 'port-conflict');
      }
    }
  }

  private isRateLimited(): boolean {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    this.hourlyCounts = this.hourlyCounts.filter((t) => t > oneHourAgo);
    if (this.hourlyCounts.length >= HOURLY_ALERT_CAP) return true;
    if (now - this.lastAlertTime < COOLDOWN_MS) return true;
    return false;
  }

  private async upsertAlert(
    key: string,
    alertData: Omit<Alert, 'id' | 'createdAt' | 'dismissed'>,
  ): Promise<void> {
    const existingId = this.alertKeys.get(key);

    if (existingId) {
      const existing = this.alerts.get(existingId);
      if (existing) {
        existing.severity = alertData.severity;
        existing.message = alertData.message;
        existing.details = alertData.details;
        existing.suggestion = alertData.suggestion;
        return;
      }
    }

    if (this.isRateLimited()) {
      log.debug({ key, type: alertData.type }, 'Alert rate-limited');
      return;
    }

    const alert: Alert = {
      id: nanoid(12),
      ...alertData,
      createdAt: new Date(),
      dismissed: false,
    };

    this.alerts.set(alert.id, alert);
    this.alertKeys.set(key, alert.id);
    this.hourlyCounts.push(Date.now());
    this.lastAlertTime = Date.now();

    await this.events.emit('alert:new', { alert });
    log.info(
      { alertId: alert.id, type: alert.type, severity: alert.severity },
      'New alert created',
    );
  }

  private resolveAlert(key: string, type: Alert['type']): void {
    const alertId = this.alertKeys.get(key);
    if (!alertId) return;

    const alert = this.alerts.get(alertId);
    if (!alert || alert.dismissed) return;

    this.alerts.delete(alertId);
    this.alertKeys.delete(key);

    void this.events.emit('alert:resolved', { alertId, type });
    log.info({ alertId, type }, 'Alert resolved');
  }

  private async handleRuntimeCrashEvent(projectId: string, error: string): Promise<void> {
    const project = this.db.getProject(projectId);
    if (!project?.container_id) return;

    const key = `container-crash:${project.container_id}`;
    const suggestion = `Check the container logs for errors using "get_logs ${project.name}" and investigate the root cause. The application may be crashing on startup.`;

    await this.upsertAlert(key, {
      type: 'container-crash',
      severity: 'critical',
      message: `${project.name} container crashed: ${error}`,
      details: {
        projectId: project.id,
        projectName: project.name,
        containerId: project.container_id,
      },
      suggestion,
    });
  }

  private async handleContainerDieEvent(payload: {
    projectId: string;
    containerId: string;
    containerName: string;
    exitCode: number;
  }): Promise<void> {
    const project = this.db.getProject(payload.projectId);
    if (!project) return;

    const key = `container-crash:${payload.containerId}`;
    const suggestion = `Check the container logs for errors using "get_logs ${project.name}" and investigate the root cause.`;

    await this.upsertAlert(key, {
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

  private async handleContainerOomEvent(payload: {
    projectId: string;
    containerId: string;
    containerName: string;
  }): Promise<void> {
    const project = this.db.getProject(payload.projectId);
    if (!project) return;

    const key = `container-crash:${payload.containerId}`;
    const suggestion = `Container ran out of memory. Consider increasing memory limits or optimizing the application's memory usage. Check logs with "get_logs ${project.name}".`;

    await this.upsertAlert(key, {
      type: 'container-crash',
      severity: 'critical',
      message: `Container OOM killed: ${project.name}`,
      details: {
        projectId: project.id,
        projectName: project.name,
        containerId: payload.containerId,
        reason: 'out_of_memory',
      },
      suggestion,
    });
  }

  private async checkContainerCrashes(): Promise<void> {
    const dockerClient = this.docker.getClient();
    const projects = this.db.listProjects();

    for (const project of projects) {
      if (!project.container_id) continue;
      if (project.status === 'building') continue;

      const key = `container-crash:${project.container_id}`;

      try {
        const container = dockerClient.getContainer(project.container_id);
        const info = await container.inspect();
        const state = info.State;
        const restartCount: number = (info.RestartCount as number | undefined) ?? 0;

        // Container is actively restarting after crash
        if (state.Restarting && restartCount > 0) {
          const message = `Container crashed: ${project.name} (restarting, count: ${String(restartCount)}, exit code ${String(state.ExitCode)})`;
          const suggestion = `Check the container logs for errors using "get_logs ${project.name}" and investigate the root cause. The application may be crashing on startup.`;

          await this.upsertAlert(key, {
            type: 'container-crash',
            severity: 'critical',
            message,
            details: {
              projectId: project.id,
              projectName: project.name,
              containerId: project.container_id,
              exitCode: state.ExitCode,
              restartCount,
              restarting: true,
              finishedAt: state.FinishedAt,
            },
            suggestion,
          });
          continue;
        }

        // Container running normally or exited cleanly — no crash
        if ((state.Running && !state.Restarting) || state.ExitCode === 0) {
          this.resolveAlert(key, 'container-crash');
          continue;
        }

        // Container stopped with non-zero exit code — single crash
        const message = `Container crashed: ${project.name} (exit code ${String(state.ExitCode)})`;
        const suggestion = `Check the container logs for errors using "get_logs ${project.name}" and investigate the root cause.`;

        await this.upsertAlert(key, {
          type: 'container-crash',
          severity: 'critical',
          message,
          details: {
            projectId: project.id,
            projectName: project.name,
            containerId: project.container_id,
            exitCode: state.ExitCode,
            finishedAt: state.FinishedAt,
          },
          suggestion,
        });
      } catch (err) {
        const message = `${project.name} container was removed externally (docker prune or manual deletion)`;
        const suggestion = 'Run restart_project to redeploy.';

        this.db.updateProject(project.id, { status: 'error' });

        await this.events.emit('container:missing', {
          projectId: project.id,
          projectName: project.name,
          containerId: project.container_id,
          suggestion,
        });

        await this.upsertAlert(key, {
          type: 'container-crash',
          severity: 'critical',
          message,
          details: {
            projectId: project.id,
            projectName: project.name,
            containerId: project.container_id,
            reason: 'container_missing',
          },
          suggestion,
        });

        log.warn({ err, containerId: project.container_id, projectId: project.id }, message);
      }
    }
  }

  private async checkContainerMemory(): Promise<void> {
    const dockerClient = this.docker.getClient();
    const projects = this.db.listProjects('running');

    for (const project of projects) {
      if (!project.container_id) continue;

      const key = `resource-saturation:${project.container_id}`;

      try {
        const container = dockerClient.getContainer(project.container_id);
        const statsStream = await container.stats({ stream: false });
        const stats = statsStream as unknown as {
          memory_stats?: { usage?: number; limit?: number };
        };

        const memUsage = stats.memory_stats?.usage;
        const memLimit = stats.memory_stats?.limit;

        if (memUsage == null || memLimit == null || memLimit === 0) {
          this.resolveAlert(key, 'resource-saturation');
          continue;
        }

        const usagePercent = (memUsage / memLimit) * 100;

        if (usagePercent < CONTAINER_MEMORY_THRESHOLD) {
          this.resolveAlert(key, 'resource-saturation');
          continue;
        }

        const usageMB = Math.round(memUsage / (1024 * 1024));
        const limitMB = Math.round(memLimit / (1024 * 1024));
        const message = `${project.name} memory usage at ${usagePercent.toFixed(0)}% (${String(usageMB)}MB / ${String(limitMB)}MB)`;
        const suggestion = `Container approaching memory limit. Increase the --memory option or check for memory leaks.`;

        await this.upsertAlert(key, {
          type: 'resource-saturation',
          severity: 'warning',
          message,
          details: {
            projectId: project.id,
            projectName: project.name,
            containerId: project.container_id,
            memoryUsagePercent: Math.round(usagePercent),
            memoryUsageMB: usageMB,
            memoryLimitMB: limitMB,
          },
          suggestion,
        });
      } catch (err) {
        log.debug({ err, containerId: project.container_id }, 'Failed to check container memory');
      }
    }
  }

  private async checkOrphanContainers(): Promise<void> {
    try {
      const dockerClient = this.docker.getClient();
      const containers = await dockerClient.listContainers({ all: true });

      const projects = this.db.listProjects();
      const services = this.db.listServices();

      const knownContainerIds = new Set<string>();
      for (const project of projects) {
        if (project.container_id) knownContainerIds.add(project.container_id);
      }
      for (const service of services) {
        if (service.container_id) knownContainerIds.add(service.container_id);
      }

      const orphans: { id: string; name: string; state: string }[] = [];
      for (const container of containers) {
        const names = container.Names.map((n: string) => n.replace(/^\//, ''));
        const isOpenLanderContainer = names.some(
          (n: string) => n.startsWith('ol-') || n.startsWith('openlander'),
        );
        if (!isOpenLanderContainer) continue;
        if (knownContainerIds.has(container.Id)) continue;

        orphans.push({
          id: container.Id.slice(0, 12),
          name: names[0] || container.Id.slice(0, 12),
          state: container.State,
        });
      }

      const key = 'orphan-container:system';
      if (orphans.length === 0) {
        this.resolveAlert(key, 'orphan-container');
        return;
      }

      const nameList = orphans.map((o) => `${o.name} (${o.state})`).join(', ');
      const message = `${String(orphans.length)} orphan OpenLander container(s) detected: ${nameList}`;
      const suggestion =
        'These containers have no matching project in the database. ' +
        'Remove them with platform_cleanup_orphans or docker rm.';

      await this.upsertAlert(key, {
        type: 'orphan-container',
        severity: 'warning',
        message,
        details: {
          count: orphans.length,
          containers: orphans,
        },
        suggestion,
      });
    } catch (err) {
      log.debug({ err }, 'Failed to check orphan containers');
    }
  }
}
