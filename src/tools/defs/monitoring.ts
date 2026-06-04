import net from 'node:net';
import { createModuleLogger } from '../../lib/logger.js';
import { DOCKER_LABELS } from '../../config/index.js';
import {
  OpenLanderError,
  ProjectNotFoundError,
  ServiceNotFoundError,
  ServiceOperationUnsupportedError,
} from '../../errors.js';
import { kindToLegacyType, MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import {
  deployableServiceIdToProjectId,
  projectIdToDeployableServiceId,
} from '../../db/service-ids.js';
import { loadServiceViewRecords, serviceViewFromRows } from '../../db/views/service-view.js';
import { formatStatsSummary, getSystemStats } from '../../monitor/stats.js';
import { getMcpInstancePublicInfo } from '../../mcp/instance-identity.js';
import {
  archivedServicesSuggestedCall,
  buildMcpActionStatusCall,
  lifecycleEffectForTool,
  parseDestructiveMcpPlan,
  summarizeDestructiveArgs,
} from '../../mcp/agent-lifecycle-contract.js';
import { BUILD_TIME_PREFIXES } from '../../pipeline/build-args.js';
import { resolveContainerHost } from '../../pipeline/url-resolver.js';
import {
  diagnoseServiceSchema,
  diagnoseHostResourcesSchema,
  dismissAlertSchema,
  getAlertsSchema,
  getInstanceInfoSchema,
  getLogsSchema,
  getProjectStatsSchema,
  getTopologySchema,
  getSystemStatsSchema,
  mcpActionStatusSchema,
  probeHostSchema,
} from './schemas.js';
import type { ToolDef } from './types.js';
import type { ToolContext } from './types.js';
import { computeContainerCpuPercent, type ContainerStatsRaw } from '../../pipeline/docker.js';

const log = createModuleLogger('monitoring-tools');

type AppCtx = ToolContext['appCtx'];
type ServiceRow = NonNullable<Awaited<ReturnType<AppCtx['db']['getService']>>>;
type ProjectRow = NonNullable<Awaited<ReturnType<AppCtx['db']['getProject']>>>;
type DeployLogRow = Awaited<ReturnType<AppCtx['db']['getDeployLogs']>>[number];
type DockerContainerRow = Awaited<ReturnType<AppCtx['docker']['listAllContainers']>>[number];

interface ResolvedDeployableService {
  service: ServiceRow;
  project: ProjectRow;
  runtimeProject: ProjectRow;
}

async function resolveTopologyProject(
  appCtx: AppCtx,
  args: Record<string, unknown>,
): Promise<ProjectRow> {
  const projectId = typeof args['project_id'] === 'string' ? args['project_id'].trim() : '';
  const projectName = typeof args['project_name'] === 'string' ? args['project_name'].trim() : '';
  const project = projectId
    ? await appCtx.db.getProject(projectId)
    : await appCtx.db.getProjectByName(projectName);
  if (!project) {
    throw new ProjectNotFoundError(projectId || projectName);
  }
  return project;
}

async function getTopologyDeployables(appCtx: AppCtx, project: ProjectRow): Promise<ServiceRow[]> {
  const groupServices = await appCtx.db.getDeployablesByGroup(project.id);
  if (groupServices.length > 0) {
    return expandComposeTopologyDeployables(appCtx, groupServices);
  }
  const serviceRecords = await loadServiceViewRecords(appCtx.db, [project]);
  const service = serviceRecords.get(project.id)?.service ?? null;
  return service ? [service] : [];
}

async function expandComposeTopologyDeployables(
  appCtx: AppCtx,
  services: readonly ServiceRow[],
): Promise<ServiceRow[]> {
  const expanded: ServiceRow[] = [];
  const seen = new Set<string>();

  for (const service of services) {
    if (service.kind === 'compose' && typeof appCtx.db.getComposeChildren === 'function') {
      const children = await appCtx.db.getComposeChildren(service.id);
      if (children.length > 0) {
        for (const child of children) {
          if (!seen.has(child.id)) {
            seen.add(child.id);
            expanded.push(child);
          }
        }
        continue;
      }
    }

    if (!seen.has(service.id)) {
      seen.add(service.id);
      expanded.push(service);
    }
  }

  return expanded;
}

function topologyDeployableKind(service: ServiceRow): 'application' | 'compose' {
  return service.kind === 'compose' || service.kind === 'compose-child' ? 'compose' : 'application';
}

async function getConnectedManagedServices(
  appCtx: AppCtx,
  projectId: string,
  deployables: readonly ServiceRow[],
): Promise<{
  serviceConnections: Awaited<ReturnType<AppCtx['db']['listServiceConnectionsByProject']>>;
  managedServices: ServiceRow[];
}> {
  const directManagedServices =
    typeof appCtx.db.getServices === 'function'
      ? await appCtx.db.getServices({ project_id: projectId, kindIn: MANAGED_SERVICE_KINDS })
      : [];
  const serviceConnections =
    typeof appCtx.db.listServiceConnectionsByProject === 'function'
      ? await appCtx.db.listServiceConnectionsByProject(projectId)
      : [];
  const allServices =
    serviceConnections.length > 0 && typeof appCtx.db.listServices === 'function'
      ? await appCtx.db.listServices()
      : [];
  const servicesById = new Map(allServices.map((service) => [service.id, service]));
  const seen = new Set(deployables.map((service) => service.id));
  const managedServices: ServiceRow[] = [];

  for (const service of directManagedServices) {
    if (
      seen.has(service.id) ||
      !(MANAGED_SERVICE_KINDS as readonly string[]).includes(service.kind)
    ) {
      continue;
    }
    seen.add(service.id);
    managedServices.push(service);
  }

  for (const connection of serviceConnections) {
    const service = servicesById.get(connection.service_id_provider);
    if (
      !service ||
      seen.has(service.id) ||
      !(MANAGED_SERVICE_KINDS as readonly string[]).includes(service.kind)
    ) {
      continue;
    }
    seen.add(service.id);
    managedServices.push(service);
  }

  return { serviceConnections, managedServices };
}

async function getProjectTopology(args: Record<string, unknown>, appCtx: AppCtx) {
  const project = await resolveTopologyProject(appCtx, args);
  const deployables = await getTopologyDeployables(appCtx, project);
  const { serviceConnections, managedServices } = await getConnectedManagedServices(
    appCtx,
    project.id,
    deployables,
  );
  const nodeIds = new Set([...deployables, ...managedServices].map((service) => service.id));
  const dependsOnMap = new Map<string, string[]>();

  for (const service of deployables) {
    const lookupId = deployableServiceIdToProjectId(service.id);
    const deps = await appCtx.db.findDependenciesByProject(lookupId);
    const siblingDeps = deps
      .map((dep) => dep.target_service_id)
      .filter((serviceId): serviceId is string => serviceId !== null && nodeIds.has(serviceId));
    dependsOnMap.set(projectIdToDeployableServiceId(lookupId), siblingDeps);
  }

  for (const connection of serviceConnections) {
    if (
      !nodeIds.has(connection.service_id_consumer) ||
      !nodeIds.has(connection.service_id_provider)
    ) {
      continue;
    }
    const existing = dependsOnMap.get(connection.service_id_consumer) ?? [];
    dependsOnMap.set(connection.service_id_consumer, [
      ...new Set([...existing, connection.service_id_provider]),
    ]);
  }

  const services = [
    ...deployables.map((service) => ({
      id: service.id,
      name: service.name,
      role: 'deployable' as const,
      kind: topologyDeployableKind(service),
      source: service.source,
      status: service.status,
      project_id: project.id,
      port: service.assigned_port ?? null,
      image: service.image_url ?? service.image_tag ?? null,
      dependsOn: dependsOnMap.get(service.id) ?? [],
    })),
    ...managedServices.map((service) => ({
      id: service.id,
      name: service.name,
      role: 'managed' as const,
      kind: service.kind,
      type: service.type ?? kindToLegacyType(service.kind),
      status: service.status,
      attached_project_id: project.id,
      attached_project_name: project.name,
      port: service.assigned_port ?? service.port ?? null,
      image: service.image_url ?? service.image ?? null,
      dependsOn: [] as string[],
    })),
  ];

  return {
    project: { id: project.id, name: project.name },
    count: services.length,
    services,
    edges: deployables.flatMap((service) =>
      (dependsOnMap.get(service.id) ?? []).map((targetServiceId) => ({
        from: service.id,
        to: targetServiceId,
      })),
    ),
    _agent_guidance: {
      message:
        'Topology is read-only. Applications/Compose workloads depend on Database/Cache/Storage resources listed in dependsOn.',
      next_steps: [
        'Use openlander_monitor.diagnose_service with an Application/Compose service_id to inspect failures.',
        'Use openlander_managed_service.get_service_credentials for Database/Cache/Storage connection details when needed.',
      ],
    },
  };
}

function countLogLines(value: string): number {
  if (!value) return 0;
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const withoutTrailingNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  if (!withoutTrailingNewline) return 0;
  return withoutTrailingNewline.split('\n').length;
}

export const monitoringToolDefs: ToolDef[] = [
  {
    name: 'get_instance_info',
    riskLevel: 'low',
    description:
      'Return this OpenLander MCP instance identity: id, name, endpoint, host, suggestedName, and whether the name is still a default. Use this first when the user has multiple OpenLander MCP servers connected.',
    mcpDescription:
      'Return this OpenLander instance identity so agents can choose the right connected server.',
    inputSchema: getInstanceInfoSchema,
    execute: (_args, context) => Promise.resolve(getMcpInstancePublicInfo(context.appCtx.config)),
  },
  {
    name: 'get_logs',
    riskLevel: 'low',
    description:
      'Get recent container stdout/stderr logs for an Application/Compose workload or Project. Prefer service_id from list_projects when available. Use when user asks about errors, crashes, or app behavior. Returns { project, service, logs } where logs is a string of recent lines (agent default: 80, MCP default: 200). Errors: PROJECT_NOT_FOUND, SERVICE_NOT_FOUND. If logs show a build error, call get_build_log for the raw build output. For deployment history (past deploys, triggers, durations), use get_deploy_history instead.',
    mcpDescription:
      'Get recent Application/Compose or Project logs. Prefer service_id. MCP default is 200 lines; pass lines=500+ for long tracebacks.',
    inputSchema: getLogsSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const lines =
        (args['lines'] as number | undefined) ?? (context.target === 'agent' ? 80 : 200);
      const serviceId = typeof args['service_id'] === 'string' ? args['service_id'].trim() : '';
      const serviceName =
        typeof args['service_name'] === 'string' ? args['service_name'].trim() : '';
      const containerName =
        typeof args['container_name'] === 'string' ? args['container_name'].trim() : '';

      if (serviceId || serviceName || containerName) {
        const { service, project, runtimeProject } = await resolveDeployableServiceForMonitoring(
          args,
          context,
        );
        const logs = await appCtx.pipeline.getLogs(runtimeProject.id, lines);
        return {
          project: project.name,
          service: {
            id: service.id,
            name: service.name,
            container_name: service.container_name,
          },
          logs,
          requested_lines: lines,
          returned_lines: countLogLines(logs),
          tail: true,
          _agent_guidance: {
            message:
              'Logs are returned from the Docker tail buffer. If the traceback or migration failure is still cut off, retry get_logs with a larger lines value such as 500 or 1000.',
          },
        };
      }

      const projectId = typeof args['project_id'] === 'string' ? args['project_id'].trim() : '';
      const projectName =
        typeof args['project_name'] === 'string' ? args['project_name'].trim() : '';
      const project = projectId
        ? await appCtx.db.getProject(projectId)
        : await appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectId || projectName);
      }

      const serviceRecords = await loadServiceViewRecords(appCtx.db, [project]);
      const service = serviceRecords.get(project.id)?.service ?? null;
      const logs = await appCtx.pipeline.getLogs(project.id, lines);
      return {
        project: project.name,
        service: service ? { id: service.id, name: service.name } : null,
        logs,
        requested_lines: lines,
        returned_lines: countLogLines(logs),
        tail: true,
        _agent_guidance: {
          message:
            'Logs are returned from the Docker tail buffer. If the traceback or migration failure is still cut off, retry get_logs with a larger lines value such as 500 or 1000.',
        },
      };
    },
  },
  {
    name: 'get_system_stats',
    riskLevel: 'low',
    description:
      'Get host system resource usage — CPU load, memory, and disk space. Use when user asks about server health, capacity, or before deploying to check if resources are available. Returns { summary, cpu, memory, disk } with percentage usage and warnings. Always available, no errors.',
    mcpDescription: 'Get host system resource usage.',
    inputSchema: getSystemStatsSchema,
    execute: () => {
      const stats = getSystemStats();
      return Promise.resolve({
        summary: formatStatsSummary(stats),
        ...stats,
      });
    },
  },
  {
    name: 'diagnose_host_resources',
    riskLevel: 'low',
    description:
      'Diagnose OpenLander host resource pressure in one read-only MCP call. Returns Docker daemon status, host CPU/memory/disk stats, Docker disk totals, container counts, and top CPU/memory containers. Use when deploys fail with SIGKILL/OOM, Docker becomes unreachable, builds hang, or OpenLander itself appears unstable. Does not stop, remove, restart, or clean anything.',
    mcpDescription:
      'Read-only host/Docker resource diagnosis for SIGKILL/OOM, Docker instability, and stuck deploys.',
    inputSchema: diagnoseHostResourcesSchema,
    execute: async (args, context) => diagnoseHostResources(args, context.appCtx),
  },
  {
    name: 'get_alerts',
    riskLevel: 'low',
    description:
      'Get current system alerts for resource issues, inactive projects, and container problems. Returns active alerts with severity, message, and suggested actions. Use when user asks about system health, problems, or "show alerts". Always available.',
    mcpDescription: 'Get active system alerts and notifications.',
    inputSchema: getAlertsSchema,
    execute: (_args, context) => {
      const alerts = context.appCtx.alertMonitor.getActiveAlerts();
      return Promise.resolve({
        count: alerts.length,
        alerts: alerts.map((alert) => ({
          id: alert.id,
          type: alert.type,
          severity: alert.severity,
          message: alert.message,
          suggestion: alert.suggestion,
          createdAt: alert.createdAt.toISOString(),
        })),
      });
    },
  },
  {
    name: 'dismiss_alert',
    riskLevel: 'medium',
    description:
      'Dismiss a specific alert by ID so it no longer appears in active alerts. Use when user acknowledges an alert. Returns { status, alertId }.',
    mcpDescription: 'Dismiss an active alert by ID.',
    inputSchema: dismissAlertSchema,
    execute: (args, context) => {
      const alertId = args['alert_id'] as string;
      context.appCtx.alertMonitor.dismissAlert(alertId);
      return Promise.resolve({ status: 'dismissed', alertId });
    },
  },
  {
    name: 'get_project_stats',
    riskLevel: 'low',
    description:
      'Get CPU, memory, restarts, and uptime for an Application/Compose or Project container. Prefer service_id from list_projects when available. Use when user asks about resource usage, container health, or performance metrics. Returns { cpu_percent, memory_usage_mb, memory_limit_mb, restarts, uptime_seconds, status }. Errors: PROJECT_NOT_FOUND, SERVICE_NOT_FOUND.',
    mcpDescription: 'Get per-container CPU, memory, restarts, and uptime for a service/project.',
    inputSchema: getProjectStatsSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const serviceId = typeof args['service_id'] === 'string' ? args['service_id'].trim() : '';
      const serviceName =
        typeof args['service_name'] === 'string' ? args['service_name'].trim() : '';

      let project: ProjectRow;
      let service: ServiceRow | undefined;
      let status: string | null | undefined;
      let containerId: string | null | undefined;

      if (serviceId || serviceName) {
        const resolved = await resolveDeployableServiceForMonitoring(args, context);
        project = resolved.project;
        service = resolved.service;
        status = service.status;
        containerId = service.container_id ?? resolved.runtimeProject.container_id;
      } else {
        const projectId = typeof args['project_id'] === 'string' ? args['project_id'].trim() : '';
        const projectName =
          typeof args['project_name'] === 'string' ? args['project_name'].trim() : '';
        const resolvedProject = projectId
          ? await appCtx.db.getProject(projectId)
          : await appCtx.db.getProjectByName(projectName);
        if (!resolvedProject) {
          throw new ProjectNotFoundError(projectId || projectName);
        }
        project = resolvedProject;
        // S3.4 canonical-first via the service-first read model. `status`
        // is emitted in the early-return below, so restore its historic
        // JSON-omit bottom: the view normalizes the no-services-row case to
        // 'idle', and a real services-row status is never 'idle' (enum
        // running|stopped|error), so 'idle' uniquely marks that bottom →
        // undefined → key omitted. `containerId` is a gate only.
        const serviceRecords = await loadServiceViewRecords(appCtx.db, [project]);
        const record = serviceRecords.get(project.id);
        service = record?.service ?? undefined;
        const view = record?.view ?? serviceViewFromRows(project, null);
        status = view.status === 'idle' ? undefined : view.status;
        containerId = view.containerId;
      }

      if (!containerId || status !== 'running') {
        return {
          project: project.name,
          service: service ? { id: service.id, name: service.name } : null,
          status,
          cpu_percent: 0,
          memory_usage_mb: 0,
          memory_limit_mb: 0,
          restarts: 0,
          uptime_seconds: 0,
        };
      }

      try {
        const stats = (await appCtx.docker.getContainerStats(containerId)) as ContainerStatsRaw;
        const inspect = await appCtx.docker.inspectContainer(containerId);
        // Calculate CPU percentage
        const cpuCount = stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;
        const cpuPercent = computeContainerCpuPercent(stats, cpuCount);
        // Convert bytes to MB
        const memoryUsageMb = Math.round((stats.memory_stats.usage / 1024 / 1024) * 10) / 10;
        const memoryLimitMb = Math.round((stats.memory_stats.limit / 1024 / 1024) * 10) / 10;

        // Get restart count
        const restarts = inspect.RestartCount || 0;

        // Calculate uptime in seconds
        const startedAt = new Date(inspect.State.StartedAt).getTime();
        const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);

        return {
          project: project.name,
          service: service ? { id: service.id, name: service.name } : null,
          status,
          cpu_percent: Math.round(cpuPercent * 10) / 10,
          memory_usage_mb: memoryUsageMb,
          memory_limit_mb: memoryLimitMb,
          restarts,
          uptime_seconds: uptimeSeconds,
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn(
          { err, projectName: project.name, containerId },
          'Failed to fetch container stats',
        );
        return {
          project: project.name,
          service: service ? { id: service.id, name: service.name } : null,
          status,
          cpu_percent: 0,
          memory_usage_mb: 0,
          memory_limit_mb: 0,
          restarts: 0,
          uptime_seconds: 0,
          error: `Stats unavailable: ${errMsg}`,
          _agent_guidance: {
            message: 'Container stats could not be retrieved.',
            next_steps: [
              'Verify the container is running with get_logs',
              'Try redeploying if the container crashed',
            ],
          },
        };
      }
    },
  },
  {
    name: 'get_topology',
    riskLevel: 'low',
    description:
      'Return the read-only resource topology for a Project. Shows Applications/Compose workloads, connected Database/Cache/Storage resources, and dependsOn edges so agents can understand app-to-database/cache ownership over MCP. Requires project_id or project_name. Does not inspect Docker or mutate state.',
    mcpDescription:
      'Return Project resource topology: Applications/Compose, Database/Cache/Storage resources, and dependency edges.',
    inputSchema: getTopologySchema,
    execute: async (args, context) => getProjectTopology(args, context.appCtx),
  },
  {
    name: 'diagnose_service',
    riskLevel: 'low',
    description:
      'Diagnose an Application/Compose workload in one MCP call. Returns workload/source summary, masked env key inventory, build-time env warnings, sanitized recent deployment status/log tail, container status, sanitized runtime logs, local HTTP probe, dependency probes, and recommended next actions. Use this after redeploy_app or get_deploy_status reports a failure, timeout, DB connection problem, or confusing runtime behavior. For raw live container logs only use get_logs; for full untruncated build output and captured deploy-time runtime logs use get_build_log.',
    mcpDescription:
      'One-shot Application/Compose diagnostics after deploy/runtime failures. For raw logs use get_logs; for full build output use get_build_log.',
    inputSchema: diagnoseServiceSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const { service, project, runtimeProject } = await resolveDeployableServiceForMonitoring(
        args,
        context,
      );
      const lines = (args['lines'] as number | undefined) ?? 80;
      const timeoutMs = (args['timeout_ms'] as number | undefined) ?? 5000;
      const internal = (args['internal'] as boolean | undefined) ?? false;
      const pathArg = (args['path'] as string | undefined)?.trim();
      const healthCheckPathArg = (args['health_check_path'] as string | undefined)?.trim();

      const [groupEnv, serviceEnv, deployLogs] = await Promise.all([
        appCtx.db.getEnvVars(project.id),
        appCtx.db.getEnvVarsForService(project.id, service.id),
        appCtx.db.getDeployLogs(runtimeProject.id, 5),
      ]);
      const effectiveEnv = { ...groupEnv, ...serviceEnv };
      const probePath = selectServiceProbePath({
        requestedPath: pathArg || healthCheckPathArg,
        healthCheckPath: service.health_check_path,
        env: effectiveEnv,
      });

      const container = await summarizeContainer(appCtx, service);
      const runtimeLogs = await readServiceLogs(appCtx, runtimeProject.id, lines);
      const recentDeployment = summarizeRecentDeployments(deployLogs);
      const buildDiagnostics = diagnoseBuildTimeEnv(effectiveEnv, deployLogs);
      const httpCheck = await probeServiceHttp(appCtx, service, probePath, timeoutMs, {
        internal,
      });
      const internalHttpCheck =
        !internal && service.container_id && httpCheck['reachable'] === false
          ? await probeServiceHttp(appCtx, service, probePath, timeoutMs, { internal: true })
          : null;
      const dependencies = await probeEnvDependencies(
        appCtx,
        effectiveEnv,
        timeoutMs,
        service.container_id ?? undefined,
        true,
      );
      const nextSteps = buildDiagnoseNextSteps({
        service,
        recentDeployment,
        buildDiagnostics,
        container,
        httpCheck,
        dependencies,
      });
      const route = summarizeRouteState({
        service,
        project,
        container,
        httpCheck,
        internalHttpCheck,
      });
      const diagnosis = buildSynthesizedServiceDiagnosis({
        service,
        project,
        effectiveEnv,
        buildDiagnostics,
        container,
        route,
        httpCheck,
        internalHttpCheck,
        dependencies,
        logs: runtimeLogs,
        recentDeployment,
      });

      return {
        project: {
          id: project.id,
          name: project.name,
          runtimeProjectId: runtimeProject.id,
        },
        service: {
          id: service.id,
          name: service.name,
          kind: service.kind,
          source: service.source,
          status: service.status,
          repoUrl: sanitizeRepoUrl(service.repo_url),
          image: service.image_url ?? service.image_tag ?? null,
          dockerfilePath: service.dockerfile_path,
          dockerTarget: service.docker_target,
          buildContext: service.build_context,
          assignedPort: service.assigned_port,
          containerPort: service.container_port,
        },
        env: summarizeEnvKeys(groupEnv, serviceEnv),
        buildTimeEnv: buildDiagnostics,
        recentDeployment,
        container,
        logs: runtimeLogs,
        httpCheck,
        ...(internalHttpCheck ? { internalHttpCheck } : {}),
        route,
        dependencies,
        ...(diagnosis ? { diagnosis } : {}),
        ...(diagnosis?.suggested_call ? { suggested_call: diagnosis.suggested_call } : {}),
        _agent_guidance: {
          ...(diagnosis ? { message: diagnosis.summary } : {}),
          next_steps: diagnosis ? nextStepsForDiagnosis(diagnosis, nextSteps) : nextSteps,
        },
      };
    },
  },
  {
    name: 'probe_host',
    riskLevel: 'low',
    description:
      'Check if a host, URL, or container endpoint is reachable. Pass target, or host as an alias for target. Targets like `ol-svc-*` / `ol-{project}` are internal Docker DNS names and require internal=true. External hosts probe from the OpenLander host by default.',
    mcpDescription:
      'Check connectivity to a host, URL, or container endpoint. Accepts target or host; internal Docker DNS names require internal=true.',
    inputSchema: probeHostSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const target = (args['target'] as string | undefined) ?? (args['host'] as string);
      const portArg = args['port'] as number | undefined;
      const protocolArg = args['protocol'] as 'http' | 'https' | 'tcp' | undefined;
      const pathArg = (args['path'] as string | undefined) ?? '/';
      const timeoutMs = (args['timeout_ms'] as number | undefined) ?? 5000;
      const internal = (args['internal'] as boolean | undefined) ?? false;

      const { protocol, host, port, url } = resolveTarget(target, portArg, protocolArg, pathArg);
      const targetResolved = url ?? `${protocol}://${host}:${String(port)}`;
      const startedAt = Date.now();

      if (internal) {
        const hasContext = Boolean(
          args['service_id'] ?? args['service_name'] ?? args['project_id'] ?? args['project_name'],
        );
        if (!hasContext) {
          return {
            reachable: false,
            latency_ms: 0,
            error: 'INTERNAL_PROBE_CONTEXT_REQUIRED',
            protocol_used: protocol,
            target_resolved: targetResolved,
            _agent_guidance: {
              message:
                'Project network isolation is enabled. Pass service_id, service_name, project_id, or project_name so OpenLander can probe from the correct project container.',
              next_steps: [
                'Call list_projects and use projects[].deployable_service.service_id for the internal probe context.',
                'Call diagnose_service for full service-aware diagnostics.',
              ],
            },
          };
        }
        const { service } = await resolveDeployableServiceForMonitoring(args, context);
        return probeInternal(
          appCtx,
          protocol,
          host,
          port,
          pathArg,
          timeoutMs,
          targetResolved,
          service.container_id ?? undefined,
          true,
        );
      }

      if (protocol === 'tcp') {
        return probeTcp(host, port, timeoutMs, targetResolved);
      }

      return probeHttp(
        url ?? `${protocol}://${host}:${String(port)}${pathArg}`,
        timeoutMs,
        protocol,
        targetResolved,
        startedAt,
      );
    },
  },
  {
    name: 'mcp_action_status',
    riskLevel: 'low',
    description:
      'Check the status of a destructive MCP action that was routed to human approval. Pass action_run_id, or action_id as an alias.',
    mcpDescription:
      'Check pending/approved/rejected/failed status for a held MCP action. Accepts action_run_id or action_id.',
    inputSchema: mcpActionStatusSchema,
    execute: async (args, context) => {
      const actionRunId =
        (args['action_run_id'] as string | undefined) ?? (args['action_id'] as string);
      const run = await context.appCtx.db.getActionRun(actionRunId);
      if (!run) {
        return {
          status: 'not_found',
          error: 'NOT_FOUND',
          code: 'NOT_FOUND',
          message: `Action run ${actionRunId} was not found.`,
        };
      }

      const status =
        run.approval_status === 'rejected'
          ? 'rejected'
          : run.status === 'pending_approval'
            ? run.approval_status === 'approved'
              ? 'approved_executing'
              : 'pending'
            : run.status;
      const planSummary = parseDestructiveMcpPlan(run.plan);
      const requestedTool = planSummary?.tool;
      const requestedArgsSummary = planSummary
        ? summarizeDestructiveArgs(planSummary.args)
        : undefined;
      const projectId = run.project_id || planSummary?.targetProjectId || null;
      const lifecycleEffect = requestedTool ? lifecycleEffectForTool(requestedTool) : undefined;
      const pollCall =
        status === 'pending' || status === 'approved_executing'
          ? buildMcpActionStatusCall(run.id)
          : undefined;
      const suggestedCall =
        status === 'succeeded' && lifecycleEffect?.kind === 'archive'
          ? archivedServicesSuggestedCall(projectId)
          : undefined;
      const guidance =
        status === 'pending'
          ? {
              message:
                'This MCP action is still waiting for human approval. Do not retry the original destructive action.',
              next_steps: ['Use poll_call to check this action again after the user responds.'],
            }
          : status === 'approved_executing'
            ? {
                message:
                  'The human approved this MCP action and OpenLander is executing it. Keep polling until it reaches succeeded or failed.',
                next_steps: ['Use poll_call again; do not start a duplicate lifecycle action.'],
              }
            : status === 'rejected'
              ? {
                  message: 'The human rejected this MCP action. Stop and report the rejection.',
                  next_steps: ['Do not substitute hard delete, remove_service, or cleanup_docker.'],
                }
              : status === 'succeeded' && lifecycleEffect?.kind === 'archive'
                ? {
                    message:
                      'Archive completed. Archive is reversible cleanup, not permanent deletion.',
                    next_steps: [
                      'Use suggested_call to inspect archived Applications/Compose workloads.',
                      'Use unarchive_service or unarchive_project to restore later; hard delete remains Web UI-only.',
                    ],
                  }
                : status === 'succeeded' && lifecycleEffect?.kind === 'unarchive'
                  ? {
                      message:
                        'Restore completed. The target is back on the active lifecycle path, but no container was started automatically.',
                      next_steps: [
                        'Call redeploy_app only if the user wants the service running again.',
                        'After redeploying, call diagnose_service to verify runtime health.',
                      ],
                    }
                  : status === 'failed'
                    ? {
                        message:
                          'The held MCP action failed. Report the failure and use diagnostic actions if relevant.',
                        next_steps: [
                          'Do not substitute hard delete, remove_service, or cleanup_docker.',
                        ],
                      }
                    : undefined;

      return {
        actionRunId: run.id,
        action_run_id: run.id,
        status,
        projectId,
        project_id: projectId,
        approvalStatus: run.approval_status,
        approvalTool: run.approval_tool,
        requestedTool,
        requested_tool: requestedTool,
        requestedArgsSummary,
        requested_args_summary: requestedArgsSummary,
        lifecycle_effect: lifecycleEffect,
        poll_call: pollCall,
        suggested_call: suggestedCall,
        error: run.error_message,
        requestedAt: run.approval_requested_at,
        resolvedAt: run.approval_resolved_at,
        _agent_guidance: guidance,
      };
    },
  },
];

