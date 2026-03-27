import { networkInterfaces, platform } from 'node:os';

import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('traefik');

import type { Docker } from './docker.js';
import { getDataDir, getPolicy, SHARED_NETWORK_NAME } from '../config/index.js';
import { join } from 'node:path';

const TRAEFIK_IMAGE = 'traefik:v3.6';

export type TraefikEnvironment = 'production' | 'development';

export interface TraefikManagerOptions {
  containerName?: string;
  networkName?: string;
  httpPort?: number;
  dashboardPort?: number;
}

/** Get the dynamic config directory for the current environment. */
export function getDynamicConfigDir(): string {
  return join(getDataDir(), 'traefik', 'dynamic');
}

/**
 * Traefik reverse proxy management.
 *
 * OpenLander uses Traefik as a Docker-label-based reverse proxy.
 * Each deployed container gets Traefik labels that automatically
 * configure routing without touching any config files.
 */
export class TraefikManager {
  private readonly containerName: string;
  private readonly networkName: string;
  private readonly httpPort: number;
  private readonly dashboardPort: number;

  constructor(
    private readonly docker: Docker,
    private readonly openLanderPort: number = 3000,
    options?: TraefikManagerOptions,
  ) {
    const defaultPolicy = getPolicy('production');
    this.containerName = options?.containerName ?? defaultPolicy.traefikContainerName;
    this.networkName = options?.networkName ?? defaultPolicy.networkName;
    this.httpPort = options?.httpPort ?? defaultPolicy.traefikHttpPort;
    this.dashboardPort = options?.dashboardPort ?? defaultPolicy.traefikDashboardPort;
  }

  async isRunning(): Promise<boolean> {
    try {
      const client = this.docker.getClient();
      const containers = await client.listContainers({
        filters: { name: [this.containerName] },
      });
      return containers.length > 0;
    } catch (err) {
      log.warn({ err }, 'Failed to check Traefik running status');
      return false;
    }
  }

  private async hasCurrentConfig(): Promise<boolean> {
    try {
      const client = this.docker.getClient();
      const container = client.getContainer(this.containerName);
      const info = await container.inspect();
      const cmd: string[] = (info.Config.Cmd as string[] | null) ?? [];
      return cmd.some((arg: string) => arg.includes('providers.http.endpoint'));
    } catch (_err) {
      return false;
    }
  }

  async ensureNetwork(): Promise<void> {
    await this.ensureNetworkByName(this.networkName);
  }

  async ensureAllNetworks(): Promise<void> {
    await this.ensureNetworkByName(SHARED_NETWORK_NAME);
  }

  /**
   * Connect the Traefik container to an additional Docker network.
   * Used to join the dev network so Traefik can route to dev containers.
   * No-op if already connected.
   */
  async connectToNetwork(networkName: string): Promise<void> {
    try {
      const client = this.docker.getClient();
      const container = client.getContainer(this.containerName);
      const info = await container.inspect();
      const connected = Object.keys(info.NetworkSettings.Networks);
      if (connected.includes(networkName)) {
        return;
      }
      const network = client.getNetwork(networkName);
      await network.connect({ Container: container.id });
      log.info(
        { containerName: this.containerName, networkName },
        'Traefik connected to additional network',
      );
    } catch (err) {
      log.warn({ err, networkName }, 'Failed to connect Traefik to additional network');
    }
  }

  private async ensureNetworkByName(name: string): Promise<void> {
    const client = this.docker.getClient();

    try {
      await client.getNetwork(name).inspect();
      return;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('not found') && !msg.includes('No such network')) {
        throw error;
      }
    }

    try {
      await client.createNetwork({
        Name: name,
        Driver: 'bridge',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists')) {
        return;
      }
      throw error;
    }
  }

  async start(): Promise<void> {
    if (await this.isRunning()) {
      if (await this.hasCurrentConfig()) {
        await this.ensureMultiNetwork();
        return;
      }
      log.info('Traefik config outdated (missing HTTP Provider) — recreating container');
    }

    await this.ensureAllNetworks();

    const client = this.docker.getClient();

    try {
      const existing = client.getContainer(this.containerName);
      await existing.remove({ force: true });
      log.debug('Removed existing Traefik container before recreation');
    } catch (_err) {
      // Container doesn't exist — expected on first run
    }

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
    }

    const httpPortStr = String(this.httpPort);
    const dashboardPortStr = String(this.dashboardPort);

