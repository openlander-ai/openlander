import { containerName } from './helpers.js';

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
  // Always localhost for now — single server mode
  void serverId; // suppress unused warning until multi-server
  return 'localhost';
}

/**
 * Resolves container name with optional server prefix.
 * TODO(multi-server): Prefix with serverId to avoid naming collisions across servers.
 */
export function resolveContainerName(projectName: string, serverId?: string): string {
  void serverId;
  return containerName(projectName);
}
