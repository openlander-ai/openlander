import type Dockerode from 'dockerode';
import { DOCKER_LABELS, SHARED_NETWORK_NAME } from '../../config/index.js';
import {
  isDockerNotFoundError,
  NetworkAddressPoolExhaustedError,
  NetworkCleanupBlockedError,
  NetworkNotFoundError,
  ServiceConfigError,
} from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import { containerName } from '../helpers.js';
import type { DockerContext } from './context.js';
import { isAlreadyConnectedError, isNotConnectedToNetwork, withTimeout } from './helpers.js';

const NETWORK_INSPECT_TIMEOUT_MS = 15_000;
const PROJECT_NETWORK_SUBNET_PREFIX = 24;
const NETWORK_CREATE_ATTEMPTS = 8;
const SYSTEM_NETWORK_NAMES = new Set(['bridge', 'host', 'none']);

const log = createModuleLogger('docker:network');

export type DockerNetworkOwnership =
  'current_instance' | 'other_instance' | 'legacy_unlabeled' | 'external' | 'system';

export interface DockerNetworkSummary {
  id: string;
  name: string;
  driver: string;
  scope: string;
  subnets: string[];
  labels: Record<string, string>;
  endpointCount: number;
  ownerInstanceId: string | null;
  ownership: DockerNetworkOwnership;
  cleanupEligible: boolean;
  cleanupBlocker: string | null;
}

export interface ProjectNetworkPoolStatus {
  cidr: string;
  subnetPrefix: number;
  totalSubnets: number;
  unavailableSubnets: number;
  availableSubnets: number;
  pressure: 'ok' | 'low' | 'exhausted';
}

interface Ipv4CidrRange {
  start: number;
  end: number;
  prefix: number;
  cidr: string;
}

function parseIpv4Address(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = result * 256 + octet;
  }
  return result;
}

function formatIpv4Address(value: number): string {
  return [
    Math.floor(value / 2 ** 24),
    Math.floor(value / 2 ** 16) % 256,
    Math.floor(value / 2 ** 8) % 256,
    value % 256,
  ].join('.');
}

