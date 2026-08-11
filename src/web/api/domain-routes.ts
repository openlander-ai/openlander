import { Hono } from 'hono';
import type { Context } from 'hono';
import { nanoid } from 'nanoid';
import { domainToASCII } from 'node:url';

import type { AppContext } from '../../app.js';
import type { DomainMappingRow, ProjectRow, ServiceRow } from '../../db/index.js';
import { MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import type { OpenLanderError } from '../../errors.js';
import { ServiceNotFoundError, ServiceSelectionRequiredError } from '../../errors.js';
import {
  normalizeDomainHost,
  normalizeDomainPathPrefix,
} from '../../db/repos/domain-mapping.repo.js';
import {
  getManagedPublicDomainProvider,
  isManagedPublicDomainMapping,
} from '../../pipeline/public-domain-ownership.js';
import { resolveProject } from './helpers/deployable-service-route-shared.js';

interface DomainRouteContext {
  config: AppContext['config'];
  db: AppContext['db'];
}

type DomainBody = {
  domain?: unknown;
  pathPrefix?: unknown;
  path_prefix?: unknown;
  stripPrefix?: unknown;
  strip_prefix?: unknown;
  upstreamPathPrefix?: unknown;
  upstream_path_prefix?: unknown;
  targetPort?: unknown;
  target_port?: unknown;
};

type ParsedDomainBody = {
  domain: string;
  pathPrefix: string;
  stripPrefix: boolean;
  upstreamPathPrefix: string | null;
  targetPort: number | null;
};

const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_LITERAL_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const MANAGED_SERVICE_KIND_SET = new Set<string>(MANAGED_SERVICE_KINDS);

export function createDomainRoutes(ctx: DomainRouteContext): Hono {
  const routes = new Hono();

  routes.get('/projects/:p/services/:s/domains', async (c) => {
    const resolved = await resolveService(c, ctx);
    if (resolved instanceof Response) return resolved;

    const domains = await listManualDomainMappingsForService(
      ctx,
      resolved.project.id,
      resolved.service.id,
    );
    return c.json({
      projectId: resolved.project.id,
      serviceId: resolved.service.id,
      count: domains.length,
      domains: domains.map(mapDomainMapping),
    });
  });

  routes.post('/projects/:p/services/:s/domains', async (c) => {
    const resolved = await resolveService(c, ctx);
    if (resolved instanceof Response) return resolved;
    return createDomainMappingResponse(c, ctx, resolved.project, resolved.service);
  });

  routes.delete('/projects/:p/services/:s/domains/:idOrDomain', async (c) => {
    const resolved = await resolveService(c, ctx);
    if (resolved instanceof Response) return resolved;
    return deleteDomainMappingResponse(c, ctx, resolved.project, resolved.service);
  });

  routes.get('/projects/:id/domains', async (c) => {
    const project = await resolveProjectForRoute(c, ctx, c.req.param('id'));
    if (project instanceof Response) return project;

    const [deployables, allDomains, publicAccess] = await Promise.all([
      ctx.db.getDeployablesByGroup(project.id),
      ctx.db.listDomainMappings(),
      ctx.db.getProjectPublicAccess(project.id),
    ]);
    const deployableIds = new Set(deployables.map((service) => service.id));
    const managedMappingIds = connectedPublishMappingIds(publicAccess?.domain_mapping_id);
    const domains = allDomains.filter(
      (mapping) =>
        deployableIds.has(mapping.service_id) &&
        !isManagedPublicDomainMapping(mapping.id, managedMappingIds),
    );

    return c.json({
      projectId: project.id,
      count: domains.length,
      domains: domains.map(mapDomainMapping),
    });
  });

  routes.post('/projects/:id/domains', async (c) => {
    const project = await resolveProjectForRoute(c, ctx, c.req.param('id'));
    if (project instanceof Response) return project;

    const service = await resolveSingleDeployable(c, ctx, project);
    if (service instanceof Response) return service;
    return createDomainMappingResponse(c, ctx, project, service);
  });

  routes.delete('/projects/:id/domains/:idOrDomain', async (c) => {
    const project = await resolveProjectForRoute(c, ctx, c.req.param('id'));
    if (project instanceof Response) return project;

    const service = await resolveSingleDeployable(c, ctx, project);
    if (service instanceof Response) return service;
    return deleteDomainMappingResponse(c, ctx, project, service);
  });

  return routes;
}

async function createDomainMappingResponse(
  c: Context,
  ctx: DomainRouteContext,
  project: ProjectRow,
  service: ServiceRow,
): Promise<Response> {
  if (ctx.config.traefik.mode === 'external') {
    return c.json(
      {
        error: 'DOMAIN_ROUTING_DISABLED',
        code: 'DOMAIN_ROUTING_DISABLED',
        message: 'Domain routing writes are disabled while Traefik is in external mode.',
      },
      409,
    );
  }

  const parsed = await parseDomainBody(c);
  if (parsed instanceof Response) return parsed;

  const existing = await ctx.db.findDomainMappingByHostAndPath(parsed.domain, parsed.pathPrefix);
  if (existing) {
    return c.json(
      {
        error: 'DOMAIN_ROUTE_EXISTS',
        code: 'DOMAIN_ROUTE_EXISTS',
        message: `Domain route already exists for ${parsed.domain}${parsed.pathPrefix}`,
        details: { id: existing.id, domain: existing.domain, pathPrefix: existing.path_prefix },
      },
      409,
    );
  }

  const mapping = await ctx.db.createDomainMappingForService({
    id: nanoid(16),
    serviceId: service.id,
    domain: parsed.domain,
    status: 'active',
    pathPrefix: parsed.pathPrefix,
    stripPrefix: parsed.stripPrefix,
    upstreamPathPrefix: parsed.upstreamPathPrefix,
    targetPort: parsed.targetPort,
    tlsEnabled: null,
    tlsResolver: null,
  });
  const domains = await listManualDomainMappingsForService(ctx, project.id, service.id);

  return c.json(
    {
      status: 'mapped',
      projectId: project.id,
      serviceId: service.id,
      domain: mapDomainMapping(mapping),
      totalDomains: domains.length,
    },
    201,
  );
}

async function deleteDomainMappingResponse(
  c: Context,
  ctx: DomainRouteContext,
  project: ProjectRow,
  service: ServiceRow,
): Promise<Response> {
  const [resolvedMapping, publicAccess] = await Promise.all([
    resolveDomainMappingForDelete(ctx, service.id, c.req.param('idOrDomain') ?? ''),
    ctx.db.getProjectPublicAccess(project.id),
  ]);
  if (!resolvedMapping) {
    return c.json({ error: 'NOT_FOUND', message: 'Domain mapping not found' }, 404);
  }

  const provider = getManagedPublicDomainProvider(
    resolvedMapping.mapping.id,
    connectedPublishMappingIds(publicAccess?.domain_mapping_id),
  );
  if (provider) {
    return c.json(
      {
        error: 'DOMAIN_MANAGED_BY_PUBLIC_ACCESS',
        code: 'DOMAIN_MANAGED_BY_PUBLIC_ACCESS',
        message:
          'This domain is managed by public sharing. Turn off public access instead of deleting its route.',
        details: {
          projectId: project.id,
          serviceId: service.id,
          domain: resolvedMapping.mapping.domain,
          provider,
          action: 'unexpose_public',
        },
      },
      409,
    );
  }

  await ctx.db.deleteDomainMapping(resolvedMapping.mapping.id);
  const domains = await listManualDomainMappingsForService(ctx, project.id, service.id);
  return c.json({
    status: 'unmapped',
    projectId: project.id,
    serviceId: service.id,
    domain: mapDomainMapping(resolvedMapping.mapping),
    usedLegacyFallback: resolvedMapping.usedLegacyFallback,
    totalDomains: domains.length,
  });
}

function connectedPublishMappingIds(mappingId: string | null | undefined): ReadonlySet<string> {
  return mappingId ? new Set([mappingId]) : new Set();
}

async function listManualDomainMappingsForService(
  ctx: DomainRouteContext,
  projectId: string,
  serviceId: string,
): Promise<DomainMappingRow[]> {
  const [mappings, publicAccess] = await Promise.all([
    ctx.db.listDomainMappingsForService(serviceId),
    ctx.db.getProjectPublicAccess(projectId),
  ]);
  const managedMappingIds = connectedPublishMappingIds(publicAccess?.domain_mapping_id);
  return mappings.filter((mapping) => !isManagedPublicDomainMapping(mapping.id, managedMappingIds));
}

async function resolveProjectForRoute(
  c: Context,
  ctx: DomainRouteContext,
  projectParam: string,
): Promise<ProjectRow | Response> {
  const project = await resolveProject(ctx as AppContext, projectParam);
  if (!project) {
    return c.json({ error: 'NOT_FOUND', message: `Project not found: ${projectParam}` }, 404);
  }
  return project;
}

async function resolveService(
  c: Context,
  ctx: DomainRouteContext,
): Promise<{ project: ProjectRow; service: ServiceRow } | Response> {
  const projectParam = c.req.param('p') ?? '';
  const serviceParam = c.req.param('s') ?? '';
  const project = await resolveProjectForRoute(c, ctx, projectParam);
  if (project instanceof Response) return project;

  const service = await ctx.db.getService(serviceParam);
  if (!service || service.project_id !== project.id) {
    return c.json({ error: 'NOT_FOUND', message: `Service not found: ${serviceParam}` }, 404);
  }
  if (isManagedService(service)) {
    return c.json(
      {
        error: 'INVALID_SERVICE_KIND',
        code: 'INVALID_SERVICE_KIND',
        message: 'Managed infrastructure services cannot accept custom domains.',
      },
      400,
    );
  }
  return { project, service };
}

async function resolveSingleDeployable(
  c: Context,
  ctx: DomainRouteContext,
  project: ProjectRow,
): Promise<ServiceRow | Response> {
  const deployables = (await ctx.db.getDeployablesByGroup(project.id)).filter(
    (service) => !isManagedService(service),
  );
  const singleDeployable = deployables[0];
  if (deployables.length === 1 && singleDeployable) {
    return singleDeployable;
  }
  if (deployables.length === 0) {
    const error = new ServiceNotFoundError(project.name);
    return openLanderErrorResponse(c, error);
  }
  const error = new ServiceSelectionRequiredError(
    project.id,
    project.name,
    deployables.map((service) => ({
      serviceId: service.id,
      serviceName: service.name,
      kind: service.kind,
      source: service.source,
    })),
  );
  return openLanderErrorResponse(c, error);
}

function openLanderErrorResponse(c: Context, error: OpenLanderError): Response {
  return c.json(error.toJSON(), error.statusCode as 400);
}

function isManagedService(service: ServiceRow): boolean {
  return MANAGED_SERVICE_KIND_SET.has(service.kind);
}

async function parseDomainBody(c: Context): Promise<ParsedDomainBody | Response> {
  const body = await c.req.json<DomainBody>().catch((): DomainBody => ({}));
  const domainValue = body.domain;
  if (typeof domainValue !== 'string' || domainValue.trim().length === 0) {
    return c.json({ error: 'MISSING_FIELD', message: 'domain is required' }, 400);
  }

  const domain = parseDomainHost(domainValue);
  if (!domain.ok) {
    return c.json({ error: 'INVALID_FIELD', message: domain.message }, 400);
  }

  const rawPathPrefix = body.pathPrefix ?? body.path_prefix;
  const pathPrefix = parsePathPrefix(rawPathPrefix, 'pathPrefix');
  if (!pathPrefix.ok) {
    return c.json({ error: 'INVALID_FIELD', message: pathPrefix.message }, 400);
  }

  const rawUpstream = body.upstreamPathPrefix ?? body.upstream_path_prefix;
  const upstreamPathPrefix = parseNullablePathPrefix(rawUpstream, 'upstreamPathPrefix');
  if (!upstreamPathPrefix.ok) {
    return c.json({ error: 'INVALID_FIELD', message: upstreamPathPrefix.message }, 400);
  }

  const rawStrip = body.stripPrefix ?? body.strip_prefix;
  if (rawStrip !== undefined && typeof rawStrip !== 'boolean') {
    return c.json({ error: 'INVALID_FIELD', message: 'stripPrefix must be a boolean' }, 400);
  }

  const targetPort = parseTargetPort(body.targetPort ?? body.target_port);
  if (!targetPort.ok) {
    return c.json({ error: 'INVALID_FIELD', message: targetPort.message }, 400);
  }

  return {
    domain: domain.value,
    pathPrefix: pathPrefix.value,
    stripPrefix: rawStrip ?? false,
    upstreamPathPrefix: upstreamPathPrefix.value,
    targetPort: targetPort.value,
  };
}

function parseDomainHost(
  value: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const raw = value.trim().toLowerCase();
  if (/^https?:\/\//i.test(raw) || raw.includes('/') || raw.includes('?') || raw.includes('#')) {
    return { ok: false, message: 'domain must be a host name, not a URL' };
  }
  if (raw.includes('*')) {
    return { ok: false, message: 'wildcard domains are not supported in v0.1' };
  }
  if (IPV4_LITERAL_RE.test(raw)) {
    return { ok: false, message: 'IP addresses are not valid domain hosts' };
  }
  if (raw.includes(':')) {
    return { ok: false, message: 'domain must not include a port or IP address' };
  }

  const asciiDomain = domainToASCII(raw);
  const domain = normalizeDomainHost(asciiDomain);
  if (domain.length === 0 || domain.length > 253 || domain.includes('..')) {
    return { ok: false, message: 'domain is invalid' };
  }

  const labels = domain.split('.');
  if (labels.length < 2 || domain === 'localhost' || domain.endsWith('.localhost')) {
    return {
      ok: false,
      message: 'domain must be a public DNS host, not localhost or a single-label name',
    };
  }
  if (domain.endsWith('.local')) {
    return {
      ok: false,
      message:
        '.local is reserved for mDNS/Bonjour; use public DNS or sslip.io-style hostnames in v0.1',
    };
  }
  if (labels.some((label) => !DOMAIN_LABEL_RE.test(label))) {
    return { ok: false, message: 'domain contains an invalid label' };
  }
  return { ok: true, value: domain };
}

function parsePathPrefix(
  value: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; message: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: '/' };
  }
  if (typeof value !== 'string') {
    return { ok: false, message: `${field} must be a string` };
  }
  if (value.includes('?') || value.includes('#')) {
    return { ok: false, message: `${field} must not include query or hash segments` };
  }
  return { ok: true, value: normalizeDomainPathPrefix(value) };
}

