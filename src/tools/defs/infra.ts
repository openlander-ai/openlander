import {
  OpenLanderError,
  ProjectNotFoundError,
  ServiceNotFoundError,
  ServiceSelectionRequiredError,
} from '../../errors.js';
import { MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import {
  normalizeDomainHost,
  normalizeDomainPathPrefix,
} from '../../db/repos/domain-mapping.repo.js';
import { analyzeInfrastructure } from '../../lib/infra-analyzer.js';
import { cloneRepo } from '../../pipeline/git.js';
import type { ToolDef } from './types.js';
import type { ToolContext } from './types.js';
import {
  addDomainRouteSchema,
  analyzeInfrastructureSchema,
  listDomainRoutesSchema,
} from './schemas.js';
import { nanoid } from 'nanoid';
import { domainToASCII } from 'node:url';

type AppCtx = ToolContext['appCtx'];
type ServiceRow = NonNullable<Awaited<ReturnType<AppCtx['db']['getService']>>>;
type ProjectRow = NonNullable<Awaited<ReturnType<AppCtx['db']['getProject']>>>;

const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4_LITERAL_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isManagedService(kind: string): boolean {
  return (MANAGED_SERVICE_KINDS as readonly string[]).includes(kind);
}

function serviceSelectionCandidates(services: ServiceRow[]) {
  return services.map((service) => ({
    serviceId: service.id,
    serviceName: service.name,
    projectId: service.project_id,
    kind: service.kind,
    source: service.source,
  }));
}

async function resolveProject(
  appCtx: AppCtx,
  projectName: string | undefined,
  projectId?: string,
): Promise<ProjectRow | undefined> {
  if (projectId) return (await appCtx.db.getProject(projectId)) ?? undefined;
  if (!projectName) return undefined;
  return (
    (await appCtx.db.getProject(projectName)) ?? (await appCtx.db.getProjectByName(projectName))
  );
}

async function resolveDomainServiceTarget(
  appCtx: AppCtx,
  args: Record<string, unknown>,
): Promise<{ service: ServiceRow; project: ProjectRow }> {
  const serviceId = typeof args['service_id'] === 'string' ? args['service_id'].trim() : '';
  const serviceName = typeof args['service_name'] === 'string' ? args['service_name'].trim() : '';
  const projectId = typeof args['project_id'] === 'string' ? args['project_id'].trim() : '';
  const projectName = typeof args['project_name'] === 'string' ? args['project_name'].trim() : '';

  if (serviceId) {
    const service = await appCtx.db.getService(serviceId);
    if (!service || isManagedService(service.kind)) {
      throw new ServiceNotFoundError(serviceId);
    }
    const project = await appCtx.db.getProject(service.project_id);
    if (!project) {
      throw new ProjectNotFoundError(service.project_id);
    }
    return { service, project };
  }

  const project = await resolveProject(appCtx, projectName, projectId);
  if ((projectId || projectName) && !project) {
    throw new ProjectNotFoundError(projectId || projectName);
  }

  if (serviceName) {
    const services = (await appCtx.db.listServices()).filter(
      (service) =>
        service.name === serviceName &&
        !isManagedService(service.kind) &&
        (!project || service.project_id === project.id),
    );
    if (services.length > 1) {
      throw new OpenLanderError(
        `Multiple deployable services named '${serviceName}' found. Specify service_id or project_name.`,
        'SERVICE_SELECTION_REQUIRED',
        400,
        { serviceName, candidates: serviceSelectionCandidates(services) },
      );
    }
    const service = services[0];
    if (!service) {
      throw new ServiceNotFoundError(
        projectName ? `${serviceName} in ${projectName}` : serviceName,
      );
    }
    const owningProject = project ?? (await appCtx.db.getProject(service.project_id));
    if (!owningProject) {
      throw new ProjectNotFoundError(service.project_id);
    }
    return { service, project: owningProject };
  }

  if (!project) {
    throw new ProjectNotFoundError(projectName || 'unknown');
  }

  const deployables = await appCtx.db.getDeployablesByGroup(project.id);
  if (deployables.length !== 1) {
    throw new ServiceSelectionRequiredError(
      project.id,
      project.name,
      serviceSelectionCandidates(deployables),
    );
  }
  const service = deployables[0];
  if (!service) {
    throw new ServiceNotFoundError(project.name);
  }
  return { service, project };
}

function parseDomainHostForRoute(value: unknown): string {
  if (typeof value !== 'string') {
    throw new OpenLanderError('domain must be a string', 'INVALID_HOST', 400, { field: 'domain' });
  }

  const raw = value.trim().toLowerCase();
  if (/^https?:\/\//i.test(raw) || raw.includes('/') || raw.includes('?') || raw.includes('#')) {
    throw new OpenLanderError('domain must be a host name, not a URL', 'INVALID_HOST', 400, {
      field: 'domain',
    });
  }
  if (raw.includes('*')) {
    throw new OpenLanderError('wildcard domains are not supported in v0.1', 'INVALID_HOST', 400, {
      field: 'domain',
    });
  }
  if (IPV4_LITERAL_RE.test(raw) || raw.includes(':')) {
    throw new OpenLanderError(
      'IP addresses and ports are not valid domain hosts',
      'INVALID_HOST',
      400,
      {
        field: 'domain',
      },
    );
  }

  const domain = normalizeDomainHost(domainToASCII(raw));
  if (domain.length === 0 || domain.length > 253 || domain.includes('..')) {
    throw new OpenLanderError('domain is invalid', 'INVALID_HOST', 400, { field: 'domain' });
  }

  const labels = domain.split('.');
  if (labels.length < 2 || domain === 'localhost' || domain.endsWith('.localhost')) {
    throw new OpenLanderError(
      'domain must be a public DNS host, not localhost or a single-label name',
      'INVALID_HOST',
      400,
      { field: 'domain' },
    );
  }
  if (domain.endsWith('.local')) {
    throw new OpenLanderError(
      '.local is reserved for mDNS/Bonjour; use public DNS or sslip.io-style hostnames in v0.1',
      'INVALID_HOST',
      400,
      { field: 'domain' },
    );
  }
  if (labels.some((label) => !DOMAIN_LABEL_RE.test(label))) {
    throw new OpenLanderError('domain contains an invalid label', 'INVALID_HOST', 400, {
      field: 'domain',
    });
  }

  return domain;
}

function parsePathPrefixForRoute(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (value === undefined || value === null) return '/';
  if (typeof value !== 'string') {
    throw new OpenLanderError(`${key} must be a string`, 'INVALID_PATH', 400, { field: key });
  }
  if (value.includes('?') || value.includes('#')) {
    throw new OpenLanderError(
      `${key} must not include query or hash segments`,
      'INVALID_PATH',
      400,
      {
        field: key,
      },
    );
  }
  return normalizeDomainPathPrefix(value);
}

function parseNullablePathPrefixForRoute(
  args: Record<string, unknown>,
  key: string,
): string | null {
  const value = args[key];
  if (value === undefined || value === null || value === '') return null;
  return parsePathPrefixForRoute(args, key);
}

function mapRoute(mapping: Awaited<ReturnType<AppCtx['db']['createDomainMappingForService']>>) {
  return {
    id: mapping.id,
    service_id: mapping.service_id,
    domain: mapping.domain,
    path_prefix: mapping.path_prefix,
    strip_prefix: mapping.strip_prefix,
    upstream_path_prefix: mapping.upstream_path_prefix ?? '/',
    target_port: mapping.target_port ?? null,
    status: mapping.status,
    tls: {
      managed_by_openlander: false,
    },
  };
}

export const infraToolDefs: ToolDef[] = [
  {
    name: 'add_domain_route',
    riskLevel: 'medium',
    description:
      'Register an internal Traefik Host/path route for a domain that already points to the OpenLander host or reverse proxy. This does not create DNS records, Cloudflare tunnels, ngrok endpoints, or TLS certificates. No redeploy is required. Prefer service_id; project_id/project_name works only when the group has exactly one deployable service. Returns { status: "route_registered", route, routing, urls }. Errors: DOMAIN_ROUTING_DISABLED, DOMAIN_ROUTE_EXISTS, PROJECT_NOT_FOUND, SERVICE_NOT_FOUND, SERVICE_SELECTION_REQUIRED.',
    mcpDescription:
      'Register a Traefik Host/path route for a domain that already points at OpenLander. Does not manage DNS, tunnels, or TLS.',
    inputSchema: addDomainRouteSchema,
    execute: async (args, { appCtx }) => {
      if (appCtx.config.traefik.mode === 'external') {
        throw new OpenLanderError(
          'Domain routing writes are disabled while Traefik is in external mode.',
          'DOMAIN_ROUTING_DISABLED',
          409,
        );
      }

      const domain = parseDomainHostForRoute(args['domain']);
      const pathPrefix = parsePathPrefixForRoute(args, 'path_prefix');
      const upstreamPathPrefix = parseNullablePathPrefixForRoute(args, 'upstream_path_prefix');
      const stripPrefix = args['strip_prefix'] === true;
      const targetPort = (args['target_port'] as number | undefined) ?? null;
      const { project, service } = await resolveDomainServiceTarget(appCtx, args);

      const existing = await appCtx.db.findDomainMappingByHostAndPath(domain, pathPrefix);
      if (existing) {
        throw new OpenLanderError(
          `Domain route already exists for ${domain}${pathPrefix}`,
          'DOMAIN_ROUTE_EXISTS',
          409,
          { id: existing.id, domain: existing.domain, pathPrefix: existing.path_prefix },
        );
      }

      const mapping = await appCtx.db.createDomainMappingForService({
        id: nanoid(16),
        serviceId: service.id,
        domain,
        status: 'active',
        pathPrefix,
        stripPrefix,
        upstreamPathPrefix,
        targetPort,
        tlsEnabled: null,
        tlsResolver: null,
      });

      return {
        status: 'route_registered',
        project: { id: project.id, name: project.name },
        service: { id: service.id, name: service.name },
        route: mapRoute(mapping),
        routing: {
          backend: 'traefik_http_provider',
          config_endpoint: '/api/traefik/config',
          expected_rule:
            pathPrefix === '/'
              ? `Host(\`${domain}\`)`
              : `Host(\`${domain}\`) && PathPrefix(\`${pathPrefix}\`)`,
          docker_labels_expected: false,
          requires_redeploy: false,
          expected_propagation_seconds: 5,
        },
        urls: {
          http: `http://${domain}${pathPrefix === '/' ? '' : pathPrefix}`,
          https: `https://${domain}${pathPrefix === '/' ? '' : pathPrefix}`,
        },
        _agent_guidance: {
          next_steps: [
            'No redeploy is required; domain routing is dynamic.',
            'DNS, Cloudflare Tunnel, ngrok, reverse proxy, and TLS must be configured outside OpenLander in v0.1.',
            'If this hostname is served through Cloudflare Zero Trust Tunnel, add the same hostname as a Public Hostname in the Cloudflare dashboard and point it at the OpenLander Traefik entrypoint.',
            'Wait a few seconds for Traefik to poll /api/traefik/config before probing the domain.',
            'Do not use Docker labels to verify custom domains; Docker labels only show automatic localhost routes.',
            'If OTHER services reference this service in NEXT_PUBLIC_* env vars (client-side/browser), update those vars to the new public URL and redeploy those services.',
            'Do NOT change server-side env vars like API_URL, DATABASE_URL, etc. — these use internal Docker DNS (http://ol-{name}:{port}) which is faster and must stay internal.',
          ],
          warning:
            'This only registers an internal Traefik route for a Host/path already reaching OpenLander port 80. It does not create DNS records, Cloudflare routes, ngrok endpoints, or TLS certificates.',
        },
      };
    },
  },
  {
    name: 'list_domain_routes',
    riskLevel: 'low',
    description:
      'List registered domain routes. With no target, lists routes across all projects. With service_id/service_name/project_id/project_name, lists routes for that deployable service. These are internal Traefik routes; DNS/tunnel/TLS are external prerequisites.',
    mcpDescription: 'List registered domain routes. These do not imply DNS/tunnel/TLS ownership.',
    inputSchema: listDomainRoutesSchema,
    execute: async (args, { appCtx }) => {
      const hasTarget =
        typeof args['service_id'] === 'string' ||
        typeof args['service_name'] === 'string' ||
        typeof args['project_id'] === 'string' ||
        typeof args['project_name'] === 'string';
      const mappings = hasTarget
        ? await appCtx.db.listDomainMappingsForService(
            (await resolveDomainServiceTarget(appCtx, args)).service.id,
          )
        : await appCtx.db.listDomainMappings();
      return Promise.resolve({
        count: mappings.length,
        routes: mappings.map(mapRoute),
        routing: {
          backend: 'traefik_http_provider',
          config_endpoint: '/api/traefik/config',
          docker_labels_expected: false,
        },
      });
    },
  },
  {
    name: 'analyze_infrastructure',
    riskLevel: 'low',
    description:
      'Analyze a repository to detect infrastructure needs (databases, caches, etc.) based on dependencies and environment variables. Clones the repo, scans package.json and .env files, and cross-references with existing services. Returns { needs, available, missing } where needs is detected infrastructure, available is already-provisioned services, and missing is what should be created.',
    mcpDescription: 'Analyze repo infrastructure needs against available services.',
    inputSchema: analyzeInfrastructureSchema,
    execute: async (args, { appCtx }) => {
      const repoUrl = args['repo_url'] as string;
      const branch = (args['branch'] as string | undefined) ?? undefined;
      try {
        const cloneResult = await cloneRepo({
          repoUrl,
          branch,
          sshKeyPath: appCtx.config.git.sshKeyPath || undefined,
        });
        const existingServices = await appCtx.serviceManager.list();
        const analysis = analyzeInfrastructure(cloneResult.path, existingServices);
        return analysis;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
      }
    },
    targets: ['mcp'],
  },
];
