export function extractProjectName(repoUrl: string): string {
  const cleaned = repoUrl
    .replace(/\.git$/, '')
    .replace(/^(https?:\/\/|git@)/, '')
    .replace(/:/g, '/');

  const parts = cleaned.split('/');
  return parts[parts.length - 1] ?? 'project';
}

export const CONTAINER_PREFIX = 'ol-';

/** @param _serverId - Reserved for multi-server container naming. Currently ignored. */
export function containerName(projectName: string, _serverId?: string): string {
  return `${CONTAINER_PREFIX}${projectName}`;
}

/** @param _serverId - Reserved for multi-server container naming. Currently ignored. */
export function composeContainerName(
  parentName: string,
  serviceName: string,
  _serverId?: string,
): string {
  return `${CONTAINER_PREFIX}${parentName}-${serviceName}`;
}

/** @param _serverId - Reserved for multi-server container naming. Currently ignored. */
export function serviceContainerName(serviceName: string, _serverId?: string): string {
  return `ol-svc-${serviceName}`;
}

export function serviceVolumeName(serviceName: string): string {
  return `ol-svc-data-${serviceName}`;
}

export function stripContainerPrefix(name: string): string {
  return name.replace(new RegExp(`^${CONTAINER_PREFIX}`), '');
}

export function collectKnownContainerNames<TEnvironment extends { container_id: string | null }>(
  projects: Array<{ id: string; name: string; container_id: string | null }>,
  environmentsByProject: (projectId: string) => TEnvironment[],
  environmentContainerName: (projectName: string, environment: TEnvironment) => string,
  services: Array<{ container_id: string | null; container_name: string | null }>,
): { knownIds: Set<string>; knownNames: Set<string> } {
  const knownIds = new Set<string>();
  const knownNames = new Set<string>();

  for (const project of projects) {
    // PR 4.5: per param shape, `container_id` here is supplied by callers
    // and may originate from either the (legacy) projects column or a
    // canonical lookup. We just dedupe whatever the caller provides.
    const projectContainerId = project.container_id ?? null;
    if (projectContainerId) knownIds.add(projectContainerId);
    knownNames.add(containerName(project.name));
    knownNames.add(containerName(`${project.name}-green`));
    knownNames.add(containerName(`${project.name}-blue`));

    for (const environment of environmentsByProject(project.id)) {
      if (environment.container_id) knownIds.add(environment.container_id);
      knownNames.add(environmentContainerName(project.name, environment));
    }
  }

  for (const service of services) {
    if (service.container_id) knownIds.add(service.container_id);
    if (service.container_name) knownNames.add(service.container_name);
  }

  return { knownIds, knownNames };
}
