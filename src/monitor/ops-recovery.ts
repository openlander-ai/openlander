import { randomUUID } from 'node:crypto';
import { generateText } from 'ai';

import type { AppContext } from '../app.js';
import type { OpsIncidentEventRow } from '../db/types.js';
import { createModuleLogger } from '../lib/logger.js';
import { createModelProxy } from '../llm/model-proxy.js';
import { eventBus } from '../events/index.js';
import type {
  ApprovalMetadata,
  ApprovalResult,
  ApprovalGate as ApprovalGateType,
} from '../pipeline/approval-gate.js';
import type { ConfigurableRecoveryStep, RecoveryAutomationPolicy } from './ops-types.js';

const log = createModuleLogger('ops-recovery');

const RECOVERY_MAX_FAILURES = 5;
const HEALTH_CHECK_ATTEMPTS = 3;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

export interface RecoveryContext {
  projectId: string;
  projectName: string;
  containerId: string;
  incidentId: string | null;
  automationPolicy: RecoveryAutomationPolicy;
  actionRunId: string;
}

type RecoveryOutcome = 'recovered' | 'escalated' | 'skipped';
type RecoveryExecuteContext = Omit<RecoveryContext, 'actionRunId'>;
type RecoveryContextForGuards = RecoveryExecuteContext | RecoveryContext;

export class RecoveryPipeline {
  private readonly ctx: AppContext;
  private readonly approvalGate: ApprovalGateType;
  private readonly activeRecoveries = new Set<string>();

  constructor(ctx: AppContext, approvalGate: ApprovalGateType) {
    this.ctx = ctx;
    this.approvalGate = approvalGate;
  }

