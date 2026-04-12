/**
 * DeployQueue — Sequential deploy request processing.
 *
 * Prevents concurrent agent chatStream calls from corrupting shared global state
 * (Agent.history, QuestionBridge.pendingResolve, setQuestionHandler overwrite).
 *
 * Two-layer stale recovery:
 * 1. Watchdog timer (STALE_JOB_MS) — self-healing for queued waiters
 * 2. Acquire-time check — immediate cleanup when new job arrives
 *
 * @see docs/planning/v0.1.0/web-deploy-agent-mediated.md §3.4
 */

import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('deploy-queue');

const STALE_JOB_MS = 30 * 60 * 1000; // 30 minutes

export class DeployQueue {
  private queue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private running = false;
  private acquiredAt: number | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  async acquire(): Promise<() => void> {
    if (this.running && this.acquiredAt !== null) {
      const elapsed = Date.now() - this.acquiredAt;
      if (elapsed > STALE_JOB_MS) {
        log.warn({ elapsedMs: elapsed }, 'Stale deploy job detected — force releasing');
        this.forceReleaseCurrent();
      }
    }

    if (!this.running) {
      this.running = true;
      this.acquiredAt = Date.now();
      log.debug('Acquired deploy lock immediately (queue empty)');
      return this.createRelease();
    }

    log.debug({ queueLength: this.queue.length + 1 }, 'Queued deploy request');
    await new Promise<void>((resolve, reject) => {
      this.queue.push({ resolve, reject });
    });

    this.acquiredAt = Date.now();
    return this.createRelease();
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  isRunning(): boolean {
    return this.running;
  }

  getPosition(): number {
    return this.running ? this.queue.length : -1;
  }

  private createRelease(): () => void {
    let released = false;
    this.startWatchdog();

    const release = (): void => {
      if (released) return;
      released = true;
      this.clearWatchdog();

      const next = this.queue.shift();
      if (next) {
        log.debug({ remaining: this.queue.length }, 'Releasing lock to next queued job');
        next.resolve();
      } else {
        this.running = false;
        this.acquiredAt = null;
        log.debug('Queue empty — lock released');
      }
    };

    return release;
  }

  private startWatchdog(): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      if (this.running) {
        log.warn({ timeoutMs: STALE_JOB_MS }, 'Deploy job watchdog — force releasing stale lock');
        this.forceReleaseCurrent();
      }
    }, STALE_JOB_MS);
    this.watchdog.unref();
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private forceReleaseCurrent(): void {
    this.clearWatchdog();
    this.running = false;
    this.acquiredAt = null;
    const next = this.queue.shift();
    if (next) {
      next.resolve();
    }
  }
}
