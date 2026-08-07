import { networkInterfaces, platform } from 'node:os';

import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('traefik');

import type { RuntimeBackend } from './runtime/index.js';
import { DOCKER_LABELS, getDataDir, getPolicy, SHARED_NETWORK_NAME } from '../config/index.js';
import { containerName as projectContainerName } from './helpers.js';
import { join } from 'node:path';
import {
  isDockerNotFoundError,
  ManagedTraefikNetworkError,
  ManagedTraefikOwnershipError,
} from '../errors.js';
import { deployableServiceIdToProjectId } from '../db/service-ids.js';
import type { ServiceRow } from '../db/types.js';

const TRAEFIK_IMAGE = 'traefik:v3.6';

export type TraefikEnvironment = 'production' | 'development';

export interface TraefikManagerOptions {
  containerName?: string;
  networkName?: string;
  httpPort?: number;
  httpsPort?: number;
  dashboardPort?: number;
  instanceId?: string;
  protectedShareConfig?: () => { publicHost: string; acmeEmail: string };
}

/** Get the dynamic config directory for the current environment. */
export function getDynamicConfigDir(): string {
  return join(getDataDir(), 'traefik', 'dynamic');
}

/**
 * Traefik reverse proxy management.
 *
 * OpenLander-managed Traefik uses the HTTP provider as the source of truth
 * for app routes. Docker-label routes are deliberately disabled for managed
 * app containers so blue-green and in-place route updates can flip the active
 * backend through the database without stale container labels racing it.
 */
export class TraefikManager {
  private static readonly CONTAINERIZED_OPENLANDER_HOST = 'openlander';
  private readonly containerName: string;
  private readonly networkName: string;
  private readonly httpPort: number;
  private readonly httpsPort: number;
  private readonly dashboardPort: number;
  private readonly instanceId?: string;
  private readonly protectedShareConfig?: () => { publicHost: string; acmeEmail: string };

  constructor(
    private readonly runtime: RuntimeBackend,
    private readonly openLanderPort: number = 3000,
    options?: TraefikManagerOptions,
  ) {
    const defaultPolicy = getPolicy('production');
    this.containerName = options?.containerName ?? 'traefik-ol';
    this.networkName = options?.networkName ?? defaultPolicy.networkName;
    this.httpPort = options?.httpPort ?? 80;
    this.httpsPort = options?.httpsPort ?? 443;
    this.dashboardPort = options?.dashboardPort ?? 8080;
    this.instanceId = options?.instanceId;
    this.protectedShareConfig = options?.protectedShareConfig;
  }

  private protectedShareTlsEnabled(): boolean {
    const config = this.protectedShareConfig?.();
    return Boolean(config?.publicHost.trim() && config.acmeEmail.trim());
  }

  private acmeVolumeName(): string {
    const suffix = this.instanceId?.replace(/[^A-Za-z0-9_.-]+/g, '-');
    return suffix ? `openlander-traefik-acme-${suffix}` : 'openlander-traefik-acme';
  }

  private ownsContainer(container: { labels: Record<string, string> }): boolean {
    return !this.instanceId || container.labels[DOCKER_LABELS.INSTANCE] === this.instanceId;
  }

  private isLegacyManagedContainer(container: {
    name: string;
    image: string;
    labels: Record<string, string>;
  }): boolean {
    return (
      container.name === this.containerName &&
      /(^|\/)traefik(?::|@|$)/i.test(container.image) &&
      container.labels[DOCKER_LABELS.MANAGED] === 'true' &&
      container.labels[DOCKER_LABELS.ROLE] === 'traefik' &&
      !container.labels[DOCKER_LABELS.INSTANCE]
    );
  }

  private async ownsContainerName(containerName: string): Promise<boolean> {
    if (!this.instanceId) return true;
    const containers = await this.runtime.listAllContainers();
    const container = containers.find(
      (candidate) => candidate.name === containerName || candidate.id === containerName,
    );
    return container !== undefined && this.ownsContainer(container);
  }

  async isRunning(): Promise<boolean> {
    try {
      const containers = await this.runtime.listAllContainers();
      return containers.some(
        (c) =>
          c.labels[DOCKER_LABELS.ROLE] === 'traefik' &&
          c.state === 'running' &&
          this.ownsContainer(c),
      );
    } catch (err) {
      log.warn({ err }, 'Failed to check Traefik running status');
      return false;
    }
  }