interface ContainerResourceSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  managedByOpenLander: boolean;
  role: string | null;
  project: string | null;
  service: string | null;
  composeProject: string | null;
  cpuPercent: number | null;
  memoryUsageMb: number | null;
  memoryLimitMb: number | null;
}

interface DockerDiskUsageSummary {
  available: boolean;
  images: { count: number; totalSizeMb: number };
  containers: { count: number; totalSizeMb: number };
  volumes: { count: number; totalSizeMb: number };
  error?: string;
}

const HOST_DIAGNOSTIC_STATS_SAMPLE_LIMIT = 50;

async function diagnoseHostResources(
  args: Record<string, unknown>,
  appCtx: AppCtx,
): Promise<Record<string, unknown>> {
  const containerLimit = (args['container_limit'] as number | undefined) ?? 8;
  const includeDiskUsage = (args['include_disk_usage'] as boolean | undefined) ?? true;
  const systemStats = getSystemStats();

  const dockerStatus = await appCtx.docker.status().catch((error: unknown) => ({
    state: 'not_running' as const,
    error: getUnknownErrorMessage(error),
  }));
  const dockerReachable = dockerStatus.state === 'running';
  let containerListError: string | null = null;
  const allContainers = dockerReachable
    ? await appCtx.docker.listAllContainers().catch((error: unknown) => {
        containerListError = getUnknownErrorMessage(error);
        log.warn({ error }, 'Failed to list containers for host diagnosis');
        return [] as DockerContainerRow[];
      })
    : [];

  const runningContainerCount = allContainers.filter(
    (container) => container.state === 'running',
  ).length;
  const sampleLimitReached = runningContainerCount > HOST_DIAGNOSTIC_STATS_SAMPLE_LIMIT;
  const resourceSummaries = await summarizeContainerResources(
    appCtx,
    allContainers,
    HOST_DIAGNOSTIC_STATS_SAMPLE_LIMIT,
  );
  const topByMemory = [...resourceSummaries]
    // Failed or empty stats are represented as null and sorted to the bottom.
    .sort((a, b) => (b.memoryUsageMb ?? -1) - (a.memoryUsageMb ?? -1))
    .slice(0, containerLimit);
  const topByCpu = [...resourceSummaries]
    // Failed or empty stats are represented as null and sorted to the bottom.
    .sort((a, b) => (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1))
    .slice(0, containerLimit);
  const diskUsage = includeDiskUsage
    ? await summarizeDockerDiskUsage(appCtx)
    : ({ available: false, skipped: true } as const);
  const containerCounts = summarizeContainerCounts(allContainers);
  const findings = buildHostResourceFindings({
    dockerReachable,
    containerListError,
    systemStats,
    topByMemory,
    diskUsage,
  });

  return {
    docker: {
      reachable: dockerReachable,
      status: dockerStatus,
    },
    system: {
      summary: formatStatsSummary(systemStats),
      cpu: systemStats.cpu,
      memory: systemStats.memory,
      disk: systemStats.disk,
    },
    units: {
      cpuPercent: 'percent',
      memoryMb: 'MB decimal',
      diskMb: 'MB decimal',
    },
    containers: {
      ...containerCounts,
      listError: containerListError,
      sampled: resourceSummaries.length,
      statsSampleLimit: HOST_DIAGNOSTIC_STATS_SAMPLE_LIMIT,
      sampleLimitReached,
      topByMemory,
      topByCpu,
    },
    dockerDiskUsage: diskUsage,
    findings,
    _agent_guidance: {
      message:
        findings.length > 0
          ? 'Host resource pressure or Docker instability may explain deploy/runtime failures.'
          : 'No obvious host-level resource pressure detected from this read-only check.',
      next_steps: buildHostResourceNextSteps(findings),
    },
  };
}

