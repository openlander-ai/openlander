import type { AppContext } from '../app.js';
import { randomUUID } from 'node:crypto';
import type { OpsIncidentRow } from '../db/types.js';
import { eventBus } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';
import type { OpsConfig, OpsEvent } from './ops-types.js';
import { DEFAULT_OPS_CONFIG } from './ops-types.js';

const log = createModuleLogger('ops-agent');

export class OpsAgent {
  private readonly ctx: AppContext;
  private config: OpsConfig;
  private queue: OpsEvent[] = [];
  private processing = false;
  private running = false;
  private readonly eventHandlers = new Map<string, (payload: unknown) => void>();
  private readonly eventUnsubscribers = new Map<string, () => void>();
  private readonly llmCallsPerProject = new Map<string, number[]>();
  private readonly llmCallsGlobal: number[] = [];
  private readonly maxConcurrentLLM = 3;
  private readonly maxConcurrentRecovery = 5;
  private diskCheckTimer: ReturnType<typeof setInterval> | null = null;
  private lastCleanupAt = 0;
  private readonly CLEANUP_COOLDOWN_MS = 10 * 60_000; // 10 minutes

  constructor(ctx: AppContext, config?: Partial<OpsConfig>) {
    this.ctx = ctx;
    this.config = { ...DEFAULT_OPS_CONFIG, ...config };
    void this.ctx;
    void this.maxConcurrentLLM;
    void this.maxConcurrentRecovery;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    this.eventHandlers.set('monitor:inactive', (payload) => {
      this.enqueue({ type: 'monitor:inactive', payload, timestamp: Date.now() });
    });
    this.eventHandlers.set('deploy:crash', (payload) => {
      this.enqueue({ type: 'deploy:crash', payload, timestamp: Date.now() });
    });
    this.eventHandlers.set('container:missing', (payload) => {
      this.enqueue({ type: 'container:missing', payload, timestamp: Date.now() });
    });
    this.eventHandlers.set('deploy:failed', (payload) => {
      this.enqueue({ type: 'deploy:failed', payload, timestamp: Date.now() });
    });
    this.eventHandlers.set('recovery:failed', (payload) => {
      this.enqueue({ type: 'recovery:failed', payload, timestamp: Date.now() });
    });
    this.eventHandlers.set('recovery:exhausted', (payload) => {
      this.enqueue({ type: 'recovery:exhausted', payload, timestamp: Date.now() });
    });
    this.eventHandlers.set('monitor:healthcheck', (payload) => {
      this.enqueue({ type: 'monitor:healthcheck', payload, timestamp: Date.now() });
    });

    for (const [eventName, handler] of this.eventHandlers.entries()) {
      const unsubscribe = eventBus.on(
        eventName as
          | 'monitor:inactive'
          | 'deploy:crash'
          | 'container:missing'
          | 'deploy:failed'
          | 'recovery:failed'
          | 'recovery:exhausted'
          | 'monitor:healthcheck',
        handler,
      );
      this.eventUnsubscribers.set(eventName, unsubscribe);
    }

    await this.reconcileOnBoot();

    this.diskCheckTimer = setInterval(() => {
      void this.checkAndCleanDisk();
    }, 5 * 60_000);

    void this.processQueue();
    await Promise.resolve();
    log.info('OpsAgent started');
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.diskCheckTimer) {
      clearInterval(this.diskCheckTimer);
      this.diskCheckTimer = null;
    }

    for (const unsubscribe of this.eventUnsubscribers.values()) {
      unsubscribe();
    }
    this.eventUnsubscribers.clear();
    this.eventHandlers.clear();

