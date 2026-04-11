import type { DockerContext } from './context.js';
import { DOCKER_LABELS } from '../../config/index.js';
import { isDockerNotFoundError } from '../../errors.js';
import type Dockerode from 'dockerode';

export class VolumeOps {
  constructor(private readonly ctx: DockerContext) {}

  /** Inspect a volume. Throws the raw Docker 404 error if not found (use isDockerNotFoundError to check). */
  async inspectVolume(name: string): Promise<Dockerode.VolumeInspectInfo> {
    return await this.ctx.client.getVolume(name).inspect();
  }

  /** List volumes with optional filters. */
  async listVolumes(filters?: Record<string, string[]>): Promise<Dockerode.VolumeInspectInfo[]> {
    const result = (await this.ctx.client.listVolumes(
      filters ? { filters } : undefined,
    )) as unknown as { Volumes?: Dockerode.VolumeInspectInfo[] };
    return result.Volumes ?? [];
  }

  /** Create a volume. Always applies MANAGED=true label. */
  async createVolume(opts: { name: string; labels?: Record<string, string> }): Promise<void> {
    await this.ctx.client.createVolume({
      Name: opts.name,
      Labels: {
        [DOCKER_LABELS.MANAGED]: 'true',
        ...opts.labels,
      },
    });
  }

  /** Remove a volume. Silent on 404. */
  async removeVolume(name: string): Promise<void> {
    try {
      await this.ctx.client.getVolume(name).remove();
    } catch (error) {
      if (isDockerNotFoundError(error)) return;
      throw error;
    }
  }
}
