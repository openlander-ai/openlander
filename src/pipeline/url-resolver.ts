import { containerName } from './helpers.js';

const DEFAULT_LOCAL_CONTAINER_HOST = 'localhost';
const DEFAULT_CONTAINERIZED_CONTAINER_HOST = 'host.docker.internal';

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/**
 * Resolves the container URL for a given port and server.
 * TODO(multi-server): When serverId refers to a remote server,
 * look up the server's host from ServerRegistry and return the remote URL.
 */
export function resolveContainerUrl(port: number, serverId?: string): string {
  const host = resolveContainerHost(serverId);
  return `http://${host}:${String(port)}`;
}

/**
 * Resolves the container host for a given server.
 * TODO(multi-server): Return remote server's IP/hostname when serverId is not local.
 */
export function resolveContainerHost(serverId?: string): string {
  void serverId; // suppress unused warning until multi-server
  if (isTruthyEnv(process.env.OPENLANDER_CONTAINERIZED)) {
    const configuredHost = process.env.OPENLANDER_CONTAINER_HOST?.trim();
    return configuredHost && configuredHost.length > 0
      ? configuredHost
      : DEFAULT_CONTAINERIZED_CONTAINER_HOST;
  }
  return DEFAULT_LOCAL_CONTAINER_HOST;
}

/**
 * Resolves container name with optional server prefix.
 * TODO(multi-server): Prefix with serverId to avoid naming collisions across servers.
 */
export function resolveContainerName(projectName: string, serverId?: string): string {
  void serverId;
  return containerName(projectName);
}
