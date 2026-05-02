import type { AppContext } from '../app.js';
import type { OpsAlert, OpsConfig } from './ops-types.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('ops-alerting');

export class OpsAlerting {
  private readonly ctx: AppContext;
  private readonly dedupCache = new Map<string, number>();
  private dedupWindowMs: number;

  constructor(ctx: AppContext, config?: Partial<OpsConfig>) {
    this.ctx = ctx;
    this.dedupWindowMs = (config?.thresholds?.alert_dedup_minutes ?? 15) * 60_000;
  }

  async sendAlert(alert: OpsAlert): Promise<void> {
    if (this.isDuplicate(alert)) {
      log.debug(
        { projectId: alert.project.id, eventType: alert.event_type },
        'Alert suppressed by dedup',
      );
      return;
    }

    const key = `${alert.project.id}:${alert.event_type}`;
    this.dedupCache.set(key, Date.now());

    if (alert.incident_id) {
      try {
        const eventId = `evt-${String(Date.now())}-${Math.random().toString(36).slice(2, 7)}`;
        await this.ctx.db.addOpsIncidentEvent({
          id: eventId,
          incident_id: alert.incident_id,
          event_type: 'alert_sent',
          description: `Alert sent: ${alert.title}`,
          metadata: JSON.stringify({
            severity: alert.severity,
            channels: this.ctx.channelManager.listConnected(),
          }),
        });
      } catch (err) {
        log.warn({ err }, 'Failed to log alert as incident event');
      }
    }

    try {
      await this.ctx.channelManager.broadcastStructured(alert);
      log.info(
        { projectId: alert.project.id, severity: alert.severity, title: alert.title },
        'Alert sent',
      );
    } catch (err) {
      log.error({ err, projectId: alert.project.id }, 'Failed to broadcast alert');
    }
  }

  isDuplicate(alert: OpsAlert): boolean {
    const key = `${alert.project.id}:${alert.event_type}`;
    const lastSent = this.dedupCache.get(key);
    if (!lastSent) return false;
    return Date.now() - lastSent < this.dedupWindowMs;
  }

  buildContextualAlert(params: {
    severity: OpsAlert['severity'];
    projectId: string;
    projectName: string;
    eventType: string;
    title: string;
    description: string;
    context?: Record<string, unknown>;
    suggestion?: string;
    actionsTaken?: string[];
    incidentId?: string;
  }): OpsAlert {
    return {
      severity: params.severity,
      project: { id: params.projectId, name: params.projectName },
      event_type: params.eventType,
      title: params.title,
      description: params.description,
      context: params.context ?? {},
      suggestion: params.suggestion ?? null,
      actions_taken: params.actionsTaken ?? [],
      incident_id: params.incidentId ?? null,
      timestamp: Date.now(),
    };
  }

  clearDedupCache(): void {
    this.dedupCache.clear();
  }

  updateConfig(config: Partial<OpsConfig>): void {
    if (config.thresholds?.alert_dedup_minutes !== undefined) {
      this.dedupWindowMs = config.thresholds.alert_dedup_minutes * 60_000;
    }
  }
}