async function summarizeContainerResources(
  appCtx: AppCtx,
  containers: DockerContainerRow[],
  sampleLimit: number,
): Promise<ContainerResourceSummary[]> {
  const running = containers
    .filter((container) => container.state === 'running')
    .slice(0, sampleLimit);
  const settled = await Promise.allSettled(
    running.map(async (container) => ({
      container,
      stats: summarizeDockerStats(await appCtx.docker.getContainerStats(container.id)),
    })),
  );

  return settled.flatMap((result): ContainerResourceSummary[] => {
    if (result.status === 'rejected') {
      log.debug({ error: result.reason }, 'Container resource stats unavailable');
      return [];
    }

    const { container, stats } = result.value;
    return [
      {
        id: container.id,
        name: container.name,
        image: container.image,
        state: container.state,
        status: container.status,
        managedByOpenLander: container.managedByOpenLander,
        role: container.labels[DOCKER_LABELS.ROLE] ?? null,
        project: container.labels[DOCKER_LABELS.PROJECT] ?? null,
        service: container.labels[DOCKER_LABELS.SERVICE] ?? null,
        composeProject: container.composeProject,
        cpuPercent: stats.cpuPercent,
        memoryUsageMb: stats.memoryUsageMb,
        memoryLimitMb: stats.memoryLimitMb,
      },
    ];
  });
}

