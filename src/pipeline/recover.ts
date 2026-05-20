import { DOCKER_LABELS, SHARED_NETWORK_NAME } from '../config/index.js';
import type { AppContext } from '../app.js';
import type { ProjectRow, ServiceRow } from '../db/index.js';
import { ORPHAN_MANAGED_GROUP_ID } from '../db/service-ids.js';
import {
  containerName as projectContainerName,
  serviceContainerName,
  serviceVolumeName,
} from './helpers.js';
import { SERVICE_MEMORY_LIMITS, SERVICE_TEMPLATES } from './service-manager.js';
import { getServiceAdapter } from './service-adapters/index.js';
import { buildTraefikLabels, ensureManagedTraefikNetwork } from './traefik.js';
import { allocatePort } from './port.js';
import { createModuleLogger } from '../lib/logger.js';
import { loadResourceLimitsForDeployTarget } from './config-snapshot.js';

const log = createModuleLogger('recover');

type NetworkStatus = 'existed' | 'created' | 'error';
type ServiceStatus = 'running' | 'started' | 'recreated' | 'error';
type ProjectStatus = 'running' | 'started' | 'recreated' | 'needs_redeploy' | 'skipped' | 'error';

export interface RecoverItemResult<T extends string> {
  name: string;
  status: T;
  error?: string;
}

export interface RecoverResult {
  networks: RecoverItemResult<NetworkStatus>[];
  services: RecoverItemResult<ServiceStatus>[];
  projects: RecoverItemResult<ProjectStatus>[];
}

async function containerExists(
  ctx: AppContext,
  nameOrId: string,
): Promise<{ exists: boolean; running: boolean }> {
  try {
    const info = await ctx.docker.inspectContainer(nameOrId);
    return { exists: true, running: info.State.Running };
  } catch {
    return { exists: false, running: false };
  }
}

async function imageExists(ctx: AppContext, tag: string): Promise<boolean> {
  try {
    await ctx.docker.inspectImage(tag);
    return true;
  } catch {
    return false;
  }
}

async function volumeExists(ctx: AppContext, name: string): Promise<boolean> {
  try {
    await ctx.docker.inspectVolume(name);
    return true;
  } catch {
    return false;
  }
}

async function ensureNetwork(
  ctx: AppContext,
  name: string,
): Promise<RecoverItemResult<NetworkStatus>> {
  try {
    try {
      await ctx.docker.getNetworkInfo(name);
      return { name, status: 'existed' };
    } catch {
      // Network doesn't exist — will create below
    }
    await ctx.docker.ensureNetwork(name);
    return { name, status: 'created' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('already exists')) {
      return { name, status: 'existed' };
    }
    return { name, status: 'error', error: msg };
  }
}

function getDataMountPath(kind: string): string {
  const adapter = getServiceAdapter(kind);
  return adapter ? adapter.getDataMountPath() : '/data';
}

function getServiceContainerPort(service: ServiceRow): number {
  const template = SERVICE_TEMPLATES[service.kind as string];
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return template?.port ?? service.assigned_port ?? service.port ?? 0;
}

