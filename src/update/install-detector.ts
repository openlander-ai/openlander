import { basename, isAbsolute } from 'node:path';
import type { Docker } from '../pipeline/docker.js';
import type { ComposeInstallation } from './types.js';

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';
const COMPOSE_WORKDIR_LABEL = 'com.docker.compose.project.working_dir';
const COMPOSE_CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files';
const DATA_DESTINATION = '/root/.openlander';
const DOCKER_SOCKET_DESTINATION = '/var/run/docker.sock';

type InstallDocker = Pick<Docker, 'inspectContainer'>;

function unsupported(reason: string): ComposeInstallation {
  return {
    mode: 'manual',
    reason,
    containerId: null,
    image: null,
    imageId: null,
    composeProject: null,
    composeService: null,
    workingDirectory: null,
    composeFiles: [],
    dataVolumeName: null,
    dockerSocketPath: null,
    networkNames: [],
  };
}

export async function detectComposeInstallation(
  docker: InstallDocker,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ComposeInstallation> {
  if (environment.OPENLANDER_CONTAINERIZED !== 'true') {
    return unsupported('not_containerized');
  }
  const containerId = environment.HOSTNAME?.trim();
  if (!containerId) return unsupported('container_identity_missing');
  let info: Awaited<ReturnType<InstallDocker['inspectContainer']>>;
  try {
    info = await docker.inspectContainer(containerId);
  } catch {
    return unsupported('container_inspection_failed');
  }
  const labels = info.Config.Labels;
  const composeProject = labels[COMPOSE_PROJECT_LABEL]?.trim() ?? '';
  const composeService = labels[COMPOSE_SERVICE_LABEL]?.trim() ?? '';
  const workingDirectory = labels[COMPOSE_WORKDIR_LABEL]?.trim() ?? '';
  const composeFiles = (labels[COMPOSE_CONFIG_FILES_LABEL] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    !composeProject ||
    composeService !== 'openlander' ||
    !isAbsolute(workingDirectory) ||
    composeFiles.length !== 1 ||
    !isAbsolute(composeFiles[0] ?? '') ||
    basename(composeFiles[0] ?? '') !== 'docker-compose.runtime.yml'
  ) {
    return unsupported('unofficial_compose_installation');
  }
  const dataMount = info.Mounts.find(
    (mount) => mount.Destination === DATA_DESTINATION && mount.Type === 'volume',
  );
  const dockerSocketMount = info.Mounts.find(
    (mount) => mount.Destination === DOCKER_SOCKET_DESTINATION,
  );
  const dataVolumeName = dataMount?.Name?.trim() ?? '';
  const dockerSocketPath = dockerSocketMount?.Source.trim() ?? '';
  const preferredNetwork = `${composeProject}_default`;
  const networkNames = Object.keys(info.NetworkSettings.Networks).sort((left, right) => {
    if (left === preferredNetwork) return -1;
    if (right === preferredNetwork) return 1;
    return left.localeCompare(right);
  });
  if (!dataVolumeName || !dockerSocketPath || networkNames.length === 0) {
    return unsupported('required_mount_or_network_missing');
  }
  return {
    mode: 'compose',
    reason: null,
    containerId,
    image: info.Config.Image,
    imageId: info.Image,
    composeProject,
    composeService,
    workingDirectory,
    composeFiles,
    dataVolumeName,
    dockerSocketPath,
    networkNames,
  };
}
