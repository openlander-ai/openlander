import type { OpenLanderConfig } from '../config/index.js';
import type { Database } from '../db/index.js';
import type { EventBus, EventPayload } from '../events/index.js';
import type { RuntimeSignal } from '../health/types.js';
import { createModuleLogger } from '../lib/logger.js';
import type { ProjectStateManager, ProjectStatus } from './project-state-manager.js';
import { consumeMcpDeploy } from '../pipeline/auto-recovery.js';

const log = createModuleLogger('recovery-coordinator');

function createFallbackStateManager(db: Database): Pick<ProjectStateManager, 'transition'> {
  return {
    transition(projectId: string, targetStatus: ProjectStatus): Promise<boolean> {
      db.updateProject(projectId, { status: targetStatus });
      return Promise.resolve(true);
    },
  };
}

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

type DeploymentRecoveryFn = (
  projectId: string,
  error: string,
  step?: string,
  buildLog?: string,
) => Promise<void>;

export class RecoveryCoordinator {
  private readonly db: Database;
  private readonly events: EventBus;
  private readonly config: OpenLanderConfig;
  private readonly maxLlmCallsPerHour: number;
  private readonly suppressions = new Map<string, number>();
  private readonly inFlightProjects = new Set<string>();
  private llmCallTimestamps: number[] = [];
  private unsubscribers: Array<() => void> = [];
  private running = false;
  private opsAgent: OpsAgentRef | undefined;
  private configGetter: (() => OpenLanderConfig) | null = null;
  private deploymentRecovery: DeploymentRecoveryFn | undefined;
  private stateManager: Pick<ProjectStateManager, 'transition'>;

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
    this.stateManager = createFallbackStateManager(db);
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

    for (const eventType of ['container:die', 'container:oom', 'container:missing'] as const) {
      this.unsubscribers.push(
        this.events.on(eventType, async (payload) => {
          await this.handleContainerFailure(eventType, payload);
        }),
      );
    }

    this.unsubscribers.push(
      this.events.on('deploy:failed', async (payload) => {
        await this.handleDeployFailed(payload);
      }),
      this.events.on('compose:failed', async (payload) => {
        await this.handleComposeFailed(payload);
      }),
    );

