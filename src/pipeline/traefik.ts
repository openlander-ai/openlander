import { networkInterfaces, platform } from 'node:os';

import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('traefik');

import type { RuntimeBackend } from './runtime/index.js';
import { DOCKER_LABELS, getDataDir, getPolicy, SHARED_NETWORK_NAME } from '../config/index.js';
import { containerName as projectContainerName } from './helpers.js';
import { join } from 'node:path';
import { isDockerNotFoundError } from '../errors.js';
import { deployableServiceIdToProjectId } from '../db/service-ids.js';
import type { ServiceRow } from '../db/types.js';

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
    private readonly runtime: RuntimeBackend,
    private readonly openLanderPort: number = 3000,
    options?: TraefikManagerOptions,
  ) {
    const defaultPolicy = getPolicy('production');
    this.containerName = options?.containerName ?? 'traefik-ol';
    this.networkName = options?.networkName ?? defaultPolicy.networkName;
    this.httpPort = options?.httpPort ?? 80;
    this.dashboardPort = options?.dashboardPort ?? 8080;
  }

  async isRunning(): Promise<boolean> {
    try {
      const containers = await this.runtime.listAllContainers();
      return containers.some(
        (c) => c.labels[DOCKER_LABELS.ROLE] === 'traefik' && c.state === 'running',
      );
    } catch (err) {
      log.warn({ err }, 'Failed to check Traefik running status');
      return false;
    }
  }

  private async hasCurrentConfig(): Promise<boolean> {
    try {
      const info = await this.runtime.inspectContainer(this.containerName);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const cmd: string[] = info.Config.Cmd ?? [];
      const hasHttpProvider = cmd.some((arg: string) => arg.includes('providers.http.endpoint'));
      const hasCorrectNetwork = cmd.some(
        (arg: string) => arg === `--providers.docker.network=${this.networkName}`,
      );
      return hasHttpProvider && hasCorrectNetwork;
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
    await this.connectContainerToNetworkByName(this.containerName, networkName);
  }

  private async connectContainerToNetworkByName(
    containerName: string,
    networkName: string,
  ): Promise<boolean> {
    try {
      await this.runtime.connectContainerToNetwork(containerName, networkName);
      log.info({ containerName, networkName }, 'Traefik connected to network');
      return true;
    } catch (err) {
      log.warn({ err, containerName, networkName }, 'Failed to connect Traefik to network');
      return false;
    }
  }

  private async tryAdoptExistingTraefik(): Promise<boolean> {
    const containers = await this.runtime.listAllContainers();
    const running = containers.filter(
      (c) => c.labels[DOCKER_LABELS.ROLE] === 'traefik' && c.state === 'running',
    );

    const candidate = running.find((c) => c.name !== this.containerName);

    if (!candidate) {
      return false;
    }

    log.info(
      { existingContainer: candidate.name, managedContainer: this.containerName },
      'Found legacy OpenLander Traefik — adopting',
    );

    const connected = await this.connectContainerToNetworkByName(
      candidate.name,
      SHARED_NETWORK_NAME,
    );
    if (!connected) {
      log.warn(
        'Failed to connect adopted Traefik to shared network — falling back to new container',
      );
      return false;
    }

    try {
      await this.runtime.removeContainer(this.containerName);
      log.debug({ containerName: this.containerName }, 'Removed stale managed Traefik container');
    } catch {
      // Container doesn't exist — expected
    }

    return true;
  }

  private async ensureNetworkByName(name: string): Promise<void> {
    try {
      await this.runtime.getNetworkInfo(name);
      return;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('not found') && !isDockerNotFoundError(error)) {
        throw error;
      }
    }

    await this.runtime.ensureNetwork(name);
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

    if (await this.tryAdoptExistingTraefik()) {
      return;
    }

    try {
      const existing = await this.runtime.listAllContainers();
      const traefikContainers = existing.filter((c) => c.labels[DOCKER_LABELS.ROLE] === 'traefik');
      for (const c of traefikContainers) {
        await this.runtime.removeContainer(c.id);
      }
      if (traefikContainers.length > 0) {
        log.debug(
          `Removed ${traefikContainers.length.toString()} existing Traefik container(s) before recreation`,
        );
      }
    } catch (_err) {
      // Container doesn't exist — expected on first run
    }

    try {
      await this.runtime.pullImage(TRAEFIK_IMAGE);
    } catch (err) {
      log.debug({ err }, 'Traefik image pull failed — may already exist locally');
    }

    const httpPortStr = String(this.httpPort);
    const dashboardPortStr = String(this.dashboardPort);

    await this.runtime.runInfraContainer({
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
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.ROLE]: 'traefik',
      },
    });

    await this.ensureMultiNetwork();
  }

  private async ensureMultiNetwork(): Promise<void> {
    await this.connectToNetwork(SHARED_NETWORK_NAME);
  }

  async stop(): Promise<void> {
    try {
      await this.runtime.safeRemoveContainer(this.containerName);
    } catch (err) {
      log.warn({ err }, 'Failed to remove Traefik container — may already be removed');
    }
  }
}