    const drainStart = Date.now();
    while (this.processing && Date.now() - drainStart < 5000) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
    }

    log.info('OpsAgent stopped');
  }

  enqueue(event: OpsEvent): void {
    if (!this.running) {
      return;
    }

    this.queue.push(event);
    if (!this.processing) {
      void this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      while (this.queue.length > 0 && this.running) {
        const event = this.queue.shift();
        if (!event) {
          break;
        }

        try {
          await this.routeEvent(event);
        } catch (error) {
          log.error({ error, eventType: event.type }, 'OpsAgent event processing error');
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async routeEvent(event: OpsEvent): Promise<void> {
    switch (event.type) {
      case 'deploy:crash':
      case 'container:missing':
        await this.handleCrashEvent(event);
        break;
      case 'deploy:failed':
        await this.handleDeployFailed(event);
        break;
      case 'recovery:failed':
      case 'recovery:exhausted':
        await this.handleRecoveryExhausted(event);
        break;
      case 'monitor:healthcheck':
        await this.handleHealthDegraded(event);
        break;
      case 'monitor:inactive':
        await this.handleInactiveProject(event);
        break;
      default:
        log.debug({ eventType: event.type }, 'OpsAgent received unknown event type');
    }
  }

  private async reconcileOnBoot(): Promise<void> {
    try {
      const activeIncidents = new Map<string, OpsIncidentRow>();
      for (const project of this.ctx.db.listProjects()) {
        const incident = this.ctx.db.getActiveOpsIncident(project.id);
        if (incident) {
          activeIncidents.set(incident.id, incident);
        }
      }

      for (const incident of activeIncidents.values()) {
        this.ctx.db.addOpsIncidentEvent({
          id: `evt-${randomUUID()}`,
          incident_id: incident.id,
          event_type: 'interrupted',
          description: 'Incident interrupted by server restart',
        });
      }

      const now = Date.now();
      const staleCircuitBreakers = this.ctx.db.findAllOpenCircuitBreakers().filter((projectId) => {
        const state = this.ctx.db.getCircuitBreakerState(projectId);
        return typeof state?.opened_at === 'number' && now - state.opened_at > 86_400_000;
      });

      for (const projectId of staleCircuitBreakers) {
        this.ctx.db.resetCircuitBreaker(projectId);
      }

      if (activeIncidents.size > 0 || staleCircuitBreakers.length > 0) {
        log.info(
          {
            interruptedIncidents: activeIncidents.size,
            resetBreakers: staleCircuitBreakers.length,
          },
          'Boot reconciliation completed',
        );
      }

      await Promise.resolve();
    } catch (err) {
      log.warn({ err }, 'Boot reconciliation failed — continuing startup');
    }
  }

  private handleCrashEvent(_event: OpsEvent): Promise<void> {
    void _event;
    return Promise.resolve();
  }

  private handleHealthDegraded(_event: OpsEvent): Promise<void> {
    void _event;
    return Promise.resolve();
  }

  private handleDeployFailed(_event: OpsEvent): Promise<void> {
    void _event;
    return Promise.resolve();
  }

  private handleRecoveryExhausted(_event: OpsEvent): Promise<void> {
    void _event;
    return Promise.resolve();
  }

  private handleInactiveProject(_event: OpsEvent): Promise<void> {
    void _event;
    return Promise.resolve();
  }

  private async checkAndCleanDisk(): Promise<void> {
    if (!this.config.auto_cleanup) {
      return;
    }

    if (Date.now() - this.lastCleanupAt < this.CLEANUP_COOLDOWN_MS) {
      return;
    }

    try {
      const { getSystemStats } = await import('./stats.js');
      const stats = await Promise.resolve(getSystemStats());
      const diskPercent = stats.disk.usagePercent;

      if (diskPercent >= this.config.thresholds.disk_cleanup_percent) {
        log.info(
          { diskPercent, threshold: this.config.thresholds.disk_cleanup_percent },
          'Disk threshold reached — running cleanup',
        );

        const { diskThresholdCleanup } = await import('../pipeline/cleanup.js');
        diskThresholdCleanup();

        this.lastCleanupAt = Date.now();

        log.info({ diskPercent }, 'Disk cleanup completed');
      }
    } catch (err) {
      log.warn({ err }, 'Disk check/cleanup failed');
    }
  }

  generateDigest(): Promise<void> {
    void this.processing;
    return Promise.resolve();
  }

  isLlmRateLimited(projectId: string): boolean {
    const now = Date.now();
    const hourAgo = now - 3_600_000;
    const projectCalls = (this.llmCallsPerProject.get(projectId) ?? []).filter((t) => t > hourAgo);
    const globalCalls = this.llmCallsGlobal.filter((t) => t > hourAgo);

    this.llmCallsPerProject.set(projectId, projectCalls);
    return projectCalls.length >= 3 || globalCalls.length >= 20;
  }

  recordLlmCall(projectId: string): void {
    const now = Date.now();
    const hourAgo = now - 3_600_000;
    const existing = (this.llmCallsPerProject.get(projectId) ?? []).filter((t) => t > hourAgo);
    this.llmCallsPerProject.set(projectId, [...existing, now]);

    const cleanGlobal = this.llmCallsGlobal.filter((t) => t > hourAgo);
    this.llmCallsGlobal.length = 0;
    this.llmCallsGlobal.push(...cleanGlobal, now);
  }

  getConfig(): OpsConfig {
    return this.config;
  }

  reloadConfig(config: Partial<OpsConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