    const container = await client.createContainer({
      Image: TRAEFIK_IMAGE,
      name: this.containerName,
      Cmd: [
        '--api.insecure=true',
        '--providers.docker=true',
        '--providers.docker.exposedbydefault=false',
        `--providers.docker.network=${this.networkName}`,
        `--providers.http.endpoint=http://host.docker.internal:${String(this.openLanderPort)}/api/traefik/config`,
        '--providers.http.pollInterval=5s',
        '--entrypoints.web.address=:80',
      ],
      ExposedPorts: {
        '80/tcp': {},
        '8080/tcp': {},
      },
      HostConfig: {
        PortBindings: {
          '80/tcp': [{ HostPort: httpPortStr }],
          '8080/tcp': [{ HostPort: dashboardPortStr }],
        },
        Binds: ['/var/run/docker.sock:/var/run/docker.sock:ro'],
        ...(platform() !== 'darwin' ? { ExtraHosts: ['host.docker.internal:host-gateway'] } : {}),
        NetworkMode: this.networkName,
        RestartPolicy: { Name: 'unless-stopped' },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      },
      Labels: {
        'openlander.managed': 'true',
        'openlander.role': 'traefik',
      },
    });
    await container.start();

    await this.ensureMultiNetwork();
  }

  private async ensureMultiNetwork(): Promise<void> {
    await this.connectToNetwork(SHARED_NETWORK_NAME);
  }

  async stop(): Promise<void> {
    try {
      await this.docker.removeContainer(this.containerName);
    } catch (err) {
      log.warn({ err }, 'Failed to remove Traefik container — may already be removed');
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
 * Prefers LAN IPs over VPN IPs, and skips Docker bridge interfaces.
 * Returns undefined if no usable IPv4 address is found.
 */
export function getLanIp(): string | undefined {
  const ips = getAllIps();
  const first = ips[0];
  return first?.address;
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
  const hostIp = process.env['HOST_IP'];
  const hostVpnIp = process.env['HOST_VPN_IP'];
  const dockerHost = process.env['DOCKER_HOST'];

  const nets = networkInterfaces();
  const detected: NetworkIp[] = [];
  const vpnPatterns = /^(tailscale|ts|zt|zerotier|wg|tun|utun)/i;
  const dockerPatterns = /^(br-|docker|veth)/i;

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.internal || net.family !== 'IPv4') continue;
      if (dockerPatterns.test(name)) continue;
      const isVpn = vpnPatterns.test(name) || net.address.startsWith('100.');
      detected.push({
        address: net.address,
        interface: name,
        type: isVpn ? 'vpn' : 'lan',
      });
    }
  }

  const result: NetworkIp[] = [];
  let dockerHostIp: string | undefined;

  if (dockerHost) {
    try {
      const url = new URL(dockerHost);
      if (url.protocol === 'tcp:' || url.protocol === 'ssh:') {
        const host = url.hostname;
        if (host && host !== 'localhost' && host !== '127.0.0.1') {
          dockerHostIp = host;
        }
      }
    } catch (error) {
      void error;
    }
  }

  if (hostIp) {
    result.push({ address: hostIp, interface: 'HOST_IP', type: 'lan' });
  } else if (dockerHostIp) {
    result.push({ address: dockerHostIp, interface: 'DOCKER_HOST', type: 'lan' });
  } else {
    result.push(...detected.filter((ip) => ip.type === 'lan'));
  }

  if (hostVpnIp) {
    result.push({ address: hostVpnIp, interface: 'HOST_VPN_IP', type: 'vpn' });
  } else {
    result.push(...detected.filter((ip) => ip.type === 'vpn'));
  }

  return result.sort((a, b) => (a.type === 'lan' ? -1 : 1) - (b.type === 'lan' ? -1 : 1));
}

export interface ProjectUrl {
  url: string;
  type: 'lan' | 'vpn';
  ip: string;
}

export function getProjectUrls(projectName: string): ProjectUrl[] {
  return getAllIps().map((ip) => ({
    url: `http://${projectName}.${ip.address}.sslip.io`,
    type: ip.type,
    ip: ip.address,
  }));
}

export function buildTraefikLabels(
  projectName: string,
  containerPort: number,
  hostname?: string,
  environment: TraefikEnvironment = 'production',
): Record<string, string> {
  const routerName = `ol-${projectName}`;
  const host = hostname ?? getEnvironmentProjectHostname(projectName, environment);
  const networkName = getPolicy(environment).networkName;

  return {
    'traefik.enable': 'true',
    [`traefik.http.routers.${routerName}.rule`]: `Host(\`${host}\`)`,
    [`traefik.http.routers.${routerName}.entrypoints`]: 'web',
    [`traefik.http.routers.${routerName}.service`]: routerName,
    [`traefik.http.services.${routerName}.loadbalancer.server.port`]: String(containerPort),
    'traefik.docker.network': networkName,
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
        if (pattern.test(container.image) || pattern.test(container.name)) {
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
 * In managed mode, connects to OpenLander's shared network.
 *
 * @param docker - Docker instance
 * @param containerId - Container ID to connect
 * @param networkName - Network name (from traefik.externalNetwork or config.docker.networkName)
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

  const ver = detection.version?.replace(/^v/i, '') ?? '';
  const versionInfo = ver ? ` v${ver}` : '';
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
