import type { AppContext } from '../app.js';
import type { OpsAlert } from './ops-types.js';
import { createModuleLogger } from '../lib/logger.js';
import { getSystemStats } from './stats.js';

const log = createModuleLogger('ops-digest');

export interface DigestReport {
  generatedAt: number;
  period: { from: number; to: number };
  projects: { total: number; running: number; stopped: number; error: number };
  incidents: {
    total: number;
    autoResolved: number;
    escalated: number;
    open: number;
    avgResolutionMs: number | null;
  };
  resources: { cpu: number | null; memory: number | null; disk: number | null };
  openCircuitBreakers: string[];
}

export class DigestGenerator {
  private readonly ctx: AppContext;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private lastDigestAt: number | null = null;
  private lastReport: DigestReport | null = null;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  async generateDigest(): Promise<DigestReport> {
    const now = Date.now();
    const from = now - 24 * 60 * 60 * 1000;

    const allProjects = await this.ctx.db.listProjects();
    const projectStats = {
      total: allProjects.length,
      // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
      running: allProjects.filter((p) => p.status === 'running').length,
      // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
      stopped: allProjects.filter((p) => p.status === 'stopped').length,
      // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
      error: allProjects.filter((p) => p.status === 'error').length,
    };

    const recentIncidents = await this.getRecentIncidents(from, now);
    const incidentStats = this.computeIncidentStats(recentIncidents);

    const resources = this.getResources();

    const openBreakers = await this.getOpenCircuitBreakers();

    const report: DigestReport = {
      generatedAt: now,
      period: { from, to: now },
      projects: projectStats,
      incidents: incidentStats,
      resources,
      openCircuitBreakers: openBreakers,
    };

    this.lastReport = report;
    this.lastDigestAt = now;
    log.info({ incidentCount: recentIncidents.length }, 'Daily digest generated');
    return report;
  }

  formatDigestForChannel(report: DigestReport): OpsAlert {
    const upProjects = `${String(report.projects.running)}/${String(report.projects.total)} running`;
    const incidentSummary =
      report.incidents.total === 0
        ? 'No incidents'
        : `${String(report.incidents.total)} incidents (${String(report.incidents.autoResolved)} auto-resolved, ${String(report.incidents.escalated)} escalated)`;

    const lines = [
      `Daily Operations Digest`,
      `Projects: ${upProjects}`,
      `Incidents (24h): ${incidentSummary}`,
    ];

    if (report.resources.disk !== null) {
      lines.push(`Disk: ${String(Math.round(report.resources.disk))}%`);
    }
    if (report.openCircuitBreakers.length > 0) {
      lines.push(`Open circuit breakers: ${report.openCircuitBreakers.join(', ')}`);
    }

    return {
      severity:
        report.incidents.escalated > 0 || report.openCircuitBreakers.length > 0
          ? 'warning'
          : 'info',
      project: { id: 'system', name: 'OpenLander' },
      event_type: 'daily_digest',
      title: 'Daily Operations Digest',
      description: lines.join('\n'),
      context: report as unknown as Record<string, unknown>,
      suggestion: null,
      actions_taken: [],
      incident_id: null,
      timestamp: report.generatedAt,
    };
  }

  scheduleDigest(timeOfDay: string): void {
    this.stopSchedule();

    this.scheduleTimer = setInterval(() => {
      void (async () => {
        const now = new Date();
        const [hourStr, minStr] = timeOfDay.split(':');
        const hour = Number(hourStr ?? 9);
        const minute = Number(minStr ?? 0);

        if (now.getHours() === hour && now.getMinutes() === minute) {
          const lastMinute = this.lastDigestAt ? Date.now() - this.lastDigestAt : Infinity;
          if (lastMinute > 60_000) {
            try {
              const report = await this.generateDigest();
              const alert = this.formatDigestForChannel(report);
              await this.ctx.channelManager.broadcastStructured(alert);
            } catch (err: unknown) {
              log.error({ err }, 'Failed to generate or broadcast scheduled digest');
            }
          }
        }
      })();
    }, 60_000);
  }

  stopSchedule(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  getLastReport(): DigestReport | null {
    return this.lastReport;
  }

  private async getRecentIncidents(from: number, to: number) {
    try {
      return await this.ctx.db.listOpsIncidentsByDateRange(from, to);
    } catch (err) {
      log.warn({ err }, 'Failed to load recent incidents for digest');
      return [];
    }
  }

  private computeIncidentStats(
    incidents: Array<{ status: string; created_at: number; resolved_at: number | null }>,
  ) {
    const resolved = incidents.filter((i) => i.resolved_at !== null);
    return {
      total: incidents.length,
      autoResolved: incidents.filter((i) => i.status === 'resolved').length,
      escalated: incidents.filter((i) => i.status === 'escalated').length,
      open: incidents.filter((i) => i.status === 'open' || i.status === 'active').length,
      avgResolutionMs: this.computeAvgResolution(resolved),
    };
  }

  private computeAvgResolution(
    resolved: Array<{ created_at: number; resolved_at: number | null }>,
  ): number | null {
    if (resolved.length === 0) return null;
    const total = resolved.reduce((sum, i) => sum + ((i.resolved_at ?? 0) - i.created_at), 0);
    return Math.round(total / resolved.length);
  }

  private getResources(): DigestReport['resources'] {
    try {
      const stats = getSystemStats();
      return {
        cpu: stats.cpu.usagePercent,
        memory: stats.memory.usagePercent,
        disk: stats.disk.usagePercent,
      };
    } catch {
      return { cpu: null, memory: null, disk: null };
    }
  }

  private async getOpenCircuitBreakers(): Promise<string[]> {
    try {
      return await this.ctx.db.findAllOpenCircuitBreakers();
    } catch (err) {
      log.warn({ err }, 'Failed to load open circuit breakers for digest');
      return [];
    }
  }
}