export function getConfiguredPublicHost(): string | undefined {
  const raw = process.env['OPENLANDER_PUBLIC_HOST']?.trim();
  if (!raw) return undefined;
  const withoutWildcard = raw.startsWith('*.') ? raw.slice(2) : raw;
  try {
    const parsed = new URL(
      withoutWildcard.includes('://') ? withoutWildcard : `http://${withoutWildcard}`,
    );
    return parsed.hostname || undefined;
  } catch (_error) {
    return withoutWildcard.replace(/\/.*$/, '').replace(/:\d+$/, '') || undefined;
  }
}

function configuredPublicHost(): string | undefined {
  return getConfiguredPublicHost();
}

function isContainerizedRuntime(): boolean {
  const raw = process.env['OPENLANDER_CONTAINERIZED']?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function isIpv4Address(value: string): boolean {
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) return false;
      const n = Number(part);
      return n >= 0 && n <= 255;
    })
  );
}

function hostnameFromPublicHost(projectName: string, publicHost: string): string {
  if (isIpv4Address(publicHost)) {
    return `${projectName}.${publicHost}.sslip.io`;
  }
  return `${projectName}.${publicHost}`;
}

/**
 * Get the hostname for a project.
 * Prefers OPENLANDER_PUBLIC_HOST when configured so containerized installs do
 * not advertise the backend container's private bridge IP.
 */
export function getProjectHostname(projectName: string, lanIp?: string): string {
  const explicitPublicHost = lanIp ? undefined : configuredPublicHost();
  if (explicitPublicHost) {
    return hostnameFromPublicHost(projectName, explicitPublicHost);
  }

  const ip = lanIp ?? getLanIp();
  if (ip) {
    return `${projectName}.${ip}.sslip.io`;
  }
  return `${projectName}.localhost`;
}

export function getEnvironmentProjectHostname(
  projectName: string,
  _environment: TraefikEnvironment,
  lanIp?: string,
): string {
  return getProjectHostname(projectName, lanIp);
}

/**
 * Get the full internal URL for a project.
 */
export function getProjectUrl(projectName: string, lanIp?: string): string {
  return `http://${getProjectHostname(projectName, lanIp)}`;
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
 *
 * Inside a containerized OpenLander runtime (OPENLANDER_CONTAINERIZED=true),
 * `networkInterfaces()` sees the container's own bridge IP (typically a
 * 172.x.x.x address on `eth0`) — useless as a public URL because host
 * browsers cannot reach it directly. In that case we ignore detected
 * interfaces entirely and rely solely on explicit env overrides
 * (HOST_IP, HOST_VPN_IP, DOCKER_HOST). Operators with a containerized
 * install on a real server should set OPENLANDER_PUBLIC_HOST or HOST_IP so
 * sslip.io URLs advertise a reachable address.
 */
