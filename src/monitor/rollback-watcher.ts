import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('rollback-watcher');

interface WatcherState {
  projectId: string;
  consecutiveFailures: number;
  timer: ReturnType<typeof setTimeout>;
}

export class RollbackWatcher {
  private readonly events: EventBus;
  private readonly db: Database;
  private readonly watchers = new Map<string, WatcherState>();
  private readonly WATCH_DURATION_MS = 60_000;
  private readonly FAILURE_THRESHOLD = 3;

  constructor(events: EventBus, db: Database) {
    this.events = events;
    this.db = db;
  }

  start(): void {
    this.events.on('deploy:success', (payload) => {
      this.startWatching(payload.projectId);
    });

    this.events.on('monitor:healthcheck', (payload) => {
      this.handleHealthCheck(payload.projectId, payload.healthy);
    });
  }

  private startWatching(projectId: string): void {
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
    });

    log.info({ projectId }, 'Started post-deploy health watch');
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
        void this.events.emit('rollback:suggested', {
          projectId,
          projectName: project.name,
          consecutiveFailures: watcher.consecutiveFailures,
          previousImageTag: project.previous_image_tag,
        });
      }
      this.stopWatching(projectId);
    }
  }
}
