import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import { serviceMetrics } from '../schema.drizzle.js';
import type { ServiceMetricRow } from '../schema.drizzle.js';

/**
 * Phase E_NEW Task 5 — repo for the time-series `service_metrics` table.
 * Writes one row per sample (recorder hook in
 * `ServiceHealthMonitor.runServiceCheck`) and reads back a window of
 * samples for the v4 service detail sparkline. Aggregation/downsampling
 * happens in the route, not the repo, so the repo stays a thin
 * accessor.
 */
export class ServiceMetricRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  /**
   * Insert a single sample. Caller is responsible for `recorded_at`
   * (epoch ms) so backfill / replay paths can pin the timestamp.
   */
  async recordMetricSample(sample: {
    serviceId: string;
    recordedAt: number;
    cpu: number;
    mem: number;
    req: number;
    err: number;
    p95LatencyMs: number | null;
    requestCount: number;
  }): Promise<void> {
    await this.db.insert(serviceMetrics).values({
      service_id: sample.serviceId,
      recorded_at: sample.recordedAt,
      cpu: sample.cpu,
      mem: sample.mem,
      req: sample.req,
      err: sample.err,
      p95_latency_ms: sample.p95LatencyMs,
      request_count: sample.requestCount,
    });
  }

  /**
   * Return all samples for a service in the half-open window
   * `[fromMs, ∞)`, oldest-first. Pure read — downsampling lives in
   * the route.
   */
  async listMetricsSince(serviceId: string, fromMs: number): Promise<ServiceMetricRow[]> {
    return await this.db
      .select()
      .from(serviceMetrics)
      .where(and(eq(serviceMetrics.service_id, serviceId), gte(serviceMetrics.recorded_at, fromMs)))
      .orderBy(asc(serviceMetrics.recorded_at));
  }

  /**
   * Used by the route to short-circuit to HTTP 204 when a service has
   * no history at all (first-deploy, recorder hasn't run yet). The
   * 204 path is required by the plan (Principle 4 strict reading —
   * no synthetic empty arrays).
   */
  async hasAnyMetrics(serviceId: string): Promise<boolean> {
    const row =
      (
        await this.db
          .select({ one: sql<number>`1` })
          .from(serviceMetrics)
          .where(eq(serviceMetrics.service_id, serviceId))
          .limit(1)
      )[0] ?? null;
    return row !== null;
  }

  /**
   * Latest CPU/mem sample for a service, used by the topology cold
   * path so /api/projects/:id (and the project list) doesn't have to
   * fan out one Docker stats RPC per service node. Returns null when
   * no samples exist.
   */
  async getLatestSample(serviceId: string): Promise<ServiceMetricRow | null> {
    return (
      (
        await this.db
          .select()
          .from(serviceMetrics)
          .where(eq(serviceMetrics.service_id, serviceId))
          .orderBy(desc(serviceMetrics.recorded_at))
          .limit(1)
      )[0] ?? null
    );
  }

  /**
   * Latest sample timestamp regardless of window. Used by the v4
   * /api/monitoring/services route to render a "stale" badge with the
   * actual age when a service has historical metrics but no samples in
   * the polling window. Returns null when no samples exist at all.
   */
  async getLastSampleAt(serviceId: string): Promise<number | null> {
    const row =
      (
        await this.db
          .select({ recorded_at: sql<number | null>`MAX(${serviceMetrics.recorded_at})` })
          .from(serviceMetrics)
          .where(eq(serviceMetrics.service_id, serviceId))
          .limit(1)
      )[0] ?? null;
    return row?.recorded_at ?? null;
  }
}
