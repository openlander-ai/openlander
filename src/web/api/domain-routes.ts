import { Hono } from 'hono';

import type { Database } from '../../db/index.js';
import type { CloudflareTunnelManager } from '../../pipeline/cloudflare.js';
import type { TraefikManager } from '../../pipeline/traefik.js';

interface DomainRouteContext {
  db: Database;
  cloudflare: CloudflareTunnelManager;
  traefik: TraefikManager;
}

export function createDomainRoutes(ctx: DomainRouteContext): Hono {
  const routes = new Hono();

  routes.post('/projects/:id/domains', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${id}` }, 404);
    }

    const body = await c.req.json<{ domain?: string }>();
    if (!body.domain) {
      return c.json({ error: 'MISSING_FIELD', message: 'domain is required' }, 400);
    }

    const domain = normalizeDomainParam(body.domain);

    // Ensure Traefik has File Provider before adding domain routes
    try {
      await ctx.traefik.start();
    } catch {
      /* startup handles errors */
    }

    try {
      await ctx.cloudflare.createTunnel(project.id, domain);
      const mappings = ctx.cloudflare.listDomains(project.id);
      return c.json(
        {
          status: 'mapped',
          projectId: project.id,
          domain,
          totalDomains: mappings.length,
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'DOMAIN_CREATE_FAILED', message }, 400);
    }
  });

  routes.delete('/projects/:id/domains/:domain', async (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${id}` }, 404);
    }

    const domainParam = decodeURIComponent(c.req.param('domain'));
    const domain = normalizeDomainParam(domainParam);

    try {
      await ctx.cloudflare.removeTunnel(project.id, domain);
      const mappings = ctx.cloudflare.listDomains(project.id);
      return c.json({
        status: 'unmapped',
        projectId: project.id,
        domain,
        totalDomains: mappings.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'DOMAIN_DELETE_FAILED', message }, 400);
    }
  });

  routes.get('/projects/:id/domains', (c) => {
    const id = c.req.param('id');
    const project = ctx.db.getProject(id) ?? ctx.db.getProjectByName(id);
    if (!project) {
      return c.json({ error: 'NOT_FOUND', message: `Project not found: ${id}` }, 404);
    }

    const domains = ctx.cloudflare.listDomains(project.id);
    return c.json({
      projectId: project.id,
      count: domains.length,
      domains,
    });
  });

  return routes;
}

function normalizeDomainParam(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^\*\./, '')
    .replace(/\.$/, '');
}
