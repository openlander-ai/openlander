/**
 * DeployQueue — Sequential deploy request processing.
 *
 * Prevents concurrent agent chatStream calls from corrupting shared global state
 * (Agent.history, QuestionBridge.pendingResolve, setQuestionHandler overwrite).
 *
 * v0.1.0: Simple FIFO queue with hard timeout per job.
 * Phase 2: Replace with proper session isolation (per-session Agent state).
 *
 * @see docs/planning/v0.1.0/web-deploy-agent-mediated.md §3.4
 */

import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('deploy-queue');

/** Hard timeout per deploy job — prevents stuck jobs from blocking the queue. */
const JOB_TIMEOUT_MS = 120_000; // 2 minutes

export class DeployQueue {
  private queue: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private running = false;

  /**
   * Enqueue a deploy request. Resolves when it's this job's turn to run.
   * If no other job is running, resolves immediately.
   *
   * Usage:
   * ```typescript
   * const release = await deployQueue.acquire();
   * try {
   *   await agent.chatStream(...);
   * } finally {
   *   release();
   * }
   * ```
   */
  async acquire(): Promise<() => void> {
    if (!this.running) {
      this.running = true;
      log.debug('Acquired deploy lock immediately (queue empty)');
      return this.createRelease();
    }

    // Another job is running — wait in queue
    log.debug({ queueLength: this.queue.length + 1 }, 'Queued deploy request');
    await new Promise<void>((resolve, reject) => {
      this.queue.push({ resolve, reject });
    });

    return this.createRelease();
  }

  /** Current number of waiting jobs (not including the running one). */
  getQueueLength(): number {
    return this.queue.length;
  }

  /** Whether a deploy job is currently running. */
  isRunning(): boolean {
    return this.running;
  }

  /** Get the position in queue (0 = next to run, -1 = not queued). */
  getPosition(): number {
    return this.running ? this.queue.length : -1;
  }

  /**
   * Create a release function with hard timeout.
   * If the job doesn't release within JOB_TIMEOUT_MS, it's force-released.
   */
  private createRelease(): () => void {
    let released = false;

    const timer = setTimeout(() => {
      if (!released) {
        log.warn({ timeoutMs: JOB_TIMEOUT_MS }, 'Deploy job timed out — force releasing lock');
        release();
      }
    }, JOB_TIMEOUT_MS);

    const release = (): void => {
      if (released) return;
      released = true;
      clearTimeout(timer);

      const next = this.queue.shift();
      if (next) {
        log.debug({ remaining: this.queue.length }, 'Releasing lock to next queued job');
        next.resolve();
      } else {
        this.running = false;
        log.debug('Queue empty — lock released');
      }
    };

    return release;
  }
}
