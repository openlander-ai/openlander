import type { Database } from '../db/index.js';
import type { ProjectRow, ServiceRow } from '../db/types.js';
import type { RuntimeBackend } from './runtime/index.js';
import type { CloudflareTunnelManager } from './cloudflare.js';
import type { CoordinatorSuppressor } from './deploy/lifecycle.js';
import { DOCKER_LABELS } from '../config/index.js';
import {
  ContainerNotFoundError,
  ServiceHasConsumersError,
  isDockerNotFoundError,
} from '../errors.js';

export async function deleteDeployableService(
  ctx: {
    db: Database;
    docker: RuntimeBackend;
    cloudflare: CloudflareTunnelManager;
    coordinator?: CoordinatorSuppressor;
  },
  project: ProjectRow,
  runtimeProject: ProjectRow,
  service: ServiceRow,
  deleteVolumes: boolean,
  deletingServiceIds: ReadonlySet<string> = new Set([service.id]),
) {
  await assertServiceDeleteDependencies(ctx.db, service, deletingServiceIds);

  ctx.coordinator?.suppressProject(runtimeProject.id, 60_000);

  await ctx.cloudflare.deleteConnectedPublishReservation(service.project_id, service.id);

  const removedDomains: string[] = [];
  for (const mapping of await ctx.db.getDomainMappingsForService(service.id)) {
    await ctx.cloudflare.removeTunnelForService(service.id, mapping.domain);
    removedDomains.push(mapping.domain);
  }
  await ctx.db.deleteDomainMappingsByService(service.id);

  const environments = await ctx.db.getEnvironmentsByServiceId(service.id);
  const containerRefs = new Set<string>();
  const primaryContainerRef = service.container_id ?? service.container_name;
  if (primaryContainerRef) containerRefs.add(primaryContainerRef);
  for (const environment of environments) {
    if (environment.container_id) containerRefs.add(environment.container_id);
  }

  for (const containerRef of containerRefs) {
    try {
      await ctx.docker.stopContainer(containerRef);
    } catch (err) {
      if (!isDockerNotFoundError(err) && !(err instanceof ContainerNotFoundError)) throw err;
    }
    await ctx.docker.removeContainer(containerRef);
  }
  const containerRemoved = containerRefs.size > 0;

  const siblingDeployables = (await ctx.db.getDeployablesByGroup(project.id)).filter(
    (candidate) => candidate.id !== service.id,
  );
  const removedVolumes: string[] = [];
  let volumeDeleteSkippedReason: string | null = null;
  if (deleteVolumes) {
    if (siblingDeployables.length > 0) {
      volumeDeleteSkippedReason = 'PROJECT_HAS_SIBLING_SERVICES';
    } else {
      const volumes = await ctx.docker.listVolumes({
        label: [`${DOCKER_LABELS.MANAGED}=true`, `${DOCKER_LABELS.PROJECT}=${project.name}`],
      });
      for (const volume of volumes) {
        if (!volume.Name) continue;
        await ctx.docker.removeVolume(volume.Name);
        removedVolumes.push(volume.Name);
      }
    }
  }

  await ctx.db.deleteProjectDependenciesByService(service.id);
  await ctx.db.deleteService(service.id);
  if (runtimeProject.id !== project.id) {
    // Current invariant: attached deployables have a preserved 1:1
    // runtime project row with no remaining deployables under that row.
    // If a future model lets multiple services share a runtime project,
    // preserve the row until the last runtime-scoped service is gone.
    const remainingRuntimeDeployables = await ctx.db.getDeployablesByGroup(runtimeProject.id);
    if (remainingRuntimeDeployables.length === 0) {
      await ctx.docker.removeProjectNetwork(runtimeProject.name);
      await ctx.db.deleteProject(runtimeProject.id);
    }
  }

  return {
    status: 'deleted',
    project: project.name,
    service: service.name,
    serviceId: service.id,
    containerRemoved,
    removedDomains,
    volumes: {
      deleted: removedVolumes,
      preserved: !deleteVolumes || volumeDeleteSkippedReason !== null,
      skippedReason: volumeDeleteSkippedReason,
    },
  };
}

export async function assertServiceDeleteDependencies(
  db: Database,
  service: ServiceRow,
  deletingServiceIds: ReadonlySet<string>,
) {
  const providerConnections = (await db.listServiceConsumersForProvider(service.id)).filter(
    (row) => !deletingServiceIds.has(row.service_id_consumer),
  );
  const dependencyConsumers = (await db.findProjectDependents(undefined, service.id)).filter(
    (row) => !row.source_service_id || !deletingServiceIds.has(row.source_service_id),
  );
  if (providerConnections.length > 0 || dependencyConsumers.length > 0) {
    const connectionConsumers = await Promise.all(
      providerConnections.map(async (connection) => {
        const consumer = await db.getService(connection.service_id_consumer);
        return {
          serviceId: connection.service_id_consumer,
          serviceName: consumer?.name ?? connection.service_id_consumer,
          projectId: consumer?.project_id ?? '',
        };
      }),
    );
    const dependencyServiceIds = new Set(
      dependencyConsumers
        .map((dependency) => dependency.source_service_id)
        .filter((serviceId): serviceId is string => Boolean(serviceId)),
    );
    const dependencyServiceConsumers = await Promise.all(
      Array.from(dependencyServiceIds).map(async (serviceId) => {
        const consumer = await db.getService(serviceId);
        return {
          serviceId,
          serviceName: consumer?.name ?? serviceId,
          projectId: consumer?.project_id ?? '',
        };
      }),
    );
    const consumers = [...connectionConsumers, ...dependencyServiceConsumers];
    const error = new ServiceHasConsumersError(service.id, service.name, consumers);
    throw error;
  }
}