  private async containerHasCurrentConfig(containerName: string): Promise<boolean> {
    try {
      if (!(await this.ownsContainerName(containerName))) return false;
      const info = await this.runtime.inspectContainer(containerName);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const cmd: string[] = info.Config.Cmd ?? [];
      const expectedHttpEndpoint = `--providers.http.endpoint=${this.getHttpProviderEndpoint()}`;
      const hasHttpProvider = cmd.some((arg: string) => arg === expectedHttpEndpoint);
      const hasDockerProvider = cmd.some((arg: string) => arg === '--providers.docker=true');
      const expectsTls = this.protectedShareTlsEnabled();
      const hasTlsEntrypoint = cmd.some(
        (arg: string) => arg === '--entrypoints.websecure.address=:443',
      );
      const hasAcmeResolver = cmd.some(
        (arg: string) => arg === '--certificatesresolvers.openlander.acme.httpchallenge=true',
      );
      const currentAcmeEmail = this.protectedShareConfig?.().acmeEmail.trim() ?? '';
      const hasCurrentAcmeEmail = cmd.some(
        (arg: string) =>
          arg === `--certificatesresolvers.openlander.acme.email=${currentAcmeEmail}`,
      );
      return (
        hasHttpProvider &&
        !hasDockerProvider &&
        (expectsTls ? hasTlsEntrypoint && hasAcmeResolver && hasCurrentAcmeEmail : !hasAcmeResolver)
      );
    } catch (_err) {
      return false;
    }
  }

  private async hasCurrentConfig(): Promise<boolean> {
    return await this.containerHasCurrentConfig(this.containerName);
  }

