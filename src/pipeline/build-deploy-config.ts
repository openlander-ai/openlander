import type { Database } from '../db/index.js';
import { validateStoredConfig } from './config-snapshot.js';
import type { ProjectConfig } from './deploy-core.js';

export interface BuildDeployConfigParams {
  projectId: string;
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

export function buildDeployConfig(params: BuildDeployConfigParams): ProjectConfig {
  const { projectId, runtimeOverrides, db } = params;

  const project = db.getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // PR 4.5: canonical-first reads of deployable fields with `??` fallback to
  // legacy `projects` columns through migration 0012.
  const deployable = db.getDeployableForProject(projectId);
  const buildMethod = deployable?.build_method ?? project.build_method;
  const source = deployable?.source ?? project.source;
  const imageUrl = deployable?.image_url ?? project.image_url;
  const imageCmdRaw = deployable?.image_cmd ?? project.image_cmd;
  const containerPort = deployable?.container_port ?? project.container_port;
  const dockerfilePath = deployable?.dockerfile_path ?? project.dockerfile_path;
  const dockerTarget = deployable?.docker_target ?? project.docker_target;
  const buildContext = deployable?.build_context ?? project.build_context;
  const assignedPort = deployable?.assigned_port ?? project.assigned_port;

  const isCompose = buildMethod === 'compose';
  const imageCmd = parseImageCmd(imageCmdRaw ?? null);
  const dbConfig: ProjectConfig = {
    repoUrl: project.repo_url ?? '',
    branch: project.branch,
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
    _preferredPort: assignedPort ?? undefined,
  };

  const stored = db.loadDeployConfig(projectId);
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
