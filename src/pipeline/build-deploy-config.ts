import type { Database, ServiceRow } from '../db/index.js';
import { loadServiceViewRecord, serviceViewFromRows } from '../db/views/service-view.js';
import { ServiceNotFoundError } from '../errors.js';
import { validateStoredConfig } from './config-snapshot.js';
import type { ProjectConfig } from './deploy-core.js';
import { getRedeploySourceMissingError } from './redeploy-source.js';

export interface BuildDeployConfigParams {
  projectId: string;
  serviceId?: string;
  service?: ServiceRow;
  runtimeOverrides?: Partial<ProjectConfig>;
  db: Database;
}

function parseImageCmd(rawImageCmd: string | null): string[] | undefined {
  if (!rawImageCmd) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(rawImageCmd);
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    const cmd = parsed.filter((entry): entry is string => typeof entry === 'string');
    return cmd.length > 0 ? cmd : undefined;
  } catch {
    return undefined;
  }
}

function isValidDockerfilePath(path: string): boolean {
  return (
    path !== 'Dockerfile' &&
    !path.startsWith('/') &&
    !path.endsWith('.yml') &&
    !path.endsWith('.yaml')
  );
}

export async function buildDeployConfig(params: BuildDeployConfigParams): Promise<ProjectConfig> {
  const { projectId, serviceId, service, runtimeOverrides, db } = params;

  const project = await db.getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const record = await loadServiceViewRecord(db, project);
  const deployable =
    service ?? (serviceId ? ((await db.getService(serviceId)) ?? null) : record.service);
  if (serviceId && !deployable) {
    throw new ServiceNotFoundError(serviceId);
  }
  const view = serviceId ? serviceViewFromRows(project, deployable) : record.view;
  const buildMethod = view.buildMethod;
  const source = view.source;
  const repoUrl = deployable?.repo_url ?? '';
  const branch = deployable?.branch ?? undefined;
  const imageUrl = view.imageUrl;
  const imageCmdRaw = view.imageCmdRaw;
  const containerPort = view.containerPort;
  const dockerfilePath = view.dockerfilePath;
  const dockerTarget = view.dockerTarget;
  const buildContext = view.buildContext;
  const assignedPort = view.assignedPort;

  const isCompose = buildMethod === 'compose';
  const sourceMissingError = getRedeploySourceMissingError({
    id: deployable?.id ?? `${projectId}__svc`,
    source: source ?? 'git',
    repo_url: repoUrl,
    image_url: imageUrl ?? null,
  });
  if (sourceMissingError) {
    throw sourceMissingError;
  }

  const imageCmd = parseImageCmd(imageCmdRaw ?? null);
  const dbConfig: ProjectConfig = {
    repoUrl,
    branch,
    name: project.name,
    visibility: project.visibility ?? undefined,
    source: (source as 'git' | 'image' | undefined) ?? undefined,
    imageUrl: imageUrl ?? undefined,
    imageCmd,
    containerPort: containerPort ?? undefined,
    dockerfilePath:
      !isCompose && dockerfilePath != null && isValidDockerfilePath(dockerfilePath)
        ? dockerfilePath
        : undefined,
    dockerTarget: isCompose ? undefined : (dockerTarget ?? undefined),
    buildContext: buildContext ?? undefined,
    preferDockerfile: buildMethod !== 'compose',
    _projectId: projectId,
    _serviceId: deployable?.id,
    _preferredPort: assignedPort ?? undefined,
  };

  const stored = deployable
    ? await db.loadDeployConfigForService(deployable.id)
    : await db.loadDeployConfig(projectId);
  const storedConfig = stored ? validateStoredConfig(stored.config_json) : null;
  const mergedFromStored: ProjectConfig = storedConfig
    ? {
        ...storedConfig.snapshot,
        ...dbConfig,
      }
    : dbConfig;

  return {
    ...mergedFromStored,
    ...runtimeOverrides,
  };
}
