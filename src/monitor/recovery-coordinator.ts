import type { OpenLanderConfig } from '../config/index.js';
import type { Database } from '../db/index.js';
import type { EventBus, EventPayload } from '../events/index.js';
import type { RuntimeSignal } from '../health/types.js';
import { createModuleLogger } from '../lib/logger.js';
import type { ProjectStateManager, ProjectStatus } from './project-state-manager.js';
import { consumeMcpDeploy } from '../pipeline/auto-recovery.js';
import {
  checkRecoveryEligibility,
  type EligibilityReason as PolicyEligibilityReason,
  type RecoveryEligibilityContext,
  type RecoveryTrigger,
} from './recovery-policy.js';

const log = createModuleLogger('recovery-coordinator');

function createFallbackStateManager(db: Database): Pick<ProjectStateManager, 'transition'> {
  return {
    transition(projectId: string, targetStatus: ProjectStatus): Promise<boolean> {
      db.updateProject(projectId, { status: targetStatus });
      return Promise.resolve(true);
    },
  };
}

/**
 * Coordinator-layer reasons (config / operator / status). Infrastructure
 * invariants (archived / stopped / lock / breaker / budget) come from
 * {@link PolicyEligibilityReason} via recovery-policy.ts.
 */
type CoordinatorEligibilityReason =
  | `status_${string}`
  | 'ai_disabled'
  | 'operator_suppressed'
  | 'incident_active';

type EligibilityReason = CoordinatorEligibilityReason | PolicyEligibilityReason;

interface ProjectSnapshot {
  name: string;
  status: string;
  archived_at: string | null;
  container_id: string | null;
  deploy_lock_session: string | null;
  deploy_lock_at: string | null;
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

  checkEligibility(projectId: string, trigger?: RecoveryTrigger): EligibilityResult {
    return this.evaluateEligibility(projectId, trigger ?? 'container_failure');
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
    const result = this.evaluateEligibility(projectId, 'continue_check');
    return result.eligible;
  }

  /**
   * Trigger-aware eligibility evaluation. Coordinator-specific gates (config
   * flag, operator suppression, status whitelist) run first; infrastructure
   * invariants (archived/lock/breaker/budget) come from the shared policy
   * module so all entry points evaluate them identically.
   *
   * Used by checkEligibility (public, container/health/deploy triggers) and
   * shouldContinue (continue_check trigger). Closes the U-P0-4 gap where
   * shouldContinue did not consult the deploy lock.
   */
  private evaluateEligibility(projectId: string, trigger: RecoveryTrigger): EligibilityResult {
    const project = this.getProjectSnapshot(projectId);
    if (!project) {
      return { eligible: false, reason: 'project_not_found' };
    }

    // PR 4.5: canonical-first read of status with `??` fallback to legacy
    // `projects` column through migration 0012.
    const deployable = this.db.getDeployableForProject(projectId);
    const status = deployable?.status ?? project.status;

    // Coordinator-specific status whitelist (depends on trigger).
    // checkEligibility legacy behaviour: only running/error are eligible.
    // shouldContinue legacy behaviour: only running is eligible (recovery may
    // already have transitioned the project; recovery_in_progress handled by policy).
    if (trigger === 'continue_check') {
      if (status !== 'running' && status !== 'recovering') {
        return { eligible: false, reason: `status_${status}` };
      }
    } else {
      if (status !== 'running' && status !== 'error') {
        return { eligible: false, reason: `status_${status}` };
      }
    }

    if (project.archived_at) {
      return { eligible: false, reason: 'archived' };
    }

    // Coordinator-only gates (no equivalent in shared policy).
    if (!this.getConfig().ai.autoRecovery.enabled) {
      return { eligible: false, reason: 'ai_disabled' };
    }

    if (this.isOperatorSuppressed(projectId)) {
      return { eligible: false, reason: 'operator_suppressed' };
    }

    // Delegate the remaining infrastructure invariants (budget, breaker, lock)
    // to the shared policy so all recovery entry points evaluate them identically.
    const policyCtx: RecoveryEligibilityContext = {
      db: this.db,
      isCircuitBreakerOpen: (id) => this.db.isCircuitBreakerOpen(id),
      isGlobalBudgetExceeded: () => this.isGlobalBudgetExceeded(),
    };
    const policyResult = checkRecoveryEligibility(projectId, trigger, policyCtx);
    if (!policyResult.eligible) {
      return { eligible: false, reason: policyResult.reason };
    }

    return { eligible: true };
  }