function parseNullablePathPrefix(
  value: unknown,
  field: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  const parsed = parsePathPrefix(value, field);
  return parsed.ok ? { ok: true, value: parsed.value } : parsed;
}

function parseTargetPort(
  value: unknown,
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
    return { ok: false, message: 'targetPort must be an integer between 1 and 65535' };
  }
  return { ok: true, value };
}

async function resolveDomainMappingForDelete(
  ctx: DomainRouteContext,
  serviceId: string,
  idOrDomainParam: string,
): Promise<{ mapping: DomainMappingRow; usedLegacyFallback: boolean } | null> {
  const idOrDomain = decodeURIComponent(idOrDomainParam);
  const mappings = await ctx.db.listDomainMappingsForService(serviceId);
  const byId = mappings.find((mapping) => mapping.id === idOrDomain);
  if (byId) {
    return { mapping: byId, usedLegacyFallback: false };
  }

  const parsedDomain = parseDomainHost(idOrDomain);
  if (!parsedDomain.ok) {
    return null;
  }
  const legacyRootMapping = mappings.find(
    (mapping) => mapping.domain === parsedDomain.value && mapping.path_prefix === '/',
  );
  return legacyRootMapping ? { mapping: legacyRootMapping, usedLegacyFallback: true } : null;
}

function mapDomainMapping(mapping: DomainMappingRow): Record<string, unknown> {
  return {
    id: mapping.id,
    domain: mapping.domain,
    hostname: mapping.domain,
    serviceId: mapping.service_id,
    projectId: mapping.project_id,
    status: mapping.status,
    pathPrefix: mapping.path_prefix,
    stripPrefix: mapping.strip_prefix,
    upstreamPathPrefix: mapping.upstream_path_prefix,
    targetPort: mapping.target_port,
    tls: {
      enabled: mapping.tls_enabled === true,
      resolver: mapping.tls_resolver,
      status: mapping.tls_enabled === true ? 'unknown' : 'absent',
    },
    legacyWarning:
      mapping.cloudflare_zone_id || mapping.cloudflare_dns_record_id
        ? 'legacy_cloudflare_metadata_present'
        : null,
    createdAt: mapping.created_at,
    updatedAt: mapping.updated_at,
  };
}