async function recoverService(
  ctx: AppContext,
  service: ServiceRow,
  dryRun: boolean,
): Promise<RecoverItemResult<ServiceStatus>> {
  const cName = serviceContainerName(service.name);
  const vName = serviceVolumeName(service.name);

  try {
    // Check if container already exists
    const container = await containerExists(ctx, cName);
    if (container.exists && container.running) {
      return { name: service.name, status: 'running' };
    }
    if (container.exists && !container.running) {
      if (!dryRun) {
        await ctx.docker.startContainer(cName);
        await ctx.db.updateService(service.id, { status: 'running' });
      }
      return { name: service.name, status: 'started' };
    }

    // Container doesn't exist — recreate
    if (dryRun) {
      return { name: service.name, status: 'recreated' };
    }

    // Ensure volume (preserve existing data!)
    const volExists = await volumeExists(ctx, vName);
    if (!volExists) {
      await ctx.docker.createVolume({
        name: vName,
        labels: {
          [DOCKER_LABELS.ROLE]: 'service',
          [DOCKER_LABELS.SERVICE]: service.name,
        },
      });
    }

    // Ensure image — read from canonical image_url; legacy image is @deprecated
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const serviceImage = service.image_url ?? service.image ?? '';
    const hasImage = await imageExists(ctx, serviceImage);
    if (!hasImage) {
      await ctx.docker.pullImage(serviceImage);
    }

    const envVars: Record<string, string> = {};
    // env_vars column is @deprecated but has no canonical per-service equivalent yet (1.1)

    // eslint-disable-next-line openlander-internal/no-dropped-columns -- transitional: canonical-first read or non-row identifier; tracked for 1.1 cleanup
    const rawEnvVars = service.env_vars;
    if (rawEnvVars) {
      const parsed = JSON.parse(rawEnvVars) as Array<{ key: string; value: string }>;
      for (const { key, value } of parsed) {
        envVars[key] = value;
      }
    }

    // Get template config — use canonical kind
    const template = SERVICE_TEMPLATES[service.kind as string];
    const containerPort = getServiceContainerPort(service);
    const dataMountPath = getDataMountPath(service.kind);
    const memLimits = SERVICE_MEMORY_LIMITS[service.kind as string] ?? {
      memoryLimitBytes: 536870912,
      cpuShares: 512,
    };

    await ctx.docker.safeRemoveContainer(cName);

    // Use canonical assigned_port; fall back to legacy port for pre-migration rows
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const hostPort = service.assigned_port ?? service.port ?? 0;
    let network: string | undefined;
    if (service.project_id === ORPHAN_MANAGED_GROUP_ID) {
      network = SHARED_NETWORK_NAME;
    } else {
      const project = await ctx.db.getProject(service.project_id);
      if (!project) {
        throw new Error(`Service owner project not found: ${service.project_id}`);
      }
      network = await ctx.docker.ensureProjectNetwork(project.name);
    }
    const containerId = await ctx.docker.runServiceContainer({
      imageTag: serviceImage,
      name: cName,
      port: hostPort,
      hostPort,
      containerPort,
      envVars,
      serviceName: service.name,
      cmd: template?.cmd,
      volumeBinds: [`${vName}:${dataMountPath}`],
      healthcheck: template?.healthcheck,
      memoryLimitBytes: memLimits.memoryLimitBytes,
      cpuShares: memLimits.cpuShares,
      network,
    });

    await ctx.db.updateService(service.id, { status: 'running', containerId });

    log.info({ service: service.name }, 'Service recovered');
    return { name: service.name, status: 'recreated' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error({ service: service.name, error: msg }, 'Failed to recover service');
    return { name: service.name, status: 'error', error: msg };
  }
}

async function recoverProject(
  ctx: AppContext,
  project: ProjectRow,
  dryRun: boolean,
): Promise<RecoverItemResult<ProjectStatus>> {
  const cName = projectContainerName(project.name);
  // PR 4.5: canonical-first reads of runtime fields with `??` fallback to
  // legacy `projects` columns through migration 0012.
  const deployable = await ctx.db.getDeployableForProject(project.id);
  const status = deployable?.status ?? project.status;
  const imageTag = deployable?.image_tag ?? project.image_tag;
  const imageCmdRaw = deployable?.image_cmd ?? project.image_cmd;
  const assignedPort = deployable?.assigned_port ?? project.assigned_port;
  const containerPortRaw = deployable?.container_port ?? project.container_port;

  try {
    // Skip stopped/archived projects
    if (status === 'stopped' || project.archived_at) {
      return { name: project.name, status: 'skipped' };
    }

    // Check if container already exists
    const container = await containerExists(ctx, cName);
    if (container.exists && container.running) {
      if (status !== 'running') {
        await ctx.stateManager.transition(project.id, 'running', 'manual-recovery');
      }
      return { name: project.name, status: 'running' };
    }
    if (container.exists && !container.running) {
      if (!dryRun) {
        await ctx.docker.startContainer(cName);
        await ctx.stateManager.transition(project.id, 'running', 'manual-recovery');
      }
      return { name: project.name, status: 'started' };
    }

    // Container doesn't exist — check if image is available
    if (!imageTag) {
      return { name: project.name, status: 'needs_redeploy' };
    }

    const hasImage = await imageExists(ctx, imageTag);
    if (!hasImage) {
      // Also check :latest tag
      const latestTag = `openlander/${project.name}:latest`;
      const hasLatest = await imageExists(ctx, latestTag);
      if (!hasLatest) {
        return { name: project.name, status: 'needs_redeploy' };
      }
    }

    if (dryRun) {
      return { name: project.name, status: 'recreated' };
    }

    // Get env vars and secret files for the project
    const envVars = await ctx.db.getEnvVars(project.id);
    const secretFiles = await ctx.env.getSecretFilesForDeploy(project.id);

    // Determine port — reuse stored port or allocate new one
    const port = assignedPort ?? (await allocatePort(ctx.db, ctx.docker, {}, 'production'));
    const containerPort = containerPortRaw ?? port;

    // Parse image cmd
    let imageCmd: string[] | undefined;
    if (imageCmdRaw) {
      try {
        imageCmd = JSON.parse(imageCmdRaw) as string[];
      } catch {
        imageCmd = [imageCmdRaw];
      }
    }

    // Build traefik labels
    const networkName = await ctx.docker.ensureProjectNetwork(project.name);
    await ensureManagedTraefikNetwork(ctx.docker, networkName);
    const traefikLabels = buildTraefikLabels(
      project.name,
      containerPort,
      undefined,
      'production',
      networkName,
    );

    // Remove any stale container with same name
    await ctx.docker.safeRemoveContainer(cName);
    const resourceLimits = await loadResourceLimitsForDeployTarget(ctx.db, {
      projectId: project.id,
      serviceId: deployable?.id,
    });

    // Create and start container
    const containerId = await ctx.docker.runContainer({
      imageTag,
      name: cName,
      port,
      containerPort,
      envVars,
      cmd: imageCmd,
      traefikLabels,
      network: networkName,
      aliases: [project.name],
      secretFiles,
      restartPolicy: { Name: 'unless-stopped' },
      resourceLimits: resourceLimits ?? undefined,
    });

    await ctx.db.updateProject(project.id, {
      status: 'running',
      containerId,
      assignedPort: port,
    });

    log.info({ project: project.name }, 'Project recovered');
    return { name: project.name, status: 'recreated' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error({ project: project.name, error: msg }, 'Failed to recover project');
    return { name: project.name, status: 'error', error: msg };
  }
}

export async function recover(
  ctx: AppContext,
  opts?: { dryRun?: boolean },
): Promise<RecoverResult> {
  const dryRun = opts?.dryRun ?? false;
  const result: RecoverResult = { networks: [], services: [], projects: [] };

  log.info({ dryRun }, 'Starting platform recovery');

  // Phase 1: Ensure networks
  const networkName = ctx.docker.getNetworkName();
  const networksToEnsure = new Set([SHARED_NETWORK_NAME, networkName, 'web']);
  for (const name of networksToEnsure) {
    if (dryRun) {
      result.networks.push({ name, status: 'existed' });
    } else {
      result.networks.push(await ensureNetwork(ctx, name));
    }
  }

  // Phase 2: Recover services (must come before projects — projects may depend on services)
  const services = await ctx.db.listServices();
  for (const service of services) {
    result.services.push(await recoverService(ctx, service, dryRun));
  }

  // Phase 3: Recover projects
  const projects = await ctx.db.listProjects();
  for (const project of projects) {
    result.projects.push(await recoverProject(ctx, project, dryRun));
  }

  log.info(
    {
      networks: result.networks.length,
      services: result.services.length,
      projects: result.projects.length,
    },
    'Platform recovery complete',
  );

  return result;
}