function summarizeDockerStats(stats: unknown): {
  cpuPercent: number | null;
  memoryUsageMb: number | null;
  memoryLimitMb: number | null;
} {
  const root = asPlainRecord(stats);
  const cpuStats = asPlainRecord(root['cpu_stats']);
  const preCpuStats = asPlainRecord(root['precpu_stats']);
  const cpuUsage = asPlainRecord(cpuStats['cpu_usage']);
  const preCpuUsage = asPlainRecord(preCpuStats['cpu_usage']);
  const cpuDelta =
    toFiniteNumber(cpuUsage['total_usage']) - toFiniteNumber(preCpuUsage['total_usage']);
  const systemDelta =
    toFiniteNumber(cpuStats['system_cpu_usage']) - toFiniteNumber(preCpuStats['system_cpu_usage']);
  const percpu = Array.isArray(cpuUsage['percpu_usage']) ? cpuUsage['percpu_usage'] : [];
  const onlineCpus = toFiniteNumber(cpuStats['online_cpus']);
  const cpuCount = onlineCpus > 0 ? onlineCpus : Math.max(percpu.length, 1);
  const cpuPercent =
    systemDelta > 0 && cpuDelta >= 0
      ? roundResourceMetric((cpuDelta / systemDelta) * cpuCount * 100)
      : null;

  const memoryStats = asPlainRecord(root['memory_stats']);
  const memoryUsage = toFiniteNumber(memoryStats['usage']);
  const memoryLimit = toFiniteNumber(memoryStats['limit']);
  return {
    cpuPercent,
    memoryUsageMb: memoryUsage > 0 ? roundResourceMetric(memoryUsage / 1e6) : null,
    memoryLimitMb: memoryLimit > 0 ? roundResourceMetric(memoryLimit / 1e6) : null,
  };
}

async function summarizeDockerDiskUsage(appCtx: AppCtx): Promise<DockerDiskUsageSummary> {
  try {
    const raw = await appCtx.docker.getDiskUsage(8_000);
    const record = asPlainRecord(raw);
    const images = Array.isArray(record['Images']) ? record['Images'] : [];
    const containers = Array.isArray(record['Containers']) ? record['Containers'] : [];
    const volumes = Array.isArray(record['Volumes']) ? record['Volumes'] : [];
    return {
      available: true,
      images: { count: images.length, totalSizeMb: roundResourceMetric(sumSizeMb(images, 'Size')) },
      containers: {
        count: containers.length,
        totalSizeMb: roundResourceMetric(sumSizeMb(containers, 'SizeRw')),
      },
      volumes: {
        count: volumes.length,
        totalSizeMb: roundResourceMetric(sumVolumeUsageMb(volumes)),
      },
    };
  } catch (error) {
    return {
      available: false,
      error: getUnknownErrorMessage(error),
      images: { count: 0, totalSizeMb: 0 },
      containers: { count: 0, totalSizeMb: 0 },
      volumes: { count: 0, totalSizeMb: 0 },
    };
  }
}

function summarizeContainerCounts(containers: DockerContainerRow[]): Record<string, number> {
  const running = containers.filter((container) => container.state === 'running').length;
  const exited = containers.filter((container) => container.state === 'exited').length;
  const openlanderManaged = containers.filter((container) => container.managedByOpenLander).length;
  return {
    total: containers.length,
    running,
    exited,
    openlanderManaged,
    unmanaged: containers.length - openlanderManaged,
  };
}

function buildHostResourceFindings(input: {
  dockerReachable: boolean;
  containerListError: string | null;
  systemStats: ReturnType<typeof getSystemStats>;
  topByMemory: ContainerResourceSummary[];
  diskUsage: DockerDiskUsageSummary | { available: false; skipped: true };
}): string[] {
  const findings: string[] = [];
  if (!input.dockerReachable) {
    findings.push('docker_unreachable');
  }
  if (input.containerListError) {
    findings.push('docker_container_list_unavailable');
  }
  if (input.systemStats.memory.usagePercent >= 85) {
    findings.push('host_memory_high');
  }
  if (input.systemStats.disk.usagePercent >= 90) {
    findings.push('host_disk_high');
  }
  const hostTotalMb = input.systemStats.memory.totalMB;
  const memoryHeavy = input.topByMemory.find(
    (container) =>
      container.memoryUsageMb !== null &&
      hostTotalMb > 0 &&
      container.memoryUsageMb / hostTotalMb > 0.4,
  );
  if (memoryHeavy) {
    findings.push('container_memory_hotspot');
  }
  if ('error' in input.diskUsage && input.diskUsage.error) {
    findings.push('docker_disk_usage_unavailable');
  }
  return findings;
}

function buildHostResourceNextSteps(findings: string[]): string[] {
  if (findings.length === 0) {
    return [
      'Continue with service-level diagnosis using diagnose_service if one service is unhealthy.',
      'If a build was killed, inspect the build log for SIGKILL/OOM details before retrying.',
    ];
  }

  const steps: string[] = [];
  if (findings.includes('docker_unreachable')) {
    steps.push(
      'Docker is not reachable from OpenLander; ask the operator to check Docker Desktop/daemon.',
    );
  }
  if (findings.includes('docker_container_list_unavailable')) {
    steps.push(
      'Docker is reachable, but OpenLander could not list containers; ask the operator to check Docker socket permissions or daemon responsiveness.',
    );
  }
  if (findings.includes('host_memory_high') || findings.includes('container_memory_hotspot')) {
    steps.push(
      'Review containers.topByMemory before retrying builds; free memory or stop non-critical workloads outside OpenLander if needed.',
    );
  }
  if (findings.includes('host_disk_high')) {
    steps.push(
      'Call openlander_managed_service.get_disk_usage to confirm Docker disk pressure; cleanup_docker is human-UI / host-maintenance only and blocked over MCP.',
    );
  }
  if (findings.includes('docker_disk_usage_unavailable')) {
    steps.push(
      'Docker disk usage did not respond; avoid host cleanup until Docker responsiveness is confirmed.',
    );
  }
  steps.push('After addressing host pressure, retry redeploy_app for the affected service_id.');
  return steps;
}

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sumSizeMb(items: unknown[], key: string): number {
  return items.reduce<number>(
    (sum, item) => sum + toFiniteNumber(asPlainRecord(item)[key]) / 1e6,
    0,
  );
}

function sumVolumeUsageMb(items: unknown[]): number {
  return items.reduce<number>((sum, item) => {
    const record = asPlainRecord(item);
    const usageData = asPlainRecord(record['UsageData']);
    return sum + toFiniteNumber(usageData['Size']) / 1e6;
  }, 0);
}

function roundResourceMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

function getUnknownErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isManagedService(kind: string): boolean {
  return (MANAGED_SERVICE_KINDS as readonly string[]).includes(kind);
}

