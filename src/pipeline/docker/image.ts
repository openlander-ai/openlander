import type { Readable } from 'node:stream';
import type Dockerode from 'dockerode';
import { createModuleLogger } from '../../lib/logger.js';
import { DockerBuildError, isDockerNotFoundError } from '../../errors.js';
import type { DockerContext } from './context.js';
import type { BuildImageOptions, BuildComposeServiceOptions } from './types.js';

const log = createModuleLogger('docker:image');

export class ImageOps {
  private readonly activeBuilds = new Map<string, Readable>();

  constructor(private readonly ctx: DockerContext) {}

  async buildImage(contextPath: string, tag: string, options?: BuildImageOptions): Promise<void> {
    const trackingId = options?.projectId;

    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.ctx.client.buildImage(
        { context: contextPath, src: ['.'] },
        {
          t: tag,
          nocache: options?.noCache === true,
          buildargs: options?.buildArgs,
          target: options?.target,
          dockerfile: options?.dockerfile,
        },
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new DockerBuildError(
        tag,
        `Build failed for ${tag} (context: ${contextPath}): ${errMsg}`,
      );
    }

    if (trackingId) {
      this.activeBuilds.set(trackingId, stream as Readable);
    }

    let buildLog = '';
    let buildError = '';
    try {
      await new Promise<void>((resolve, reject) => {
        this.ctx.client.modem.followProgress(
          stream,
          (err: Error | null) => {
            if (err) {
              const reason = [buildLog, buildError, err.message].filter(Boolean).join('\n');
              reject(
                new DockerBuildError(
                  tag,
                  `Build failed for ${tag} (context: ${contextPath}): ${reason}`,
                ),
              );
            } else if (buildError) {
              const reason = [buildLog, buildError].filter(Boolean).join('\n');
              reject(
                new DockerBuildError(
                  tag,
                  `Build failed for ${tag} (context: ${contextPath}): ${reason}`,
                ),
              );
            } else {
              resolve();
            }
          },
          (event: { stream?: string; error?: string }) => {
            if (event.stream) buildLog += event.stream;
            if (event.error) {
              buildError += event.error + '\n';
              buildLog += `ERROR: ${event.error}\n`;
            }
            options?.onProgress?.(event);
          },
        );
      });
    } finally {
      if (trackingId) {
        this.activeBuilds.delete(trackingId);
      }
    }
  }

  cancelBuild(projectId: string): boolean {
    const stream = this.activeBuilds.get(projectId);
    if (!stream) {
      return false;
    }
    stream.destroy();
    this.activeBuilds.delete(projectId);
    log.info({ projectId }, 'Build cancelled');
    return true;
  }

  async buildComposeService(opts: BuildComposeServiceOptions): Promise<void> {
    const dockerfile = opts.dockerfile ?? 'Dockerfile';

    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.ctx.client.buildImage(
        { context: opts.contextPath, src: ['.'] },
        {
          t: opts.tag,
          dockerfile,
          buildargs: opts.buildArgs,
          target: opts.target,
          nocache: opts.noCache === true,
          ...(opts.cacheFrom &&
            opts.cacheFrom.length > 0 && { cachefrom: JSON.stringify(opts.cacheFrom) }),
        },
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new DockerBuildError(
        opts.tag,
        `Build failed for ${opts.tag} (context: ${opts.contextPath}): ${errMsg}`,
      );
    }

    let buildLog = '';
    let buildError = '';
    await new Promise<void>((resolve, reject) => {
      this.ctx.client.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            const reason = [buildLog, buildError, err.message].filter(Boolean).join('\n');
            reject(
              new DockerBuildError(
                opts.tag,
                `Build failed for ${opts.tag} (context: ${opts.contextPath}): ${reason}`,
              ),
            );
          } else if (buildError) {
            const reason = [buildLog, buildError].filter(Boolean).join('\n');
            reject(
              new DockerBuildError(
                opts.tag,
                `Build failed for ${opts.tag} (context: ${opts.contextPath}): ${reason}`,
              ),
            );
          } else {
            resolve();
          }
        },
        (event: { stream?: string; error?: string }) => {
          if (event.stream) buildLog += event.stream;
          if (event.error) {
            buildError += event.error + '\n';
            buildLog += `ERROR: ${event.error}\n`;
          }
          opts.onProgress?.(event);
        },
      );
    });
  }

  async pullImage(imageTag: string): Promise<void> {
    try {
      const stream = await this.ctx.client.pull(imageTag);
      await new Promise<void>((resolve, reject) => {
        this.ctx.client.modem.followProgress(stream, (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (err) {
      // Check if image exists locally — if so, swallow the pull error
      try {
        await this.ctx.client.getImage(imageTag).inspect();
        log.debug({ err, imageTag }, 'Image pull failed but image exists locally');
      } catch (_inspectErr) {
        throw new Error(
          `Failed to pull image "${imageTag}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Inspect a Docker image. Throws if not found. */
  async inspectImage(tag: string): Promise<Dockerode.ImageInspectInfo> {
    try {
      return await this.ctx.client.getImage(tag).inspect();
    } catch (error) {
      if (isDockerNotFoundError(error)) throw new Error(`Image not found: ${tag}`);
      throw error;
    }
  }

  /** Remove a Docker image. Silent on 404. */
  async removeImage(tag: string, force = false): Promise<void> {
    try {
      await this.ctx.client.getImage(tag).remove({ force });
    } catch (error) {
      if (isDockerNotFoundError(error)) return;
      throw error;
    }
  }

  async tagImage(sourceTag: string, repo: string, newTag: string): Promise<void> {
    const image = this.ctx.client.getImage(sourceTag);
    await image.tag({ repo, tag: newTag });
  }

  async getImageExposedPort(imageTag: string): Promise<number | undefined> {
    try {
      const image = this.ctx.client.getImage(imageTag);
      const info = await image.inspect();
      const keys = Object.keys(info.Config.ExposedPorts);
      const first = keys[0]; // e.g. "80/tcp"
      if (!first) return undefined;
      const portStr = first.split('/')[0];
      if (!portStr) return undefined;
      const port = parseInt(portStr, 10);
      return isNaN(port) ? undefined : port;
    } catch (_err) {
      return undefined;
    }
  }

  /** List dangling (untagged) Docker images. */
  async listDanglingImages(): Promise<Dockerode.ImageInfo[]> {
    return await this.ctx.client.listImages({ filters: { dangling: ['true'] } });
  }
}
