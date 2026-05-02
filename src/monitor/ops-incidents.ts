import type { AppContext } from '../app.js';
import type { OpsIncidentRow, OpsIncidentEventRow } from '../db/types.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('ops-incidents');
const INCIDENT_FINGERPRINT_WINDOW_MS = 30 * 60 * 1000;

export interface IncidentWithTimeline {
  incident: OpsIncidentRow;
  events: OpsIncidentEventRow[];
}

export class IncidentManager {
  private readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  /** Create a new incident for a project (or return existing active one — deduplication). */
  async openIncident(
    projectId: string,
    trigger: { type: string; details?: string },
  ): Promise<OpsIncidentRow> {
    const existing = await this.ctx.db.getActiveOpsIncident(projectId);
    const triggerSummary = this.describeTrigger(trigger);
    const triggerFingerprint = this.generateFingerprint(triggerSummary);

    if (existing) {
      const existingFingerprint = this.generateFingerprint(existing.root_cause ?? '');
      const incidentAgeMs = Date.now() - existing.created_at;

      if (
        existingFingerprint.length > 0 &&
        existingFingerprint === triggerFingerprint &&
        incidentAgeMs <= INCIDENT_FINGERPRINT_WINDOW_MS
      ) {
        await this.addEvent(existing.id, 'detected', `Recurring event: ${triggerSummary}`);
        return existing;
      }

      await this.addEvent(
        existing.id,
        'cascade_detected',
        `New error pattern detected: ${triggerSummary}`,
        {
          existing_fingerprint: existingFingerprint || null,
          new_fingerprint: triggerFingerprint,
          window_ms: INCIDENT_FINGERPRINT_WINDOW_MS,
        },
      );
      return existing;
    }

    const id = this.generateIncidentId();
    const severity = this.inferSeverity(trigger.type);
    const incident = await this.ctx.db.createOpsIncident({
      id,
      project_id: projectId,
      severity,
      status: 'open',
      root_cause: triggerSummary,
    });

    await this.addEvent(
      incident.id,
      'detected',
      `Incident detected: ${trigger.type}${trigger.details ? ` — ${trigger.details}` : ''}`,
      {
        trigger_type: trigger.type,
        trigger_details: trigger.details,
      },
    );

    // Cascade detection: find dependent projects
    try {
      const dependents = await this.ctx.db.findProjectDependents(projectId, undefined);
      if (dependents.length > 0) {
        const affectedProjectIds = dependents.map((d) => d.source_service_id);
        await this.addEvent(
          incident.id,
          'cascade_detected',
          `${String(dependents.length)} dependent project(s) may be affected`,
          { affected_project_ids: affectedProjectIds },
        );
      }
    } catch (err) {
      log.debug({ err, projectId }, 'Cascade detection failed while opening incident');
      // cascade detection is best-effort
    }

    log.info({ incidentId: incident.id, projectId, triggerType: trigger.type }, 'Incident opened');
    return incident;
  }

  async addEvent(
    incidentId: string,
    eventType: OpsIncidentEventRow['event_type'],
    description: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const id = `evt-${String(Date.now())}-${Math.random().toString(36).slice(2, 7)}`;
    await this.ctx.db.addOpsIncidentEvent({
      id,
      incident_id: incidentId,
      event_type: eventType,
      description,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    });
  }

  async resolveIncident(incidentId: string, resolution?: string): Promise<void> {
    await this.ctx.db.updateOpsIncidentStatus(incidentId, 'resolved', { resolved_at: Date.now() });
    await this.addEvent(incidentId, 'recovered', resolution ?? 'Incident resolved');
    log.info({ incidentId }, 'Incident resolved');
  }

  async escalateIncident(incidentId: string, reason: string): Promise<void> {
    await this.ctx.db.updateOpsIncidentStatus(incidentId, 'escalated', {
      escalated_at: Date.now(),
    });
    await this.addEvent(incidentId, 'escalated', reason);
    log.warn({ incidentId, reason }, 'Incident escalated');
  }

  async getActiveIncident(projectId: string): Promise<OpsIncidentRow | null> {
    return (await this.ctx.db.getActiveOpsIncident(projectId)) ?? null;
  }

  async getIncidentWithTimeline(incidentId: string): Promise<IncidentWithTimeline | null> {
    const incident = await this.ctx.db.getOpsIncident(incidentId);
    if (!incident) return null;
    const events = await this.ctx.db.listOpsIncidentEvents(incidentId);
    return { incident, events };
  }

  private generateIncidentId(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.random().toString(36).slice(2, 7);
    return `inc-${date}-${random}`;
  }

  private inferSeverity(triggerType: string): 'critical' | 'warning' | 'info' {
    if (
      triggerType.includes('crash') ||
      triggerType.includes('missing') ||
      triggerType.includes('exhausted')
    ) {
      return 'critical';
    }
    if (
      triggerType.includes('fail') ||
      triggerType.includes('degrad') ||
      triggerType.includes('inactive')
    ) {
      return 'warning';
    }
    return 'info';
  }

  private describeTrigger(trigger: { type: string; details?: string }): string {
    return `${trigger.type}${trigger.details ? ` — ${trigger.details}` : ''}`;
  }

  private generateFingerprint(errorMessage: string): string {
    return errorMessage
      .replace(/[0-9a-f]{8,}/gi, '<id>')
      .replace(/\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}[^\s]*/gi, '<ts>')
      .replace(/:\d{4,5}/g, ':<port>')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, 200);
  }
}
