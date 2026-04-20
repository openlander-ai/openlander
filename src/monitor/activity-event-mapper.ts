/**
 * Shared event-to-activity mapping functions.
 *
 * Extracted from src/web/api/routes.ts so that both the API activity buffer
 * and the persistence subscriber (ActivityLogger) can reuse the same logic.
 */

import type { EventType, EventPayload } from '../events/index.js';
import { ulid } from '../db/repos/activity-log.repo.js';

// ── ActivityEvent shape (matches the legacy /api/activity format) ──

export interface ActivityEvent {
  id: string;
  timestamp: string;
  type:
    | 'incident'
    | 'recovery'
    | 'approval'
    | 'circuit_breaker'
    | 'cleanup'
    | 'alert'
    | 'ai_diagnosis'
    | 'ai:invoked'
    | 'ai:completed'
    | 'recovery:blocked'
    | 'recovery:degraded'
    | 'recovery:stopped'
    | 'recovery:started';
  severity: 'critical' | 'warning' | 'info';
  projectId: string;
  projectName: string;
  title: string;
  description: string;
  status:
    | 'active'
    | 'resolved'
    | 'pending'
    | 'failed'
    | 'ai-running'
    | 'ai-completed'
    | 'recovery-blocked'
    | 'recovery-stopped'
    | 'recovering';
  incidentId?: string;
  actionRunId?: string;
  correlationId?: string;
  cascadeGroup?: string[];
  aiMetadata?: {
    model: string;
    tokensUsed?: number;
    durationMs?: number;
    diagnosisSummary?: string;
  };
  rawType: EventType;
  // Backward-compatibility aliases for legacy consumers of /api/activity
  project: string;
  user: string;
  detail?: string;
  time: string;
  reason?: string;
}

// ── Database abstraction for project resolution ──

/**
 * Minimal database interface needed by resolveProjectIdFromEvent().
 * Accepts the full Database class or any object that satisfies these methods.
 */
export interface ActivityMapperDb {
  getActionRunsByApprovalStatus(
    status: 'pending' | 'approved' | 'rejected',
    limit: number,
  ): Array<{ id: string; project_id: string }>;
  getProject(id: string): { name: string } | undefined;
}

// ── Mapping functions ──

