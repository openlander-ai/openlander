import { ContainerNotFoundError, isDockerNotFoundError } from '../../errors.js';
import type { DockerContext } from './context.js';
import { stripDockerStreamHeaders } from './helpers.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('docker:stream');

export interface DockerLogOptions {
  timestamps?: boolean;
}

export class StreamOps {
  constructor(private readonly ctx: DockerContext) {}

  /** Get container logs as a string. */
  async getLogs(
    containerId: string,
    tail: number | 'all' = 100,
    opts?: DockerLogOptions,
  ): Promise<string> {
    try {
      const container = this.ctx.client.getContainer(containerId);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
        ...(tail === 'all' ? {} : { tail }),
        ...(opts?.timestamps === true ? { timestamps: true } : {}),
      });
      const buffer = Buffer.isBuffer(logs) ? logs : Buffer.from(logs);
      return stripDockerStreamHeaders(buffer);
    } catch (error) {
      if (isDockerNotFoundError(error)) {
        log.debug({ containerId }, 'Container not found while fetching logs');
        throw new ContainerNotFoundError(containerId);
      }
      throw error;
    }
  }

  /** Follow container logs as a readable stream for real-time log tailing. */
  async getLogStream(
    containerId: string,
    opts?: { tail?: number; stdout?: boolean; stderr?: boolean; timestamps?: boolean },
  ): Promise<NodeJS.ReadableStream> {
    const container = this.ctx.client.getContainer(containerId);
    return await container.logs({
      follow: true,
      stdout: opts?.stdout ?? true,
      stderr: opts?.stderr ?? true,
      tail: opts?.tail ?? 50,
      ...(opts?.timestamps === true ? { timestamps: true } : {}),
    });
  }

  /** Get Docker daemon event stream for real-time container events. */
  async getEventStream(filters: Record<string, string[]>): Promise<NodeJS.ReadableStream> {
    return await (
      this.ctx.client.getEvents as (opts: {
        filters: Record<string, string[]>;
      }) => Promise<NodeJS.ReadableStream>
    )({
      filters,
    });
  }
}