  private getHttpProviderEndpoint(): string {
    const host = isContainerizedRuntime()
      ? TraefikManager.CONTAINERIZED_OPENLANDER_HOST
      : 'host.docker.internal';
    return `http://${host}:${String(this.openLanderPort)}/api/traefik/config`;
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
  ): Promise<void> {
    try {
      if (!(await this.ownsContainerName(containerName))) {
        const container = (await this.runtime.listAllContainers()).find(
          (candidate) => candidate.name === containerName || candidate.id === containerName,
        );
        throw new ManagedTraefikOwnershipError(
          containerName,
          this.instanceId ?? 'unconfigured',
          container?.labels[DOCKER_LABELS.INSTANCE] ?? null,
        );
      }
      await this.runtime.connectContainerToNetwork(containerName, networkName);
      log.info({ containerName, networkName }, 'Traefik connected to network');
    } catch (err) {
      if (err instanceof ManagedTraefikOwnershipError) throw err;
      throw new ManagedTraefikNetworkError(
        containerName,
        networkName,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async tryAdoptExistingTraefik(): Promise<boolean> {
    const containers = await this.runtime.listAllContainers();
    const running = containers.filter(
      (c) =>
        c.labels[DOCKER_LABELS.ROLE] === 'traefik' &&
        c.state === 'running' &&
        this.ownsContainer(c),
    );

    const candidate = running.find((c) => c.name !== this.containerName);

    if (!candidate) {
      return false;
    }

    if (!(await this.containerHasCurrentConfig(candidate.name))) {
      log.info(
        { existingContainer: candidate.name },
        'Found legacy OpenLander Traefik with outdated provider config — recreating',
      );
      return false;
    }

    log.info(
      { existingContainer: candidate.name, managedContainer: this.containerName },
      'Found legacy OpenLander Traefik — adopting',
    );

    try {
      await this.runtime.removeContainer(this.containerName);
      log.debug({ containerName: this.containerName }, 'Removed stale managed Traefik container');
    } catch {
      // Container doesn't exist — expected
    }

    try {
      await this.runtime.renameContainer(candidate.id, this.containerName);
      log.info(
        { existingContainer: candidate.name, managedContainer: this.containerName },
        'Renamed adopted Traefik to managed container name',
      );
    } catch (err) {
      log.warn(
        { err, existingContainer: candidate.name, managedContainer: this.containerName },
        'Failed to rename adopted Traefik — falling back to new container',
      );
      return false;
    }

    await this.ensureTraefikRuntimeNetworks(this.containerName);

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

    const existingAtManagedName = (await this.runtime.listAllContainers()).find(
      (container) => container.name === this.containerName,
    );
    if (existingAtManagedName && !this.ownsContainer(existingAtManagedName)) {
      if (this.isLegacyManagedContainer(existingAtManagedName)) {
        log.info(
          { containerName: this.containerName, instanceId: this.instanceId },
          'Recreating legacy unlabeled OpenLander Traefik for the current instance',
        );
      } else {
        throw new ManagedTraefikOwnershipError(
          this.containerName,
          this.instanceId ?? 'unconfigured',
          existingAtManagedName.labels[DOCKER_LABELS.INSTANCE] ?? null,
        );
      }
    }

    await this.ensureAllNetworks();

    if (await this.tryAdoptExistingTraefik()) {
      return;
    }

    try {
      const existing = await this.runtime.listAllContainers();
      const traefikContainers = existing.filter(
        (c) =>
          c.labels[DOCKER_LABELS.ROLE] === 'traefik' &&
          (this.ownsContainer(c) || this.isLegacyManagedContainer(c)),
      );
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
    const httpsPortStr = String(this.httpsPort);
    const dashboardPortStr = String(this.dashboardPort);
    const protectedShare = this.protectedShareConfig?.();
    const tlsEnabled = this.protectedShareTlsEnabled();
    const cmd = [
      '--api.insecure=true',
      `--providers.http.endpoint=${this.getHttpProviderEndpoint()}`,
      '--providers.http.pollInterval=5s',
      '--entrypoints.web.address=:80',
    ];
    if (tlsEnabled && protectedShare) {
      cmd.push(
        '--entrypoints.websecure.address=:443',
        `--certificatesresolvers.openlander.acme.email=${protectedShare.acmeEmail.trim()}`,
        '--certificatesresolvers.openlander.acme.storage=/data/acme.json',
        '--certificatesresolvers.openlander.acme.httpchallenge=true',
        '--certificatesresolvers.openlander.acme.httpchallenge.entrypoint=web',
      );
    }

    await this.runtime.runInfraContainer({
      Image: TRAEFIK_IMAGE,
      name: this.containerName,
      Cmd: cmd,
      ExposedPorts: {
        '80/tcp': {},
        ...(tlsEnabled ? { '443/tcp': {} } : {}),
        '8080/tcp': {},
      },
      HostConfig: {
        PortBindings: {
          '80/tcp': [{ HostPort: httpPortStr }],
          ...(tlsEnabled ? { '443/tcp': [{ HostPort: httpsPortStr }] } : {}),
          '8080/tcp': [{ HostPort: dashboardPortStr }],
        },
        ...(tlsEnabled ? { Binds: [`${this.acmeVolumeName()}:/data`] } : {}),
        ...(platform() !== 'darwin' ? { ExtraHosts: ['host.docker.internal:host-gateway'] } : {}),
        NetworkMode: this.networkName,
        RestartPolicy: { Name: 'unless-stopped' },
        LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
      },
      Labels: {
        [DOCKER_LABELS.MANAGED]: 'true',
        [DOCKER_LABELS.ROLE]: 'traefik',
        ...(this.instanceId ? { [DOCKER_LABELS.INSTANCE]: this.instanceId } : {}),
      },
    });

    await this.ensureMultiNetwork();
  }

  private async ensureMultiNetwork(): Promise<void> {
    await this.ensureTraefikRuntimeNetworks(this.containerName);
  }

  private async ensureTraefikRuntimeNetworks(containerName: string): Promise<void> {
    await this.connectContainerToNetworkByName(containerName, SHARED_NETWORK_NAME);
    await this.ensureOpenLanderContainerNetworks(containerName);
  }

  private async ensureOpenLanderContainerNetworks(traefikContainerName: string): Promise<void> {
    if (!isContainerizedRuntime()) {
      return;
    }

    try {
      const info = await this.runtime.inspectContainer(
        TraefikManager.CONTAINERIZED_OPENLANDER_HOST,
      );
      const networks = Object.keys(info.NetworkSettings.Networks);
      for (const networkName of networks) {
        await this.connectContainerToNetworkByName(traefikContainerName, networkName);
      }
    } catch (err) {
      log.warn(
        { err, containerName: TraefikManager.CONTAINERIZED_OPENLANDER_HOST },
        'Failed to connect Traefik to OpenLander container networks',
      );
    }
  }

  async stop(): Promise<void> {
    try {
      if (!(await this.ownsContainerName(this.containerName))) {
        log.warn(
          { containerName: this.containerName, instanceId: this.instanceId },
          'Refusing to remove a Traefik container owned by another OpenLander instance',
        );
        return;
      }
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
  routeProvider: 'docker-labels' | 'http-provider' = 'docker-labels',
): Record<string, string> {
  if (routeProvider === 'http-provider') {
    return { 'traefik.enable': 'false' };
  }

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

export function appRouteProviderForTraefikMode(
  mode: 'managed' | 'external',
): 'docker-labels' | 'http-provider' {
  return mode === 'managed' ? 'http-provider' : 'docker-labels';
}

export async function ensureManagedTraefikNetwork(
  runtime: RuntimeBackend,
  networkName: string,
): Promise<void> {
  try {
    const instanceId = runtime.getInstanceId?.();
    if (instanceId) {
      const containers = await runtime.listAllContainers();
      const traefik = containers.find(
        (container) => container.name === 'traefik-ol' || container.id === 'traefik-ol',
      );
      if (!traefik || traefik.labels[DOCKER_LABELS.INSTANCE] !== instanceId) {
        throw new ManagedTraefikOwnershipError(
          'traefik-ol',
          instanceId,
          traefik?.labels[DOCKER_LABELS.INSTANCE] ?? null,
        );
      }
    }
    await runtime.connectContainerToNetwork('traefik-ol', networkName);
  } catch (error) {
    if (error instanceof ManagedTraefikOwnershipError) throw error;
    if (error instanceof ManagedTraefikNetworkError) throw error;
    if (isDockerNotFoundError(error)) {
      throw new ManagedTraefikNetworkError('traefik-ol', networkName, 'container not found');
    }
    throw new ManagedTraefikNetworkError(
      'traefik-ol',
      networkName,
      error instanceof Error ? error.message : String(error),
    );
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
  const manager = new TraefikManager(runtime, 3000, {
    instanceId: runtime.getInstanceId?.(),
  });
  await manager.stop();

  log.info('Managed Traefik stopped (if it was running)');
}

/**
 * Connect a container to the Traefik-facing network.
 * OpenLander 0.1 deploys apps onto project-scoped networks; managed Traefik must join
 * those networks so HTTP-provider backends can resolve container names.
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