  async execute(context: RecoveryExecuteContext): Promise<RecoveryOutcome> {
    const { projectId, incidentId } = context;

    if (!this.isProductionRecovery(context)) {
      this.addIncidentEvent(
        incidentId,
        'interrupted',
        'Recovery skipped because target is not production environment',
      );
      return 'skipped';
    }

    if (this.ctx.db.isCircuitBreakerOpen(projectId)) {
      log.warn({ projectId }, 'Circuit breaker open — skipping recovery');
      await this.escalate(context, 'Circuit breaker open — too many failures');
      return 'skipped';
    }

    const isHalfOpenAttempt = this.ctx.db.getCircuitBreakerState(projectId)?.state === 'half_open';

    if (this.activeRecoveries.has(projectId)) {
      log.warn({ projectId }, 'Recovery already in progress — skipping');
      return 'skipped';
    }

    const actionRunId = this.ctx.db.createActionRun({
      projectId,
      triggerSource: 'auto_recovery',
      recoveryStrategy: 'unknown',
    });

    const executionContext: RecoveryContext = {
      ...context,
      actionRunId,
    };

    this.activeRecoveries.add(projectId);
    try {
      const outcome = await this.runRecoverySequence(executionContext);
      if (isHalfOpenAttempt && outcome === 'escalated') {
        this.ctx.db.openCircuitBreaker(projectId);
        log.warn({ projectId }, 'Half-open recovery attempt failed — circuit breaker re-opened');
      }
      this.ctx.db.updateActionRunStatus(
        actionRunId,
        outcome === 'recovered' ? 'succeeded' : 'failed',
        outcome === 'escalated' ? 'Recovery pipeline exhausted' : undefined,
      );
      return outcome;
    } catch (error) {
      this.ctx.db.updateActionRunStatus(
        actionRunId,
        'failed',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    } finally {
      this.activeRecoveries.delete(projectId);
    }
  }

  private async gateStep(
    context: RecoveryContext,
    step: ConfigurableRecoveryStep,
    _description: string,
  ): Promise<'proceed' | 'rejected' | 'timed_out'> {
    void _description;
    const mode = context.automationPolicy[step];
    if (mode === 'auto') {
      return 'proceed';
    }

    this.ctx.db.updateActionRunStatus(context.actionRunId, 'pending_approval');
    this.ctx.db.updateActionRunApproval(context.actionRunId, 'pending', step);

    await eventBus.emit('recovery:approval-needed', {
      projectId: context.projectId,
      actionRunId: context.actionRunId,
      toolName: step,
      attempt: 1,
      source: 'ops_recovery',
    });

    const metadata: ApprovalMetadata = {
      projectId: context.projectId,
      projectName: context.projectName,
      toolName: step,
      attempt: 1,
      actionRunId: context.actionRunId,
      createdAt: new Date(),
    };

    const result: ApprovalResult = await this.approvalGate.waitForApproval(
      context.actionRunId,
      metadata,
    );

    if (result === 'approved') {
      this.ctx.db.updateActionRunStatus(context.actionRunId, 'running');
      this.ctx.db.updateActionRunApproval(context.actionRunId, 'approved', step);
      return 'proceed';
    }

    this.ctx.db.updateActionRunApproval(context.actionRunId, 'rejected', step);
    return result;
  }

  private async runRecoverySequence(context: RecoveryContext): Promise<RecoveryOutcome> {
    const { projectId, containerId, incidentId } = context;
    const project = this.ctx.db.getProject(projectId);

    if (!project) {
      log.error({ projectId }, 'Project not found for recovery');
      await this.escalate(context, 'Project not found for recovery');
      return 'escalated';
    }

    if (project.deploy_lock_session) {
      this.addIncidentEvent(
        incidentId,
        'interrupted',
        'Deploy lock is held by another process — recovery skipped',
      );
      log.info(
        { projectId, lockSession: project.deploy_lock_session },
        'Deploy lock held — skipping',
      );
      return 'skipped';
    }

    const restartGate = await this.gateStep(context, 'restart', 'Container restart');
    if (restartGate !== 'proceed') {
      return await this.escalate(
        context,
        `Recovery gated: restart step ${restartGate} by operator`,
      );
    }

    this.addIncidentEvent(incidentId, 'action_taken', 'Step restart: attempting container restart');
    const restartResult = await this.restartContainer(projectId, containerId);
    if (!restartResult.success) {
      this.incrementAndCheckBreaker(projectId);
      const restartFailureReason = `Restart failed: ${restartResult.reason}`;

      const diagnosisGate = await this.gateStep(context, 'diagnosis', 'LLM diagnosis of crash');
      if (diagnosisGate !== 'proceed') {
        return await this.escalate(
          context,
          `Recovery gated: diagnosis step ${diagnosisGate} by operator`,
        );
      }

      this.addIncidentEvent(
        context.incidentId,
        'diagnosed',
        `Step diagnosis: ${restartFailureReason}`,
      );

      const restartLogs = await this.readContainerLogs(context.containerId);
      const restartDiagnosis = await this.generateDiagnosis(
        context,
        restartFailureReason,
        restartLogs,
      );
      if (restartDiagnosis && context.incidentId) {
        this.ctx.db.updateOpsIncident(context.incidentId, {
          diagnosis: restartDiagnosis,
          root_cause: restartFailureReason,
        });
      }

      let restartFixNotes: string[] = [];
      const fixesGate = await this.gateStep(context, 'apply_fixes', 'Apply deterministic fixes');
      if (fixesGate === 'proceed') {
        restartFixNotes = await this.applyFixes(context, restartLogs);
        if (restartFixNotes.length > 0) {
          this.addIncidentEvent(
            context.incidentId,
            'action_taken',
            `Step fix: ${restartFixNotes.join(' | ')}`,
          );
          if (context.incidentId) {
            this.ctx.db.updateOpsIncident(context.incidentId, {
              actions_taken: restartFixNotes.join('\n'),
            });
          }
        }
      }

      const rollbackGate = await this.gateStep(context, 'rollback', 'Rollback to previous version');
      if (rollbackGate !== 'proceed') {
        return await this.escalate(
          context,
          `Recovery gated: rollback step ${rollbackGate} by operator`,
        );
      }

      return await this.tryRollback(
        context,
        `${restartFailureReason}; ${restartFixNotes.join('; ')}`,
      );
    }

    this.addIncidentEvent(
      incidentId,
      'action_taken',
      'Step healthcheck: waiting for HTTP and container health checks',
    );
    const healthy = await this.waitForHealthy(projectId, containerId);
    if (healthy) {
      this.addIncidentEvent(incidentId, 'recovered', 'Container recovered after restart');
      this.ctx.db.resetCircuitBreaker(projectId);
      if (incidentId) {
        this.ctx.db.updateOpsIncidentStatus(incidentId, 'resolved', { resolved_at: Date.now() });
      }
      return 'recovered';
    }

    this.incrementAndCheckBreaker(projectId);
    const healthFailureReason = 'Health check failed after restart (3 attempts over 90 seconds)';

    const diagnosisGate = await this.gateStep(context, 'diagnosis', 'LLM diagnosis of crash');
    if (diagnosisGate !== 'proceed') {
      return await this.escalate(
        context,
        `Recovery gated: diagnosis step ${diagnosisGate} by operator`,
      );
    }

    this.addIncidentEvent(
      context.incidentId,
      'diagnosed',
      `Step diagnosis: ${healthFailureReason}`,
    );

    const healthLogs = await this.readContainerLogs(context.containerId);
    const healthDiagnosis = await this.generateDiagnosis(context, healthFailureReason, healthLogs);
    if (healthDiagnosis && context.incidentId) {
      this.ctx.db.updateOpsIncident(context.incidentId, {
        diagnosis: healthDiagnosis,
        root_cause: healthFailureReason,
      });
    }

    let healthFixNotes: string[] = [];
    const fixesGate = await this.gateStep(context, 'apply_fixes', 'Apply deterministic fixes');
    if (fixesGate === 'proceed') {
      healthFixNotes = await this.applyFixes(context, healthLogs);
      if (healthFixNotes.length > 0) {
        this.addIncidentEvent(
          context.incidentId,
          'action_taken',
          `Step fix: ${healthFixNotes.join(' | ')}`,
        );
        if (context.incidentId) {
          this.ctx.db.updateOpsIncident(context.incidentId, {
            actions_taken: healthFixNotes.join('\n'),
          });
        }
      }
    }

    const rollbackGate = await this.gateStep(context, 'rollback', 'Rollback to previous version');
    if (rollbackGate !== 'proceed') {
      return await this.escalate(
        context,
        `Recovery gated: rollback step ${rollbackGate} by operator`,
      );
    }

    return await this.tryRollback(context, `${healthFailureReason}; ${healthFixNotes.join('; ')}`);
  }

  private async restartContainer(
    projectId: string,
    containerId: string,
  ): Promise<{ success: true } | { success: false; reason: string }> {
    try {
      await this.ctx.docker.getClient().getContainer(containerId).restart();
      log.info({ projectId, containerId }, 'Container restart step completed');
      return { success: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log.error({ projectId, containerId, error }, 'Container restart step failed');
      return { success: false, reason };
    }
  }

  private async waitForHealthy(projectId: string, containerId: string): Promise<boolean> {
    for (let attempt = 1; attempt <= HEALTH_CHECK_ATTEMPTS; attempt += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS);
      });

      const project = this.ctx.db.getProject(projectId);
      const port = project?.assigned_port;
      const containerRunning = await this.isContainerRunning(containerId);
      const httpHealthy = typeof port === 'number' ? await this.isHttpHealthy(port) : false;

      log.info(
        {
          projectId,
          containerId,
          attempt,
          containerRunning,
          httpHealthy,
          assignedPort: port,
        },
        'Recovery health-check attempt completed',
      );

      if (containerRunning && httpHealthy) {
        return true;
      }
    }