function parseIpv4Cidr(value: string): Ipv4CidrRange | null {
  const match = /^([^/]+)\/(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const address = parseIpv4Address(match[1] ?? '');
  const prefix = Number(match[2]);
  if (address === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const size = 2 ** (32 - prefix);
  const start = Math.floor(address / size) * size;
  return {
    start,
    end: start + size - 1,
    prefix,
    cidr: `${formatIpv4Address(start)}/${String(prefix)}`,
  };
}

function rangesOverlap(left: Ipv4CidrRange, right: Ipv4CidrRange): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function isAddressPoolCollision(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('pool overlaps');
}

function isAddressPoolExhausted(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('all predefined address pools have been fully subnetted') ||
    message.includes('could not find an available, non-overlapping ipv4 address pool')
  );
}

export class NetworkOps {
  constructor(private readonly ctx: DockerContext) {}

  private projectNetworkPool(): Ipv4CidrRange {
    const configured = this.ctx.projectNetworkPoolCidr.trim();
    const pool = parseIpv4Cidr(configured);
    if (
      !pool ||
      pool.cidr !== configured ||
      pool.prefix < 12 ||
      pool.prefix > PROJECT_NETWORK_SUBNET_PREFIX
    ) {
      throw new ServiceConfigError(
        `docker.projectNetworkPoolCidr must be a canonical IPv4 CIDR between /12 and /${String(
          PROJECT_NETWORK_SUBNET_PREFIX,
        )}: ${configured}`,
      );
    }
    return pool;
  }

  private occupiedIpv4Ranges(
    networks: Array<Pick<Dockerode.NetworkInspectInfo, 'IPAM'>>,
    additionalCidrs: string[] = [],
  ): Ipv4CidrRange[] {
    return [
      ...networks.flatMap((network) =>
        (network.IPAM?.Config ?? []).flatMap((config) => {
          const subnet = typeof config.Subnet === 'string' ? parseIpv4Cidr(config.Subnet) : null;
          return subnet ? [subnet] : [];
        }),
      ),
      ...additionalCidrs.flatMap((cidr) => {
        const subnet = parseIpv4Cidr(cidr);
        return subnet ? [subnet] : [];
      }),
    ];
  }

  private availableProjectSubnet(
    networks: Array<Pick<Dockerode.NetworkInspectInfo, 'IPAM'>>,
    additionalCidrs: string[] = [],
  ): string | null {
    const pool = this.projectNetworkPool();
    const occupied = this.occupiedIpv4Ranges(networks, additionalCidrs);
    const subnetSize = 2 ** (32 - PROJECT_NETWORK_SUBNET_PREFIX);
    const totalSubnets = 2 ** (PROJECT_NETWORK_SUBNET_PREFIX - pool.prefix);
    for (let index = 0; index < totalSubnets; index++) {
      const start = pool.start + index * subnetSize;
      const candidate: Ipv4CidrRange = {
        start,
        end: start + subnetSize - 1,
        prefix: PROJECT_NETWORK_SUBNET_PREFIX,
        cidr: `${formatIpv4Address(start)}/${String(PROJECT_NETWORK_SUBNET_PREFIX)}`,
      };
      if (!occupied.some((subnet) => rangesOverlap(candidate, subnet))) {
        return candidate.cidr;
      }
    }
    return null;
  }

  private async rawNetworks(): Promise<Dockerode.NetworkInspectInfo[]> {
    return await withTimeout(
      this.ctx.client.listNetworks(),
      NETWORK_INSPECT_TIMEOUT_MS,
      'Docker network list for address allocation',
    );
  }

  private async networkExists(name: string): Promise<boolean> {
    try {
      await withTimeout(
        this.ctx.client.getNetwork(name).inspect(),
        NETWORK_INSPECT_TIMEOUT_MS,
        `Network inspect (${name})`,
      );
      return true;
    } catch (error) {
      if (isDockerNotFoundError(error)) return false;
      throw error;
    }
  }

  private async createManagedBridgeNetwork(
    name: string,
    labels: Record<string, string>,
  ): Promise<string> {
    this.projectNetworkPool();
    const rejectedSubnets: string[] = [];
    for (let attempt = 0; attempt < NETWORK_CREATE_ATTEMPTS; attempt++) {
      const subnet = this.availableProjectSubnet(await this.rawNetworks(), rejectedSubnets);
      if (!subnet) {
        throw new NetworkAddressPoolExhaustedError(name, this.projectNetworkPool().cidr);
      }
      try {
        await withTimeout(
          this.ctx.client.createNetwork({
            Name: name,
            Driver: 'bridge',
            IPAM: { Config: [{ Subnet: subnet }] },
            Labels: labels,
          }),
          NETWORK_INSPECT_TIMEOUT_MS,
          `Network create (${name})`,
        );
        return name;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('already exists')) return name;
        if (isAddressPoolCollision(error)) {
          rejectedSubnets.push(subnet);
          continue;
        }
        if (isAddressPoolExhausted(error)) {
          throw new NetworkAddressPoolExhaustedError(name, this.projectNetworkPool().cidr);
        }
        throw error;
      }
    }
    throw new NetworkAddressPoolExhaustedError(name, this.projectNetworkPool().cidr);
  }

  private summarizeNetwork(
    info: Dockerode.NetworkInspectInfo,
    endpointCountOverride?: number,
  ): DockerNetworkSummary {
    const name = info.Name;
    const labels = info.Labels ?? {};
    const ownerInstanceId = labels[DOCKER_LABELS.INSTANCE] ?? null;
    const endpointCount = endpointCountOverride ?? Object.keys(info.Containers ?? {}).length;
    const isSystem = SYSTEM_NETWORK_NAMES.has(name);
    const isShared = name === SHARED_NETWORK_NAME;
    const isLegacyOpenLander = labels[DOCKER_LABELS.MANAGED] === 'true' || name.startsWith('ol-');

    let ownership: DockerNetworkOwnership;
    if (isSystem) {
      ownership = 'system';
    } else if (ownerInstanceId) {
      ownership =
        this.ctx.instanceId && ownerInstanceId === this.ctx.instanceId
          ? 'current_instance'
          : 'other_instance';
    } else if (isLegacyOpenLander) {
      ownership = 'legacy_unlabeled';
    } else {
      ownership = 'external';
    }

    let cleanupBlocker: string | null = null;
    if (isSystem) cleanupBlocker = 'system_network';
    else if (isShared) cleanupBlocker = 'shared_network';
    else if (info.Driver !== 'bridge') cleanupBlocker = 'unsupported_network_driver';
    else if (info.Scope !== 'local') cleanupBlocker = 'unsupported_network_scope';
    else if (endpointCount > 0) cleanupBlocker = 'active_endpoints';
    else if (ownership === 'other_instance') cleanupBlocker = 'different_instance';
    else if (ownership === 'legacy_unlabeled') cleanupBlocker = 'legacy_confirmation_required';
    else if (ownership === 'external') cleanupBlocker = 'unmanaged_network';

    return {
      id: info.Id,
      name,
      driver: info.Driver,
      scope: info.Scope,
      subnets: (info.IPAM?.Config ?? [])
        .map((config) => config.Subnet)
        .filter((subnet): subnet is string => typeof subnet === 'string' && subnet.length > 0),
      labels,
      endpointCount,
      ownerInstanceId,
      ownership,
      cleanupEligible: cleanupBlocker === null,
      cleanupBlocker,
    };
  }

  /** List Docker networks with ownership and zero-endpoint cleanup eligibility. */
  async listNetworks(): Promise<DockerNetworkSummary[]> {
    const [networks, containers] = await Promise.all([
      withTimeout(
        this.ctx.client.listNetworks(),
        NETWORK_INSPECT_TIMEOUT_MS,
        'Docker network list',
      ),
      withTimeout(
        this.ctx.client.listContainers({ all: true }),
        NETWORK_INSPECT_TIMEOUT_MS,
        'Docker container list for network inventory',
      ),
    ]);
    const endpointCountsById = new Map<string, number>();
    const endpointCountsByName = new Map<string, number>();

    for (const container of containers) {
      for (const [networkName, endpoint] of Object.entries(container.NetworkSettings.Networks)) {
        endpointCountsByName.set(networkName, (endpointCountsByName.get(networkName) ?? 0) + 1);
        if (endpoint.NetworkID) {
          endpointCountsById.set(
            endpoint.NetworkID,
            (endpointCountsById.get(endpoint.NetworkID) ?? 0) + 1,
          );
        }
      }
    }

    return networks.map((network) =>
      this.summarizeNetwork(
        network,
        endpointCountsById.get(network.Id) ?? endpointCountsByName.get(network.Name) ?? 0,
      ),
    );
  }

  getProjectNetworkPoolStatus(networks: DockerNetworkSummary[]): ProjectNetworkPoolStatus {
    const pool = this.projectNetworkPool();
    const occupied = this.occupiedIpv4Ranges(
      networks.map((network) => ({
        IPAM: { Config: network.subnets.map((subnet) => ({ Subnet: subnet })) },
      })),
    );
    const subnetSize = 2 ** (32 - PROJECT_NETWORK_SUBNET_PREFIX);
    const totalSubnets = 2 ** (PROJECT_NETWORK_SUBNET_PREFIX - pool.prefix);
    let unavailableSubnets = 0;
    for (let index = 0; index < totalSubnets; index++) {
      const start = pool.start + index * subnetSize;
      const candidate: Ipv4CidrRange = {
        start,
        end: start + subnetSize - 1,
        prefix: PROJECT_NETWORK_SUBNET_PREFIX,
        cidr: `${formatIpv4Address(start)}/${String(PROJECT_NETWORK_SUBNET_PREFIX)}`,
      };
      if (occupied.some((subnet) => rangesOverlap(candidate, subnet))) {
        unavailableSubnets++;
      }
    }
    const availableSubnets = totalSubnets - unavailableSubnets;
    const pressure =
      availableSubnets === 0
        ? 'exhausted'
        : availableSubnets <= Math.max(4, Math.ceil(totalSubnets * 0.05))
          ? 'low'
          : 'ok';
    return {
      cidr: pool.cidr,
      subnetPrefix: PROJECT_NETWORK_SUBNET_PREFIX,
      totalSubnets,
      unavailableSubnets,
      availableSubnets,
      pressure,
    };
  }

  /** Fail before image preparation when a missing Project network has no allocatable subnet. */
  async preflightProjectNetwork(projectName: string): Promise<void> {
    const networkName = containerName(projectName);
    if (await this.networkExists(networkName)) return;
    this.projectNetworkPool();
    if (!this.availableProjectSubnet(await this.rawNetworks())) {
      throw new NetworkAddressPoolExhaustedError(networkName, this.projectNetworkPool().cidr);
    }
  }

  /**
   * Remove one exact zero-endpoint network after rechecking ownership and identity.
   * Legacy OpenLander networks require an explicit opt-in; external and other-instance
   * networks are never removed through this operation.
   */
  async removeUnusedNetwork(input: {
    networkName: string;
    expectedNetworkId: string;
    allowLegacyUnlabeled?: boolean;
  }): Promise<DockerNetworkSummary> {
    const network = this.ctx.client.getNetwork(input.networkName);
    let info: Dockerode.NetworkInspectInfo;
    try {
      info = await withTimeout(
        network.inspect(),
        NETWORK_INSPECT_TIMEOUT_MS,
        `Network inspect (${input.networkName})`,
      );
    } catch (error) {
      if (isDockerNotFoundError(error)) throw new NetworkNotFoundError(input.networkName);
      throw error;
    }

    const summary = this.summarizeNetwork(info);
    if (summary.id !== input.expectedNetworkId) {
      throw new NetworkCleanupBlockedError(input.networkName, 'network_id_changed', {
        expectedNetworkId: input.expectedNetworkId,
        actualNetworkId: summary.id,
      });
    }
    if (summary.endpointCount > 0) {
      throw new NetworkCleanupBlockedError(input.networkName, 'active_endpoints', {
        endpointCount: summary.endpointCount,
      });
    }
    if (summary.cleanupBlocker && summary.cleanupBlocker !== 'legacy_confirmation_required') {
      throw new NetworkCleanupBlockedError(input.networkName, summary.cleanupBlocker, {
        ownerInstanceId: summary.ownerInstanceId,
      });
    }
    if (summary.ownership === 'legacy_unlabeled') {
      if (!input.allowLegacyUnlabeled) {
        throw new NetworkCleanupBlockedError(input.networkName, 'legacy_confirmation_required');
      }
    }

    try {
      await withTimeout(
        network.remove(),
        NETWORK_INSPECT_TIMEOUT_MS,
        `Network remove (${input.networkName})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('active endpoints')) {
        throw new NetworkCleanupBlockedError(input.networkName, 'active_endpoints');
      }
      if (isDockerNotFoundError(error)) throw new NetworkNotFoundError(input.networkName);
      throw error;
    }
    return summary;
  }

  /** Attach a container to the shared OpenLander network with a DNS alias. Silently succeeds if already connected. */
  async ensureSharedNetworkAttachment(containerId: string, alias: string): Promise<void> {
    const network = this.ctx.client.getNetwork(SHARED_NETWORK_NAME);

    try {
      await network.connect({
        Container: containerId,
        EndpointConfig: { Aliases: [alias] },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isAlreadyConnectedError(msg)) {
        return;
      }

      throw error;
    }
  }

  /** Connect a container to a network with optional aliases. Silently succeeds if already connected. */
  async connectContainerToNetwork(
    containerId: string,
    networkName: string,
    aliases?: string[],
  ): Promise<void> {
    try {
      const network = this.ctx.client.getNetwork(networkName);
      await network.connect({
        Container: containerId,
        EndpointConfig: aliases ? { Aliases: aliases } : undefined,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isAlreadyConnectedError(msg)) {
        return;
      }
      throw error;
    }
  }

  /**
   * Connect a container to a network WITHOUT any error suppression.
   * Unlike `connectContainerToNetwork`, this propagates ALL errors
   * (including "already connected") — used internally where failures
   * must trigger container cleanup.
   */
  async connectToNetworkStrict(containerId: string, networkName: string): Promise<void> {
    await this.ctx.client.getNetwork(networkName).connect({ Container: containerId });
  }

  /** Disconnect a container from a network before removal to avoid sandbox cleanup races. */
  async disconnectContainerFromNetwork(containerId: string, networkName: string): Promise<void> {
    try {
      const network = this.ctx.client.getNetwork(networkName);
      await network.disconnect({ Container: containerId, Force: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isNotConnectedToNetwork(msg) || isDockerNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }

  /** Inspect a Docker network and return its metadata. */
  async getNetworkInfo(networkName: string): Promise<Dockerode.NetworkInspectInfo> {
    try {
      const network = this.ctx.client.getNetwork(networkName);
      return await withTimeout(
        network.inspect(),
        NETWORK_INSPECT_TIMEOUT_MS,
        `Network inspect (${networkName})`,
      );
    } catch (error) {
      if (isDockerNotFoundError(error)) {
        throw new Error(`Network not found: ${networkName}`);
      }
      throw error;
    }
  }

  /** Ensure a project-scoped Docker network exists. Returns the network name. */
  async ensureProjectNetwork(projectName: string): Promise<string> {
    const networkName = containerName(projectName);
    if (await this.networkExists(networkName)) return networkName;
    return await this.createManagedBridgeNetwork(networkName, {
      [DOCKER_LABELS.MANAGED]: 'true',
      [DOCKER_LABELS.PROJECT]: projectName,
      ...(this.ctx.instanceId ? { [DOCKER_LABELS.INSTANCE]: this.ctx.instanceId } : {}),
    });
  }

  /** Remove a project-scoped Docker network. Silently succeeds if not found or has active endpoints. */
  async removeProjectNetwork(projectName: string): Promise<void> {
    const networkName = containerName(projectName);
    const network = this.ctx.client.getNetwork(networkName);

    try {
      const info = await withTimeout(
        network.inspect(),
        NETWORK_INSPECT_TIMEOUT_MS,
        `Network inspect (${networkName})`,
      );
      if (this.ctx.instanceId && info.Labels?.[DOCKER_LABELS.INSTANCE] !== this.ctx.instanceId) {
        log.warn(
          {
            projectName,
            networkName,
            instanceId: this.ctx.instanceId,
            ownerInstanceId: info.Labels?.[DOCKER_LABELS.INSTANCE],
          },
          'Refusing to remove a project network owned by another or unknown instance',
        );
        return;
      }

      if (this.ctx.instanceId) {
        for (const containerId of Object.keys(info.Containers ?? {})) {
          try {
            const container = await this.ctx.client.getContainer(containerId).inspect();
            const labels = container.Config.Labels;
            const isOwnedTraefik =
              labels[DOCKER_LABELS.MANAGED] === 'true' &&
              labels[DOCKER_LABELS.ROLE] === 'traefik' &&
              labels[DOCKER_LABELS.INSTANCE] === this.ctx.instanceId;
            if (isOwnedTraefik) {
              await network.disconnect({ Container: containerId, Force: true });
            }
          } catch (error) {
            if (!isDockerNotFoundError(error)) throw error;
          }
        }
      }

      await network.remove();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isDockerNotFoundError(error)) {
        return;
      }
      if (msg.includes('active endpoints')) {
        log.warn(
          { projectName, networkName, error: msg },
          'Cannot remove project network with active endpoints',
        );
        return;
      }
      throw error;
    }
  }

  /** Ensure a Docker network exists, creating it if missing. Returns the network name. */
  async ensureNetwork(name: string): Promise<string> {
    if (await this.networkExists(name)) return name;
    return await this.createManagedBridgeNetwork(name, {
      [DOCKER_LABELS.MANAGED]: 'true',
      ...(this.ctx.instanceId ? { [DOCKER_LABELS.INSTANCE]: this.ctx.instanceId } : {}),
    });
  }
}
