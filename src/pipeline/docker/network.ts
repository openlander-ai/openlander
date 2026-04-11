import type Dockerode from 'dockerode';
import { SHARED_NETWORK_NAME } from '../../config/index.js';
import { isDockerNotFoundError } from '../../errors.js';
import { createModuleLogger } from '../../lib/logger.js';
import { containerName } from '../helpers.js';
import type { DockerContext } from './context.js';
import { isAlreadyConnectedError, isNotConnectedToNetwork } from './helpers.js';

const log = createModuleLogger('docker:network');

export class NetworkOps {
  constructor(private readonly ctx: DockerContext) {}

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
      return await network.inspect();
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

    try {
      await this.ctx.client.getNetwork(networkName).inspect();
      return networkName;
    } catch (error) {
      if (!isDockerNotFoundError(error)) {
        throw error;
      }
    }

    try {
      await this.ctx.client.createNetwork({ Name: networkName, Driver: 'bridge' });
      return networkName;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists')) {
        return networkName;
      }
      throw error;
    }
  }

  /** Remove a project-scoped Docker network. Silently succeeds if not found or has active endpoints. */
  async removeProjectNetwork(projectName: string): Promise<void> {
    const networkName = containerName(projectName);

    try {
      await this.ctx.client.getNetwork(networkName).remove();
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
    try {
      await this.ctx.client.getNetwork(name).inspect();
      return name;
    } catch (error) {
      if (!isDockerNotFoundError(error)) {
        throw error;
      }
    }
    try {
      await this.ctx.client.createNetwork({ Name: name, Driver: 'bridge' });
      return name;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists')) {
        return name;
      }
      throw error;
    }
  }
}
