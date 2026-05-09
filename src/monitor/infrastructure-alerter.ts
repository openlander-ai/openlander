import type { Docker } from '../pipeline/docker.js';
import type { Database } from '../db/index.js';
import { getSystemStats } from './stats.js';
import { createModuleLogger } from '../lib/logger.js';
import { parseDBTimestamp } from '../lib/parse-db-timestamp.js';
import type { AlertMonitor } from './alerts.js';

const log = createModuleLogger('infra-alerter');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const INACTIVE_DAYS_THRESHOLD = 14;
const RESTART_COUNT_THRESHOLD = 3;
const DANGLING_IMAGES_THRESHOLD = 3;
const CONTAINER_MEMORY_THRESHOLD = 90;
const INITIAL_STAGGER_MS = 8000;

export class InfrastructureAlerter {
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private initialTimerId: ReturnType<typeof setTimeout> | undefined;
  private checking = false;

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly alertMonitor: AlertMonitor,
    private readonly options: { intervalMs?: number } = {},
  ) {}

  start(intervalMs?: number): void {
    if (this.intervalId) {
      return;
    }

    const interval = intervalMs ?? this.options.intervalMs ?? 30000;
    this.intervalId = setInterval(() => {
      void this.runChecks();
    }, interval);

    // Stagger first check to avoid Docker API thundering herd at startup.
    this.initialTimerId = setTimeout(() => {
      this.initialTimerId = undefined;
      void this.runChecks();
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

  async runChecks(): Promise<void> {
    if (this.checking) {
      return;
    }

    this.checking = true;
    try {
      await Promise.all([
        this.checkDiskUsage(),
        this.checkInactiveProjects(),
        this.checkContainerRestartLoops(),
        this.checkContainerMemory(),
        this.checkDanglingImages(),
        this.checkPortConflicts(),
      ]);
    } catch (err) {
      log.error({ err }, 'Error during infrastructure alert checks');
    } finally {
      this.checking = false;
    }
  }

  private async checkDiskUsage(): Promise<void> {
    const stats = getSystemStats();
    const usagePercent = stats.disk.usagePercent;
    const key = 'disk:root';

    if (usagePercent < 80) {
      this.alertMonitor.resolveAlert(key, 'disk');
      return;
    }

    const severity: 'warning' | 'critical' = usagePercent >= 90 ? 'critical' : 'warning';
    const message = `Disk usage is ${usagePercent.toFixed(1)}% (${String(stats.disk.usedGB)}GB / ${String(stats.disk.totalGB)}GB)`;
    const suggestion =
      usagePercent >= 90
        ? 'Critical: Free up disk space immediately. Remove unused Docker images with "docker image prune -a" or clean up old project data.'
        : 'Consider cleaning up unused Docker images with "docker image prune" or removing old unused projects.';

    await this.alertMonitor.upsertAlert(key, {
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
    const projects = await this.db.listProjects('running');
    const now = Date.now();

    for (const project of projects) {
      const key = `inactive-project:${project.id}`;
      const updatedAt = parseDBTimestamp(project.updated_at).getTime();
      const daysSinceUpdate = (now - updatedAt) / MS_PER_DAY;

      if (daysSinceUpdate <= INACTIVE_DAYS_THRESHOLD) {
        this.alertMonitor.resolveAlert(key, 'inactive-project');
        continue;
      }

      const message = `Project "${project.name}" has been inactive for ${String(Math.floor(daysSinceUpdate))} days`;
      const suggestion = `Consider stopping this project to free up resources. Use "stop_service ${project.name}" or ask the user if it's still needed.`;

      await this.alertMonitor.upsertAlert(key, {
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
    const projects = await this.db.listProjects('running');

    for (const project of projects) {
      // PR 4.5: canonical-first read of container_id with `??` fallback to
      // legacy `projects` column through migration 0012.
      const deployable = await this.db.getDeployableForProject(project.id);
      const containerId = deployable?.container_id ?? project.container_id;
      if (!containerId) continue;

      const key = `restart-loop:${containerId}`;

      try {
        const info = await this.docker.inspectContainer(containerId);
        const restartCount: number = info.RestartCount;

        const startedAt = new Date(info.State.StartedAt);
        const hoursSinceStart = (Date.now() - startedAt.getTime()) / (60 * 60 * 1000);
        const isRecent = hoursSinceStart < 24;

        if (restartCount < RESTART_COUNT_THRESHOLD || !isRecent) {
          this.alertMonitor.resolveAlert(key, 'restart-loop');
          continue;
        }

        const message = `Container for "${project.name}" has restarted ${String(restartCount)} times in the last 24 hours`;
        const suggestion = `Check the container logs for errors using "get_logs ${project.name}" and investigate the root cause. The application may be crashing on startup.`;

        await this.alertMonitor.upsertAlert(key, {
          type: 'restart-loop',
          severity: 'critical',
          message,
          details: {
            projectId: project.id,
            projectName: project.name,
            containerId,
            restartCount,
            lastStarted: info.State.StartedAt,
          },
          suggestion,
        });
      } catch (err) {
        log.debug({ err, containerId }, 'Failed to inspect container for restart check');
      }
    }
  }

  private async checkDanglingImages(): Promise<void> {
    const key = 'dangling-images:system';

    try {
      const images = await this.docker.listDanglingImages();

      if (images.length < DANGLING_IMAGES_THRESHOLD) {
        this.alertMonitor.resolveAlert(key, 'dangling-images');
        return;
      }

      const totalSize = images.reduce(
        (sum, img) => sum + ((img.Size as number | undefined) ?? 0),
        0,
      );
      const sizeGB = (totalSize / 1e9).toFixed(2);

      const message = `${String(images.length)} dangling Docker images detected, using approximately ${sizeGB}GB of disk space`;
      const suggestion =
        'Clean up dangling images to free disk space with "docker image prune". This is safe and will only remove unused images.';

      await this.alertMonitor.upsertAlert(key, {
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
    const projects = await this.db.listProjects('running');
    const portMap = new Map<number, string[]>();

    for (const project of projects) {
      // PR 4.5: canonical-first read of assigned_port with `??` fallback.
      const deployable = await this.db.getDeployableForProject(project.id);
      const assignedPort = deployable?.assigned_port ?? project.assigned_port;
      if (assignedPort != null) {
        const names = portMap.get(assignedPort) ?? [];
        names.push(project.name);
        portMap.set(assignedPort, names);
      }
    }

    const activeKeys = new Set<string>();

    for (const [port, names] of portMap) {
      if (names.length < 2) continue;

      const key = `port-conflict:${String(port)}`;
      activeKeys.add(key);

      const altPort = port + 1000;
      await this.alertMonitor.upsertAlert(key, {
        type: 'port-conflict',
        severity: 'warning',
        message: `Port ${String(port)} used by ${names.join(', ')}`,
        details: { port, projects: names, suggestedPort: altPort },
        suggestion: `Port ${String(port)} is shared by multiple projects. Consider reassigning one to port ${String(altPort)}.`,
      });
    }

    for (const key of this.alertMonitor.getAlertKeys()) {
      if (key.startsWith('port-conflict:') && !activeKeys.has(key)) {
        this.alertMonitor.resolveAlert(key, 'port-conflict');
      }
    }
  }

  private async checkContainerMemory(): Promise<void> {
    const projects = await this.db.listProjects('running');

    for (const project of projects) {
      // PR 4.5: canonical-first read of container_id with `??` fallback.
      const deployable = await this.db.getDeployableForProject(project.id);
      const containerId = deployable?.container_id ?? project.container_id;
      if (!containerId) continue;

      const key = `resource-saturation:${containerId}`;

      try {
        const statsRaw = await this.docker.getContainerStats(containerId);
        const stats = statsRaw as {
          memory_stats?: { usage?: number; limit?: number };
        };

        const memUsage = stats.memory_stats?.usage;
        const memLimit = stats.memory_stats?.limit;

        if (memUsage == null || memLimit == null || memLimit === 0) {
          this.alertMonitor.resolveAlert(key, 'resource-saturation');
          continue;
        }

        const usagePercent = (memUsage / memLimit) * 100;

        if (usagePercent < CONTAINER_MEMORY_THRESHOLD) {
          this.alertMonitor.resolveAlert(key, 'resource-saturation');
          continue;
        }

        const usageMB = Math.round(memUsage / (1024 * 1024));
        const limitMB = Math.round(memLimit / (1024 * 1024));
        const message = `${project.name} memory usage at ${usagePercent.toFixed(0)}% (${String(usageMB)}MB / ${String(limitMB)}MB)`;
        const suggestion = `Container approaching memory limit. Increase the --memory option or check for memory leaks.`;

        await this.alertMonitor.upsertAlert(key, {
          type: 'resource-saturation',
          severity: 'warning',
          message,
          details: {
            projectId: project.id,
            projectName: project.name,
            containerId,
            memoryUsagePercent: Math.round(usagePercent),
            memoryUsageMB: usageMB,
            memoryLimitMB: limitMB,
          },
          suggestion,
        });
      } catch (err) {
        log.debug({ err, containerId }, 'Failed to check container memory');
      }
    }
  }
}
