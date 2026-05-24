import type { RuntimeBackend } from './runtime/index.js';
import { isDockerNotFoundError } from '../errors.js';

/**
 * Parsed Docker image URL components.
 */
export interface ParsedImageUrl {
  registry?: string;
  name: string;
  tag: string;
}

/**
 * Validates and parses a Docker image URL.
 *
 * Accepts formats:
 * - `nginx` → `{ name: 'nginx', tag: 'latest' }`
 * - `nginx:latest` → `{ name: 'nginx', tag: 'latest' }`
 * - `nginx:1.25-alpine` → `{ name: 'nginx', tag: '1.25-alpine' }`
 * - `ghcr.io/user/app:v1.0` → `{ registry: 'ghcr.io', name: 'user/app', tag: 'v1.0' }`
 * - `runtime.io/library/nginx:latest` → `{ registry: 'runtime.io', name: 'library/nginx', tag: 'latest' }`
 *
 * @param url - Docker image URL to parse
 * @returns Parsed image components or null if invalid
 */
export function parseImageUrl(url: string): ParsedImageUrl | null {
  // Reject empty or whitespace-only strings
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return null;
  }

  // Reject strings with spaces
  if (url.includes(' ')) {
    return null;
  }

  // Split by tag (last colon that's not part of registry)
  let imagePart = url;
  let tag = 'latest';

  // Check if there's a tag (colon not in registry part)
  const lastColonIndex = url.lastIndexOf(':');
  if (lastColonIndex !== -1) {
    // Check if this colon is part of a registry (e.g., localhost:5000)
    const beforeColon = url.substring(0, lastColonIndex);
    const afterColon = url.substring(lastColonIndex + 1);

    // If afterColon contains only valid tag characters and no slashes, it's a tag
    if (!/[/\\]/.test(afterColon) && /^[a-zA-Z0-9._-]+$/.test(afterColon)) {
      imagePart = beforeColon;
      tag = afterColon;
    }
  }

  // Split registry and name
  let registry: string | undefined;
  let name: string;

  // Check if imagePart contains a registry (has a dot, colon, or starts with localhost)
  const firstSlashIndex = imagePart.indexOf('/');
  if (firstSlashIndex !== -1) {
    const potentialRegistry = imagePart.substring(0, firstSlashIndex);
    // Registry must contain a dot, colon, or be localhost
    if (
      potentialRegistry.includes('.') ||
      potentialRegistry.includes(':') ||
      potentialRegistry === 'localhost'
    ) {
      registry = potentialRegistry;
      name = imagePart.substring(firstSlashIndex + 1);
    } else {
      name = imagePart;
    }
  } else {
    name = imagePart;
  }

  // Validate name is not empty
  if (!name || name.trim() === '') {
    return null;
  }

  // Validate name contains only valid characters (alphanumeric, dots, slashes, hyphens, underscores)
  if (!/^[a-zA-Z0-9._/-]+$/.test(name)) {
    return null;
  }

  const result: ParsedImageUrl = {
    name,
    tag,
  };

  if (registry) {
    result.registry = registry;
  }

  return result;
}

/**
 * Extracts the EXPOSE port from a Docker image.
 *
 * Inspects the image configuration and returns the lowest non-management port.
 * Returns null if no EXPOSE found or image doesn't exist.
 *
 * @param docker - Docker instance
 * @param imageTag - Image tag to inspect
 * @returns Exposed port number or null
 */
export async function getImageExposedPort(
  runtime: RuntimeBackend,
  imageTag: string,
): Promise<number | null> {
  try {
    const inspectData = await runtime.inspectImage(imageTag);

    // ExposedPorts format: { "80/tcp": {}, "443/tcp": {} }
    const exposedPorts = inspectData.Config.ExposedPorts as
      | Record<string, Record<string, unknown>>
      | undefined;

    if (!exposedPorts || Object.keys(exposedPorts).length === 0) {
      return null;
    }

    // Extract port numbers and filter out management ports
    const ports = Object.keys(exposedPorts)
      .map((portStr) => {
        const match = portStr.match(/^(\d+)\//);
        return match && match[1] ? parseInt(match[1], 10) : null;
      })
      .filter((port): port is number => port !== null && !isManagementPort(port));

    if (ports.length === 0) {
      return null;
    }

    // Return the lowest port
    return Math.min(...ports);
  } catch (_err) {
    // Image not found or inspect failed
    return null;
  }
}

/**
 * Maps Docker pull errors to user-friendly messages.
 *
 * @param error - Error from Docker pull operation
 * @returns User-friendly error message
 */
export function mapPullError(error: Error): string {
  const message = error.message.toLowerCase();

  if (isDockerNotFoundError(error) || message.includes('repository does not exist')) {
    return 'Image not found. Check the image name and try again.';
  }

  if (message.includes('denied') || message.includes('unauthorized')) {
    return 'This appears to be a private image. Only public images are supported in the current version.';
  }

  if (message.includes('no such host') || message.includes('connection refused')) {
    return 'Cannot reach the registry. Check your network connection.';
  }

  return `Failed to pull image: ${error.message}`;
}

/**
 * Check if a port is a management/internal port that should be excluded.
 */
function isManagementPort(port: number): boolean {
  const managementPorts = [9090, 9091];
  return managementPorts.includes(port);
}
