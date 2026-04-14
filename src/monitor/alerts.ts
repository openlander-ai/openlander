import { nanoid } from 'nanoid';
import type { Docker } from '../pipeline/docker.js';
import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';
import { ContainerAlertHandler } from './container-alert-handler.js';
import { InfrastructureAlerter } from './infrastructure-alerter.js';

const log = createModuleLogger('alerts');

export interface Alert {
  id: string;
  type:
    | 'disk'
    | 'inactive-project'
    | 'restart-loop'
    | 'dangling-images'
    | 'port-conflict'
    | 'container-crash'
    | 'resource-saturation'
    | 'orphan-container';
  severity: 'warning' | 'critical';
  message: string;
  details: Record<string, unknown>;
  suggestion: string;
  createdAt: Date;
  dismissed: boolean;
}

export interface AlertMonitorOptions {
  intervalMs?: number;
}

const DEFAULT_OPTIONS: Required<AlertMonitorOptions> = {
  intervalMs: 30000,
};

const HOURLY_ALERT_CAP = 3;
const COOLDOWN_MS = 5 * 60 * 1000;

export class AlertMonitor {
  private readonly db: Database;
  private readonly events: EventBus;
  private readonly options: Required<AlertMonitorOptions>;
  private readonly alerts = new Map<string, Alert>();
  private readonly alertKeys = new Map<string, string>();
  private started = false;
  private hourlyCounts: number[] = [];
  private lastAlertTime = 0;
  readonly infrastructureAlerter: InfrastructureAlerter;
  private containerAlertHandler: ContainerAlertHandler;

  constructor(docker: Docker, db: Database, events: EventBus, options?: AlertMonitorOptions) {
    this.db = db;
    this.events = events;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.infrastructureAlerter = new InfrastructureAlerter(docker, db, this, {
      intervalMs: this.options.intervalMs,
    });
    this.containerAlertHandler = new ContainerAlertHandler(db, events, this);
  }

  start(intervalMs?: number): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.infrastructureAlerter.start(intervalMs);
    this.containerAlertHandler.start();
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.infrastructureAlerter.stop();
    this.containerAlertHandler.stop();
  }

  getActiveAlerts(): Alert[] {
    const memoryAlerts = Array.from(this.alerts.values()).filter((a) => !a.dismissed);

    const openIncidents = this.db.listAllActiveOpsIncidents();

    const memoryAlertProjectIds = new Set(
      memoryAlerts
        .filter((a) => a.type === 'container-crash')
        .map((a) => (a.details as { projectId?: string }).projectId)
        .filter(Boolean),
    );

    for (const inc of openIncidents) {
      if (memoryAlertProjectIds.has(inc.project_id)) continue;

      const project = this.db.getProject(inc.project_id);
      const projectName = project?.name ?? inc.project_id;

      memoryAlerts.push({
        id: inc.id,
        type: 'container-crash',
        severity: inc.severity === 'info' ? 'warning' : inc.severity,
        message: `Incident: ${projectName} — ${inc.root_cause ?? inc.status}`,
        details: { projectId: inc.project_id, incidentId: inc.id, source: 'ops_incidents' },
        suggestion: `Check ops incidents for project "${projectName}". Use get_logs to investigate.`,
        createdAt: new Date(inc.created_at),
        dismissed: false,
      });
    }

    return memoryAlerts;
  }

  dismissAlert(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      log.debug({ alertId }, 'Attempted to dismiss non-existent alert');
      return;
    }

    alert.dismissed = true;
    const key = `${alert.type}:${this.getTargetId(alert)}`;
    this.alertKeys.delete(key);

    void this.events.emit('alert:dismissed', { alertId });
    log.info({ alertId, type: alert.type }, 'Alert dismissed');
  }

  getAlertKeys(): IterableIterator<string> {
    return this.alertKeys.keys();
  }

  async upsertAlert(
    key: string,
    alertData: Omit<Alert, 'id' | 'createdAt' | 'dismissed'>,
  ): Promise<void> {
    const existingId = this.alertKeys.get(key);

    if (existingId) {
      const existing = this.alerts.get(existingId);
      if (existing) {
        existing.severity = alertData.severity;
        existing.message = alertData.message;
        existing.details = alertData.details;
        existing.suggestion = alertData.suggestion;
        return;
      }
    }

    if (this.isRateLimited()) {
      log.debug({ key, type: alertData.type }, 'Alert rate-limited');
      return;
    }

    const alert: Alert = {
      id: nanoid(12),
      ...alertData,
      createdAt: new Date(),
      dismissed: false,
    };

    this.alerts.set(alert.id, alert);
    this.alertKeys.set(key, alert.id);
    this.hourlyCounts.push(Date.now());
    this.lastAlertTime = Date.now();

    await this.events.emit('alert:new', { alert });
    log.info(
      { alertId: alert.id, type: alert.type, severity: alert.severity },
      'New alert created',
    );
  }

  resolveAlert(key: string, type: Alert['type']): void {
    const alertId = this.alertKeys.get(key);
    if (!alertId) return;

    const alert = this.alerts.get(alertId);
    if (!alert || alert.dismissed) return;

    this.alerts.delete(alertId);
    this.alertKeys.delete(key);

    void this.events.emit('alert:resolved', { alertId, type });
    log.info({ alertId, type }, 'Alert resolved');
  }

  private isRateLimited(): boolean {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    this.hourlyCounts = this.hourlyCounts.filter((t) => t > oneHourAgo);
    if (this.hourlyCounts.length >= HOURLY_ALERT_CAP) return true;
    if (now - this.lastAlertTime < COOLDOWN_MS) return true;
    return false;
  }

  private getTargetId(alert: Alert): string {
    switch (alert.type) {
      case 'disk':
        return 'root';
      case 'inactive-project': {
        const pid = alert.details['projectId'];
        return typeof pid === 'string' ? pid : 'unknown';
      }
      case 'restart-loop': {
        const cid = alert.details['containerId'];
        return typeof cid === 'string' ? cid : 'unknown';
      }
      case 'dangling-images':
        return 'system';
      case 'port-conflict': {
        const port = alert.details['port'];
        return typeof port === 'number' ? String(port) : 'unknown';
      }
      case 'container-crash':
      case 'resource-saturation':
      case 'orphan-container': {
        const containerId = alert.details['containerId'];
        return typeof containerId === 'string' ? containerId : 'unknown';
      }
      default:
        return 'unknown';
    }
  }
}
