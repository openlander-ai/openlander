import type { DockerContext } from './context.js';
import { DOCKER_LABELS } from '../../config/index.js';
import { isDockerNotFoundError } from '../../errors.js';
import type Dockerode from 'dockerode';
import { createModuleLogger } from '../../lib/logger.js';
import { withTimeout } from './helpers.js';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const log = createModuleLogger('docker:volume');

const VOLUME_INSPECT_TIMEOUT_MS = 15_000;

export class VolumeOps {
  constructor(private readonly ctx: DockerContext) {}

  /** Inspect a volume. Throws the raw Docker 404 error if not found (use isDockerNotFoundError to check). */
  async inspectVolume(name: string): Promise<Dockerode.VolumeInspectInfo> {
    return await withTimeout(
      this.ctx.client.getVolume(name).inspect(),
      VOLUME_INSPECT_TIMEOUT_MS,
      `Volume inspect (${name})`,
    );
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
      if (isDockerNotFoundError(error)) {
        log.debug({ name }, 'Volume not found during removal — already gone');
        return;
      }
      throw error;
    }
  }

  /**
   * Replaces a managed volume with a snapshot of a local directory.
   *
   * Imported Compose repositories are often cloned inside the OpenLander
   * container. A Docker bind mount would resolve that path on the Docker host,
   * not inside OpenLander, so the files would be missing. Uploading a tar
   * archive through the Docker API keeps this working in both native and
   * containerized installations.
   */
  async seedVolumeFromDirectory(opts: {
    name: string;
    sourcePath: string;
    imageTag: string;
    labels?: Record<string, string>;
  }): Promise<void> {
    await this.removeVolume(opts.name);
    await this.createVolume({ name: opts.name, labels: opts.labels });

    const helperName = `openlander-volume-seed-${randomUUID()}`;
    const container = await this.ctx.client.createContainer({
      Image: opts.imageTag,
      name: helperName,
      Cmd: ['true'],
      Labels: {
        [DOCKER_LABELS.MANAGED]: 'true',
        'openlander.role': 'volume-seed',
      },
      HostConfig: {
        Binds: [`${opts.name}:/openlander-seed`],
      },
    });

    const archive = spawn('tar', ['-C', opts.sourcePath, '-cf', '-', '.'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    archive.stderr.setEncoding('utf8');
    archive.stderr.on('data', (chunk: string) => {
      if (stderr.length < 8_192) stderr += chunk;
    });

    try {
      const exit = new Promise<number>((resolve, reject) => {
        archive.once('error', reject);
        archive.once('close', (code) => {
          resolve(code ?? 1);
        });
      });
      await Promise.all([
        container.putArchive(archive.stdout, { path: '/openlander-seed' }),
        exit.then((code) => {
          if (code !== 0) {
            throw new Error(
              `Failed to archive Compose bind source ${opts.sourcePath}: ${stderr.trim() || `tar exited with code ${String(code)}`}`,
            );
          }
        }),
      ]);
    } finally {
      if (archive.exitCode === null) archive.kill();
      try {
        await container.remove({ force: true });
      } catch (error) {
        log.debug({ err: error, helperName }, 'Failed to remove Compose volume seed container');
      }
    }
  }
}