function normalizeContainerName(name: string): string {
  return name.replace(/^\//, '').trim();
}

function matchesServiceAlias(service: ServiceRow, value: string): boolean {
  const normalized = normalizeContainerName(value);
  return (
    service.name === value ||
    service.id === value ||
    service.container_name === normalized ||
    service.container_id === value
  );
}

async function resolveProjectScope(
  projectName: string,
  context: ToolContext,
): Promise<ProjectRow | undefined> {
  if (!projectName) return undefined;
  return (
    (await context.appCtx.db.getProject(projectName)) ??
    (await context.appCtx.db.getProjectByName(projectName))
  );
}

async function serviceSelectionCandidates(
  services: ServiceRow[],
  context: ToolContext,
): Promise<Array<Record<string, unknown>>> {
  return Promise.all(
    services.map(async (service) => {
      const project = await context.appCtx.db.getProject(service.project_id);
      return {
        serviceId: service.id,
        serviceName: service.name,
        projectId: service.project_id,
        projectName: project?.name ?? service.project_id,
        kind: service.kind,
        source: service.source,
      };
    }),
  );
}

async function resolveSingleDeployableProjectAlias(
  projectName: string,
  context: ToolContext,
): Promise<ServiceRow | undefined> {
  const project = await resolveProjectScope(projectName, context);
  if (!project) return undefined;

  const deployables =
    typeof context.appCtx.db.getDeployablesByGroup === 'function'
      ? await context.appCtx.db.getDeployablesByGroup(project.id)
      : (await context.appCtx.db.listServices()).filter((item) => item.project_id === project.id);
  const filtered = deployables.filter((item) => !isManagedService(item.kind));
  if (filtered.length > 1) {
    throw new OpenLanderError(
      `Project '${projectName}' has multiple Applications/Compose workloads. Specify service_id or service_name.`,
      'SERVICE_SELECTION_REQUIRED',
      400,
      {
        projectId: project.id,
        projectName: project.name,
        candidates: await serviceSelectionCandidates(filtered, context),
      },
    );
  }
  return filtered[0];
}

async function resolveDeployableServiceForMonitoring(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ResolvedDeployableService> {
  const serviceId = typeof args.service_id === 'string' ? args.service_id.trim() : '';
  const serviceName = typeof args.service_name === 'string' ? args.service_name.trim() : '';
  const containerName =
    typeof args.container_name === 'string' ? normalizeContainerName(args.container_name) : '';
  const projectId = typeof args.project_id === 'string' ? args.project_id.trim() : '';
  const projectName = typeof args.project_name === 'string' ? args.project_name.trim() : '';
  const projectIdentifier = projectId || projectName;

  let service: ServiceRow | undefined;
  let projectScope: ProjectRow | undefined;

  if (serviceId) {
    service = await context.appCtx.db.getService(serviceId);
  } else if (serviceName) {
    projectScope = await resolveProjectScope(projectIdentifier, context);
    if (projectIdentifier && !projectScope) {
      throw new ProjectNotFoundError(projectIdentifier);
    }
    const services = await context.appCtx.db.listServices();
    const named = services.filter((item) => matchesServiceAlias(item, serviceName));
    const projectScopeId = projectScope?.id;
    const scoped = projectScopeId
      ? named.filter((item) => item.project_id === projectScopeId)
      : named;
    const deployable = scoped.filter((item) => !isManagedService(item.kind));
    if (deployable.length > 1) {
      throw new OpenLanderError(
        `Multiple Applications/Compose workloads named '${serviceName}' found. Specify project_name or service_id.`,
        'SERVICE_SELECTION_REQUIRED',
        400,
        {
          serviceName,
          candidates: await serviceSelectionCandidates(deployable, context),
        },
      );
    }
    service = deployable[0] ?? scoped[0];
    if (!service && !projectIdentifier) {
      service = await resolveSingleDeployableProjectAlias(serviceName, context);
    }
  } else if (containerName) {
    projectScope = await resolveProjectScope(projectIdentifier, context);
    if (projectIdentifier && !projectScope) {
      throw new ProjectNotFoundError(projectIdentifier);
    }
    const services = await context.appCtx.db.listServices();
    const projectScopeId = projectScope?.id;
    const scoped = services.filter(
      (item) =>
        item.container_name === containerName &&
        !isManagedService(item.kind) &&
        (!projectScopeId || item.project_id === projectScopeId),
    );
    if (scoped.length > 1) {
      throw new OpenLanderError(
        `Multiple Applications/Compose workloads use container '${containerName}'. Specify project_name or service_id.`,
        'SERVICE_SELECTION_REQUIRED',
        400,
        {
          containerName,
          candidates: await serviceSelectionCandidates(scoped, context),
        },
      );
    }
    service = scoped[0];
  } else if (projectIdentifier) {
    projectScope = await resolveProjectScope(projectIdentifier, context);
    if (!projectScope) {
      throw new ProjectNotFoundError(projectIdentifier);
    }
    const deployables =
      typeof context.appCtx.db.getDeployablesByGroup === 'function'
        ? await context.appCtx.db.getDeployablesByGroup(projectScope.id)
        : (await context.appCtx.db.listServices()).filter(
            (item) => item.project_id === projectScope?.id,
          );
    const filtered = deployables.filter((item) => !isManagedService(item.kind));
    if (filtered.length > 1) {
      throw new OpenLanderError(
        `Project '${projectIdentifier}' has multiple Applications/Compose workloads. Specify service_id or service_name.`,
        'SERVICE_SELECTION_REQUIRED',
        400,
        {
          projectName: projectIdentifier,
          candidates: await serviceSelectionCandidates(filtered, context),
        },
      );
    }
    service = filtered[0];
  }

  if (!service) {
    throw new ServiceNotFoundError(
      serviceId || serviceName || containerName || projectIdentifier || 'unknown',
    );
  }
  if (isManagedService(service.kind)) {
    throw new ServiceOperationUnsupportedError('diagnose_service', service.kind);
  }

  const project = await context.appCtx.db.getProject(service.project_id);
  if (!project) {
    throw new ProjectNotFoundError(service.project_id);
  }
  if (projectIdentifier && projectIdentifier !== project.id && projectIdentifier !== project.name) {
    throw new ServiceNotFoundError(`${service.name} in ${projectIdentifier}`);
  }

  const runtimeProjectId = deployableServiceIdToProjectId(service.id);
  const runtimeProject = (await context.appCtx.db.getProject(runtimeProjectId)) ?? project;
  return { service, project, runtimeProject };
}

function sanitizeRepoUrl(repoUrl: string | null): string | null {
  if (!repoUrl) return null;
  try {
    const parsed = new URL(repoUrl);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? '***' : '';
      parsed.password = parsed.password ? '***' : '';
    }
    return parsed.toString();
  } catch {
    return repoUrl.replace(/:\/\/[^/@]+@/, '://***@');
  }
}

const SECRET_ASSIGNMENT_RE =
  /\b([A-Z0-9_]*(?:DATABASE_URL|REDIS_URL|POSTGRES_URL|MYSQL_URL|MONGO_URL|MONGODB_URI|TOKEN|SECRET|PASSWORD|PASS|PWD|KEY|DSN|URI)[A-Z0-9_]*)\s*=\s*(["']?)[^\s"']+\2/gi;

const FREE_TEXT_SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer ***'],
  [/\bBasic\s+[A-Za-z0-9._~+/-]+=*/gi, 'Basic ***'],
  [/\bgithub_pat_[A-Za-z0-9_-]+\b/g, 'github_pat_***'],
  [/\bgh([pousr])_[A-Za-z0-9_]{8,}\b/g, 'gh$1_***'],
  [/\bxox([baprs])-[A-Za-z0-9-]+\b/g, 'xox$1-***'],
  // Anthropic must precede the OpenAI alternative — `sk-ant-…` would
  // otherwise match the more general `sk-…{20,}` pattern and lose the
  // provider hint in the masked output.
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, 'anthropic_***'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, 'openai_***'],
  [/\b(?:stripe_)?(sk|rk)_(live|test)_[A-Za-z0-9_]+\b/g, '$1_$2_***'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, 'aws_***'],
  [/\bAIza[A-Za-z0-9_-]{35}\b/g, 'google_***'],
  [/\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g, 'sendgrid_***'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, 'jwt_***'],
];

function sanitizeDiagnosticText(value: string | null | undefined): string | null {
  if (!value) return null;
  const sanitizedUrl = sanitizeRepoUrl(value) ?? value;
  return FREE_TEXT_SECRET_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    sanitizedUrl.replace(SECRET_ASSIGNMENT_RE, '$1=***'),
  );
}

function sortedKeys(record: Record<string, string>): string[] {
  return Object.keys(record).sort((a, b) => a.localeCompare(b));
}