export function getAllIps(): NetworkIp[] {
  const hostIp = process.env['HOST_IP'];
  const hostVpnIp = process.env['HOST_VPN_IP'];
  const dockerHost = process.env['DOCKER_HOST'];
  const containerized = isContainerizedRuntime();

  const detected: NetworkIp[] = containerized ? [] : detectInterfaceIps();

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

function detectInterfaceIps(): NetworkIp[] {
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

  return detected;
}

export interface ProjectUrl {
  url: string;
  type: 'public' | 'lan' | 'vpn' | 'host';
  ip?: string;
  host?: string;
  reachable?: 'external' | 'host-only' | 'container-only';
}

export function getProjectUrls(projectName: string, assignedPort?: number | null): ProjectUrl[] {
  const publicHost = configuredPublicHost();
  if (publicHost) {
    return [
      {
        url: `http://${hostnameFromPublicHost(projectName, publicHost)}`,
        type: 'public',
        host: publicHost,
        reachable: 'external',
      },
    ];
  }

  const urls: ProjectUrl[] = getAllIps().map((ip) => ({
    url: `http://${projectName}.${ip.address}.sslip.io`,
    type: ip.type,
    ip: ip.address,
    reachable: 'external' as const,
  }));

  // Always advertise the host-published port when known. On Mac Docker
  // Desktop this is often the only address the user's browser can reach,
  // and on bare-metal it remains useful as a localhost dev URL alongside
  // the LAN sslip URL.
  if (assignedPort && assignedPort > 0) {
    urls.push({
      url: `http://localhost:${String(assignedPort)}`,
      type: 'host',
      host: 'localhost',
      reachable: 'host-only',
    });
  }

  if (urls.length === 0) {
    urls.push({
      url: `http://${projectName}.localhost`,
      type: 'host',
      host: 'localhost',
      reachable: 'host-only',
    });
  }

  return urls;
}

export function getPreferredProjectUrl(projectName: string, assignedPort?: number | null): string {
  return getProjectUrls(projectName, assignedPort)[0]?.url ?? getProjectUrl(projectName);
}

type RoutableService = Pick<ServiceRow, 'name' | 'assigned_port' | 'public_url'>;

function routeSlug(displayName: string): string {
  const slug = displayName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug.length > 0 ? slug : 'project';
}

function projectUrlFromExternalUrl(url: string): ProjectUrl {
  try {
    const parsed = new URL(url);
    return {
      url,
      type: 'public',
      host: parsed.hostname,
      reachable: 'external',
    };
  } catch {
    return { url, type: 'public', reachable: 'external' };
  }
}

export function getDeployableServiceDisplayName(service: Pick<ServiceRow, 'name'>): string {
  return deployableServiceIdToProjectId(service.name);
}

export function getDeployableServiceRouteName(service: Pick<ServiceRow, 'name'>): string {
  return routeSlug(getDeployableServiceDisplayName(service));
}

export function getDeployableServiceUrls(service: RoutableService): ProjectUrl[] {
  const port = service.assigned_port ?? null;
  if (!port) return [];

  if (service.public_url) {
    return [projectUrlFromExternalUrl(service.public_url)];
  }

  return getProjectUrls(getDeployableServiceRouteName(service), port);
}

export function getPreferredDeployableServiceUrl(service: RoutableService): string | null {
  return getDeployableServiceUrls(service)[0]?.url ?? null;
}

export function buildTraefikLabels(
  projectName: string,
  containerPort: number,
  hostname?: string,
  _environment: TraefikEnvironment = 'production',
  networkName = getPolicy('production').networkName,
): Record<string, string> {
  const routerName = projectContainerName(projectName);
  const host = hostname ?? getEnvironmentProjectHostname(projectName, 'production');

  return {
    'traefik.enable': 'true',
    [`traefik.http.routers.${routerName}.rule`]: `Host(\`${host}\`)`,
    [`traefik.http.routers.${routerName}.entrypoints`]: 'web',
    [`traefik.http.routers.${routerName}.service`]: routerName,
    [`traefik.http.services.${routerName}.loadbalancer.server.port`]: String(containerPort),
    'traefik.docker.network': networkName,
  };
}

export async function ensureManagedTraefikNetwork(
  runtime: RuntimeBackend,
  networkName: string,
): Promise<void> {
  try {
    await runtime.connectContainerToNetwork('traefik-ol', networkName);
  } catch (error) {
    if (isDockerNotFoundError(error)) {
      log.warn(
        { error, networkName },
        'Managed Traefik container not found while connecting project network',
      );
      return;
    }
    log.warn({ error, networkName }, 'Failed to connect managed Traefik to project network');
    throw error;
  }
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
 * @param runtime - Runtime backend to query containers
 * @returns Proxy detection result with type, container name, ports, and version
 */
export async function detectReverseProxy(runtime: RuntimeBackend): Promise<ProxyDetection> {
  try {
    const containers = await runtime.listAllContainers();

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
  if (labels[DOCKER_LABELS.ROLE] === 'traefik') {
    return true;
  }

  const providerLabels = Object.entries(labels).filter(([key]) => isTraefikDockerProviderKey(key));
  if (providerLabels.some(([, value]) => value.trim().toLowerCase() === 'false')) {
    return false;
  }

  // Check for common Traefik provider indicators
  // External Traefik may have these labels set
  const hasProviderLabels = providerLabels.length > 0;

  if (hasProviderLabels) {
    return true;
  }

  // Default to true for external Traefik (most common config)
  // This will be verified more accurately in future versions
  return true;
}

function isTraefikDockerProviderKey(key: string): boolean {
  return (
    key.startsWith('traefik.') && (key.includes('.docker.') || key.includes('providers.docker'))
  );
}

// --- Mode Switching ---

/**
 * Switch from managed to external Traefik mode.
 *
 * Safely stops the OpenLander-managed Traefik container.
 * Does NOT modify config — caller should update traefik.mode and traefik.externalNetwork.
 *
 * @param runtime - Runtime backend
 * @param externalNetwork - Name of the external Traefik's Docker network
 */
export async function switchToExternalMode(
  runtime: RuntimeBackend,
  externalNetwork: string,
): Promise<void> {
  log.info({ externalNetwork }, 'Switching to external Traefik mode');

  // Stop managed Traefik if running
  const manager = new TraefikManager(runtime);
  await manager.stop();

  log.info('Managed Traefik stopped (if it was running)');
}

/**
 * Connect a container to the Traefik-facing network.
 * OpenLander 0.1 deploys apps onto project-scoped networks; managed Traefik must join
 * those networks to route Docker-provider traffic.
 *
 * @param runtime - Runtime backend
 * @param containerId - Container ID to connect
 * @param networkName - Network name (from traefik.externalNetwork or config.docker.networkName)
 */
export async function connectToTraefikNetwork(
  runtime: RuntimeBackend,
  containerId: string,
  networkName: string,
): Promise<void> {
  try {
    await runtime.connectContainerToNetwork(containerId, networkName);
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
