/**
 * Monitoring routes — v4 service-aggregate dashboard for the top-level
 * `/monitoring` page (ralplan-monitoring-logs Phase 2).
 *
 * Shape:
 *   GET /api/monitoring/services?project=<id>
 *   →
 *   {
 *     services: [
 *       {
 *         serviceId, projectId | null, projectName | null,
 *         name, status, health, cpu60[], mem60[],
 *         lastSampleAt: number | null, stale: boolean
 *       },
 *       ...
 *     ],
 *     excluded: number,   // count of services with no samples (excluded
 *                         //   from the grid; UI surfaces as a footer)
 *     total:    number,   // total services known to the system
 *   }
 *
 * Per the plan's Principle 1 (no synthetic empty-state numbers): services
 * without ANY metric samples are dropped from `services[]` and counted in
 * `excluded`. The page's empty state copy uses `excluded` to tell the
 * user how many services are pending their first sample.
 *
 * Per the plan's Principle 3 (reuse before invent): the per-service
 * downsample pattern is identical to the existing /api/services/:id/metrics
 * route — same 60-bin uniform reduce. Stale-sample threshold (5 min) is
 * the plan's Critic-Amendment-#2 default.
 */
import { Hono } from 'hono';

import type { AppContext } from '../../app.js';

const SERIES_LENGTH = 60;
const STALE_AFTER_MS = 5 * 60 * 1000; // 5 minutes
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface MonitoringServiceEntry {
  serviceId: string;
  projectId: string | null;
  projectName: string | null;
  name: string;
  status: string;
  health: 'healthy' | 'unhealthy' | 'unknown';
  cpu60: number[];
  mem60: number[];
  lastSampleAt: number | null;
  stale: boolean;
}

interface MonitoringResponse {
  services: MonitoringServiceEntry[];
  excluded: number;
  total: number;
}

/**
 * Uniform downsample to SERIES_LENGTH bins. Mirrors the helper in
 * `system-routes.ts` /services/:id/metrics; not exported there or we'd
 * import it directly.
 */
function downsample(values: number[]): number[] {
  if (values.length === 0) return new Array<number>(SERIES_LENGTH).fill(0);
  if (values.length >= SERIES_LENGTH) {
    const result: number[] = [];
    const binSize = values.length / SERIES_LENGTH;
    for (let i = 0; i < SERIES_LENGTH; i++) {
      const start = Math.floor(i * binSize);
      const end = Math.floor((i + 1) * binSize);
      const slice = values.slice(start, end);
      const avg = slice.reduce((s, v) => s + v, 0) / slice.length;
      result.push(Math.round(avg * 100) / 100);
    }
    return result;
  }
  const firstValue = values[0] ?? 0;
  return new Array<number>(SERIES_LENGTH - values.length).fill(firstValue).concat(values);
}

function deriveHealth(status: string): MonitoringServiceEntry['health'] {
  if (status === 'running') return 'healthy';
  if (status === 'error') return 'unhealthy';
  return 'unknown';
}

export function createMonitoringRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/monitoring/services', (c) => {
    const projectFilter = c.req.query('project');
    const projectScoped =
      projectFilter !== undefined && projectFilter !== '' && projectFilter !== 'all';

    const allServices = ctx.db.listServices();
    const projects = ctx.db.listProjects();
    const projectNameById = new Map<string, string>();
    for (const p of projects) projectNameById.set(p.id, p.name);

    // service → first project connection (if any). One row per service.
    const projectIdByService = new Map<string, string>();
    for (const svc of allServices) {
      const conns = ctx.db.listServiceConnectionsByService(svc.id);
      const first = conns[0];
      if (first) projectIdByService.set(svc.id, first.project_id);
    }

    const now = Date.now();
    const fromMs = now - WINDOW_MS;
    let total = 0;
    let excluded = 0;
    const out: MonitoringServiceEntry[] = [];

    for (const svc of allServices) {
      const projectId = projectIdByService.get(svc.id) ?? null;
      if (projectScoped && projectId !== projectFilter) continue;
      total += 1;

      if (!ctx.db.hasAnyServiceMetrics(svc.id)) {
        excluded += 1;
        continue;
      }

      const samples = ctx.db.listServiceMetricsSince(svc.id, fromMs);
      if (samples.length === 0) {
        excluded += 1;
        continue;
      }

      const cpu60 = downsample(samples.map((s) => s.cpu));
      const mem60 = downsample(samples.map((s) => s.mem));
      const lastSampleAt = samples[samples.length - 1]?.recorded_at ?? null;
      const stale = lastSampleAt == null ? true : now - lastSampleAt > STALE_AFTER_MS;

      out.push({
        serviceId: svc.id,
        projectId,
        projectName: projectId ? (projectNameById.get(projectId) ?? null) : null,
        name: svc.name,
        status: svc.status,
        health: deriveHealth(svc.status),
        cpu60,
        mem60,
        lastSampleAt,
        stale,
      });
    }

    const body: MonitoringResponse = {
      services: out,
      excluded,
      total,
    };
    return c.json(body);
  });

  return api;
}
