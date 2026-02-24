import Dockerode from 'dockerode';

import { DockerNotRunningError, DockerBuildError, ContainerNotFoundError } from '../errors.js';

export interface RunContainerOptions {
  imageTag: string;
  name: string;
  port: number;
  envVars: Record<string, string>;
  traefikLabels: Record<string, string>;
}

export interface ContainerInfo {
  id: string;
  name: string;
  status: string;
  port?: number;
  imageTag?: string;
}

/**
 * Docker control layer using dockerode.
 *
 * Wraps all Docker operations with proper error handling
 * and user-friendly error messages.
 */
export class Docker {
  private readonly client: Dockerode;

  constructor(socketPath?: string) {
    this.client = new Dockerode(socketPath ? { socketPath } : undefined);
  }

  /** Verify Docker daemon is accessible. */
  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  /** Verify Docker is running, throw typed error if not. */
  async ensureRunning(): Promise<void> {
    const ok = await this.ping();
    if (!ok) {
      throw new DockerNotRunningError();
    }
  }

  /** Build a Docker image from a directory containing a Dockerfile. */
  async buildImage(contextPath: string, tag: string): Promise<void> {
    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.client.buildImage({ context: contextPath, src: ['.'] }, { t: tag });
    } catch (error) {
      throw new DockerBuildError(tag, error instanceof Error ? error.message : String(error));
    }

    // Collect build log and wait for completion
    let buildLog = '';
    await new Promise<void>((resolve, reject) => {
      this.client.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) reject(new DockerBuildError(tag, buildLog + '\n' + err.message));
          else resolve();
        },
        (event: { stream?: string; error?: string }) => {
          if (event.stream) buildLog += event.stream;
          if (event.error) buildLog += `ERROR: ${event.error}\n`;
        },
      );
    });
  }

  /** Create and start a container. */
  async runContainer(options: RunContainerOptions): Promise<string> {
    const envArray = Object.entries(options.envVars).map(([k, v]) => `${k}=${v}`);

    const container = await this.client.createContainer({
      Image: options.imageTag,
      name: options.name,
      Env: envArray,
      Labels: {
        'openlander.managed': 'true',
        'openlander.project': options.name.replace(/^ol-/, ''),
        ...options.traefikLabels,
      },
      ExposedPorts: {
        [`${String(options.port)}/tcp`]: {},
      },
      HostConfig: {
        PortBindings: {
          [`${String(options.port)}/tcp`]: [{ HostPort: String(options.port) }],
        },
        NetworkMode: 'web', // Traefik network
        RestartPolicy: { Name: 'unless-stopped' },
      },
    });

    await container.start();
    return container.id;
  }

  /** Stop a running container. */
  async stopContainer(containerId: string): Promise<void> {
    try {
      const container = this.client.getContainer(containerId);
      await container.stop();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found') || msg.includes('No such container')) {
        throw new ContainerNotFoundError(containerId);
      }
      // Already stopped is not an error
      if (!msg.includes('is not running')) {
        throw error;
      }
    }
  }

  /** Remove a container (force removes even if running). */
  async removeContainer(containerId: string): Promise<void> {
    try {
      const container = this.client.getContainer(containerId);
      await container.remove({ force: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found') || msg.includes('No such container')) {
        // Already removed — not an error
        return;
      }
      throw error;
    }
  }

  /** Get container logs as a string. */
  async getLogs(containerId: string, tail = 100): Promise<string> {
    try {
      const container = this.client.getContainer(containerId);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail,
        follow: false,
      });
      return logs.toString();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not found') || msg.includes('No such container')) {
        throw new ContainerNotFoundError(containerId);
      }
      throw error;
    }
  }

  /** List all OpenLander-managed containers. */
  async listManagedContainers(): Promise<ContainerInfo[]> {
    const containers = await this.client.listContainers({
      all: true,
      filters: { label: ['openlander.managed=true'] },
    });

    return containers.map((c) => ({
      id: c.Id,
      name: c.Names[0]?.replace(/^\//, '') ?? 'unknown',
      status: c.State,
      port: c.Ports[0]?.PublicPort,
      imageTag: c.Image,
    }));
  }

  /** Get the underlying dockerode client (for Traefik manager). */
  getClient(): Dockerode {
    return this.client;
  }
}
