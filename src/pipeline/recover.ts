import { DOCKER_LABELS, SHARED_NETWORK_NAME } from '../config/index.js';
import type { AppContext } from '../app.js';
import type { ProjectRow, ServiceRow } from '../db/index.js';
import {
  containerName as projectContainerName,
  serviceContainerName,
  serviceVolumeName,
} from './helpers.js';
import { SERVICE_TEMPLATES } from './service-manager.js';
import { getServiceAdapter } from './service-adapters/index.js';
import { buildTraefikLabels } from './traefik.js';
import { allocatePort } from './port.js';
import { getPolicy } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';

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

function getDataMountPath(type: string): string {
  const adapter = getServiceAdapter(type);
  return adapter ? adapter.getDataMountPath() : '/data';
}

function getServiceContainerPort(service: ServiceRow): number {
  const template = SERVICE_TEMPLATES[service.type];
  return template?.port ?? service.port;
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
        ctx.db.updateService(service.id, { status: 'running' });
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

    // Ensure image
    const hasImage = await imageExists(ctx, service.image);
    if (!hasImage) {
      await ctx.docker.pullImage(service.image);
    }

    const envVars: Record<string, string> = {};
    if (service.env_vars) {
      const parsed: unknown = JSON.parse(service.env_vars);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'string') {
            const eqIdx = entry.indexOf('=');
            if (eqIdx > 0) {
              envVars[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
            }
          } else if (entry && typeof entry === 'object' && 'key' in entry && 'value' in entry) {
            const kv = entry as { key: unknown; value: unknown };
            envVars[String(kv.key)] = String(kv.value);
          }
        }
      }
    }

    // Get template config
    const template = SERVICE_TEMPLATES[service.type];
    const containerPort = getServiceContainerPort(service);
    const dataMountPath = getDataMountPath(service.type);

    await ctx.docker.safeRemoveContainer(cName);

    const containerId = await ctx.docker.runContainer({
      imageTag: service.image,
      name: cName,
      port: service.port,
      containerPort,
      envVars,
      cmd: template?.cmd,
      labels: {
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.ROLE]: 'service',
        [DOCKER_LABELS.SERVICE]: service.name,
      },
      traefikLabels: {},
      network: SHARED_NETWORK_NAME,
      restartPolicy: { Name: 'unless-stopped' },
      extraBinds: [`${vName}:${dataMountPath}`],
      healthcheck: template?.healthcheck,
    });

    ctx.db.updateService(service.id, { status: 'running', containerId });

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

  try {
    // Skip stopped/archived projects
    if (project.status === 'stopped' || project.archived_at) {
      return { name: project.name, status: 'skipped' };
    }

    // Check if container already exists
    const container = await containerExists(ctx, cName);
    if (container.exists && container.running) {
      if (project.status !== 'running') {
        ctx.db.updateProject(project.id, { status: 'running' });
      }
      return { name: project.name, status: 'running' };
    }
    if (container.exists && !container.running) {
      if (!dryRun) {
        await ctx.docker.startContainer(cName);
        ctx.db.updateProject(project.id, { status: 'running' });
      }
      return { name: project.name, status: 'started' };
    }

    // Container doesn't exist — check if image is available
    if (!project.image_tag) {
      return { name: project.name, status: 'needs_redeploy' };
    }

    const hasImage = await imageExists(ctx, project.image_tag);
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
    const envVars = ctx.db.getEnvVars(project.id);
    const secretFiles = ctx.env.getSecretFilesForDeploy(project.id);

    // Determine port — reuse stored port or allocate new one
    const port =
      project.assigned_port ?? (await allocatePort(ctx.db, ctx.docker, {}, 'production'));
    const containerPort = project.container_port ?? port;

    // Parse image cmd
    let imageCmd: string[] | undefined;
    if (project.image_cmd) {
      try {
        imageCmd = JSON.parse(project.image_cmd) as string[];
      } catch {
        imageCmd = [project.image_cmd];
      }
    }

    // Build traefik labels
    const traefikLabels = buildTraefikLabels(project.name, containerPort, undefined, 'production');

    // Remove any stale container with same name
    await ctx.docker.safeRemoveContainer(cName);

    // Create and start container
    const containerId = await ctx.docker.runContainer({
      imageTag: project.image_tag,
      name: cName,
      port,
      containerPort,
      envVars,
      cmd: imageCmd,
      traefikLabels,
      network: getPolicy('production').networkName,
      secretFiles,
    });

    ctx.db.updateProject(project.id, {
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
  const services = ctx.db.listServices();
  for (const service of services) {
    result.services.push(await recoverService(ctx, service, dryRun));
  }

  // Phase 3: Recover projects
  const projects = ctx.db.listProjects();
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