function isBuildTimeEnvKey(key: string): boolean {
  return BUILD_TIME_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function summarizeEnvKeys(groupEnv: Record<string, string>, serviceEnv: Record<string, string>) {
  const groupKeys = sortedKeys(groupEnv);
  const serviceKeys = sortedKeys(serviceEnv);
  const effectiveKeys = sortedKeys({ ...groupEnv, ...serviceEnv });
  const buildTimeKeys = effectiveKeys.filter(isBuildTimeEnvKey);
  return {
    count: effectiveKeys.length,
    keys: effectiveKeys,
    groupKeys,
    serviceKeys,
    buildTimeKeys,
    runtimeOnlyKeys: effectiveKeys.filter((key) => !isBuildTimeEnvKey(key)),
    masked: true,
    note: 'Only environment variable keys are returned. Values are intentionally not exposed.',
  };
}

function tailLines(text: string | null | undefined, lines: number): string | null {
  if (!text) return null;
  return text.split(/\r?\n/).slice(-lines).join('\n');
}

function sanitizedTailLines(text: string | null | undefined, lines: number): string | null {
  return tailLines(sanitizeDiagnosticText(text), lines);
}

function summarizeRecentDeployments(logs: DeployLogRow[]) {
  const latest = logs[0];
  return {
    count: logs.length,
    latest: latest
      ? {
          id: latest.id,
          status: latest.status,
          trigger: latest.trigger,
          commitSha: latest.commit_sha,
          commitMessage: latest.commit_message,
          durationMs: latest.duration_ms,
          createdAt: latest.created_at,
          buildLogTail: sanitizedTailLines(latest.build_log, 30),
          buildLogTailSanitized: true,
          fullBuildLogHint:
            'Call get_build_log for full raw build output and captured runtime logs.',
        }
      : null,
    history: logs.slice(0, 5).map((entry) => ({
      id: entry.id,
      status: entry.status,
      trigger: entry.trigger,
      commitSha: entry.commit_sha,
      createdAt: entry.created_at,
    })),
  };
}

function diagnoseBuildTimeEnv(env: Record<string, string>, logs: DeployLogRow[]) {
  const text = logs
    .map((entry) =>
      [entry.build_log, entry.runtime_log, entry.trigger_detail].filter(Boolean).join('\n'),
    )
    .join('\n');
  const effectiveKeys = sortedKeys(env);
  const referencedRuntimeOnly = effectiveKeys.filter(
    (key) => !isBuildTimeEnvKey(key) && new RegExp(`\\b${escapeRegExp(key)}\\b`).test(text),
  );
  const missingAtBuild = referencedRuntimeOnly.filter((key) =>
    new RegExp(
      `${escapeRegExp(key)}[^\\n]{0,80}(is not set|missing|required)|(?:is not set|missing|required)[^\\n]{0,80}${escapeRegExp(key)}`,
      'i',
    ).test(text),
  );

  const warnings: string[] = [];
  if (missingAtBuild.length > 0) {
    warnings.push(
      `${missingAtBuild.join(', ')} exists in runtime env but is not passed to Docker build because it does not use an allowed public build-time prefix.`,
    );
  }

  return {
    allowedPrefixes: BUILD_TIME_PREFIXES,
    buildTimeKeys: effectiveKeys.filter(isBuildTimeEnvKey),
    referencedRuntimeOnlyKeys: referencedRuntimeOnly,
    suspectedMissingBuildTimeKeys: missingAtBuild,
    warnings,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return asRecord(record[key]) ?? {};
}

function getString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function getNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' ? value : null;
}

async function summarizeContainer(
  appCtx: AppCtx,
  service: ServiceRow,
): Promise<Record<string, unknown>> {
  if (!service.container_id) {
    return {
      present: false,
      running: false,
      serviceStatus: service.status,
      reason: 'service has no container_id',
    };
  }

  try {
    const rawInspect = asRecord(await appCtx.docker.inspectContainer(service.container_id)) ?? {};
    const state = getNestedRecord(rawInspect, 'State');
    const config = getNestedRecord(rawInspect, 'Config');
    return {
      present: true,
      id: service.container_id,
      name: service.container_name ?? getString(rawInspect, 'Name')?.replace(/^\//, '') ?? null,
      running: state['Running'] === true,
      status: getString(state, 'Status'),
      exitCode: getNumber(state, 'ExitCode'),
      error: sanitizeDiagnosticText(getString(state, 'Error')),
      startedAt: getString(state, 'StartedAt'),
      finishedAt: getString(state, 'FinishedAt'),
      restartCount: getNumber(rawInspect, 'RestartCount'),
      inspectName: getString(rawInspect, 'Name')?.replace(/^\//, '') ?? null,
      image: sanitizeDiagnosticText(
        getString(config, 'Image') ?? service.image_tag ?? service.image_url,
      ),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      present: false,
      running: false,
      id: service.container_id,
      error: sanitizeDiagnosticText(message),
      _agent_guidance: {
        next_steps: ['Container inspect failed. Verify the container still exists on the host.'],
      },
    };
  }
}

async function readServiceLogs(
  appCtx: AppCtx,
  runtimeProjectId: string,
  lines: number,
): Promise<Record<string, unknown>> {
  try {
    return {
      available: true,
      tail: sanitizeDiagnosticText(await appCtx.pipeline.getLogs(runtimeProjectId, lines)),
      sanitized: true,
    };
  } catch (err) {
    return {
      available: false,
      error: sanitizeDiagnosticText(err instanceof Error ? err.message : String(err)),
    };
  }
}

function normalizeProbePath(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname || '/';
    return pathname.startsWith('/') ? pathname : `/${pathname}`;
  } catch {
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }
}

function inferBasePathFromEnv(env: Record<string, string>): string | null {
  const candidateKeys = [
    'NEXT_PUBLIC_BASE_PATH',
    'PUBLIC_BASE_PATH',
    'VITE_BASE_PATH',
    'REACT_APP_BASE_PATH',
    'APP_BASE_PATH',
    'BASE_PATH',
    'PUBLIC_URL',
    'NEXTAUTH_URL',
  ];
  for (const key of candidateKeys) {
    const path = normalizeProbePath(env[key]);
    if (path && path !== '/') return path;
  }
  return null;
}

function selectServiceProbePath(input: {
  requestedPath?: string;
  healthCheckPath?: string | null;
  env: Record<string, string>;
}): string {
  return (
    normalizeProbePath(input.requestedPath) ??
    inferBasePathFromEnv(input.env) ??
    normalizeProbePath(input.healthCheckPath) ??
    '/'
  );
}

async function probeServiceHttp(
  appCtx: AppCtx,
  service: ServiceRow,
  path: string,
  timeoutMs: number,
  options: { internal?: boolean } = {},
): Promise<Record<string, unknown>> {
  // `internal=true` answers "is the app serving inside its own container?"
  // Default mode answers "can OpenLander reach the service over Docker DNS?"
  if (options.internal) {
    if (!service.container_id) {
      return {
        skipped: true,
        reason: 'service has no container_id yet — wait for deploy to start the container',
      };
    }
    const containerPort = service.container_port ?? service.assigned_port;
    if (!containerPort) {
      return {
        skipped: true,
        reason: 'service has no container_port or assigned_port',
      };
    }
    const startedAt = Date.now();
    const targetUrl = `http://127.0.0.1:${String(containerPort)}${path}`;
    const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
    const cmd = [
      'sh',
      '-c',
      // wget first (BusyBox/Alpine default); fall back to curl for Debian-ish
      // distros. Both run with a TCP-only timeout so the exec returns within
      // timeoutSec even on a hung socket. `2>&1` so we get useful stderr in
      // the response on failure.
      `wget -qO- --timeout=${String(timeoutSec)} ${targetUrl} 2>&1 || curl -sf --max-time ${String(timeoutSec)} ${targetUrl} 2>&1`,
    ];
    try {
      const result = await appCtx.docker.execSimple(service.container_id, cmd);
      const latencyMs = Date.now() - startedAt;
      const reachable = result.exitCode === 0;
      const probeToolUnavailable = result.exitCode === 127;
      const output = result.stderr.trim() || result.stdout.trim();
      return {
        reachable,
        latency_ms: latencyMs,
        protocol_used: 'http',
        target_resolved: `${service.container_id.slice(0, 12)}:${String(containerPort)}${path}`,
        probed_from: 'service-container',
        ...(reachable ? {} : { error: output || `exit code ${String(result.exitCode)}` }),
        ...(probeToolUnavailable ? { probe_tool_unavailable: true } : {}),
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        reachable: false,
        latency_ms: latencyMs,
        error: errorMsg,
        protocol_used: 'http',
        target_resolved: `${service.container_id.slice(0, 12)}:${String(containerPort)}${path}`,
        probed_from: 'service-container',
      };
    }
  }

  if (service.container_name && service.container_port) {
    const internalUrl = `http://${service.container_name}:${String(service.container_port)}${path}`;
    const internalResult = await probeInternal(
      appCtx,
      'http',
      service.container_name,
      service.container_port,
      path,
      timeoutMs,
      internalUrl,
      service.container_id ?? undefined,
      true,
    );
    if (
      internalResult['reachable'] === true ||
      (internalResult['error'] !== 'No running managed containers available for internal probe' &&
        internalResult['probe_tool_unavailable'] !== true)
    ) {
      return {
        ...internalResult,
        probe_mode: 'internal_docker_dns',
      };
    }
  }

  if (!service.assigned_port) {
    return {
      skipped: true,
      reason: 'service has no internal container port or assigned host port',
    };
  }
  const host = resolveContainerHost();
  const url = `http://${host}:${String(service.assigned_port)}${path}`;
  return probeHttp(url, timeoutMs, 'http', url, Date.now()).then((result) => ({
    ...result,
    probe_mode: 'host_port_fallback',
  }));
}

interface DependencyTarget {
  key: string;
  protocol: 'tcp' | 'http' | 'https';
  host: string;
  port: number;
  display: string;
}

function defaultPortForProtocol(protocol: string): number | undefined {
  switch (protocol) {
    case 'postgres:':
    case 'postgresql:':
      return 5432;
    case 'mysql:':
      return 3306;
    case 'redis:':
      return 6379;
    case 'mongodb:':
    case 'mongo:':
      return 27017;
    case 'http:':
      return 80;
    case 'https:':
      return 443;
    default:
      return undefined;
  }
}

function envDependencyTargets(env: Record<string, string>): DependencyTarget[] {
  const targets: DependencyTarget[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!/(URL|URI|DSN|DATABASE|REDIS|POSTGRES|MYSQL|MONGO)/i.test(key)) continue;
    try {
      const parsed = new URL(value);
      const port = parsed.port ? Number(parsed.port) : defaultPortForProtocol(parsed.protocol);
      if (!parsed.hostname || !port || port < 1 || port > 65535) continue;
      const probeProtocol =
        parsed.protocol === 'http:' || parsed.protocol === 'https:'
          ? parsed.protocol.slice(0, -1)
          : 'tcp';
      targets.push({
        key,
        protocol: probeProtocol as 'tcp' | 'http' | 'https',
        host: parsed.hostname,
        port,
        display: `${parsed.protocol}//${parsed.hostname}:${String(port)}`,
      });
    } catch {
      continue;
    }
  }
  return targets.slice(0, 8);
}

async function probeEnvDependencies(
  appCtx: AppCtx,
  env: Record<string, string>,
  timeoutMs: number,
  preferredContainerId?: string,
  requirePreferredContainer = false,
): Promise<Record<string, unknown>> {
  const targets = envDependencyTargets(env);
  if (targets.length === 0) {
    return { count: 0, checks: [] };
  }

  const checks = await Promise.all(
    targets.map(async (target) => {
      const result =
        target.protocol === 'tcp'
          ? await probeInternal(
              appCtx,
              'tcp',
              target.host,
              target.port,
              '/',
              timeoutMs,
              target.display,
              preferredContainerId,
              requirePreferredContainer,
            )
          : await probeHttp(
              `${target.protocol}://${target.host}:${String(target.port)}/`,
              timeoutMs,
              target.protocol,
              target.display,
              Date.now(),
            );
      return {
        key: target.key,
        target: target.display,
        protocol: target.protocol,
        host: target.host,
        port: target.port,
        reachable: result['reachable'] === true,
        error: typeof result['error'] === 'string' ? sanitizeDiagnosticText(result['error']) : null,
      };
    }),
  );

  return { count: checks.length, checks };
}

function buildDiagnoseNextSteps(input: {
  service: ServiceRow;
  recentDeployment: Record<string, unknown>;
  buildDiagnostics: Record<string, unknown>;
  container: Record<string, unknown>;
  httpCheck: Record<string, unknown>;
  dependencies: Record<string, unknown>;
}): string[] {
  const nextSteps: string[] = [];
  const suspected = input.buildDiagnostics['suspectedMissingBuildTimeKeys'];
  if (Array.isArray(suspected) && suspected.length > 0) {
    nextSteps.push(
      `${suspected.join(', ')} is currently runtime-only. If the app reads it during Docker/Next build, change the app so build does not require the secret, or add an explicit safe build-time variable path before retrying redeploy_app.`,
    );
  }

  if (input.container['status'] === 'restarting') {
    nextSteps.push(
      'Container is in a restart loop. Check logs.tail and recentDeployment.buildLogTail, then redeploy_app after fixing the startup crash.',
    );
  } else if (input.container['running'] !== true) {
    nextSteps.push(
      'Container is not running. Check recentDeployment.buildLogTail, then call redeploy_app after fixing the cause.',
    );
  } else if (input.httpCheck['reachable'] === false) {
    nextSteps.push(
      'Container is running but HTTP probe failed. Check logs.tail and verify the service listens on the configured container port/path.',
    );
  }

  const latestDeployment = asRecord(input.recentDeployment['latest']) ?? {};
  const buildLogTail =
    typeof latestDeployment['buildLogTail'] === 'string' ? latestDeployment['buildLogTail'] : '';
  if (/\b(SIGKILL|OOM|out of memory|killed)\b/i.test(buildLogTail)) {
    nextSteps.push(
      'Build/runtime logs suggest host resource pressure. Call openlander_monitor.diagnose_host_resources before retrying.',
    );
  }

  const depChecks = asRecord(input.dependencies)?.['checks'];
  if (
    Array.isArray(depChecks) &&
    depChecks.some((item) => asRecord(item)?.['reachable'] === false)
  ) {
    nextSteps.push(
      'One or more declared dependency endpoints are unreachable from Docker. Fix service host/port/env values, then call redeploy_app.',
    );
  }

  if (nextSteps.length === 0) {
    nextSteps.push(
      'No obvious backend issue detected. If behavior is still wrong, inspect logs.tail and recentDeployment.latest.buildLogTail for app-level errors.',
    );
  }
  nextSteps.push(
    'For existing services, call openlander_deploy.deploy_app with service_id/service_name/name, or call openlander_service.redeploy_app directly with service_id.',
  );
  return nextSteps;
}

interface SynthesizedServiceDiagnosis {
  code:
    | 'PORT_MISMATCH'
    | 'ROUTE_BACKEND_MISMATCH'
    | 'RUNTIME_ENV_MISSING'
    | 'BUILD_TIME_ENV_MISSING'
    | 'NO_RUNTIME_IMAGE'
    | 'RESTART_LOOP'
    | 'CONTAINER_NOT_RUNNING'
    | 'DEPENDENCY_UNREACHABLE';
  confidence: 'high';
  summary: string;
  evidence: Record<string, unknown>;
  suggested_call?: SuggestedServiceDiagnosisCall;
}

type SuggestedServiceDiagnosisCall =
  | {
      tool: 'openlander_service';
      action: 'apply_route_config';
      params: { service_id: string; container_port: number };
    }
  | {
      tool: 'openlander_service';
      action: 'set_env_vars';
      params: {
        service_id: string;
        scope: 'service';
        variables: Record<string, string>;
        defer_redeploy: false;
      };
    }
  | {
      tool: 'openlander_service';
      action: 'redeploy_app';
      params: { service_id: string };
    };

function resolveHttpProviderContainerName(service: ServiceRow, project: ProjectRow): string | null {
  if (service.container_name) {
    return service.container_name;
  }
  if (service.id === projectIdToDeployableServiceId(project.id)) {
    return project.name;
  }
  return null;
}

function summarizeRouteState(input: {
  service: ServiceRow;
  project: ProjectRow;
  container: Record<string, unknown>;
  httpCheck: Record<string, unknown>;
  internalHttpCheck: Record<string, unknown> | null;
}): Record<string, unknown> {
  const backendContainerName = resolveHttpProviderContainerName(input.service, input.project);
  const backendPort = input.service.container_port ?? input.service.assigned_port ?? null;
  const inspectedContainerName =
    typeof input.container['inspectName'] === 'string'
      ? input.container['inspectName']
      : typeof input.container['name'] === 'string'
        ? input.container['name']
        : null;
  const issues: Array<{ code: string; message: string }> = [];

  if (!backendContainerName) {
    issues.push({
      code: 'missing_backend_container_name',
      message: 'The managed HTTP provider cannot resolve a container name for this service.',
    });
  }
  if (!backendPort) {
    issues.push({
      code: 'missing_backend_port',
      message: 'The managed HTTP provider cannot resolve a backend port for this service.',
    });
  }
  if (
    input.container['running'] === true &&
    backendContainerName &&
    inspectedContainerName &&
    backendContainerName !== inspectedContainerName
  ) {
    issues.push({
      code: 'backend_container_name_mismatch',
      message: `The HTTP provider backend is ${backendContainerName}, but Docker inspect reports ${inspectedContainerName}.`,
    });
  }
  if (input.httpCheck['reachable'] === false && input.internalHttpCheck?.['reachable'] === true) {
    issues.push({
      code: 'external_route_failed_internal_probe_passed',
      message:
        'The service responds inside its container, but the normal OpenLander route probe fails.',
    });
  }

  return {
    provider: 'traefik_http',
    backend: {
      container_name: backendContainerName,
      container_port: input.service.container_port ?? null,
      assigned_port: input.service.assigned_port ?? null,
      resolved_port: backendPort,
    },
    inspected_container: {
      id: input.container['id'] ?? null,
      name: inspectedContainerName,
      running: input.container['running'] === true,
    },
    internal_probe_reachable: input.internalHttpCheck?.['reachable'] ?? null,
    issues,
    consistent: issues.length === 0,
  };
}

function extractListeningPort(text: string): number | null {
  const patterns = [
    /\b(?:listening|listen|started|server|ready|running)\b[^\n]{0,100}\b(?:on\s+)?(?:port\s+)?(\d{2,5})\b/i,
    /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const rawPort = match?.[1];
    if (!rawPort) continue;
    const port = Number(rawPort);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) {
      return port;
    }
  }
  return null;
}

