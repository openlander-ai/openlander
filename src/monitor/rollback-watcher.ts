import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import type { DeployPipeline } from '../pipeline/deploy.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('rollback-watcher');

interface WatcherState {
  projectId: string;
  consecutiveFailures: number;
  timer: ReturnType<typeof setTimeout>;
  planId?: string;
}

export class RollbackWatcher {
  private readonly events: EventBus;
  private readonly db: Database;
  private readonly pipeline?: DeployPipeline;
  private readonly watchers = new Map<string, WatcherState>();
  private unsubscribers: Array<() => void> = [];
  private readonly WATCH_DURATION_MS = 60_000;
  private readonly FAILURE_THRESHOLD = 3;

  constructor(events: EventBus, db: Database, pipeline?: DeployPipeline) {
    this.events = events;
    this.db = db;
    this.pipeline = pipeline;
  }

  start(): void {
    this.unsubscribers.push(
      this.events.on('deploy:success', (payload) => {
        this.startWatching(payload.projectId, payload.planId);
      }),
      this.events.on('monitor:healthcheck', (payload) => {
        this.handleHealthCheck(payload.projectId, payload.healthy);
      }),
    );
  }

  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    for (const [, watcher] of this.watchers) {
      clearTimeout(watcher.timer);
    }
    this.watchers.clear();
  }

  private startWatching(projectId: string, planId?: string): void {
    const project = this.db.getProject(projectId);
    if (!project?.previous_image_tag) return;

    this.stopWatching(projectId);

    const timer = setTimeout(() => {
      this.stopWatching(projectId);
    }, this.WATCH_DURATION_MS);

    this.watchers.set(projectId, {
      projectId,
      consecutiveFailures: 0,
      timer,
      planId,
    });

    log.info({ projectId, planId }, 'Started post-deploy health watch');
  }

  private stopWatching(projectId: string): void {
    const watcher = this.watchers.get(projectId);
    if (watcher) {
      clearTimeout(watcher.timer);
      this.watchers.delete(projectId);
    }
  }

  private handleHealthCheck(projectId: string, healthy: boolean): void {
    const watcher = this.watchers.get(projectId);
    if (!watcher) return;

    if (healthy) {
      watcher.consecutiveFailures = 0;
      return;
    }

    watcher.consecutiveFailures++;
    log.info(
      { projectId, failures: watcher.consecutiveFailures },
      'Health check failed during watch',
    );

    if (watcher.consecutiveFailures >= this.FAILURE_THRESHOLD) {
      const project = this.db.getProject(projectId);
      if (project?.previous_image_tag) {
        // If this is a plan-originated deploy and we have pipeline, auto-execute rollback
        if (watcher.planId && this.pipeline) {
          void this.executeAutoRollback(projectId, watcher.planId);
        } else {
          // Otherwise, emit suggestion for manual rollback
          void this.events.emit('rollback:suggested', {
            projectId,
            projectName: project.name,
            consecutiveFailures: watcher.consecutiveFailures,
            previousImageTag: project.previous_image_tag,
          });
        }
      }
      this.stopWatching(projectId);
    }
  }

  private async executeAutoRollback(projectId: string, planId: string): Promise<void> {
    if (!this.pipeline) return;

    try {
      log.info({ projectId, planId }, 'Auto-executing rollback for plan deploy');
      const result = await this.pipeline.rollback(projectId);

      if (result.success) {
        log.info({ projectId, planId }, 'Auto-rollback succeeded');
        // Update plan status to rolled_back
        this.db.updateDeployPlanStatus(planId, 'rolled_back');
      } else {
        log.error({ projectId, planId, error: result.error }, 'Auto-rollback failed');
      }
    } catch (err) {
      log.error({ projectId, planId, err }, 'Error during auto-rollback execution');
    }
  }
}
