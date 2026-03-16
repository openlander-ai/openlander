import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { createGitProvider } from '../../git-providers/index.js';
import { createModuleLogger } from '../../lib/logger.js';
import { getSystemStats, formatStatsSummary } from '../../monitor/stats.js';
import { detectReverseProxy, getProxyStatus, getLanIp, getAllIps } from '../../pipeline/traefik.js';
import { SERVICE_TEMPLATES } from '../../pipeline/service-manager.js';

const log = createModuleLogger('api');

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
      const services = await ctx.serviceManager.list();
      return c.json(services);
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
        envVars: body.env_vars,
      });
      return c.json(service);
    } catch (err) {
      log.debug({ err }, 'Create service failed');
      const detail = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: 'INTERNAL_ERROR', message: detail || 'Failed to create service' },
        500,
      );
    }
  });

  api.delete('/services/:id', async (c) => {
    const id = c.req.param('id');
    try {
      await ctx.serviceManager.remove(id);
      return c.json({ status: 'removed' });
    } catch (err) {
      log.debug({ err, serviceId: id }, 'Remove service failed');
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Service not found')) {
        return c.json({ error: 'NOT_FOUND', message: `Service not found: ${id}` }, 404);
      }
      return c.json({ error: 'INTERNAL_ERROR', message: 'Failed to remove service' }, 500);
    }
  });

  api.post('/services/:id/start', async (c) => {
    const id = c.req.param('id');
    try {
      await ctx.serviceManager.start(id);
      return c.json({ status: 'started' });
    } catch (err) {
      log.debug({ err, serviceId: id }, 'Start service failed');
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Service not found')) {
        return c.json({ error: 'NOT_FOUND', message: `Service not found: ${id}` }, 404);
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
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Service not found')) {
        return c.json({ error: 'NOT_FOUND', message: `Service not found: ${id}` }, 404);
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