function extractMissingEnvKeys(text: string): string[] {
  const keys = new Set<string>();
  const patterns = [
    /\b([A-Z][A-Z0-9_]{1,})\b[^\n]{0,80}\b(?:is\s+)?(?:not\s+set|missing|required|undefined)\b/g,
    /\b(?:[Mm]issing|[Rr]equired|[Uu]ndefined)\b[^\n]{0,80}\b(?:env(?:ironment)?(?: variable)?\s+)?([A-Z][A-Z0-9_]{1,})\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const key = match[1];
      if (key && key.length <= 80) {
        keys.add(key);
      }
    }
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function isKnownRuntimeEnvKey(key: string): boolean {
  return (
    /^(DATABASE_URL|REDIS_URL|POSTGRES_URL|POSTGRESQL_URL|MYSQL_URL|MONGO_URL|MONGODB_URI|RABBITMQ_URL|AMQP_URL|S3_ENDPOINT|S3_ACCESS_KEY|S3_SECRET_KEY)$/.test(
      key,
    ) || /_(URL|URI|DSN|HOST|PORT|TOKEN|SECRET|PASSWORD|PASS|PWD|KEY|ENDPOINT)$/.test(key)
  );
}

function hasRuntimeImage(service: ServiceRow, container: Record<string, unknown>): boolean {
  return Boolean(
    service.image_tag ||
    service.image_url ||
    (typeof container['image'] === 'string' && container['image'].length > 0),
  );
}

function setEnvVarsSuggestedCall(serviceId: string, keys: string[]): SuggestedServiceDiagnosisCall {
  const variables: Record<string, string> = {};
  for (const key of keys) {
    variables[key] = `<${key}_value>`;
  }
  return {
    tool: 'openlander_service',
    action: 'set_env_vars',
    params: {
      service_id: serviceId,
      scope: 'service',
      variables,
      defer_redeploy: false,
    },
  };
}

function redeploySuggestedCall(serviceId: string): SuggestedServiceDiagnosisCall {
  return {
    tool: 'openlander_service',
    action: 'redeploy_app',
    params: { service_id: serviceId },
  };
}

function nextStepsForDiagnosis(
  diagnosis: SynthesizedServiceDiagnosis,
  fallback: string[],
): string[] {
  if (!diagnosis.suggested_call) {
    return fallback;
  }
  const call = diagnosis.suggested_call;
  if (call.action === 'apply_route_config') {
    return [
      'Use suggested_call to update the managed route without rebuilding or recreating the image.',
      'Read the action result route_verification field: verified means the route passed, skipped means call diagnostic_call, and failed/rolled_back means the previous route config was restored.',
    ];
  }
  if (call.action === 'set_env_vars') {
    return [
      'Replace placeholder values in suggested_call.params.variables, then execute suggested_call to save env and apply the same-image runtime recreate path.',
      'Read the action result runtime_apply field: verified means the same-image apply passed, applied/skipped needs diagnostic_call, and failed includes whether the previous version is still serving.',
    ];
  }
  return [
    'Use suggested_call to run a full redeploy/rebuild because the current image cannot be fixed with a route or same-image runtime update.',
    'After the deploy reaches a terminal status, call diagnose_service again to verify.',
  ];
}

function buildSynthesizedServiceDiagnosis(input: {
  service: ServiceRow;
  project: ProjectRow;
  effectiveEnv: Record<string, string>;
  buildDiagnostics: Record<string, unknown>;
  container: Record<string, unknown>;
  route: Record<string, unknown>;
  httpCheck: Record<string, unknown>;
  internalHttpCheck: Record<string, unknown> | null;
  dependencies: Record<string, unknown>;
  logs: Record<string, unknown>;
  recentDeployment: Record<string, unknown>;
}): SynthesizedServiceDiagnosis | null {
  const suspectedBuildEnv = input.buildDiagnostics['suspectedMissingBuildTimeKeys'];
  if (Array.isArray(suspectedBuildEnv) && suspectedBuildEnv.length > 0) {
    return {
      code: 'BUILD_TIME_ENV_MISSING',
      confidence: 'high',
      summary: `${suspectedBuildEnv.join(', ')} is present at runtime but the recent build log shows it was missing during build.`,
      evidence: {
        suspected_missing_build_time_keys: suspectedBuildEnv,
        allowed_build_time_prefixes: input.buildDiagnostics['allowedPrefixes'],
      },
      suggested_call: redeploySuggestedCall(input.service.id),
    };
  }

  const runtimeLogText = typeof input.logs['tail'] === 'string' ? input.logs['tail'] : '';
  const currentKeys = new Set(Object.keys(input.effectiveEnv));
  const missingRuntimeEnvKeys = extractMissingEnvKeys(runtimeLogText).filter(
    (key) => currentKeys.has(key) || isKnownRuntimeEnvKey(key),
  );
  if (missingRuntimeEnvKeys.length > 0 && !hasRuntimeImage(input.service, input.container)) {
    return {
      code: 'NO_RUNTIME_IMAGE',
      confidence: 'high',
      summary:
        'The service has runtime env errors, but OpenLander has no current runtime image for a same-image recreate.',
      evidence: {
        missing_env_keys: missingRuntimeEnvKeys,
        image_tag: input.service.image_tag ?? null,
        image_url: input.service.image_url ?? null,
        container_image: input.container['image'] ?? null,
      },
      suggested_call: redeploySuggestedCall(input.service.id),
    };
  }

  if (input.container['status'] === 'restarting') {
    return {
      code: 'RESTART_LOOP',
      confidence: 'high',
      summary: 'The container is running but Docker reports a restart loop.',
      evidence: {
        status: input.container['status'],
        exit_code: input.container['exitCode'],
        restart_count: input.container['restartCount'],
      },
    };
  }

  if (input.container['present'] === true && input.container['running'] !== true) {
    return {
      code: 'CONTAINER_NOT_RUNNING',
      confidence: 'high',
      summary: 'The service has a container, but Docker reports it is not running.',
      evidence: {
        status: input.container['status'],
        exit_code: input.container['exitCode'],
        error: input.container['error'],
      },
    };
  }

  const configuredPort = input.service.container_port;
  const logText = [
    typeof input.logs['tail'] === 'string' ? input.logs['tail'] : '',
    typeof asRecord(input.recentDeployment['latest'])?.['buildLogTail'] === 'string'
      ? (asRecord(input.recentDeployment['latest'])?.['buildLogTail'] as string)
      : '',
  ].join('\n');
  const detectedPort = extractListeningPort(logText);
  if (
    input.container['running'] === true &&
    input.httpCheck['reachable'] === false &&
    typeof configuredPort === 'number' &&
    detectedPort !== null &&
    detectedPort !== configuredPort
  ) {
    return {
      code: 'PORT_MISMATCH',
      confidence: 'high',
      summary: `The app appears to listen on ${String(detectedPort)}, but OpenLander routes to container_port ${String(configuredPort)}.`,
      evidence: {
        configured_container_port: configuredPort,
        detected_listening_port: detectedPort,
        http_probe_target: input.httpCheck['target_resolved'],
        http_probe_error: input.httpCheck['error'],
      },
      suggested_call: {
        tool: 'openlander_service',
        action: 'apply_route_config',
        params: { service_id: input.service.id, container_port: detectedPort },
      },
    };
  }

  const routeIssues = asRecord(input.route)?.['issues'];
  const hasRouteBackendMismatch =
    Array.isArray(routeIssues) &&
    routeIssues.some((issue) => {
      const record = asRecord(issue);
      return (
        record?.['code'] === 'backend_container_name_mismatch' ||
        record?.['code'] === 'external_route_failed_internal_probe_passed'
      );
    });
  const refreshPort = input.service.container_port ?? input.service.assigned_port;
  if (
    input.container['running'] === true &&
    input.httpCheck['reachable'] === false &&
    input.internalHttpCheck?.['reachable'] === true &&
    hasRouteBackendMismatch &&
    typeof refreshPort === 'number'
  ) {
    return {
      code: 'ROUTE_BACKEND_MISMATCH',
      confidence: 'high',
      summary:
        'The app responds inside the container, but the OpenLander route probe fails, which points to a stale route/backend target. Re-applying route config refreshes the HTTP-provider backend name and port from the service row.',
      evidence: {
        route: input.route,
        http_probe_target: input.httpCheck['target_resolved'],
        internal_probe_target: input.internalHttpCheck['target_resolved'],
        repair_mode: 'refresh_http_provider_backend',
      },
      suggested_call: {
        tool: 'openlander_service',
        action: 'apply_route_config',
        params: { service_id: input.service.id, container_port: refreshPort },
      },
    };
  }

  if (missingRuntimeEnvKeys.length > 0) {
    const presentKeys = missingRuntimeEnvKeys.filter((key) => currentKeys.has(key));
    const missingKeys = missingRuntimeEnvKeys.filter((key) => !currentKeys.has(key));
    return {
      code: 'RUNTIME_ENV_MISSING',
      confidence: 'high',
      summary:
        missingKeys.length > 0
          ? `${missingKeys.join(', ')} is missing from the service runtime env.`
          : `${presentKeys.join(', ')} exists in saved env, but the running container logs still report it missing.`,
      evidence: {
        missing_env_keys: missingRuntimeEnvKeys,
        present_in_saved_env: presentKeys,
        missing_from_saved_env: missingKeys,
        build_time_suspected_keys: suspectedBuildEnv,
      },
      suggested_call: setEnvVarsSuggestedCall(input.service.id, missingRuntimeEnvKeys),
    };
  }

  const depChecks = asRecord(input.dependencies)?.['checks'];
  const failedDependency = Array.isArray(depChecks)
    ? depChecks
        .map((item) => asRecord(item))
        .find((item): item is Record<string, unknown> => item?.['reachable'] === false)
    : undefined;
  if (failedDependency) {
    const failed = failedDependency;
    const key = typeof failed['key'] === 'string' ? failed['key'] : 'endpoint';
    return {
      code: 'DEPENDENCY_UNREACHABLE',
      confidence: 'high',
      summary: `Dependency ${key} is unreachable from the service network.`,
      evidence: {
        key: failed['key'],
        target: failed['target'],
        error: failed['error'],
      },
    };
  }

  return null;
}

function resolveTarget(
  target: string,
  portArg: number | undefined,
  protocolArg: 'http' | 'https' | 'tcp' | undefined,
  path: string,
): { protocol: 'http' | 'https' | 'tcp'; host: string; port: number; url?: string } {
  if (target.startsWith('http://') || target.startsWith('https://')) {
    const parsed = new URL(target);
    const protocol = protocolArg ?? (parsed.protocol === 'https:' ? 'https' : 'http');
    const host = parsed.hostname;
    const port =
      portArg ?? (parsed.port ? parseInt(parsed.port, 10) : protocol === 'https' ? 443 : 80);
    const fullPath = parsed.pathname === '/' ? path : parsed.pathname;
    return { protocol, host, port, url: `${protocol}://${host}:${String(port)}${fullPath}` };
  }

  const colonIdx = target.lastIndexOf(':');
  if (colonIdx > 0 && !target.includes('/')) {
    const host = target.slice(0, colonIdx);
    const parsedPort = parseInt(target.slice(colonIdx + 1), 10);
    if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
      const protocol = protocolArg ?? (portArg !== undefined || parsedPort ? 'tcp' : 'http');
      return { protocol, host, port: portArg ?? parsedPort };
    }
  }

  const protocol = protocolArg ?? (portArg !== undefined ? 'tcp' : 'http');
  const port = portArg ?? (protocol === 'https' ? 443 : 80);
  return { protocol, host: target, port };
}