  /**
   * Map a RuntimeSignal kind to the appropriate RecoveryTrigger so that
   * eligibility is evaluated with the correct policy (e.g. health_degraded
   * for probe/regression signals, container_failure for container events).
   */
  private static signalTrigger(kind: RuntimeSignal['kind']): RecoveryTrigger {
    switch (kind) {
      case 'probe_failed':
      case 'post_deploy_regression':
        return 'health_degraded';
      case 'container_died':
      case 'container_oom':
      case 'container_missing':
        return 'container_failure';
    }
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
      const trigger = RecoveryCoordinator.signalTrigger(signal.kind);
      const result = this.checkEligibility(signal.projectId, trigger);
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
      const result = this.evaluateEligibility(payload.projectId, 'health_degraded');
      if (!result.eligible) {
        await this.emitBlocked(payload.projectId, result.reason);
        return;
      }

      this.recordLlmCall();

      // Stage B: OpsAgent enqueue (non-critical)
      this.enqueueOpsAgentForCrash(payload.projectId);

      // Stage C: transition status — failure must abort before stage D so
      // that recovery:started never fires on a project whose status was not
      // transitioned (U-P0-2). Partial failure is surfaced via
      // `recovery:degraded` so it is observable rather than silently swallowed.
      try {
        await this.transitionProjectStatus(payload.projectId, 'recovering', 'recovery-started');
      } catch (statusErr) {
        await this.handleStageTransitionFailure(payload.projectId, statusErr, {
          trigger: 'health:degraded',
        });
        return;
      }

      // Stage D: emit recovery:started
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
      const result = this.evaluateEligibility(payload.projectId, 'container_failure');
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

      // Stage B: OpsAgent enqueue (non-critical)
      this.enqueueOpsAgentForCrash(payload.projectId, payload.containerId || undefined);

      // Stage C: transition status — failure must abort before stage D
      // (U-P0-2). Partial failure is surfaced via `recovery:degraded`.
      try {
        await this.transitionProjectStatus(payload.projectId, 'recovering', 'recovery-started');
      } catch (statusErr) {
        await this.handleStageTransitionFailure(payload.projectId, statusErr, { trigger });
        return;
      }

      // Stage D: emit recovery:started
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

      const result = this.evaluateEligibility(payload.projectId, 'deploy_failed');
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

      const result = this.evaluateEligibility(payload.projectId, 'deploy_failed');
      if (!result.eligible) {
        await this.emitBlocked(payload.projectId, result.reason);
        return;
      }

      await this.deploymentRecovery?.(payload.projectId, payload.error);
    } catch (err) {
      log.error({ err, projectId: payload.projectId }, 'Unhandled error in compose:failed handler');
    }
  }

  /**
   * Stage B — enqueue ops agent for crash handling. Non-critical: enqueue
   * failures are logged but do not abort recovery progression. Synchronous
   * (no await) so it does not change microtask ordering of subsequent stages.
   * `containerIdOverride` is the container ID from the originating event,
   * preferred over the DB-cached container_id when available.
   */
  private enqueueOpsAgentForCrash(projectId: string, containerIdOverride?: string): void {
    if (!this.opsAgent) {
      return;
    }
    try {
      const project = this.getProjectSnapshot(projectId);
      this.opsAgent.enqueue({
        type: 'deploy:crash',
        payload: {
          projectId,
          projectName: project?.name ?? projectId,
          containerId: containerIdOverride || project?.container_id || '',
        },
        timestamp: Date.now(),
      });
    } catch (enqueueErr) {
      log.warn(
        { err: enqueueErr, projectId },
        'Failed to enqueue to OpsAgent, continuing with recovery',
      );
    }
  }

  /**
   * Stage C failure handler — emits both `recovery:degraded` (architectural
   * partial-failure visibility) and `recovery:blocked` (legacy compat for
   * existing UI/test consumers). Inlined into the handler call site rather
   * than wrapped through `withRecoveryStage` so that the success path keeps
   * its original microtask depth (recovery-coordinator.test.ts dedup test).
   */
  private async handleStageTransitionFailure(
    projectId: string,
    error: unknown,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    log.warn(
      { err: error, projectId, ...metadata },
      'Failed to set status to recovering, aborting recovery to prevent state mismatch',
    );
    try {
      await this.events.emit('recovery:degraded', {
        projectId,
        stage: 'transition',
        reason,
        metadata,
      });
    } catch (emitErr) {
      log.error(
        { err: emitErr, projectId, originalReason: reason },
        'Failed to emit recovery:degraded event',
      );
    }
    await this.emitBlocked(projectId, 'partial_failure_state_transition');
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

    // PR 4.5: canonical-first status read with `??` fallback.
    const deployable = this.db.getDeployableForProject(projectId);
    const status = deployable?.status ?? project.status;

    if (status === 'recovering') {
      await this.transitionProjectStatus(
        projectId,
        nextStatus,
        nextStatus === 'running' ? 'recovery-success' : 'recovery-failed',
      );
    } else if (nextStatus === 'running' && status === 'error') {
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
