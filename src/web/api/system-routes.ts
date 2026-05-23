import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import type { ServiceRow } from '../../db/types.js';
import { kindToLegacyType, MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import { ORPHAN_MANAGED_GROUP_ID } from '../../db/service-ids.js';
import { ServiceInUseError, ServiceNotFoundError } from '../../errors.js';
import { createGitProvider } from '../../git-providers/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { getSystemStats, formatStatsSummary } from '../../monitor/stats.js';
import { detectReverseProxy, getProxyStatus, getLanIp, getAllIps } from '../../pipeline/traefik.js';
import { SERVICE_TEMPLATES, AVAILABLE_VERSIONS } from '../../pipeline/service-manager.js';

const log = createModuleLogger('api');
const MAX_SERVICE_LOG_LINES = 1_000;

function serviceNotFoundBody(id: string): { error: 'NOT_FOUND'; message: string } {
  return { error: 'NOT_FOUND', message: `Service not found: ${id}` };
}

/**
 * Map a canonical ServiceRow to the legacy wire shape expected by the
 * frontend (Service interface in web/src/lib/api/services.ts).
 *
 * After Phase C of migration 0012 drops `type`, `image`, `port`, `env_vars`
 * from the services table, those fields are undefined on the row. The frontend
 * still reads them for managed-service cards (ServicesPage, ServiceDetailV2,
 * ServiceConnectionTab). This mapper fills the legacy fields from the canonical
 * post-0012 equivalents so the wire contract stays stable through 1.x.
 *
 * Canonical → legacy mapping:
 *   kind        → type   (discriminator string)
 *   image_url   → image
 *   assigned_port → port
 *   env_vars repo (JSON.stringify) → env_vars
 */
type ServiceWire = Omit<ServiceRow, 'env_vars' | 'image' | 'port' | 'type'> & {
  type: string;
  image: string;
  port: number | null;
  env_vars: string | null;
  scope: 'project' | 'global';
  attached_project_id: string | null;
};

function toServiceWire(service: ServiceRow, envVars: Record<string, string>): ServiceWire {
  const isGlobal = service.project_id === ORPHAN_MANAGED_GROUP_ID;
  return {
    ...service,
    // v5.2: strip the internal `__svc` suffix so the wire-format name
    // matches what the topology + project services endpoints already emit.
    // The suffix is an artifact of the post-0009 service-id convention and
    // never belongs in human-facing surfaces.
    name: service.name.replace(/__svc$/, ''),
    type: service.type ?? kindToLegacyType(service.kind),
    image: service.image ?? service.image_url ?? '',
    port: service.port ?? service.assigned_port ?? null,
    env_vars:
      // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
      service.env_vars !== undefined
        ? // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
          service.env_vars
        : Object.keys(envVars).length > 0
          ? JSON.stringify(envVars)
          : null,
    scope: isGlobal ? 'global' : 'project',
    attached_project_id: isGlobal ? null : service.project_id,
  };
}

export function createSystemRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/repos', async (c) => {
    const ghConfig = ctx.config.gitProviders.github;
    if (!ghConfig.token) {
      return c.json(
        { error: 'GITHUB_NOT_CONFIGURED', message: 'No GitHub token. Add one in setup.' },
        400,
      );
    }
    const provider = createGitProvider('github', ghConfig);
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const visibility = (c.req.query('visibility') ?? 'all') as 'all' | 'public' | 'private';
    const result = await provider.listRepos({ page, perPage: 30, visibility });
    return c.json({
      count: result.repos.length,
      hasMore: result.hasMore,
      repos: result.repos,
    });
  });

  api.get('/repos/search', async (c) => {
    const ghConfig = ctx.config.gitProviders.github;
    if (!ghConfig.token) {
      return c.json(
        { error: 'GITHUB_NOT_CONFIGURED', message: 'No GitHub token. Add one in setup.' },
        400,
      );
    }
    const provider = createGitProvider('github', ghConfig);
    const query = c.req.query('q') ?? '';
    if (!query) {
      return c.json({ error: 'MISSING_FIELD', message: 'q (query) parameter is required' }, 400);
    }
    const result = await provider.searchRepos(query);
    return c.json({
      total: result.total,
      repos: result.repos,
    });
  });

  // --- System ---

  api.get('/system/stats', (c) => {
    const stats = getSystemStats();
    return c.json({
      summary: formatStatsSummary(stats),
      ...stats,
    });
  });

  api.get('/system/lan-ip', (c) => {
    const ip = getLanIp();
    const allIps = getAllIps();
    return c.json({ ip: ip ?? null, allIps });
  });

  // --- Server Status (v0.0.9) ---

  api.get('/server/status', async (c) => {
    try {
      // Get all containers
      const allContainers = await ctx.docker.listAllContainers();
      const managedContainers = allContainers.filter((c) => c.managedByOpenLander);
      const externalContainers = allContainers.filter((c) => !c.managedByOpenLander);

      // Get unique ports
      const portsSet = new Set<number>();
      for (const container of allContainers) {
        for (const port of container.ports) {
          if (port.PublicPort !== undefined) {
            portsSet.add(port.PublicPort);
          }
        }
      }

      // Detect reverse proxy
      const proxyDetection = await detectReverseProxy(ctx.docker);
      const proxyStatus = getProxyStatus(proxyDetection, 'managed');

      return c.json({
        containers: {
          total: allContainers.length,
          managed: managedContainers.length,
          external: externalContainers.length,
        },
        portsInUse: portsSet.size,
        proxy: {
          type: proxyDetection.type,
          status: proxyStatus,
          version: proxyDetection.version,
        },
        externalContainers: externalContainers.map((c) => ({
          name: c.name,
          image: c.image,
          ports: c.ports
            .filter((p): p is typeof p & { PublicPort: number } => p.PublicPort !== undefined)
            .map((p) => p.PublicPort),
        })),
      });
    } catch (err) {
      log.debug({ err }, 'Server status fetch failed');
      return c.json({
        containers: { total: 0, managed: 0, external: 0 },
        portsInUse: 0,
        proxy: { type: 'none', status: 'Unknown', version: undefined },
        externalContainers: [],
      });
    }
  });

  api.get('/services', async (c) => {
    try {
      // /managed-services UI surface. Pass kindIn into listWithCardSummary so
      // the Docker inspect+health fan-out only runs for the ~10 managed rows
      // instead of 30+ services (the post-filter approach in v5.2 still
      // inspected every container before discarding deployables — Codex perf
      // finding #1, 2026-04-30).
      const services = await ctx.serviceManager.listWithCardSummary({
        kindIn: MANAGED_SERVICE_KINDS,
      });
      const wire = await Promise.all(
        services.map(async (svc) => {
          const envVars = await ctx.db.getEnvVarsForService(svc.project_id, svc.id);
          return toServiceWire(svc, envVars);
        }),
      );
      return c.json(wire);
    } catch (err) {
      log.debug({ err }, 'List services failed');
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to list services' }, 500);
    }
  });

  api.get('/services/templates', (c) => {
    return c.json(
      Object.entries(SERVICE_TEMPLATES).map(([key, template]) => ({
        id: key,
        name: key.charAt(0).toUpperCase() + key.slice(1),
        image: template.image,
        port: template.port,
        versions: AVAILABLE_VERSIONS[key] ?? [],
      })),
    );
  });

  api.post('/services', async (c) => {
    try {
      const body = await c.req.json<{
        name?: string;
        template?: string;
        image?: string;
        port?: number;
        version?: string;
        env_vars?: Array<{ key: string; value: string }>;
      }>();

      if (!body.name) {
        return c.json({ error: 'MISSING_FIELD', message: 'name is required' }, 400);
      }

      if (!body.template && !body.image) {
        return c.json(
          { error: 'MISSING_FIELD', message: 'Either template or image is required' },
          400,
        );
      }

      if (body.template && body.image) {
        return c.json(
          { error: 'INVALID_FIELD', message: 'Provide either template or image, not both' },
          400,
        );
      }

      if (body.image && body.port === undefined) {
        return c.json(
          { error: 'MISSING_FIELD', message: 'port is required when using custom image' },
          400,
        );
      }

      const service = await ctx.serviceManager.create({
        name: body.name,
        template: body.template,
        image: body.image,
        port: body.port,
        version: body.version,
        envVars: body.env_vars,
      });
      const envVars = await ctx.db.getEnvVarsForService(service.project_id, service.id);
      return c.json(toServiceWire(service, envVars));
    } catch (err) {
      log.debug({ err }, 'Create service failed');
      const detail = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: 'INTERNAL_ERROR', message: detail || 'Failed to create service' },
        500,
      );
    }
  });

  api.get('/services/:id', async (c) => {
    const id = c.req.param('id');
    try {
      const service = await ctx.serviceManager.getDetail(id);
      const envVars = await ctx.db.getEnvVarsForService(service.project_id, service.id);
      return c.json(toServiceWire(service, envVars));
    } catch (err) {
      log.debug({ err, serviceId: id }, 'Get service detail failed');
      if (err instanceof ServiceNotFoundError) {
        return c.json(serviceNotFoundBody(id), 404);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch service detail' }, 500);
    }
  });

  api.get('/services/:id/logs', async (c) => {
    const id = c.req.param('id');
    const linesQuery = c.req.query('lines');
    const lines = linesQuery ? Number.parseInt(linesQuery, 10) : 100;
    if (!Number.isInteger(lines) || lines <= 0) {
      return c.json({ error: 'INVALID_FIELD', message: 'lines must be a positive integer' }, 400);
    }
    if (lines > MAX_SERVICE_LOG_LINES) {
      return c.json(
        {
          error: 'INVALID_FIELD',
          message: `lines must be at most ${String(MAX_SERVICE_LOG_LINES)}`,
        },
        400,
      );
    }

    try {
      const logs = await ctx.serviceManager.getLogs(id, lines);
      return c.json({ logs });
    } catch (err) {
      log.debug({ err, serviceId: id }, 'Get service logs failed');
      if (err instanceof ServiceNotFoundError) {
        return c.json(serviceNotFoundBody(id), 404);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch service logs' }, 500);
    }
  });

  api.get('/services/:id/stats', async (c) => {
    const id = c.req.param('id');
    try {
      const stats = await ctx.serviceManager.getStats(id);
      return c.json(stats);
    } catch (err) {
      log.debug({ err, serviceId: id }, 'Get service stats failed');
      if (err instanceof ServiceNotFoundError) {
        return c.json(serviceNotFoundBody(id), 404);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch service stats' }, 500);
    }
  });

  // Phase E_NEW Task 4: 3-state service health for v4 InfraMap nodes.
  // Reads from the same Docker inspect path as `/services/:id/stats`
  // (`ServiceManager.inspectServiceContainer`) and projects onto the
  // 3-state vocabulary the UI hook expects:
  //   container running + healthcheck `healthy`         → 'healthy'
  //   container running + healthcheck `unhealthy`/`starting` → 'crashed'
  //   container running + no healthcheck declared       → 'running'
  //   container not running / no container reference    → 404
  // The `'crashed'` mapping for `unhealthy`/`starting` matches the v4
  // ServiceHealth UI type's binary `'healthy' | 'crashed'` consumers
  // while preserving the third `'running'` slot for services without
  // an explicit healthcheck.
  // Phase E_NEW Task 5 — time-series sparkline data for the v4 service detail.
  // Returns 60 uniformly-downsampled datapoints regardless of range.
  // 204 when the service has no recorded samples yet (first-deploy or
  // recorder hasn't fired); the UI hook should treat 204 as "no data"
  // and keep a placeholder sparkline rather than showing an error.
  api.get('/services/:id/metrics', async (c) => {
    const id = c.req.param('id');

    const rangeParam = (c.req.query('range') ?? '1h') as '15m' | '1h' | '6h' | '24h' | '7d';
    const RANGE_MS: Record<string, number> = {
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };
    const windowMs: number = RANGE_MS[rangeParam] ?? RANGE_MS['1h'] ?? 3_600_000;

    try {
      const service = await ctx.db.getService(id);
      if (!service) {
        return c.json(serviceNotFoundBody(id), 404);
      }

      if (!(await ctx.db.hasAnyServiceMetrics(id))) {
        return new Response(null, { status: 204 });
      }

      const fromMs = Date.now() - windowMs;
      const rows = await ctx.db.listServiceMetricsSince(id, fromMs);

      if (rows.length === 0) {
        return new Response(null, { status: 204 });
      }

      const TARGET = 60;

      /**
       * Uniform downsample: bucket the rows into TARGET bins, average
       * within each bin. If rows < TARGET, pad with the last known value
       * so the sparkline always has exactly 60 points.
       */
      function downsample(values: number[]): number[] {
        if (values.length === 0) return new Array<number>(TARGET).fill(0);
        if (values.length >= TARGET) {
          const result: number[] = [];
          const binSize = values.length / TARGET;
          for (let i = 0; i < TARGET; i++) {
            const start = Math.floor(i * binSize);
            const end = Math.floor((i + 1) * binSize);
            const slice = values.slice(start, end);
            const avg = slice.reduce((s, v) => s + v, 0) / slice.length;
            result.push(Math.round(avg * 100) / 100);
          }
          return result;
        }
        // Fewer than 60 points — left-pad with the first value
        const firstValue = values[0] ?? 0;
        const padded = new Array<number>(TARGET - values.length).fill(firstValue).concat(values);
        return padded;
      }

      const cpuArr = rows.map((r) => r.cpu);
      const memArr = rows.map((r) => r.mem);
      const reqArr = rows.map((r) => r.req);
      const errArr = rows.map((r) => r.err);

      const p95Values = rows.map((r) => r.p95_latency_ms).filter((v): v is number => v !== null);
      const p95LatencyMs =
        p95Values.length > 0
          ? Math.round((p95Values.reduce((s, v) => s + v, 0) / p95Values.length) * 100) / 100
          : 0;

      const totalRequests = rows.reduce((s, r) => s + r.request_count, 0);

      return c.json({
        cpu: downsample(cpuArr),
        memory: downsample(memArr),
        requestsPerSec: downsample(reqArr),
        errorRate: downsample(errArr),
        p95LatencyMs,
        totalRequests,
      });
    } catch (err) {
      log.debug({ err, serviceId: id }, 'Get service metrics failed');
      if (err instanceof ServiceNotFoundError) {
        return c.json(serviceNotFoundBody(id), 404);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch service metrics' }, 500);
    }
  });

  api.get('/services/:id/health', async (c) => {
    const id = c.req.param('id');
    try {
      // Check DB state BEFORE docker inspection. During a redeploy the
      // owning project runtime status is flipped to `building` and may
      // briefly run a new container before the lifecycle finishes —
      // none of those steady-state probes tell us the deploy is
      // actually done. Surfacing `deploying` from the project row is
      // the only signal that matches the project list + /topology
      // vocab, so do that first and fall through to docker inspect
      // for the steady-state healthy/crashed projection.
      //
      // `ServiceRow.status` does not include `'building'` in the
      // current schema (see src/db/types.ts) — only the project row
      // carries the deploy lifecycle. If we ever widen
      // `ServiceRow.status` to include `'building'`, add the service
      // check back here.
      const service = await ctx.db.getService(id);
      const owningProject = service ? await ctx.db.getProject(service.project_id) : null;
      if (owningProject?.status === 'building') {
        return c.json({ health: 'deploying' });
      }

      const inspection = await ctx.serviceManager.getInspectionHealth(id);
      if (inspection.status !== 'running') {
        return c.json(
          { error: 'NOT_FOUND', message: `Service container is not running: ${id}` },
          404,
        );
      }

      // Phase 4 fix (Blocker 5): collapse to UI's 2-state vocabulary
      // (`healthy | crashed`). The 3-state intermediate `running` was
      // documented but the UI type + zod schema both reject it, so the
      // health contract test fails when a seeded container has no
      // HEALTHCHECK declared. Parity with /topology, which also lands
      // on `healthy | crashed`. (Plus `deploying` from the DB-status
      // check above — see PR widening the UI vocab.)
      //
      //   docker 'healthy'                  → UI 'healthy'
      //   docker 'starting' (start_period)  → UI 'healthy'  (grace window)
      //   docker null (no HEALTHCHECK)      → UI 'healthy'  (collapsed from 'running')
      //   docker 'unhealthy'                → UI 'crashed'
      const health: 'healthy' | 'crashed' =
        inspection.healthStatus === 'unhealthy' ? 'crashed' : 'healthy';

      return c.json({ health });
    } catch (err) {
      log.debug({ err, serviceId: id }, 'Get service health failed');
      if (err instanceof ServiceNotFoundError) {
        return c.json(serviceNotFoundBody(id), 404);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch service health' }, 500);
    }
  });

  api.get('/services/:id/connected-projects', async (c) => {
    const id = c.req.param('id');
    try {
      const projects = await ctx.serviceManager.getConnectedProjects(id);
      return c.json(projects);
    } catch (err) {
      log.debug({ err, serviceId: id }, 'Get connected projects failed');
      if (err instanceof ServiceNotFoundError) {
        return c.json(serviceNotFoundBody(id), 404);
      }
      return c.json(
        { error: 'INTERNAL_ERROR', message: 'Failed to fetch connected projects' },
        500,
      );
    }
  });

  api.get('/services/:id/databases', async (c) => {
    const id = c.req.param('id');
    try {
      const databases = await ctx.serviceManager.listDatabases(id);
      return c.json({ databases });
    } catch (err) {
      log.debug({ err, serviceId: id }, 'List service databases failed');
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ServiceNotFoundError) {
        return c.json(serviceNotFoundBody(id), 404);
      }
      if (message.includes('not supported')) {
        return c.json({ error: 'UNSUPPORTED_SERVICE_TYPE', message }, 400);
      }
      if (message.includes('Service container is not running')) {
        return c.json({ error: 'SERVICE_STOPPED', message }, 400);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to list service databases' }, 500);
    }
  });

  api.post('/services/:id/databases', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string }>();
    if (!body.name) {
      return c.json({ error: 'MISSING_FIELD', message: 'name is required' }, 400);
    }

    try {
      const result = await ctx.serviceManager.createDatabase(id, body.name);
      return c.json(result);
    } catch (err) {
      log.debug({ err, serviceId: id }, 'Create service database failed');
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ServiceNotFoundError) {
        return c.json(serviceNotFoundBody(id), 404);
      }
      if (message.includes('not supported')) {
        return c.json({ error: 'UNSUPPORTED_SERVICE_TYPE', message }, 400);
      }
      if (message.includes('Service container is not running')) {
        return c.json({ error: 'SERVICE_STOPPED', message }, 400);
      }
      if (message.includes('Invalid')) {
        return c.json({ error: 'INVALID_FIELD', message }, 400);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to create service database' }, 500);
    }
  });

  api.get('/services/:id/users', async (c) => {
    const id = c.req.param('id');
    try {
      const users = await ctx.serviceManager.listUsers(id);
      return c.json({ users });
    } catch (err) {
      log.debug({ err, serviceId: id }, 'List service users failed');
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ServiceNotFoundError) {
        return c.json(serviceNotFoundBody(id), 404);
      }
      if (message.includes('not supported')) {
        return c.json({ error: 'UNSUPPORTED_SERVICE_TYPE', message }, 400);
      }
      if (message.includes('Service container is not running')) {
        return c.json({ error: 'SERVICE_STOPPED', message }, 400);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to list service users' }, 500);
    }
  });

  api.post('/services/:id/users', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ username?: string; password?: string; database?: string }>();
    if (!body.username) {
      return c.json({ error: 'MISSING_FIELD', message: 'username is required' }, 400);
    }

    try {
      const result = await ctx.serviceManager.createUser(
        id,
        body.username,
        body.password,
        body.database ? { database: body.database } : undefined,
      );
      return c.json(result);
    } catch (err) {
      log.debug({ err, serviceId: id }, 'Create service user failed');
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ServiceNotFoundError) {
        return c.json(serviceNotFoundBody(id), 404);
      }
      if (message.includes('not supported')) {
        return c.json({ error: 'UNSUPPORTED_SERVICE_TYPE', message }, 400);
      }
      if (message.includes('Service container is not running')) {
        return c.json({ error: 'SERVICE_STOPPED', message }, 400);
      }
      if (message.includes('Invalid')) {
        return c.json({ error: 'INVALID_FIELD', message }, 400);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to create service user' }, 500);
    }
  });

  api.delete('/services/:id', async (c) => {
    const id = c.req.param('id');
    try {
      const result = await ctx.serviceManager.remove(id);
      return c.json({ status: 'removed', ...result });
    } catch (err) {
      log.debug({ err, serviceId: id }, 'Remove service failed');
      if (err instanceof ServiceInUseError) {
        const connectedProjects = Array.isArray(err.details?.['connectedProjects'])
          ? err.details['connectedProjects']
          : [];
        // Match the typed-error envelope while promoting connected_projects
        // to the top level so the web UI can disable destructive deletion
        // without parsing error details.
        return c.json(
          {
            error: err.code,
            code: err.code,
            message: err.message,
            connected_projects: connectedProjects,
          },
          409,
        );
      }
      if (err instanceof ServiceNotFoundError) {
        return c.json(
          { error: 'NOT_FOUND', code: 'NOT_FOUND', message: `Service not found: ${id}` },
          404,
        );
      }
      return c.json(
        {
          error: 'INTERNAL_ERROR',
          code: 'INTERNAL_ERROR',
          message: 'Failed to remove service',
        },
        500,
      );
    }
  });

  api.post('/services/:id/start', async (c) => {
    const id = c.req.param('id');
    try {
      await ctx.serviceManager.start(id);
      return c.json({ status: 'started' });
    } catch (err) {
      log.debug({ err, serviceId: id }, 'Start service failed');
      if (err instanceof ServiceNotFoundError) {
        return c.json(serviceNotFoundBody(id), 404);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to start service' }, 500);
    }
  });

  api.post('/services/:id/stop', async (c) => {
    const id = c.req.param('id');
    try {
      await ctx.serviceManager.stop(id);
      return c.json({ status: 'stopped' });
    } catch (err) {
      log.debug({ err, serviceId: id }, 'Stop service failed');
      if (err instanceof ServiceNotFoundError) {
        return c.json(serviceNotFoundBody(id), 404);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to stop service' }, 500);
    }
  });

  // --- Alerts ---

  api.get('/alerts', (c) => {
    const alerts = ctx.alertMonitor.getActiveAlerts();
    return c.json({ alerts });
  });

  api.post('/alerts/:id/dismiss', (c) => {
    const alertId = c.req.param('id');
    ctx.alertMonitor.dismissAlert(alertId);
    return c.json({ success: true });
  });

  return api;
}
