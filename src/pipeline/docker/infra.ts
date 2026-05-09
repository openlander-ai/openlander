import { createModuleLogger } from '../../lib/logger.js';
import { DockerNotRunningError } from '../../errors.js';
import type { DockerContext } from './context.js';
import { pingWithTimeout, withTimeout } from './helpers.js';

const log = createModuleLogger('docker:infra');

export class InfraOps {
  constructor(private readonly ctx: DockerContext) {}

  /** Verify Docker daemon is accessible. */
  async ping(): Promise<boolean> {
    try {
      await pingWithTimeout(this.ctx.client, 5_000);
      return true;
    } catch (err) {
      log.debug({ err }, 'Docker ping failed');
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

  /** Docker system disk usage (images, containers, volumes). */
  async getDiskUsage(timeoutMs = 5_000): Promise<unknown> {
    return await withTimeout(this.ctx.client.df(), timeoutMs, 'Docker disk usage');
  }
}
