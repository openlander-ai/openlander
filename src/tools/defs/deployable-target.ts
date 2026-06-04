import {
  OpenLanderError,
  ProjectNotFoundError,
  ServiceNotFoundError,
  ServiceOperationUnsupportedError,
} from '../../errors.js';
import { MANAGED_SERVICE_KINDS } from '../../db/repos/service.repo.js';
import { deployableServiceIdToProjectId } from '../../db/service-ids.js';
import type { ProjectRow, ServiceRow } from '../../db/types.js';
import type { ToolContext } from './types.js';

type AppCtx = ToolContext['appCtx'];

export interface ResolvedDeployableTarget {
  service: ServiceRow;
  project: ProjectRow;
  runtimeProject: ProjectRow;
}

function isManagedService(kind: string): boolean {
  return (MANAGED_SERVICE_KINDS as readonly string[]).includes(kind);
}

async function resolveProjectScope(
  appCtx: AppCtx,
  projectId: string,
  projectName: string,
): Promise<ProjectRow | undefined> {
  if (projectId) return appCtx.db.getProject(projectId);
  if (!projectName) return undefined;
  return (await appCtx.db.getProject(projectName)) ?? appCtx.db.getProjectByName(projectName);
}

async function deployablesForProject(appCtx: AppCtx, projectId: string): Promise<ServiceRow[]> {
  const services = await appCtx.db.getDeployablesByGroup(projectId);
  return services.filter((service) => !isManagedService(service.kind));
}

async function serviceSelectionCandidates(appCtx: AppCtx, services: ServiceRow[]) {
  return Promise.all(
    services.map(async (service) => {
      const project = await appCtx.db.getProject(service.project_id);
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

async function throwServiceSelectionRequired(
  appCtx: AppCtx,
  message: string,
  candidates: ServiceRow[],
): Promise<never> {
  throw new OpenLanderError(message, 'SERVICE_SELECTION_REQUIRED', 400, {
    candidates: await serviceSelectionCandidates(appCtx, candidates),
  });
}

async function resolveSingleDeployableProjectAlias(
  appCtx: AppCtx,
  projectName: string,
): Promise<ServiceRow | undefined> {
  const project = await resolveProjectScope(appCtx, '', projectName);
  if (!project) return undefined;

  const deployables = await deployablesForProject(appCtx, project.id);
  if (deployables.length > 1) {
    await throwServiceSelectionRequired(
      appCtx,
      `Project '${projectName}' has multiple Applications/Compose workloads. Specify service_id or the workload name.`,
      deployables,
    );
  }
  return deployables[0];
}

async function resolveByServiceName(
  appCtx: AppCtx,
  serviceName: string,
  projectId: string,
  projectName: string,
): Promise<ServiceRow> {
  const projectScope = await resolveProjectScope(appCtx, projectId, projectName);
  if ((projectId || projectName) && !projectScope) {
    throw new ProjectNotFoundError(projectId || projectName);
  }

  if (projectScope) {
    const deployables = await deployablesForProject(appCtx, projectScope.id);
    const matches = deployables.filter(
      (service) =>
        service.id === serviceName ||
        service.name === serviceName ||
        deployableServiceIdToProjectId(service.id) === serviceName,
    );
    if (matches.length > 1) {
      await throwServiceSelectionRequired(
        appCtx,
        `Multiple Applications/Compose workloads named '${serviceName}' found. Specify service_id.`,
        matches,
      );
    }
    const match = matches[0];
    if (match) return match;
    const onlyDeployable = deployables[0];
    if (
      onlyDeployable &&
      deployables.length === 1 &&
      (serviceName === projectScope.id || serviceName === projectScope.name)
    ) {
      return onlyDeployable;
    }
    throw new ServiceNotFoundError(`${serviceName} in ${projectScope.name}`);
  }

  const services = await appCtx.db.listServices();
  const matches = services
    .filter((service) => !isManagedService(service.kind))
    .filter(
      (service) =>
        service.id === serviceName ||
        service.name === serviceName ||
        deployableServiceIdToProjectId(service.id) === serviceName,
    );
  if (matches.length > 1) {
    await throwServiceSelectionRequired(
      appCtx,
      `Multiple Applications/Compose workloads named '${serviceName}' found. Specify project_name or service_id.`,
      matches,
    );
  }
  const match = matches[0];
  if (match) return match;

  const projectAliasService = await resolveSingleDeployableProjectAlias(appCtx, serviceName);
  if (projectAliasService) return projectAliasService;

  throw new ServiceNotFoundError(serviceName);
}

export async function resolveDeployableTarget(
  appCtx: AppCtx,
  args: Record<string, unknown>,
  operation: string,
): Promise<ResolvedDeployableTarget> {
  const serviceId = typeof args['service_id'] === 'string' ? args['service_id'].trim() : '';
  const serviceName = typeof args['service_name'] === 'string' ? args['service_name'].trim() : '';
  const projectId = typeof args['project_id'] === 'string' ? args['project_id'].trim() : '';
  const projectName = typeof args['project_name'] === 'string' ? args['project_name'].trim() : '';

  let service: ServiceRow | undefined;
  if (serviceId) {
    service = await appCtx.db.getService(serviceId);
  } else if (serviceName) {
    service = await resolveByServiceName(appCtx, serviceName, projectId, projectName);
  } else {
    const project = await resolveProjectScope(appCtx, projectId, projectName);
    if (!project) {
      throw new ProjectNotFoundError(projectId || projectName || 'unknown');
    }
    const deployables = await deployablesForProject(appCtx, project.id);
    if (deployables.length > 1) {
      await throwServiceSelectionRequired(
        appCtx,
        `Project '${project.name}' has multiple Applications/Compose workloads. Specify service_id or service_name.`,
        deployables,
      );
    }
    service = deployables[0];
  }

  if (!service) {
    throw new ServiceNotFoundError(
      serviceId || serviceName || projectId || projectName || 'unknown',
    );
  }
  if (isManagedService(service.kind)) {
    throw new ServiceOperationUnsupportedError(operation, service.kind);
  }

  const project = await appCtx.db.getProject(service.project_id);
  if (!project) {
    throw new ProjectNotFoundError(service.project_id);
  }

  if (projectId && projectId !== project.id) {
    throw new ServiceNotFoundError(`${service.id} in ${projectId}`);
  }
  if (projectName && projectName !== project.id && projectName !== project.name) {
    throw new ServiceNotFoundError(`${service.name} in ${projectName}`);
  }

  const runtimeProjectId = deployableServiceIdToProjectId(service.id);
  const runtimeProject = (await appCtx.db.getProject(runtimeProjectId)) ?? project;
  return { service, project, runtimeProject };
}
