import type { Docker } from '../pipeline/docker.js';
import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';
import { auditDiskThresholdCleanup, shouldRunCleanup } from '../pipeline/cleanup.js';

const log = createModuleLogger('system-maintenance');

const CLEANUP_COOLDOWN_MS = 10 * 60 * 1000;

export interface SystemMaintenanceMonitorOptions {
  intervalMs?: number;
}

/**
 * SystemMaintenanceMonitor handles periodic system maintenance tasks.
 *
 * Currently manages:
 * - Disk usage monitoring and cleanup triggering
 *
 * Extracted from HealthMonitor to separate concerns:
 * - HealthMonitor: project/service health checks
 * - SystemMaintenanceMonitor: system-level maintenance (disk, resources)
 */
export class SystemMaintenanceMonitor {
  private readonly docker: Docker;
  private readonly db: Database;
  private readonly events: EventBus;
  private readonly options: Required<SystemMaintenanceMonitorOptions>;
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private checking = false;
  private lastCleanupAt = 0;

  constructor(
    docker: Docker,
    db: Database,
    events: EventBus,
    options?: SystemMaintenanceMonitorOptions,
  ) {
    this.docker = docker;
    this.db = db;
    this.events = events;
    this.options = {
      intervalMs: options?.intervalMs ?? 30000,
    };
    void this.docker;
    void this.events;
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    this.intervalId = setInterval(() => {
      void this.runMaintenance();
    }, this.options.intervalMs);

    void this.runMaintenance();
  }

  stop(): void {
    if (!this.intervalId) {
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = undefined;
  }

  /**
   * Check disk usage and trigger cleanup if needed.
   *
   * Respects cooldown period to avoid excessive cleanup operations.
   * Defers cleanup if builds are in progress.
   */
  async checkDiskUsage(): Promise<void> {
    const now = Date.now();
    if (!shouldRunCleanup() || now - this.lastCleanupAt < CLEANUP_COOLDOWN_MS) {
      return;
    }

    const building = await this.db.listProjects('building');
    if (building.length > 0) {
      log.info({ count: building.length }, 'Deferred disk cleanup — builds in progress');
      return;
    }

    this.lastCleanupAt = now;
    log.info('Disk usage above threshold — recording audit-only cleanup recommendation');
    await Promise.resolve();
    auditDiskThresholdCleanup();
  }

  private async runMaintenance(): Promise<void> {
    if (this.checking) {
      return;
    }

    this.checking = true;
    try {
      const dockerAvailable = await this.docker.ping();
      if (!dockerAvailable) {
        return;
      }

      await this.checkDiskUsage();
    } finally {
      this.checking = false;
    }
  }
}

/**
 * Factory function to create a SystemMaintenanceMonitor.
 */
export function createSystemMaintenanceMonitor(
  docker: Docker,
  db: Database,
  events: EventBus,
  options?: SystemMaintenanceMonitorOptions,
): SystemMaintenanceMonitor {
  return new SystemMaintenanceMonitor(docker, db, events, options);
}
