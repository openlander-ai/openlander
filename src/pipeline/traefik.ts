import { mkdirSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';

import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('traefik');

import type { Docker } from './docker.js';

const TRAEFIK_CONTAINER_NAME = 'openlander-traefik';
const TRAEFIK_IMAGE = 'traefik:v3.6';
const TRAEFIK_NETWORK = 'web';
const TRAEFIK_DYNAMIC_DIR_IN_CONTAINER = '/etc/traefik/dynamic/';

export const DYNAMIC_CONFIG_DIR = join(homedir(), '.openlander', 'traefik', 'dynamic');

export type TraefikEnvironment = 'production' | 'development';

/**
 * Traefik reverse proxy management.
 *
 * OpenLander uses Traefik as a Docker-label-based reverse proxy.
 * Each deployed container gets Traefik labels that automatically
 * configure routing without touching any config files.
 */
export class TraefikManager {
  constructor(private readonly docker: Docker) {}

  /** Check if Traefik container is running. */
  async isRunning(): Promise<boolean> {
    try {
      const client = this.docker.getClient();
      const containers = await client.listContainers({
        filters: { name: [TRAEFIK_CONTAINER_NAME] },
      });
      return containers.length > 0;
    } catch (err) {
      log.warn({ err }, 'Failed to check Traefik running status');
      return false;
    }
  }

  /**
   * Check if the running Traefik container has up-to-date config.
   * Returns false if the container is missing File Provider or other required args.
   */
  private async hasCurrentConfig(): Promise<boolean> {
    try {
      const client = this.docker.getClient();
      const container = client.getContainer(TRAEFIK_CONTAINER_NAME);
      const info = await container.inspect();
      const cmd: string[] = (info.Config.Cmd as string[] | null) ?? [];
      return cmd.some((arg: string) => arg.includes('providers.file.directory'));
    } catch (_err) {
      return false;
    }
  }

  /**
   * Ensure the Docker network for Traefik exists.
   * All managed containers join this network.
   */
  async ensureNetwork(): Promise<void> {
    const client = this.docker.getClient();
    const networks = await client.listNetworks({
      filters: { name: [TRAEFIK_NETWORK] },
    });

    if (networks.length === 0) {
      await client.createNetwork({
        Name: TRAEFIK_NETWORK,
        Driver: 'bridge',
      });
    }
  }

  /**
   * Start the Traefik reverse proxy container.
   * Configured as Docker provider — reads labels from other containers.
   */
  async start(): Promise<void> {
    // If running, check if config is up-to-date (e.g., File Provider added in v0.2.6)
    if (await this.isRunning()) {
      if (await this.hasCurrentConfig()) return;
      log.info('Traefik config outdated (missing File Provider) — recreating container');
    }

    await this.ensureNetwork();
    mkdirSync(DYNAMIC_CONFIG_DIR, { recursive: true });

    const client = this.docker.getClient();

    // Remove any existing stopped container to avoid 409 Conflict on create
    try {
      const existing = client.getContainer(TRAEFIK_CONTAINER_NAME);
      await existing.remove({ force: true });
      log.debug('Removed existing Traefik container before recreation');
    } catch (_err) {
      // Container doesn't exist — expected on first run
    }

    // Pull image first
    try {
      const stream = await client.pull(TRAEFIK_IMAGE);
      await new Promise<void>((resolve, reject) => {
        client.modem.followProgress(stream, (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (err) {
      log.debug({ err }, 'Traefik image pull failed — may already exist locally');
      // Image might already exist locally
    }

    const container = await client.createContainer({
      Image: TRAEFIK_IMAGE,
      name: TRAEFIK_CONTAINER_NAME,
      Cmd: [
        '--api.insecure=true',
        '--providers.docker=true',
        '--providers.docker.exposedbydefault=false',
        `--providers.docker.network=${TRAEFIK_NETWORK}`,
        `--providers.file.directory=${TRAEFIK_DYNAMIC_DIR_IN_CONTAINER}`,
        '--providers.file.watch=true',
        '--entrypoints.web.address=:80',
      ],
      ExposedPorts: {
        '80/tcp': {},
        '8080/tcp': {}, // Traefik dashboard
      },
      HostConfig: {
        PortBindings: {
          '80/tcp': [{ HostPort: '80' }],
          '8080/tcp': [{ HostPort: '8080' }],
        },
        Binds: [
          '/var/run/docker.sock:/var/run/docker.sock:ro',
          `${DYNAMIC_CONFIG_DIR}:${TRAEFIK_DYNAMIC_DIR_IN_CONTAINER}:rw`,
        ],
        NetworkMode: TRAEFIK_NETWORK,
        RestartPolicy: { Name: 'unless-stopped' },
      },
      Labels: {
        'openlander.managed': 'true',
        'openlander.role': 'traefik',
      },
    });
    await container.start();
  }

  /** Stop and remove the Traefik container. */
  async stop(): Promise<void> {
    try {
      await this.docker.removeContainer(TRAEFIK_CONTAINER_NAME);
    } catch (err) {
      log.warn({ err }, 'Failed to remove Traefik container — may already be removed');
      // Already removed
    }
  }
}

/**
 * Get the hostname for a project.
 * Uses sslip.io wildcard DNS so the URL works from any device on the network.
 * Falls back to .localhost if no LAN IP is available.
 */
export function getProjectHostname(projectName: string, lanIp?: string): string {
  const ip = lanIp ?? getLanIp();
  if (ip) {
    return `${projectName}.${ip}.sslip.io`;
  }
  return `${projectName}.localhost`;
}

export function getEnvironmentProjectHostname(
  projectName: string,
  environment: TraefikEnvironment,
  lanIp?: string,
): string {
  const envProjectName = getEnvironmentProjectName(projectName, environment);
  const ip = lanIp ?? getLanIp();
  if (ip) {
    return `${envProjectName}.${ip}.sslip.io`;
  }
  return `${envProjectName}.localhost`;
}

/**
 * Get the full internal URL for a project.
 */
export function getProjectUrl(projectName: string, lanIp?: string): string {
  return `http://${getProjectHostname(projectName, lanIp)}`;
}

function getEnvironmentProjectName(projectName: string, environment: TraefikEnvironment): string {
  if (environment === 'development') {
    return `dev-${projectName}`;
  }

  return projectName;
}

/**
 * Build Traefik labels for a project container.
 *
 * Pattern from Dokploy/openclaw-host-kit:
 *   traefik.http.routers.{name}.rule = Host(`{hostname}`)
 *   traefik.http.services.{name}.loadbalancer.server.port = {port}
 */
/**
 * Get the primary LAN IP address of this machine.
 * Returns undefined if no non-internal IPv4 address is found.
 */
export function getLanIp(): string | undefined {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (!net.internal && net.family === 'IPv4') {
        return net.address;
      }
    }
  }
  return undefined;
}

export interface NetworkIp {
  address: string;
  interface: string;
  /** 'lan' for regular network, 'vpn' for Tailscale/ZeroTier/WireGuard */
  type: 'lan' | 'vpn';
}

/**
 * Get all non-internal IPv4 addresses.
 * Detects LAN IPs and VPN IPs (Tailscale, ZeroTier, WireGuard).
 */
export function getAllIps(): NetworkIp[] {
  const nets = networkInterfaces();
  const ips: NetworkIp[] = [];
  const vpnPatterns = /^(tailscale|ts|zt|zerotier|wg|tun|utun)/i;
  const dockerPatterns = /^(br-|docker|veth)/i;

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.internal || net.family !== 'IPv4') continue;
      // Skip Docker bridge networks
      if (dockerPatterns.test(name)) continue;
      const isVpn = vpnPatterns.test(name) || net.address.startsWith('100.');
      ips.push({
        address: net.address,
        interface: name,
        type: isVpn ? 'vpn' : 'lan',
      });
    }
  }
  // LAN first, then VPN
  return ips.sort((a, b) => (a.type === 'lan' ? -1 : 1) - (b.type === 'lan' ? -1 : 1));
}

export function buildTraefikLabels(
  projectName: string,
  containerPort: number,
  hostname?: string,
  environment: TraefikEnvironment = 'production',
): Record<string, string> {
  const routerName = `ol-${projectName}`;
  const host = hostname ?? getEnvironmentProjectHostname(projectName, environment);

  return {
    'traefik.enable': 'true',
    [`traefik.http.routers.${routerName}.rule`]: `Host(\`${host}\`)`,
    [`traefik.http.routers.${routerName}.entrypoints`]: 'web',
    [`traefik.http.routers.${routerName}.service`]: routerName,
    [`traefik.http.services.${routerName}.loadbalancer.server.port`]: String(containerPort),
  };
}

// --- Reverse Proxy Detection ---

/** Result of detecting reverse proxies on the server. */
export interface ProxyDetection {
  /** Type of reverse proxy detected. */
  type: 'traefik' | 'nginx' | 'caddy' | 'haproxy' | 'none';
  /** Container name if found. */
  container?: string;
  /** Ports the proxy is using. */
  ports: number[];
  /** Version extracted from image tag (e.g., 'v3.3' from 'traefik:v3.3'). */
  version?: string;
  /** Whether Traefik Docker provider is enabled (only for type: 'traefik'). */
  traefikDockerProvider?: boolean;
}

/** Priority order for proxy detection (higher = preferred). */
const PROXY_PRIORITY: Record<string, number> = {
  traefik: 4,
  nginx: 3,
  caddy: 2,
  haproxy: 1,
};

/** Known proxy image patterns. */
const PROXY_PATTERNS: Array<{
  type: ProxyDetection['type'];
  pattern: RegExp;
}> = [
  { type: 'traefik', pattern: /traefik/i },
  { type: 'nginx', pattern: /nginx/i },
  { type: 'caddy', pattern: /caddy/i },
  { type: 'haproxy', pattern: /haproxy/i },
];

/**
 * Detect reverse proxies running on the server.
 *
 * Scans all Docker containers and identifies known reverse proxy images.
 * When multiple proxies exist, returns the one with highest priority.
 *
 * @param docker - Docker instance to query containers
 * @returns Proxy detection result with type, container name, ports, and version
 */
export async function detectReverseProxy(docker: Docker): Promise<ProxyDetection> {
  try {
    const containers = await docker.listAllContainers();

    // Find all proxy containers
    const detectedProxies: Array<ProxyDetection & { priority: number }> = [];

    for (const container of containers) {
      // Only check running or restarting containers
      if (container.state !== 'running' && container.state !== 'restarting') {
        continue;
      }

      for (const { type, pattern } of PROXY_PATTERNS) {
        if (pattern.test(container.image)) {
          const ports = container.ports
            .filter((p): p is typeof p & { PublicPort: number } => p.PublicPort !== undefined)
            .map((p) => p.PublicPort);

          const version = extractVersion(container.image);
          const priority = PROXY_PRIORITY[type] ?? 0;

          // For Traefik, check if Docker provider is enabled
          let traefikDockerProvider: boolean | undefined;
          if (type === 'traefik') {
            traefikDockerProvider = checkTraefikDockerProvider(container.labels);
          }

          detectedProxies.push({
            type,
            container: container.name,
            ports,
            version,
            priority,
            traefikDockerProvider,
          });
          break; // Only match first pattern per container
        }
      }
    }

    // Return highest priority proxy, or 'none' if nothing found
    if (detectedProxies.length === 0) {
      return { type: 'none', ports: [] };
    }

    // Sort by priority descending and return the highest
    const best = detectedProxies.sort((a, b) => b.priority - a.priority)[0];
    if (best === undefined) {
      return { type: 'none', ports: [] };
    }

    return {
      type: best.type,
      container: best.container,
      ports: best.ports,
      version: best.version,
      traefikDockerProvider: best.traefikDockerProvider,
    };
  } catch (error) {
    // Docker daemon not running or connection error
    log.warn({ error }, 'Failed to detect reverse proxy, returning none');
    return { type: 'none', ports: [] };
  }
}

/**
 * Extract version from image tag.
 * Example: 'traefik:v3.3' -> 'v3.3', 'nginx:1.25-alpine' -> '1.25-alpine'
 */
function extractVersion(image: string): string | undefined {
  const parts = image.split(':');
  if (parts.length >= 2) {
    return parts.slice(1).join(':');
  }
  return undefined;
}

/**
 * Check if Traefik Docker provider is enabled by inspecting labels.
 * Traefik v2+ uses command line args, but we can check for provider-related labels.
 */
function checkTraefikDockerProvider(labels: Record<string, string>): boolean {
  // OpenLander-managed Traefik always has this label
  if (labels['openlander.role'] === 'traefik') {
    return true;
  }

  // Check for common Traefik provider indicators
  // External Traefik may have these labels set
  const hasProviderLabels = Object.keys(labels).some(
    (key) =>
      key.startsWith('traefik.') && (key.includes('.docker.') || key.includes('providers.docker')),
  );

  if (hasProviderLabels) {
    return true;
  }

  // Default to true for external Traefik (most common config)
  // This will be verified more accurately in future versions
  return true;
}

// --- Mode Switching ---

/**
 * Switch from managed to external Traefik mode.
 *
 * Safely stops the OpenLander-managed Traefik container.
 * Does NOT modify config — caller should update traefik.mode and traefik.externalNetwork.
 *
 * @param docker - Docker instance
 * @param externalNetwork - Name of the external Traefik's Docker network
 */
export async function switchToExternalMode(docker: Docker, externalNetwork: string): Promise<void> {
  log.info({ externalNetwork }, 'Switching to external Traefik mode');

  // Stop managed Traefik if running
  const manager = new TraefikManager(docker);
  await manager.stop();

  log.info('Managed Traefik stopped (if it was running)');
}

/**
 * Connect a container to the Traefik network.
 * In external mode, connects to the external network.
 * In managed mode, connects to the 'web' network.
 *
 * @param docker - Docker instance
 * @param containerId - Container ID to connect
 * @param networkName - Network name (from traefik.externalNetwork or 'web')
 */
export async function connectToTraefikNetwork(
  docker: Docker,
  containerId: string,
  networkName: string,
): Promise<void> {
  try {
    const client = docker.getClient();
    const network = client.getNetwork(networkName);
    await network.connect({ Container: containerId });
    log.debug({ containerId, networkName }, 'Container connected to Traefik network');
  } catch (error) {
    log.warn({ error, containerId, networkName }, 'Failed to connect container to Traefik network');
    throw error;
  }
}

// --- Warning Messages ---

/**
 * Generate a warning message for non-Traefik proxy detection.
 *
 * @param detection - Proxy detection result
 * @returns Warning message string, or undefined if no warning needed
 */
export function getProxyWarning(detection: ProxyDetection): string | undefined {
  if (detection.type === 'none') {
    return undefined;
  }

  if (detection.type === 'traefik') {
    // Traefik-specific: check Docker provider
    if (detection.traefikDockerProvider === false) {
      return (
        `Traefik detected (${detection.container ?? 'unknown'}) but Docker provider is not enabled. ` +
        `Add '--providers.docker=true' to Traefik's command line arguments for automatic routing.`
      );
    }
    return undefined;
  }

  // Non-Traefik proxies
  const proxyNames: Record<string, string> = {
    nginx: 'Nginx',
    caddy: 'Caddy',
    haproxy: 'HAProxy',
  };

  const name = proxyNames[detection.type] ?? detection.type;
  const versionInfo = detection.version ? ` (${detection.version})` : '';
  const containerInfo = detection.container ? ` in container '${detection.container}'` : '';

  return (
    `${name}${versionInfo} detected${containerInfo}. ` +
    `OpenLander will not automatically configure this proxy. ` +
    `For automatic routing, consider switching to Traefik or manually configure ${name}.`
  );
}

/**
 * Get a user-friendly description of the current proxy status.
 *
 * @param detection - Proxy detection result
 * @param mode - Current Traefik mode ('managed' or 'external')
 * @returns Human-readable status string
 */
export function getProxyStatus(detection: ProxyDetection, mode: 'managed' | 'external'): string {
  if (detection.type === 'none') {
    return mode === 'managed'
      ? 'No reverse proxy detected (OpenLander will start Traefik)'
      : 'No reverse proxy detected (external mode may not work)';
  }

  const versionInfo = detection.version ? ` v${detection.version}` : '';
  const containerInfo = detection.container ? ` (${detection.container})` : '';

  if (detection.type === 'traefik') {
    const modeInfo = mode === 'external' ? 'external mode' : 'managed mode';
    const providerInfo =
      detection.traefikDockerProvider === false ? ' (Docker provider disabled!)' : '';
    return `Traefik${versionInfo}${containerInfo} [${modeInfo}]${providerInfo}`;
  }

  const proxyNames: Record<string, string> = {
    nginx: 'Nginx',
    caddy: 'Caddy',
    haproxy: 'HAProxy',
  };

  const name = proxyNames[detection.type] ?? detection.type;
  return `${name}${versionInfo}${containerInfo} (not integrated)`;
}
