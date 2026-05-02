import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import type { RuntimeSignal } from '../health/types.js';
import type { DeployPipeline } from '../pipeline/deploy.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('rollback-watcher');

interface WatcherState {
  projectId: string;
  consecutiveFailures: number;
  timer: ReturnType<typeof setTimeout>;
  planId?: string;
}

export interface RollbackWatcherOptions {
  onRegressionSignal?: (signal: RuntimeSignal) => Promise<void>;
}

export class RollbackWatcher {
  private readonly events: EventBus;
  private readonly db: Database;
  private readonly pipeline?: DeployPipeline;
  private readonly options?: RollbackWatcherOptions;
  private readonly watchers = new Map<string, WatcherState>();
  private unsubscribers: Array<() => void> = [];
  private readonly WATCH_DURATION_MS = 60_000;
  private readonly FAILURE_THRESHOLD = 3;

  constructor(
    events: EventBus,
    db: Database,
    pipeline?: DeployPipeline,
    options?: RollbackWatcherOptions,
  ) {
    this.events = events;
    this.db = db;
    this.pipeline = pipeline;
    this.options = options;
  }

  start(): void {
    this.unsubscribers.push(
      this.events.on('deploy:success', (payload) => {
        void this.startWatching(payload.projectId, payload.planId).catch((err: unknown) => {
          log.warn(
            { err, projectId: payload.projectId, planId: payload.planId },
            'Failed to start post-deploy health watch',
          );
        });
      }),
      this.events.on('monitor:healthcheck', (payload) => {
        void this.handleHealthCheck(payload.projectId, payload.healthy).catch((err: unknown) => {
          log.warn(
            { err, projectId: payload.projectId },
            'Failed to handle post-deploy health watch check',
          );
        });
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

  private async startWatching(projectId: string, planId?: string): Promise<void> {
    const project = await this.db.getProject(projectId);
    // PR 4.5: canonical-first read of previous_image_tag with `??` fallback.
    const deployable = await this.db.getDeployableForProject(projectId);
    // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
    const previousImageTag = deployable?.previous_image_tag ?? project?.previous_image_tag;
    if (!previousImageTag) return;

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

  private async handleHealthCheck(projectId: string, healthy: boolean): Promise<void> {
    const watcher = this.watchers.get(projectId);
    if (!watcher) return;

    const project = await this.db.getProject(projectId);
    if (!project) {
      this.stopWatching(projectId);
      return;
    }
    // PR 4.5: canonical-first reads with `??` fallback to legacy columns.
    const deployable = await this.db.getDeployableForProject(projectId);
    const status = deployable?.status ?? project.status;
    const previousImageTag = deployable?.previous_image_tag ?? project.previous_image_tag;
    if (status === 'stopped') {
      this.stopWatching(projectId);
      return;
    }

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
      if (previousImageTag) {
        if (this.options?.onRegressionSignal) {
          // Delegate recovery decision to RecoveryCoordinator via RuntimeSignal
          const signal: RuntimeSignal = {
            projectId,
            kind: 'post_deploy_regression',
            source: 'rollback-watcher',
            failureCount: watcher.consecutiveFailures,
            suggestedAction: 'rollback',
          };
          void this.options.onRegressionSignal(signal).catch((err: unknown) => {
            log.warn({ err, projectId }, 'Failed to emit rollback regression signal');
          });
        } else if (watcher.planId && this.pipeline) {
          // Fallback: plan-originated deploy with pipeline — auto-execute rollback
          void this.executeAutoRollback(projectId, watcher.planId);
        } else {
          // Fallback: emit suggestion for manual rollback
          void this.events
            .emit('rollback:suggested', {
              projectId,
              projectName: project.name,
              consecutiveFailures: watcher.consecutiveFailures,
              previousImageTag,
            })
            .catch((err: unknown) => {
              log.warn({ err, projectId }, 'Failed to emit rollback suggestion');
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
        await this.db.updateDeployPlanStatus(planId, 'rolled_back');
      } else {
        log.error({ projectId, planId, error: result.error }, 'Auto-rollback failed');
      }
    } catch (err) {
      log.error({ projectId, planId, err }, 'Error during auto-rollback execution');
    }
  }
}
