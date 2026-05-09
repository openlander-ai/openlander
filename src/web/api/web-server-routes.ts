import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { getPolicy, type OpenLanderEnv } from '../../config/index.js';
import { MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import type { DomainMappingRow, ProjectRow, ServiceRow } from '../../db/types.js';
import { createModuleLogger } from '../../lib/logger.js';
import type { AllContainerInfo, PortInfo } from '../../pipeline/docker/types.js';
import {
  detectReverseProxy,
  getAllIps,
  getProxyStatus,
  type NetworkIp,
  type ProxyDetection,
} from '../../pipeline/traefik.js';

const log = createModuleLogger('web-server-routes');

type WebRouteStatus = 'healthy' | 'warning' | 'error' | 'inactive';
type WebRouteSource = 'sslip' | 'domain' | 'quick_share';
type PortEnvironment = OpenLanderEnv | 'outside';
type WebRouteTlsStatus = 'ok' | 'expiring' | 'invalid' | 'absent' | 'unknown';
type ProxyStatusCode =
  | 'docker_unavailable'
  | 'no_proxy_managed'
  | 'no_proxy_external'
  | 'traefik_managed'
  | 'traefik_external'
  | 'traefik_provider_disabled'
  | 'unsupported_proxy';
type ProxyStatusSeverity = 'ok' | 'warning' | 'error';

interface DockerSnapshot {
  containers: AllContainerInfo[];
  dockerUnavailable: boolean;
}

interface WebRouteIssue {
  code:
    | 'service_not_running'
    | 'container_not_running'
    | 'missing_assigned_port'
    | 'missing_container_port'
    | 'domain_pending'
    | 'domain_error';
  message: string;
}

interface WebServerRoute {
  id: string;
  source: WebRouteSource;
  host: string;
  entryPoints: string[];
  serviceId: string;
  serviceName: string;
  projectId: string;
  projectName: string;
  port: number | null;
  containerPort: number | null;
  containerName: string | null;
  tls: {
    enabled: boolean;
    status: WebRouteTlsStatus;
  };
  status: WebRouteStatus;
  issues: WebRouteIssue[];
}

interface PortAllocation {
  port: number;
  environment: PortEnvironment;
  source: 'service' | 'docker' | 'both';
  serviceId: string | null;
  serviceName: string | null;
  projectId: string | null;
  projectName: string | null;
  containerId: string | null;
  containerName: string | null;
  external: boolean;
}

function serviceDisplayName(service: ServiceRow): string {
  return service.name.replace(/__svc$/, '');
}

function classifyPort(port: number): PortEnvironment {
  const production = getPolicy('production');
  const development = getPolicy('development');
  if (port >= production.portRangeStart && port <= production.portRangeEnd) {
    return 'production';
  }
  if (port >= development.portRangeStart && port <= development.portRangeEnd) {
    return 'development';
  }
  return 'outside';
}

function containerPublicPorts(container: AllContainerInfo): number[] {
  return container.ports
    .filter((port): port is PortInfo & { PublicPort: number } => port.PublicPort !== undefined)
    .map((port) => port.PublicPort);
}

function findContainerForService(
  service: ServiceRow,
  containersById: Map<string, AllContainerInfo>,
  containersByName: Map<string, AllContainerInfo>,
): AllContainerInfo | null {
  if (service.container_id) {
    const byId = containersById.get(service.container_id);
    if (byId) return byId;
  }
  if (service.container_name) {
    const byName = containersByName.get(service.container_name);
    if (byName) return byName;
  }
  return null;
}

function routeStatusFor(
  service: ServiceRow,
  container: AllContainerInfo | null,
  issues: WebRouteIssue[],
): WebRouteStatus {
  const status: string | null = service.status;
  if (status === 'error') return 'error';
  if (status !== 'running') return 'inactive';
  if (issues.some((issue) => issue.code === 'domain_error')) return 'error';
  if (!container || (container.state !== 'running' && container.state !== 'restarting')) {
    return 'warning';
  }
  if (issues.length > 0) return 'warning';
  return 'healthy';
}

function buildIssues(
  service: ServiceRow,
  container: AllContainerInfo | null,
  domainStatus?: DomainMappingRow['status'],
): WebRouteIssue[] {
  const issues: WebRouteIssue[] = [];
  const status: string | null = service.status;

  if (!service.assigned_port) {
    issues.push({
      code: 'missing_assigned_port',
      message: 'Service has no assigned host port.',
    });
  }

  if (!service.container_port) {
    issues.push({
      code: 'missing_container_port',
      message: 'Service has no container port configured.',
    });
  }

  if (status !== 'running') {
    issues.push({
      code: 'service_not_running',
      message: `Service status is ${status ?? 'unknown'}.`,
    });
  }

  if (status === 'running' && !container) {
    issues.push({
      code: 'container_not_running',
      message: 'No matching Docker container is running for this service.',
    });
  } else if (
    status === 'running' &&
    container &&
    container.state !== 'running' &&
    container.state !== 'restarting'
  ) {
    issues.push({
      code: 'container_not_running',
      message: `Container state is ${container.state}.`,
    });
  }

  if (domainStatus === 'pending') {
    issues.push({
      code: 'domain_pending',
      message: 'Domain mapping is pending verification.',
    });
  } else if (domainStatus === 'error') {
    issues.push({
      code: 'domain_error',
      message: 'Domain mapping is in an error state.',
    });
  }

  return issues;
}

function createRoute(params: {
  id: string;
  source: WebRouteSource;
  host: string;
  service: ServiceRow;
  project: ProjectRow;
  container: AllContainerInfo | null;
  domainStatus?: DomainMappingRow['status'];
}): WebServerRoute {
  const issues = buildIssues(params.service, params.container, params.domainStatus);
  return {
    id: params.id,
    source: params.source,
    host: params.host,
    entryPoints: ['web'],
    serviceId: params.service.id,
    serviceName: serviceDisplayName(params.service),
    projectId: params.project.id,
    projectName: params.project.name,
    port: params.service.assigned_port,
    containerPort: params.service.container_port,
    containerName: params.service.container_name,
    tls: {
      enabled: false,
      status: params.source === 'domain' ? 'unknown' : 'absent',
    },
    status: routeStatusFor(params.service, params.container, issues),
    issues,
  };
}

async function listDockerContainers(ctx: AppContext): Promise<DockerSnapshot> {
  try {
    return { containers: await ctx.docker.listAllContainers(), dockerUnavailable: false };
  } catch (err) {
    log.warn({ err }, 'Failed to list Docker containers for Web Server read model');
    return { containers: [], dockerUnavailable: true };
  }
}

async function detectProxySafe(ctx: AppContext): Promise<ProxyDetection> {
  try {
    return await detectReverseProxy(ctx.docker);
  } catch (err) {
    log.warn({ err }, 'Failed to detect reverse proxy for Web Server read model');
    return { type: 'none', ports: [] };
  }
}

function containerIndexes(containers: AllContainerInfo[]): {
  containersById: Map<string, AllContainerInfo>;
  containersByName: Map<string, AllContainerInfo>;
} {
  return {
    containersById: new Map(containers.map((container) => [container.id, container])),
    containersByName: new Map(containers.map((container) => [container.name, container])),
  };
}

async function loadRouteInputs(ctx: AppContext): Promise<{
  projectsById: Map<string, ProjectRow>;
  services: ServiceRow[];
  domainMappings: DomainMappingRow[];
  containers: AllContainerInfo[];
  dockerUnavailable: boolean;
  ips: NetworkIp[];
}> {
  const [{ containers, dockerUnavailable }, projects, services, domainMappings] = await Promise.all(
    [
      listDockerContainers(ctx),
      ctx.db.listProjects(null, { includeArchived: true }),
      ctx.db.getServices({ kindNotIn: MANAGED_SERVICE_KINDS }),
      ctx.db.listDomainMappings(),
    ],
  );

  return {
    projectsById: new Map(projects.map((project) => [project.id, project])),
    services,
    domainMappings,
    containers,
    dockerUnavailable,
    ips: getAllIps(),
  };
}

async function buildRoutes(ctx: AppContext): Promise<{
  routes: WebServerRoute[];
  dockerUnavailable: boolean;
}> {
  const { projectsById, services, domainMappings, containers, dockerUnavailable, ips } =
    await loadRouteInputs(ctx);
  const { containersById, containersByName } = containerIndexes(containers);
  const servicesById = new Map(services.map((service) => [service.id, service]));
  const routes: WebServerRoute[] = [];

  for (const service of services) {
    const project = projectsById.get(service.project_id);
    if (!project || project.archived_at || service.archived_at) continue;

    const container = findContainerForService(service, containersById, containersByName);
    // Keep issue rows visible even when a service is misconfigured and Traefik
    // would not currently materialize a route. The Web Server page is a read
    // model for routing health, not only a dump of valid Traefik routers.
    for (const ip of ips) {
      const host = `${project.name}.${ip.address}.sslip.io`;
      routes.push(
        createRoute({
          id: `sslip:${service.id}:${ip.type}:${ip.address}`,
          source: 'sslip',
          host,
          service,
          project,
          container,
        }),
      );
    }

    if (
      (service.visibility === 'quick-share' || service.visibility === 'shared') &&
      service.public_url
    ) {
      try {
        const host = new URL(service.public_url).hostname;
        routes.push(
          createRoute({
            id: `quick-share:${service.id}`,
            source: 'quick_share',
            host,
            service,
            project,
            container,
          }),
        );
      } catch {
        // Invalid historical URLs are ignored by the routing config too.
      }
    }
  }

  for (const mapping of domainMappings) {
    const service = servicesById.get(mapping.service_id);
    if (!service) continue;
    const project = projectsById.get(service.project_id);
    if (!project || project.archived_at || service.archived_at) continue;
    const container = findContainerForService(service, containersById, containersByName);
    routes.push(
      createRoute({
        id: `domain:${mapping.id}`,
        source: 'domain',
        host: mapping.domain,
        service,
        project,
        container,
        domainStatus: mapping.status,
      }),
    );
  }

  routes.sort((a, b) => a.host.localeCompare(b.host));
  return { routes, dockerUnavailable };
}

function proxyStatusCode(
  detection: ProxyDetection,
  mode: 'managed' | 'external',
  dockerUnavailable: boolean,
): ProxyStatusCode {
  if (dockerUnavailable) return 'docker_unavailable';
  if (detection.type === 'none') {
    return mode === 'managed' ? 'no_proxy_managed' : 'no_proxy_external';
  }
  if (detection.type === 'traefik') {
    if (detection.traefikDockerProvider === false) return 'traefik_provider_disabled';
    return mode === 'managed' ? 'traefik_managed' : 'traefik_external';
  }
  return 'unsupported_proxy';
}

function proxyStatusSeverity(code: ProxyStatusCode): ProxyStatusSeverity {
  if (code === 'docker_unavailable') return 'error';
  return code === 'traefik_managed' || code === 'traefik_external' ? 'ok' : 'warning';
}

function summarizeProxy(
  detection: ProxyDetection,
  mode: 'managed' | 'external',
  dockerUnavailable: boolean,
) {
  const statusCode = proxyStatusCode(detection, mode, dockerUnavailable);
  return {
    type: detection.type,
    // `status` remains for backward compatibility. New clients should use
    // `statusCode` + proxy metadata for localization.
    status: getProxyStatus(detection, mode),
    statusCode,
    statusSeverity: proxyStatusSeverity(statusCode),
    mode,
    container: detection.container ?? null,
    version: detection.version ?? null,
    ports: detection.ports,
    traefikDockerProvider: detection.traefikDockerProvider ?? null,
  };
}

function entrypointsFromProxy(detection: ProxyDetection) {
  return detection.ports.map((port) => ({
    name:
      port === 80
        ? 'web'
        : port === 443
          ? 'websecure'
          : port === 8080
            ? 'dashboard'
            : `custom:${String(port)}`,
    port,
    protocol: port === 443 ? 'https' : 'http',
  }));
}

function uniquePortAllocations(allocations: PortAllocation[]): PortAllocation[] {
  const byKey = new Map<string, PortAllocation>();
  for (const allocation of allocations) {
    const key = [
      allocation.port,
      allocation.serviceId ?? '',
      allocation.containerId ?? '',
      allocation.containerName ?? '',
    ].join(':');
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, allocation);
      continue;
    }

    byKey.set(key, {
      ...existing,
      source: existing.source === allocation.source ? existing.source : 'both',
      serviceId: existing.serviceId ?? allocation.serviceId,
      serviceName: existing.serviceName ?? allocation.serviceName,
      projectId: existing.projectId ?? allocation.projectId,
      projectName: existing.projectName ?? allocation.projectName,
      containerId: existing.containerId ?? allocation.containerId,
      containerName: existing.containerName ?? allocation.containerName,
      external: existing.external && allocation.external,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.port - b.port);
}

async function buildPortAllocations(ctx: AppContext): Promise<{
  allocations: PortAllocation[];
  dockerUnavailable: boolean;
}> {
  const [{ containers, dockerUnavailable }, projects, services] = await Promise.all([
    listDockerContainers(ctx),
    ctx.db.listProjects(null, { includeArchived: true }),
    ctx.db.listServices(),
  ]);
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const servicesByContainerId = new Map(
    services
      .filter((service) => service.container_id)
      .map((service) => [service.container_id as string, service]),
  );
  const servicesByContainerName = new Map(
    services
      .filter((service) => service.container_name)
      .map((service) => [service.container_name as string, service]),
  );

  const allocations: PortAllocation[] = [];
  for (const service of services) {
    if (!service.assigned_port) continue;
    const project = projectsById.get(service.project_id);
    allocations.push({
      port: service.assigned_port,
      environment: classifyPort(service.assigned_port),
      source: 'service',
      serviceId: service.id,
      serviceName: serviceDisplayName(service),
      projectId: project?.id ?? service.project_id,
      projectName: project?.name ?? null,
      containerId: service.container_id,
      containerName: service.container_name,
      external: false,
    });
  }

  for (const container of containers) {
    const service =
      servicesByContainerId.get(container.id) ??
      servicesByContainerName.get(container.name) ??
      null;
    for (const port of containerPublicPorts(container)) {
      allocations.push({
        port,
        environment: classifyPort(port),
        source: 'docker',
        serviceId: service?.id ?? null,
        serviceName: service ? serviceDisplayName(service) : null,
        projectId: service?.project_id ?? null,
        projectName: service ? (projectsById.get(service.project_id)?.name ?? null) : null,
        containerId: container.id,
        containerName: container.name,
        external: !container.managedByOpenLander,
      });
    }
  }

  return { allocations: uniquePortAllocations(allocations), dockerUnavailable };
}

function portSummary(allocations: PortAllocation[]) {
  const byEnvironment = {
    production: allocations.filter((allocation) => allocation.environment === 'production').length,
    development: allocations.filter((allocation) => allocation.environment === 'development')
      .length,
    outside: allocations.filter((allocation) => allocation.environment === 'outside').length,
  };
  return {
    total: allocations.length,
    byEnvironment,
  };
}

export function createWebServerRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/web-server/summary', async (c) => {
    const [{ containers, dockerUnavailable }, proxy, { routes }] = await Promise.all([
      listDockerContainers(ctx),
      detectProxySafe(ctx),
      buildRoutes(ctx),
    ]);
    const managed = containers.filter((container) => container.managedByOpenLander).length;
    const issueCount = routes.filter((route) => route.issues.length > 0).length;

    return c.json({
      proxy: summarizeProxy(proxy, ctx.config.traefik.mode, dockerUnavailable),
      routes: {
        total: routes.length,
        healthy: routes.filter((route) => route.status === 'healthy').length,
        issues: issueCount,
      },
      entrypoints: entrypointsFromProxy(proxy),
      // TODO(v0.1): wire to a Traefik reload event/access source. Null is the
      // honest contract until OpenLander records reload timestamps.
      lastReloadAt: null,
      containers: {
        total: containers.length,
        managed,
        external: containers.length - managed,
      },
      dockerUnavailable,
    });
  });

  api.get('/web-server/routes', async (c) => {
    const { routes, dockerUnavailable } = await buildRoutes(ctx);
    return c.json({
      count: routes.length,
      issueCount: routes.filter((route) => route.issues.length > 0).length,
      dockerUnavailable,
      routes,
    });
  });

  api.get('/web-server/ports', async (c) => {
    const { allocations, dockerUnavailable } = await buildPortAllocations(ctx);
    return c.json({
      ranges: {
        production: getPolicy('production'),
        development: getPolicy('development'),
      },
      summary: portSummary(allocations),
      dockerUnavailable,
      allocations,
    });
  });

  api.get('/web-server/external-containers', async (c) => {
    const { containers, dockerUnavailable } = await listDockerContainers(ctx);
    const externalContainers = containers
      .filter((container) => !container.managedByOpenLander)
      .map((container) => ({
        id: container.id,
        name: container.name,
        image: container.image,
        state: container.state,
        status: container.status,
        ports: containerPublicPorts(container),
        rangeConflicts: containerPublicPorts(container)
          .map((port) => ({ port, environment: classifyPort(port) }))
          .filter((item) => item.environment !== 'outside'),
        composeProject: container.composeProject,
        created: container.created,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return c.json({
      count: externalContainers.length,
      dockerUnavailable,
      containers: externalContainers,
    });
  });

  return api;
}
