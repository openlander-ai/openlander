import type { AppContext } from '../app.js';
import { randomUUID } from 'node:crypto';
import type { OpsIncidentRow } from '../db/types.js';
import { eventBus } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';
import type { OpsConfig, OpsEvent } from './ops-types.js';
import { DEFAULT_OPS_CONFIG } from './ops-types.js';
import { resolveAutomationPolicy } from './ops-config-resolver.js';
import { RecoveryPipeline } from './ops-recovery.js';
import { OpsAlerting } from './ops-alerting.js';
import { CascadeDetector } from './ops-cascade.js';
import { DigestGenerator } from './ops-digest.js';
import { IncidentManager } from './ops-incidents.js';

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
  private readonly recovery: RecoveryPipeline;
  private readonly alerting: OpsAlerting;
  private readonly cascade: CascadeDetector;
  private readonly digest: DigestGenerator;
  private readonly incidents: IncidentManager;
  private diskCheckTimer: ReturnType<typeof setInterval> | null = null;
  private lastCleanupAt = 0;
  private readonly CLEANUP_COOLDOWN_MS = 10 * 60_000; // 10 minutes

  constructor(ctx: AppContext, config?: Partial<OpsConfig>) {
    this.ctx = ctx;
    this.config = { ...DEFAULT_OPS_CONFIG, ...config };
    this.recovery = new RecoveryPipeline(ctx, ctx.approvalGate);
    this.alerting = new OpsAlerting(ctx, this.config);
    this.cascade = new CascadeDetector(ctx);
    this.digest = new DigestGenerator(ctx);
    this.incidents = new IncidentManager(ctx);
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
    this.eventHandlers.set('container:die', (payload) => {
      this.enqueue({ type: 'container:die', payload, timestamp: Date.now() });
    });
    this.eventHandlers.set('container:oom', (payload) => {
      this.enqueue({ type: 'container:oom', payload, timestamp: Date.now() });
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
          | 'container:die'
          | 'container:oom'
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

    if (this.config.thresholds.digest_time) {
      this.digest.scheduleDigest(this.config.thresholds.digest_time);
    }

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

    this.digest.stopSchedule();

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
      case 'container:die':
      case 'container:oom':
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

  private async handleCrashEvent(event: OpsEvent): Promise<void> {
    const payload = event.payload as {
      projectId?: string;
      projectName?: string;
      containerId?: string;
    };
    const projectId = payload.projectId ?? '';
    const projectName = payload.projectName ?? projectId;
    const containerId = payload.containerId ?? '';

    if (!projectId) {
      return;
    }

    this.cascade.recordFailure(projectId);

    const incident = this.incidents.openIncident(projectId, { type: event.type });

    const cascadeResult = await this.cascade.detectCascade();
    if (cascadeResult) {
      const cascadeAlert = this.cascade.buildCascadeAlert(cascadeResult, incident.id);
      await this.alerting.sendAlert(cascadeAlert);
      // Don't return — still attempt recovery for this individual project
    }

    const alert = this.alerting.buildContextualAlert({
      severity: 'critical',
      projectId,
      projectName,
      eventType: event.type,
      title: `Container crash: ${projectName}`,
      description: `Container for project "${projectName}" has crashed`,
      incidentId: incident.id,
    });
    await this.alerting.sendAlert(alert);

    if (this.config.recovery.enabled && containerId) {
      const automationPolicy = resolveAutomationPolicy(this.config);
      if (!automationPolicy) {
        return;
      }

      const result = await this.recovery.execute({
        projectId,
        projectName,
        containerId,
        incidentId: incident.id,
        automationPolicy,
      });
      if (result === 'recovered') {
        this.incidents.resolveIncident(incident.id, 'Auto-recovered after restart');
      } else if (result === 'escalated') {
        this.incidents.escalateIncident(incident.id, 'Recovery pipeline exhausted');
      }
    }
  }

  private async handleHealthDegraded(event: OpsEvent): Promise<void> {
    const payload = event.payload as {
      projectId?: string;
      projectName?: string;
      failures?: number;
    };
    const projectId = payload.projectId ?? '';
    if (!projectId || (payload.failures ?? 0) < 2) {
      return;
    }

    const projectName = payload.projectName ?? projectId;
    const alert = this.alerting.buildContextualAlert({
      severity: 'warning',
      projectId,
      projectName,
      eventType: 'health_degraded',
      title: `Health degraded: ${projectName}`,
      description: `Health check failing for project "${projectName}"`,
    });
    await this.alerting.sendAlert(alert);
  }

  private async handleDeployFailed(event: OpsEvent): Promise<void> {
    const payload = event.payload as {
      projectId?: string;
      error?: string;
      step?: string;
    };
    const projectId = payload.projectId ?? '';
    if (!projectId || payload.step !== 'run') return;

    // deploy:failed from HealthMonitor doesn't include containerId — look it up
    const project = this.ctx.db.getProject(projectId);
    if (!project) return;

    await this.handleCrashEvent({
      ...event,
      type: 'deploy:crash',
      payload: {
        projectId,
        projectName: project.name,
        containerId: project.container_id ?? '',
      },
    });
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

  async generateDigest(): Promise<void> {
    const report = this.digest.generateDigest();
    const alert = this.digest.formatDigestForChannel(report);
    await this.alerting.sendAlert(alert);
  }

  getDigest() {
    return this.digest.getLastReport();
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
    this.alerting.updateConfig(this.config);

    const digestTime = this.config.thresholds.digest_time;
    if (digestTime) {
      this.digest.scheduleDigest(digestTime);
    } else {
      this.digest.stopSchedule();
    }
  }
}