    this.unsubscribers.push(
      this.events.on('ai:invoked', () => {
        this.recordLlmCall();
      }),
      this.events.on('recovery:success', async (payload) => {
        await this.restoreStatusIfRecovering(payload.projectId, 'running');
      }),
      this.events.on('recovery:exhausted', async (payload) => {
        await this.restoreStatusIfRecovering(payload.projectId, 'error');
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

    if (project.status !== 'running' && project.status !== 'error') {
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

  setStateManager(stateManager: Pick<ProjectStateManager, 'transition'>): void {
    this.stateManager = stateManager;
  }

  setDeploymentRecovery(handler: DeploymentRecoveryFn): void {
    this.deploymentRecovery = handler;
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

  shouldContinue(projectId: string): boolean {
    const project = this.getProjectSnapshot(projectId);
    if (!project || project.status !== 'running' || project.archived_at) {
      return false;
    }

    if (!this.getConfig().ai.autoRecovery.enabled) {
      return false;
    }

    if (this.isOperatorSuppressed(projectId)) {
      return false;
    }

    const hourAgo = Date.now() - 3_600_000;
    this.llmCallTimestamps = this.llmCallTimestamps.filter((timestamp) => timestamp > hourAgo);
    return this.llmCallTimestamps.length <= this.maxLlmCallsPerHour;
  }

  async ingestRuntimeSignal(signal: RuntimeSignal): Promise<void> {
    if (this.inFlightProjects.has(signal.projectId)) {
      log.debug(
        { projectId: signal.projectId },
        'Skipping duplicate RuntimeSignal — already processing',
      );
      return;
    }

    this.inFlightProjects.add(signal.projectId);

    try {
      const result = this.checkEligibility(signal.projectId);
      if (!result.eligible) {
        await this.emitBlocked(signal.projectId, result.reason);
        return;
      }

      switch (signal.kind) {
        case 'probe_failed':
        case 'post_deploy_regression':
          await this.handleHealthDegraded({
            projectId: signal.projectId,
            consecutiveFailures: signal.failureCount ?? 1,
            lastError: signal.error ?? null,
          });
          break;
        case 'container_died':
          await this.handleContainerFailure('container:die', {
            projectId: signal.projectId,
            containerId: signal.containerId ?? '',
            containerName: signal.projectId,
            exitCode: 0,
          });
          break;
        case 'container_oom':
          await this.handleContainerFailure('container:oom', {
            projectId: signal.projectId,
            containerId: signal.containerId ?? '',
            containerName: signal.projectId,
          });
          break;
        case 'container_missing':
          await this.handleContainerFailure('container:missing', {
            projectId: signal.projectId,
            containerId: signal.containerId ?? '',
            projectName: signal.projectId,
            suggestion: '',
          });
          break;
      }
    } finally {
      this.inFlightProjects.delete(signal.projectId);
    }
  }

  private async handleHealthDegraded(payload: EventPayload['health:degraded']): Promise<void> {
    try {
      const result = this.checkEligibility(payload.projectId);
      if (!result.eligible) {
        await this.emitBlocked(payload.projectId, result.reason);
        return;
      }

      this.recordLlmCall();

      // OpsAgent enqueue (non-critical — failure should not block status update)
      try {
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
      } catch (enqueueErr) {
        log.warn(
          { err: enqueueErr, projectId: payload.projectId },
          'Failed to enqueue to OpsAgent, continuing with recovery',
        );
      }

      try {
        await this.transitionProjectStatus(payload.projectId, 'recovering', 'recovery-started');
      } catch (statusErr) {
        log.warn(
          { err: statusErr, projectId: payload.projectId },
          'Failed to set status to recovering, continuing with recovery event',
        );
      }

      const correlationId = this.opsAgent ? undefined : payload.projectId;

      await this.events.emit('recovery:started', {
        projectId: payload.projectId,
        trigger: 'health:degraded',
        correlationId,
      });
    } catch (err) {
      log.error(
        { err, projectId: payload.projectId },
        'Unhandled error in health:degraded handler',
      );
    }
  }

  private async handleContainerFailure(
    trigger: 'container:die' | 'container:oom' | 'container:missing',
    payload:
      | EventPayload['container:die']
      | EventPayload['container:oom']
      | EventPayload['container:missing'],
  ): Promise<void> {
    try {
      const result = this.checkEligibility(payload.projectId);
      if (!result.eligible) {
        const unhandledReasons: EligibilityReason[] = [
          'ai_disabled',
          'global_budget_exceeded',
          'circuit_breaker_open',
        ];
        if (result.reason && unhandledReasons.includes(result.reason)) {
          await this.transitionProjectStatus(payload.projectId, 'error', 'recovery-failed');
        }
        await this.emitBlocked(payload.projectId, result.reason);
        return;
      }

      // Stage B: OpsAgent enqueue (non-critical — failure should not block status update)
      try {
        if (this.opsAgent) {
          const project = this.getProjectSnapshot(payload.projectId);
          this.opsAgent.enqueue({
            type: 'deploy:crash',
            payload: {
              projectId: payload.projectId,
              projectName: project?.name ?? payload.projectId,
              containerId: payload.containerId || project?.container_id || '',
            },
            timestamp: Date.now(),
          });
        }
      } catch (enqueueErr) {
        log.warn(
          { err: enqueueErr, projectId: payload.projectId },
          'Failed to enqueue to OpsAgent, continuing with recovery',
        );
      }

      // Stage C: Update status to recovering (critical — isolated so D still fires)
      try {
        await this.transitionProjectStatus(payload.projectId, 'recovering', 'recovery-started');
      } catch (statusErr) {
        log.warn(
          { err: statusErr, projectId: payload.projectId },
          'Failed to set status to recovering, continuing with recovery event',
        );
      }

      // Stage D: Emit recovery:started
      // When OpsAgent is unavailable (null), use projectId as fallback correlationId
      const correlationId = this.opsAgent ? undefined : payload.projectId;

      await this.events.emit('recovery:started', {
        projectId: payload.projectId,
        trigger,
        correlationId,
      });
    } catch (err) {
      log.error({ err, projectId: payload.projectId }, `Unhandled error in ${trigger} handler`);
    }
  }

  private async handleDeployFailed(payload: EventPayload['deploy:failed']): Promise<void> {
    try {
      if (payload.source === 'mcp' || consumeMcpDeploy(payload.projectId)) {
        log.info({ projectId: payload.projectId }, 'MCP-triggered deploy, skipping auto-recovery');
        return;
      }

      const result = this.checkEligibility(payload.projectId);
      if (!result.eligible) {
        await this.emitBlocked(payload.projectId, result.reason);
        return;
      }

      await this.deploymentRecovery?.(
        payload.projectId,
        payload.error,
        payload.step,
        payload.buildLog,
      );
    } catch (err) {
      log.error({ err, projectId: payload.projectId }, 'Unhandled error in deploy:failed handler');
    }
  }

  private async handleComposeFailed(payload: EventPayload['compose:failed']): Promise<void> {
    try {
      if (consumeMcpDeploy(payload.projectId)) {
        log.info(
          { projectId: payload.projectId },
          'MCP-triggered compose deploy, skipping auto-recovery',
        );
        return;
      }

      const result = this.checkEligibility(payload.projectId);
      if (!result.eligible) {
        await this.emitBlocked(payload.projectId, result.reason);
        return;
      }

      await this.deploymentRecovery?.(payload.projectId, payload.error);
    } catch (err) {
      log.error({ err, projectId: payload.projectId }, 'Unhandled error in compose:failed handler');
    }
  }

  private async emitBlocked(projectId: string, reason?: EligibilityReason): Promise<void> {
    await this.events.emit('recovery:blocked', {
      projectId,
      reason: reason ?? 'unknown',
    });
  }

  private async restoreStatusIfRecovering(
    projectId: string,
    nextStatus: 'running' | 'error',
  ): Promise<void> {
    const project = this.getProjectSnapshot(projectId);
    if (!project) return;

    if (project.status === 'recovering') {
      await this.transitionProjectStatus(
        projectId,
        nextStatus,
        nextStatus === 'running' ? 'recovery-success' : 'recovery-failed',
      );
    } else if (nextStatus === 'running' && project.status === 'error') {
      await this.transitionProjectStatus(projectId, nextStatus, 'recovery-success');
      log.info({ projectId }, 'Restored project status from error to running (defensive recovery)');
    }
  }

  private async transitionProjectStatus(
    projectId: string,
    nextStatus: 'recovering' | 'running' | 'error',
    reason: 'recovery-started' | 'recovery-success' | 'recovery-failed',
  ): Promise<void> {
    const didTransition = await this.stateManager.transition(projectId, nextStatus, reason);
    if (didTransition) {
      return;
    }

    const project = this.getProjectSnapshot(projectId);
    if (project?.status === nextStatus) {
      return;
    }

    throw new Error(
      `RecoveryCoordinator state transition rejected: ${project?.status ?? 'unknown'} -> ${nextStatus}`,
    );
  }

  private getProjectSnapshot(projectId: string): ProjectSnapshot | undefined {
    return this.db.getProject(projectId);
  }

  private getConfig(): OpenLanderConfig {
    return this.configGetter ? this.configGetter() : this.config;
  }
}
