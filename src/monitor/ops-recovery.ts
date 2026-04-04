import { randomUUID } from 'node:crypto';
import { generateText } from 'ai';

import type { AppContext } from '../app.js';
import type { OpsIncidentEventRow } from '../db/types.js';
import { createModuleLogger } from '../lib/logger.js';
import { createModelProxy } from '../llm/model-proxy.js';
import { eventBus } from '../events/index.js';

const log = createModuleLogger('ops-recovery');

const RECOVERY_MAX_FAILURES = 5;
const HEALTH_CHECK_ATTEMPTS = 3;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

export interface RecoveryContext {
  projectId: string;
  projectName: string;
  containerId: string;
  incidentId: string | null;
}

type RecoveryOutcome = 'recovered' | 'escalated' | 'skipped';

export class RecoveryPipeline {
  private readonly ctx: AppContext;
  private readonly activeRecoveries = new Set<string>();

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async execute(context: RecoveryContext): Promise<RecoveryOutcome> {
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

    if (this.activeRecoveries.has(projectId)) {
      log.warn({ projectId }, 'Recovery already in progress — skipping');
      return 'skipped';
    }

    const actionRunId = this.ctx.db.createActionRun({
      projectId,
      triggerSource: 'auto_recovery',
      recoveryStrategy: 'unknown',
    });

    this.activeRecoveries.add(projectId);
    try {
      const outcome = await this.runRecoverySequence(context);
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

    this.addIncidentEvent(incidentId, 'action_taken', 'Step restart: attempting container restart');
    const restartResult = await this.restartContainer(projectId, containerId);
    if (!restartResult.success) {
      this.incrementAndCheckBreaker(projectId);
      return await this.diagnoseFixRollbackEscalate(
        context,
        `Restart failed: ${restartResult.reason}`,
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
    return await this.diagnoseFixRollbackEscalate(
      context,
      'Health check failed after restart (3 attempts over 90 seconds)',
    );
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

  private async diagnoseFixRollbackEscalate(
    context: RecoveryContext,
    failureReason: string,
  ): Promise<'recovered' | 'escalated'> {
    this.addIncidentEvent(context.incidentId, 'diagnosed', `Step diagnosis: ${failureReason}`);

    const logs = await this.readContainerLogs(context.containerId);
    const diagnosis = await this.generateDiagnosis(context, failureReason, logs);
    if (diagnosis && context.incidentId) {
      this.ctx.db.updateOpsIncident(context.incidentId, {
        diagnosis,
        root_cause: failureReason,
      });
    }

    const fixNotes = await this.applyFixes(context, logs);
    if (fixNotes.length > 0) {
      this.addIncidentEvent(
        context.incidentId,
        'action_taken',
        `Step fix: ${fixNotes.join(' | ')}`,
      );
      if (context.incidentId) {
        this.ctx.db.updateOpsIncident(context.incidentId, {
          actions_taken: fixNotes.join('\n'),
        });
      }
    }

    return await this.tryRollback(context, `${failureReason}; ${fixNotes.join('; ')}`);
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

  private async escalate(context: RecoveryContext, reason: string): Promise<'escalated'> {
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

  private isProductionRecovery(context: RecoveryContext): boolean {
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