export function formatEventName(eventType: string): string {
  return eventType.replace(/[:_-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function resolveProjectIdFromEvent<T extends EventType>(
  db: ActivityMapperDb,
  eventType: T,
  payload: EventPayload[T],
): string | undefined {
  if (eventType === 'alert:new') {
    const alertPayload = payload as EventPayload['alert:new'];
    const projectId = alertPayload.alert.details.projectId;
    return typeof projectId === 'string' ? projectId : undefined;
  }

  if (eventType === 'recovery:approval-resolved') {
    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
    if (approvalPayload.projectId) return approvalPayload.projectId;
    const statuses: Array<'pending' | 'approved' | 'rejected'> = [
      'pending',
      'approved',
      'rejected',
    ];
    for (const status of statuses) {
      const matched = db
        .getActionRunsByApprovalStatus(status, 200)
        .find((run) => run.id === approvalPayload.actionRunId);
      if (matched) {
        return matched.project_id;
      }
    }
  }

  const projectId = (payload as { projectId?: string }).projectId;
  return typeof projectId === 'string' ? projectId : undefined;
}

export function mapActivityType(eventType: EventType): ActivityEvent['type'] {
  if (
    eventType === 'ai:invoked' ||
    eventType === 'ai:completed' ||
    eventType === 'recovery:blocked' ||
    eventType === 'recovery:degraded' ||
    eventType === 'recovery:stopped' ||
    eventType === 'recovery:started'
  ) {
    return eventType;
  }
  if (
    eventType === 'recovery:approval-needed' ||
    eventType === 'recovery:approval-auto-skipped' ||
    eventType === 'recovery:approval-resolved'
  ) {
    return 'approval';
  }
  if (
    eventType === 'recovery:start' ||
    eventType === 'recovery:success' ||
    eventType === 'recovery:failed' ||
    eventType === 'recovery:exhausted'
  ) {
    return 'recovery';
  }
  if (eventType.startsWith('alert:')) {
    return 'alert';
  }
  return 'incident';
}

export function mapActivityStatus<T extends EventType>(
  eventType: T,
  payload: EventPayload[T],
): ActivityEvent['status'] {
  if (eventType === 'ai:invoked') return 'ai-running';
  if (eventType === 'ai:completed') {
    const completedPayload = payload as EventPayload['ai:completed'];
    return completedPayload.success ? 'ai-completed' : 'failed';
  }
  if (eventType === 'recovery:blocked') return 'recovery-blocked';
  if (eventType === 'recovery:degraded') return 'failed';
  if (eventType === 'recovery:stopped') return 'recovery-stopped';
  if (eventType === 'recovery:started' || eventType === 'recovery:start') return 'recovering';
  if (eventType === 'recovery:success') return 'resolved';
  if (eventType === 'recovery:failed' || eventType === 'recovery:exhausted') return 'failed';
  if (eventType === 'recovery:approval-needed') return 'pending';
  if (eventType === 'recovery:approval-auto-skipped') return 'resolved';
  if (eventType === 'recovery:approval-resolved') {
    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
    return approvalPayload.approved ? 'resolved' : 'failed';
  }
  if (eventType === 'alert:resolved') return 'resolved';
  if (
    eventType === 'deploy:failed' ||
    eventType === 'deploy:crash' ||
    eventType === 'compose:failed' ||
    eventType === 'container:die' ||
    eventType === 'container:oom' ||
    eventType === 'container:missing' ||
    eventType === 'health:degraded'
  ) {
    return 'failed';
  }
  return 'active';
}

export function mapActivitySeverity<T extends EventType>(
  eventType: T,
  payload: EventPayload[T],
  status: ActivityEvent['status'],
): ActivityEvent['severity'] {
  if (eventType === 'alert:new') {
    const alertPayload = payload as EventPayload['alert:new'];
    return alertPayload.alert.severity === 'critical' ? 'critical' : 'warning';
  }
  if (
    eventType === 'deploy:crash' ||
    eventType === 'container:die' ||
    eventType === 'container:oom' ||
    eventType === 'container:missing' ||
    eventType === 'health:degraded'
  ) {
    return 'critical';
  }
  if (status === 'failed' || status === 'recovery-blocked' || status === 'recovery-stopped') {
    return 'warning';
  }
  if (eventType === 'recovery:approval-needed') {
    return 'warning';
  }
  return 'info';
}

export function extractEventDetail<T extends EventType>(
  eventType: T,
  payload: EventPayload[T],
): string {
  if (eventType === 'deploy:failed') {
    return (payload as EventPayload['deploy:failed']).error;
  }
  if (eventType === 'tunnel:url') {
    return (payload as EventPayload['tunnel:url']).url;
  }
  if (eventType === 'compose:failed') {
    return (payload as EventPayload['compose:failed']).error;
  }
  if (eventType === 'recovery:start') {
    return (payload as EventPayload['recovery:start']).error;
  }
  if (eventType === 'recovery:failed') {
    return (payload as EventPayload['recovery:failed']).error;
  }
  if (eventType === 'recovery:exhausted') {
    return (payload as EventPayload['recovery:exhausted']).lastError;
  }
  if (eventType === 'recovery:blocked') {
    return (payload as EventPayload['recovery:blocked']).reason;
  }
  if (eventType === 'recovery:degraded') {
    return (payload as EventPayload['recovery:degraded']).reason;
  }
  if (eventType === 'recovery:stopped') {
    return (payload as EventPayload['recovery:stopped']).reason;
  }
  if (eventType === 'recovery:started') {
    return (payload as EventPayload['recovery:started']).trigger;
  }
  if (eventType === 'alert:new') {
    return (payload as EventPayload['alert:new']).alert.message;
  }
  if (eventType === 'ai:invoked') {
    const aiPayload = payload as EventPayload['ai:invoked'];
    return `${aiPayload.model} ${aiPayload.action}`;
  }
  if (eventType === 'ai:completed') {
    return `${String((payload as EventPayload['ai:completed']).durationMs)}ms`;
  }
  return '';
}

export function describeActivityEvent<T extends EventType>(
  eventType: T,
  payload: EventPayload[T],
): Pick<
  ActivityEvent,
  'title' | 'description' | 'actionRunId' | 'aiMetadata' | 'reason' | 'incidentId'
> {
  if (eventType === 'deploy:failed') {
    const deployPayload = payload as EventPayload['deploy:failed'];
    return {
      title: `Deploy failed (${deployPayload.step})`,
      description: deployPayload.error,
    };
  }
  if (eventType === 'deploy:crash') {
    const crashPayload = payload as EventPayload['deploy:crash'];
    return {
      title: 'Deploy crashed',
      description:
        crashPayload.error ??
        (crashPayload.exitCode !== undefined ? `Exit code ${String(crashPayload.exitCode)}` : ''),
    };
  }
  if (eventType === 'compose:failed') {
    return {
      title: 'Compose failed',
      description: (payload as EventPayload['compose:failed']).error,
    };
  }
  if (eventType === 'container:die') {
    const diePayload = payload as EventPayload['container:die'];
    return {
      title: 'Container exited',
      description: `${diePayload.containerName} (code ${String(diePayload.exitCode)})`,
    };
  }
  if (eventType === 'container:oom') {
    const oomPayload = payload as EventPayload['container:oom'];
    return {
      title: 'Container out of memory',
      description: oomPayload.containerName,
    };
  }
  if (eventType === 'container:missing') {
    const missingPayload = payload as EventPayload['container:missing'];
    return {
      title: 'Container missing',
      description: missingPayload.suggestion,
    };
  }
  if (eventType === 'monitor:inactive') {
    const monitorPayload = payload as EventPayload['monitor:inactive'];
    return {
      title: 'Project inactive',
      description: `${String(monitorPayload.daysSinceLastAccess)} days since last access`,
    };
  }
  if (eventType === 'health:degraded') {
    const degradedPayload = payload as EventPayload['health:degraded'];
    return {
      title: 'Health degraded',
      description:
        degradedPayload.lastError ??
        `Consecutive failures: ${String(degradedPayload.consecutiveFailures)}`,
    };
  }
  if (eventType === 'recovery:start') {
    const recoveryPayload = payload as EventPayload['recovery:start'];
    return {
      title: `Auto-recovery attempt #${String(recoveryPayload.attempt)}`,
      description: recoveryPayload.error,
    };
  }
  if (eventType === 'recovery:success') {
    const recoveryPayload = payload as EventPayload['recovery:success'];
    return {
      title: 'Auto-recovery succeeded',
      description:
        recoveryPayload.lastError ?? `Recovered in ${String(recoveryPayload.durationMs)}ms`,
    };
  }
  if (eventType === 'recovery:failed') {
    const recoveryPayload = payload as EventPayload['recovery:failed'];
    return {
      title: `Auto-recovery failed (attempt #${String(recoveryPayload.attempt)})`,
      description: recoveryPayload.error,
    };
  }
  if (eventType === 'recovery:exhausted') {
    const recoveryPayload = payload as EventPayload['recovery:exhausted'];
    return {
      title: 'Auto-recovery exhausted',
      description: recoveryPayload.lastError,
    };
  }
  if (eventType === 'recovery:blocked') {
    const blockedPayload = payload as EventPayload['recovery:blocked'];
    return {
      title: 'Recovery blocked',
      description: blockedPayload.reason,
      reason: blockedPayload.reason,
    };
  }
  if (eventType === 'recovery:degraded') {
    const degradedPayload = payload as EventPayload['recovery:degraded'];
    return {
      title: `Recovery partial failure (stage: ${degradedPayload.stage})`,
      description: degradedPayload.reason,
      reason: degradedPayload.reason,
    };
  }
  if (eventType === 'recovery:stopped') {
    const stoppedPayload = payload as EventPayload['recovery:stopped'];
    return {
      title: 'Recovery stopped',
      description: stoppedPayload.reason,
      reason: stoppedPayload.reason,
    };
  }
  if (eventType === 'recovery:started') {
    const startedPayload = payload as EventPayload['recovery:started'];
    return {
      title: 'Recovery started',
      description: startedPayload.trigger,
    };
  }
  if (eventType === 'recovery:approval-needed') {
    const approvalPayload = payload as EventPayload['recovery:approval-needed'];
    return {
      title: `Approval required: ${approvalPayload.toolName}`,
      description: `Attempt #${String(approvalPayload.attempt)}`,
      actionRunId: approvalPayload.actionRunId,
    };
  }
  if (eventType === 'recovery:approval-auto-skipped') {
    const skippedPayload = payload as EventPayload['recovery:approval-auto-skipped'];
    return {
      title: `Approval auto-skipped: ${skippedPayload.toolName}`,
      description: `Step "${skippedPayload.recoveryStep}" set to auto mode`,
      actionRunId: skippedPayload.actionRunId,
    };
  }
  if (eventType === 'recovery:approval-resolved') {
    const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
    return {
      title: approvalPayload.approved ? 'Approval approved' : 'Approval rejected',
      description: approvalPayload.actionRunId,
      actionRunId: approvalPayload.actionRunId,
    };
  }
  if (eventType === 'ai:invoked') {
    const aiPayload = payload as EventPayload['ai:invoked'];
    return {
      title: 'AI invoked',
      description: `${aiPayload.model} ${aiPayload.action}`,
      aiMetadata: {
        model: aiPayload.model,
      },
    };
  }
  if (eventType === 'ai:completed') {
    const aiPayload = payload as EventPayload['ai:completed'];
    return {
      title: aiPayload.success ? 'AI completed' : 'AI failed',
      description: `${aiPayload.action} (${String(aiPayload.durationMs)}ms)`,
      aiMetadata: {
        model: aiPayload.model,
        durationMs: aiPayload.durationMs,
        tokensUsed: (aiPayload.inputTokens ?? 0) + (aiPayload.outputTokens ?? 0) || undefined,
      },
    };
  }
  if (eventType === 'alert:new') {
    const alertPayload = payload as EventPayload['alert:new'];
    return {
      title: `Alert: ${alertPayload.alert.type}`,
      description: alertPayload.alert.message,
      incidentId:
        typeof alertPayload.alert.details.incidentId === 'string'
          ? alertPayload.alert.details.incidentId
          : undefined,
    };
  }

  return {
    title: formatEventName(eventType),
    description: extractEventDetail(eventType, payload),
  };
}

export function buildActivityEvent<T extends EventType>(
  db: ActivityMapperDb,
  eventType: T,
  payload: EventPayload[T],
): ActivityEvent | null {
  const projectId = resolveProjectIdFromEvent(db, eventType, payload);
  if (!projectId) return null;

  const project = db.getProject(projectId);
  const projectName = project?.name ?? projectId;
  const timestamp = new Date().toISOString();
  const type = mapActivityType(eventType);
  const status = mapActivityStatus(eventType, payload);
  const severity = mapActivitySeverity(eventType, payload, status);
  const content = describeActivityEvent(eventType, payload);
  const id = ulid();

  return {
    id,
    timestamp,
    type,
    severity,
    projectId,
    projectName,
    title: content.title,
    description: content.description,
    status,
    incidentId: content.incidentId,
    actionRunId: content.actionRunId,
    correlationId: content.actionRunId,
    aiMetadata: content.aiMetadata,
    rawType: eventType,
    project: projectName,
    user: 'system',
    detail: content.description || undefined,
    time: timestamp,
    reason: content.reason,
  };
}