    return false;
  }

  private async generateDiagnosis(
    context: RecoveryContext,
    failureReason: string,
    logs: string,
  ): Promise<string | null> {
    try {
      const model = createModelProxy(this.ctx.modelRegistry, 'operationalMonitoring');
      const response = await generateText({
        model,
        messages: [
          {
            role: 'system',
            content:
              'You diagnose crashed Dockerized services. Return concise root cause and immediate remediation steps in plain text.',
          },
          {
            role: 'user',
            content: `Project: ${context.projectName}\nFailure: ${failureReason}\nContainer logs (tail):\n${logs.slice(-4000)}`,
          },
        ],
      });
      const diagnosis = response.text.trim();
      this.addIncidentEvent(
        context.incidentId,
        'diagnosed',
        'Step diagnosis: LLM diagnosis generated',
      );
      return diagnosis.length > 0 ? diagnosis : null;
    } catch (error) {
      log.warn({ error, projectId: context.projectId }, 'LLM diagnosis failed during recovery');
      return null;
    }
  }

  private async applyFixes(context: RecoveryContext, logs: string): Promise<string[]> {
    const notes: string[] = [];
    const normalizedLogs = logs.toLowerCase();

    if (normalizedLogs.includes('out of memory') || normalizedLogs.includes('oomkilled')) {
      notes.push('OOM signature detected — suggested increasing memory limit/container resources');
    }

    const portConflictPattern = /eaddrinuse|address already in use|bind: address already in use/i;
    if (portConflictPattern.test(logs)) {
      const project = this.ctx.db.getProject(context.projectId);
      if (project?.assigned_port != null) {
        const resolved = await this.resolvePortConflict(context, project.assigned_port);
        notes.push(
          resolved ? 'Port-conflict resolution attempted' : 'Port-conflict resolution failed',
        );
      }
    }

    if (notes.length === 0) {
      notes.push('No deterministic fix matched — proceeding to rollback');
    }

    return notes;
  }

  private async resolvePortConflict(
    context: RecoveryContext,
    projectPort: number,
  ): Promise<boolean> {
    try {
      const containers = await this.ctx.docker.listAllContainers();
      const conflict = containers.find((container) => {
        const hasPort = container.ports.some((port) => port.PublicPort === projectPort);
        return hasPort && container.id !== context.containerId;
      });

      if (!conflict) {
        return false;
      }

      await this.ctx.docker.stopContainer(conflict.id);
      this.addIncidentEvent(
        context.incidentId,
        'action_taken',
        `Stopped conflicting container ${conflict.name} on port ${String(projectPort)}`,
      );
      return true;
    } catch (error) {
      log.warn({ error, projectId: context.projectId }, 'Port-conflict resolution attempt failed');
      return false;
    }
  }

  private async tryRollback(
    context: RecoveryContext,
    reason: string,
  ): Promise<'recovered' | 'escalated'> {
    const project = this.ctx.db.getProject(context.projectId);
    if (!project?.previous_image_tag) {
      return await this.escalate(context, `${reason}; no previous image available for rollback`);
    }

    if (project.deploy_lock_session) {
      return await this.escalate(context, `${reason}; deploy lock held during rollback`);
    }

    this.addIncidentEvent(
      context.incidentId,
      'action_taken',
      `Step rollback: attempting rollback to ${project.previous_image_tag}`,
    );

    try {
      const result = await this.ctx.pipeline.rollback(context.projectId);
      if (!result.success) {
        this.incrementAndCheckBreaker(context.projectId);
        return await this.escalate(
          context,
          `${reason}; rollback failed: ${result.error ?? 'unknown'}`,
        );
      }

      const containerId = result.containerId ?? context.containerId;
      const healthy = await this.waitForHealthy(context.projectId, containerId);
      if (healthy) {
        this.addIncidentEvent(context.incidentId, 'recovered', 'Recovered via rollback');
        this.ctx.db.resetCircuitBreaker(context.projectId);
        if (context.incidentId) {
          this.ctx.db.updateOpsIncidentStatus(context.incidentId, 'resolved', {
            resolved_at: Date.now(),
          });
        }
        return 'recovered';
      }

      this.incrementAndCheckBreaker(context.projectId);
      return await this.escalate(
        context,
        `${reason}; rollback completed but service remained unhealthy`,
      );
    } catch (error) {
      this.incrementAndCheckBreaker(context.projectId);
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error, projectId: context.projectId }, 'Rollback step threw an error');
      return await this.escalate(context, `${reason}; rollback failed: ${message}`);
    }
  }

  private async escalate(context: RecoveryContextForGuards, reason: string): Promise<'escalated'> {
    if (context.incidentId) {
      this.ctx.db.updateOpsIncidentStatus(context.incidentId, 'escalated', {
        escalated_at: Date.now(),
      });
    }
    this.addIncidentEvent(context.incidentId, 'escalated', `Step escalate: ${reason}`);
    this.addIncidentEvent(
      context.incidentId,
      'alert_sent',
      'Escalation alert emitted to event bus',
    );

    await eventBus.emit('recovery:exhausted', {
      projectId: context.projectId,
      totalAttempts: this.ctx.db.getCircuitBreakerState(context.projectId)?.failure_count ?? 0,
      lastError: reason,
    });

    log.error({ projectId: context.projectId, reason }, 'Recovery escalated');
    return 'escalated';
  }

  private addIncidentEvent(
    incidentId: string | null,
    eventType: OpsIncidentEventRow['event_type'],
    description: string,
  ): void {
    if (!incidentId) {
      return;
    }

    try {
      this.ctx.db.addOpsIncidentEvent({
        id: `evt-${randomUUID()}`,
        incident_id: incidentId,
        event_type: eventType,
        description,
      });
    } catch (error) {
      log.warn({ error, incidentId, eventType }, 'Failed to add ops incident event');
    }
  }

  private incrementAndCheckBreaker(projectId: string): void {
    try {
      const state = this.ctx.db.incrementCircuitBreakerFailure(projectId);
      if (state.failure_count >= RECOVERY_MAX_FAILURES) {
        this.ctx.db.openCircuitBreaker(projectId);
        log.warn({ projectId, failures: state.failure_count }, 'Circuit breaker opened');
      }
    } catch (error) {
      log.warn({ error, projectId }, 'Circuit breaker update failed');
    }
  }

  private isProductionRecovery(context: RecoveryContextForGuards): boolean {
    const environments = this.ctx.db.getEnvironmentsByProject(context.projectId);
    const production = environments.find((environment) => environment.type === 'production');
    const recentIncidents = this.ctx.db.listOpsIncidentsByProject(context.projectId, 1);
    void recentIncidents;

    if (!production) {
      return true;
    }

    if (!production.container_id) {
      return true;
    }

    return production.container_id === context.containerId;
  }

  private async readContainerLogs(containerId: string): Promise<string> {
    try {
      return await this.ctx.docker.getLogs(containerId, 200);
    } catch (error) {
      log.warn({ error, containerId }, 'Failed to fetch container logs for diagnosis');
      return '';
    }
  }

  private async isContainerRunning(containerId: string): Promise<boolean> {
    try {
      const info = await this.ctx.docker.getClient().getContainer(containerId).inspect();
      return info.State.Running && !info.State.Restarting;
    } catch (error) {
      log.debug({ error, containerId }, 'Container inspect failed during health check');
      return false;
    }
  }

  private async isHttpHealthy(port: number): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 5_000);

    try {
      const response = await fetch(`http://localhost:${String(port)}/`, {
        method: 'GET',
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
