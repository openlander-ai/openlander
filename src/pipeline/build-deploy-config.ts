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

  const isCompose = project.build_method === 'compose';
  const imageCmd = parseImageCmd(project.image_cmd);
  const dbConfig: ProjectConfig = {
    repoUrl: project.repo_url ?? '',
    branch: project.branch,
    name: project.name,
    visibility: project.visibility,
    source: project.source,
    imageUrl: project.image_url ?? undefined,
    imageCmd,
    containerPort: project.container_port ?? undefined,
    dockerfilePath:
      !isCompose && isValidDockerfilePath(project.dockerfile_path)
        ? project.dockerfile_path
        : undefined,
    dockerTarget: isCompose ? undefined : (project.docker_target ?? undefined),
    buildContext: project.build_context ?? undefined,
    preferDockerfile: project.build_method !== 'compose',
    _projectId: projectId,
    _preferredPort: project.assigned_port ?? undefined,
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
