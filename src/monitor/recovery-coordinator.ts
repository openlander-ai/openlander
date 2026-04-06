import type { OpenLanderConfig } from '../config/index.js';
import type { Database } from '../db/index.js';
import type { EventBus, EventPayload } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('recovery-coordinator');

type EligibilityReason =
  | 'project_not_found'
  | `status_${string}`
  | 'archived'
  | 'ai_disabled'
  | 'operator_suppressed'
  | 'global_budget_exceeded'
  | 'circuit_breaker_open'
  | 'incident_active';

interface ProjectSnapshot {
  name: string;
  status: string;
  archived_at: string | null;
  container_id: string | null;
}

interface ProjectStatusWriter {
  updateProject(projectId: string, updates: { status?: string }): void;
}

export interface EligibilityResult {
  eligible: boolean;
  reason?: EligibilityReason;
}

export interface RecoveryCoordinatorOptions {
  maxLlmCallsPerHour?: number;
}

export interface OpsAgentRef {
  enqueue(event: { type: string; payload: unknown; timestamp: number }): void;
}

export class RecoveryCoordinator {
  private readonly db: Database;
  private readonly events: EventBus;
  private readonly config: OpenLanderConfig;
  private readonly maxLlmCallsPerHour: number;
  private readonly suppressions = new Map<string, number>();
  private llmCallTimestamps: number[] = [];
  private unsubscribers: Array<() => void> = [];
  private running = false;
  private readonly projectStatusWriter: ProjectStatusWriter;
  private opsAgent: OpsAgentRef | undefined;
  private configGetter: (() => OpenLanderConfig) | null = null;

  constructor(
    db: Database,
    events: EventBus,
    config: OpenLanderConfig,
    options?: RecoveryCoordinatorOptions,
  ) {
    this.db = db;
    this.events = events;
    this.config = config;
    this.maxLlmCallsPerHour = options?.maxLlmCallsPerHour ?? 10;
    this.projectStatusWriter = db;
  }

  start(opts?: { opsAgent?: OpsAgentRef }): void {
    if (this.running) {
      return;
    }

    if (opts?.opsAgent) {
      this.opsAgent = opts.opsAgent;
    }

    this.running = true;

    this.unsubscribers.push(
      this.events.on('health:degraded', async (payload) => {
        await this.handleHealthDegraded(payload);
      }),
    );

    for (const eventType of ['container:die', 'container:oom'] as const) {
      this.unsubscribers.push(
        this.events.on(eventType, async (payload) => {
          const result = this.checkEligibility(payload.projectId);
          if (!result.eligible) {
            await this.emitBlocked(payload.projectId, result.reason);
          }
        }),
      );
    }

    this.unsubscribers.push(
      this.events.on('recovery:success', (payload) => {
        this.restoreStatusIfRecovering(payload.projectId, 'running');
      }),
      this.events.on('recovery:exhausted', (payload) => {
        this.restoreStatusIfRecovering(payload.projectId, 'error');
      }),
    );

    log.info({ hasOpsAgent: Boolean(this.opsAgent) }, 'RecoveryCoordinator started');
  }

  stop(): void {
    if (!this.running) {
      return;
    }

    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }

    this.unsubscribers = [];
    this.running = false;
    log.info('RecoveryCoordinator stopped');
  }

  checkEligibility(projectId: string): EligibilityResult {
    const project = this.getProjectSnapshot(projectId);
    if (!project) {
      return { eligible: false, reason: 'project_not_found' };
    }

    if (project.status !== 'running') {
      return { eligible: false, reason: `status_${project.status}` };
    }

    if (project.archived_at) {
      return { eligible: false, reason: 'archived' };
    }

    if (!this.getConfig().ai.autoRecovery.enabled) {
      return { eligible: false, reason: 'ai_disabled' };
    }

    if (this.isOperatorSuppressed(projectId)) {
      return { eligible: false, reason: 'operator_suppressed' };
    }

    if (this.isGlobalBudgetExceeded()) {
      return { eligible: false, reason: 'global_budget_exceeded' };
    }

    if (this.db.isCircuitBreakerOpen(projectId)) {
      return { eligible: false, reason: 'circuit_breaker_open' };
    }

    if (this.db.getActiveOpsIncident(projectId)) {
      return { eligible: false, reason: 'incident_active' };
    }

    return { eligible: true };
  }

  suppressProject(projectId: string, durationMs: number): void {
    this.suppressions.set(projectId, Date.now() + durationMs);
  }

  setOpsAgent(opsAgent: OpsAgentRef): void {
    this.opsAgent = opsAgent;
  }

  setConfigGetter(getter: () => OpenLanderConfig): void {
    this.configGetter = getter;
  }

  isOperatorSuppressed(projectId: string): boolean {
    const expiresAt = this.suppressions.get(projectId);
    if (!expiresAt) {
      return false;
    }

    if (Date.now() > expiresAt) {
      this.suppressions.delete(projectId);
      return false;
    }

    return true;
  }

  recordLlmCall(): void {
    const hourAgo = Date.now() - 3_600_000;
    this.llmCallTimestamps = this.llmCallTimestamps.filter((timestamp) => timestamp > hourAgo);
    this.llmCallTimestamps.push(Date.now());
  }

  isGlobalBudgetExceeded(): boolean {
    const hourAgo = Date.now() - 3_600_000;
    this.llmCallTimestamps = this.llmCallTimestamps.filter((timestamp) => timestamp > hourAgo);
    return this.llmCallTimestamps.length >= this.maxLlmCallsPerHour;
  }

  private async handleHealthDegraded(payload: EventPayload['health:degraded']): Promise<void> {
    const result = this.checkEligibility(payload.projectId);
    if (!result.eligible) {
      await this.emitBlocked(payload.projectId, result.reason);
      return;
    }

    this.recordLlmCall();

    if (this.opsAgent) {
      const project = this.getProjectSnapshot(payload.projectId);
      this.opsAgent.enqueue({
        type: 'deploy:crash',
        payload: {
          projectId: payload.projectId,
          projectName: project?.name ?? payload.projectId,
          containerId: project?.container_id ?? '',
        },
        timestamp: Date.now(),
      });
    }

    this.projectStatusWriter.updateProject(payload.projectId, { status: 'recovering' });

    await this.events.emit('recovery:started', {
      projectId: payload.projectId,
      trigger: 'health:degraded',
    });
  }

  private async emitBlocked(projectId: string, reason?: EligibilityReason): Promise<void> {
    await this.events.emit('recovery:blocked', {
      projectId,
      reason: reason ?? 'unknown',
    });
  }

  private restoreStatusIfRecovering(projectId: string, nextStatus: 'running' | 'error'): void {
    const project = this.getProjectSnapshot(projectId);
    if (project?.status === 'recovering') {
      this.projectStatusWriter.updateProject(projectId, { status: nextStatus });
    }
  }

  private getProjectSnapshot(projectId: string): ProjectSnapshot | undefined {
    return this.db.getProject(projectId);
  }

  private getConfig(): OpenLanderConfig {
    return this.configGetter ? this.configGetter() : this.config;
  }
}