async function probeTcp(
  host: string,
  port: number,
  timeoutMs: number,
  targetResolved: string,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: timeoutMs });

    socket.on('connect', () => {
      const latencyMs = Date.now() - startedAt;
      socket.destroy();
      resolve({
        reachable: true,
        latency_ms: latencyMs,
        protocol_used: 'tcp' as const,
        target_resolved: targetResolved,
        _agent_guidance: {
          message: `Target is reachable. ${String(latencyMs)}ms response time.`,
          next_steps: [
            'Use get_logs to check application output',
            'Use get_project_stats to monitor resource usage',
          ],
        },
      });
    });

    socket.on('timeout', () => {
      const latencyMs = Date.now() - startedAt;
      socket.destroy();
      resolve({
        reachable: false,
        latency_ms: latencyMs,
        error: `TCP connection timed out after ${String(timeoutMs)}ms`,
        protocol_used: 'tcp' as const,
        target_resolved: targetResolved,
        _agent_guidance: {
          message: `Target not reachable: TCP connection timed out after ${String(timeoutMs)}ms. Try internal=true to check from within the Docker network.`,
          next_steps: [
            'Try with internal=true to probe from inside the Docker network',
            'Check if the target host and port are correct',
            'Use get_alerts to check for container issues',
          ],
        },
      });
    });

    socket.on('error', (err) => {
      const latencyMs = Date.now() - startedAt;
      socket.destroy();
      const errorMsg = err.message;
      resolve({
        reachable: false,
        latency_ms: latencyMs,
        error: errorMsg,
        protocol_used: 'tcp' as const,
        target_resolved: targetResolved,
        _agent_guidance: {
          message: `Target not reachable: ${errorMsg}. Try internal=true to check from within the Docker network.`,
          next_steps: [
            'Try with internal=true to probe from inside the Docker network',
            'Check if the target host and port are correct',
            'Use get_alerts to check for container issues',
          ],
        },
      });
    });
  });
}

async function probeHttp(
  url: string,
  timeoutMs: number,
  protocol: 'http' | 'https' | 'tcp',
  targetResolved: string,
  startedAt: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual',
    });
    const latencyMs = Date.now() - startedAt;
    const reachable = response.status < 400;

    return {
      reachable,
      status_code: response.status,
      latency_ms: latencyMs,
      protocol_used: protocol,
      target_resolved: targetResolved,
      _agent_guidance: {
        message: reachable
          ? `Target is reachable. ${String(latencyMs)}ms response time.`
          : `Target returned HTTP ${String(response.status)}. The host is reachable but returned an error.`,
        next_steps: reachable
          ? [
              'Use get_logs to check application output',
              'Use get_project_stats to monitor resource usage',
            ]
          : [
              'Check application logs with get_logs',
              'Verify the path is correct',
              'Try internal=true to probe from inside the Docker network',
            ],
      },
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const errorMsg =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `HTTP request timed out after ${String(timeoutMs)}ms`
          : err.message
        : String(err);

    return {
      reachable: false,
      latency_ms: latencyMs,
      error: errorMsg,
      protocol_used: protocol,
      target_resolved: targetResolved,
      _agent_guidance: {
        message: `Target not reachable: ${errorMsg}. Try internal=true to check from within the Docker network.`,
        next_steps: [
          'Try with internal=true to probe from inside the Docker network',
          'Check if the target host is correct',
          'Use get_alerts to check for container issues',
        ],
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildInternalTcpProbeCommand(host: string, port: number, timeoutSec: number): string[] {
  return [
    'sh',
    '-c',
    [
      'host="$1"; port="$2"; timeout="$3"',
      'if command -v nc >/dev/null 2>&1; then',
      '  nc -z -w"$timeout" "$host" "$port"',
      'elif command -v bash >/dev/null 2>&1; then',
      '  if command -v timeout >/dev/null 2>&1; then',
      '    timeout "$timeout" bash -c \'cat < /dev/null > /dev/tcp/$1/$2\' _ "$host" "$port"',
      '  else',
      '    bash -c \'cat < /dev/null > /dev/tcp/$1/$2\' _ "$host" "$port"',
      '  fi',
      'elif command -v node >/dev/null 2>&1; then',
      '  node -e \'const net=require("net"); const host=process.argv[1]; const port=Number(process.argv[2]); const timeout=Number(process.argv[3])*1000; const socket=net.createConnection({host,port,timeout},()=>{socket.destroy(); process.exit(0);}); socket.on("timeout",()=>{socket.destroy(); process.exit(124);}); socket.on("error",()=>process.exit(1));\' "$host" "$port" "$timeout"',
      'else',
      '  echo "No TCP probe tool available: install nc, bash, or node in the exec container" >&2',
      '  exit 127',
      'fi',
    ].join('\n'),
    'openlander-probe',
    host,
    String(port),
    String(timeoutSec),
  ];
}

async function probeInternal(
  appCtx: {
    docker: {
      listManagedContainers(): Promise<{ id: string; status: string }[]>;
      execSimple(
        containerId: string,
        cmd: string[],
      ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
    };
  },
  protocol: 'http' | 'https' | 'tcp',
  host: string,
  port: number,
  path: string,
  timeoutMs: number,
  targetResolved: string,
  preferredContainerId?: string,
  requirePreferredContainer = false,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const containers = await appCtx.docker.listManagedContainers();
  const preferredRunningContainer = preferredContainerId
    ? containers.find((c) => c.id === preferredContainerId && c.status === 'running')
    : undefined;
  const runningContainer =
    preferredRunningContainer ??
    (preferredContainerId || requirePreferredContainer
      ? undefined
      : containers.find((c) => c.status === 'running'));

  if (!runningContainer) {
    const hasPreferred = Boolean(preferredContainerId) || requirePreferredContainer;
    return {
      reachable: false,
      latency_ms: 0,
      error: hasPreferred
        ? 'No running target project container available for internal probe'
        : 'No running managed containers available for internal probe',
      protocol_used: protocol,
      target_resolved: targetResolved,
      _agent_guidance: {
        message: hasPreferred
          ? 'The target service container is not running or not deployed, so OpenLander cannot probe from its isolated project network.'
          : 'No running managed containers to execute internal probe from. Deploy a project first.',
        next_steps: hasPreferred
          ? [
              'Call diagnose_service for the target service to inspect container state.',
              'Redeploy or restart the target service, then retry the internal probe.',
            ]
          : [
              'Deploy a project first to have a running container',
              'Try without internal=true to probe from the host',
            ],
      },
    };
  }

  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  let cmd: string[];
  if (protocol === 'tcp') {
    cmd = buildInternalTcpProbeCommand(host, port, timeoutSec);
  } else {
    const url = `${protocol}://${host}:${String(port)}${path}`;
    cmd = ['curl', '-sf', '--max-time', String(timeoutSec), url];
  }

  try {
    const result = await appCtx.docker.execSimple(runningContainer.id, cmd);
    const latencyMs = Date.now() - startedAt;
    const reachable = result.exitCode === 0;
    const output = result.stderr.trim() || result.stdout.trim();
    const probeToolUnavailable = result.exitCode === 127;

    return {
      reachable,
      latency_ms: latencyMs,
      error: reachable
        ? undefined
        : output || `Command exited with code ${String(result.exitCode)}`,
      ...(probeToolUnavailable ? { probe_tool_unavailable: true } : {}),
      protocol_used: protocol,
      target_resolved: targetResolved,
      _agent_guidance: {
        message: reachable
          ? `Target is reachable from inside Docker network. ${String(latencyMs)}ms response time.`
          : probeToolUnavailable
            ? `Internal TCP probe could not run inside the selected container: ${output}.`
            : `Target not reachable from inside Docker network: ${output || 'connection failed'}.`,
        next_steps: reachable
          ? [
              'Use get_logs to check application output',
              'Use get_project_stats to monitor resource usage',
            ]
          : probeToolUnavailable
            ? [
                'Try without internal=true to probe from the host instead',
                'Use a container image that includes nc, bash, or node for internal TCP probes',
                'Check target reachability from another container that has network tools',
              ]
            : [
                'Check if the target container is running',
                'Verify the container name and port are correct',
                'Use get_alerts to check for container issues',
              ],
      },
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const errorMsg = err instanceof Error ? err.message : String(err);
    const probeToolUnavailable = /executable file not found|no such file or directory/i.test(
      errorMsg,
    );
    log.warn({ err, host, port, containerId: runningContainer.id }, 'Internal probe exec failed');

    return {
      reachable: false,
      latency_ms: latencyMs,
      error: errorMsg,
      ...(probeToolUnavailable ? { probe_tool_unavailable: true } : {}),
      protocol_used: protocol,
      target_resolved: targetResolved,
      _agent_guidance: {
        message: probeToolUnavailable
          ? `Internal probe could not start inside the selected container: ${errorMsg}.`
          : `Internal probe failed: ${errorMsg}. The exec container may not have curl/nc installed.`,
        next_steps: probeToolUnavailable
          ? [
              'Try without internal=true to probe from the host instead',
              'Use a container image that includes /bin/sh and network tools for internal probes',
            ]
          : [
              'Try without internal=true to probe from the host instead',
              'Check if the exec container has networking tools installed',
            ],
      },
    };
  }
}
