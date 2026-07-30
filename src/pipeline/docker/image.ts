import type { Readable } from 'node:stream';
import type Dockerode from 'dockerode';
import { createModuleLogger } from '../../lib/logger.js';
import {
  DockerBuildCancelledError,
  DockerBuildError,
  isDockerNotFoundError,
} from '../../errors.js';
import type { DockerContext } from './context.js';
import type { BuildImageOptions, BuildComposeServiceOptions } from './types.js';
import { withTimeout } from './helpers.js';

const log = createModuleLogger('docker:image');

const IMAGE_INSPECT_TIMEOUT_MS = 15_000;
const COMPOSE_BUILD_NETWORK_RETRY_DELAYS_MS = [500, 1_500] as const;

function isRetryableComposeBuildNetworkError(error: unknown): boolean {
  if (!(error instanceof DockerBuildError)) return false;
  const evidence = `${error.message}\n${error.buildLog}`;
  return /(?:context deadline exceeded|i\/o timeout|connection (?:reset|refused)|network is unreachable|temporary failure in name resolution|no such host|tls handshake timeout|failed to do request|unexpected eof|no active session)/i.test(
    evidence,
  );
}

export class ImageOps {
  private readonly activeBuilds = new Map<string, Readable>();
  private readonly cancelledBuilds = new Set<Readable>();

  constructor(private readonly ctx: DockerContext) {}

  async buildImage(contextPath: string, tag: string, options?: BuildImageOptions): Promise<void> {
    const trackingId = options?.projectId;

    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.ctx.client.buildImage(
        { context: contextPath, src: ['.'] },
        {
          t: tag,
          version: '2',
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

    const trackedStream = stream as Readable;
    if (trackingId) {
      this.activeBuilds.set(trackingId, trackedStream);
    }

    let buildLog = '';
    let buildError = '';
    try {
      await new Promise<void>((resolve, reject) => {
        this.ctx.client.modem.followProgress(
          stream,
          (err: Error | null) => {
            if (trackingId && this.cancelledBuilds.has(trackedStream)) {
              reject(new DockerBuildCancelledError(trackingId));
            } else if (err) {
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
        if (this.activeBuilds.get(trackingId) === trackedStream) {
          this.activeBuilds.delete(trackingId);
        }
        this.cancelledBuilds.delete(trackedStream);
      }
    }
  }

  cancelBuild(projectId: string): boolean {
    const stream = this.activeBuilds.get(projectId);
    if (!stream) {
      return false;
    }
    this.cancelledBuilds.add(stream);
    stream.destroy(new DockerBuildCancelledError(projectId));
    if (this.activeBuilds.get(projectId) === stream) {
      this.activeBuilds.delete(projectId);
    }
    log.info({ projectId }, 'Build cancelled');
    return true;
  }

  async buildComposeService(opts: BuildComposeServiceOptions): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.buildComposeServiceOnce(opts);
        return;
      } catch (error) {
        const retryDelayMs = COMPOSE_BUILD_NETWORK_RETRY_DELAYS_MS[attempt];
        if (retryDelayMs === undefined || !isRetryableComposeBuildNetworkError(error)) {
          throw error;
        }
        log.warn(
          { err: error, imageTag: opts.tag, attempt: attempt + 1, retryDelayMs },
          'Compose image build hit a transient network error; retrying',
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  private async buildComposeServiceOnce(opts: BuildComposeServiceOptions): Promise<void> {
    const dockerfile = opts.dockerfile ?? 'Dockerfile';

    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.ctx.client.buildImage(
        { context: opts.contextPath, src: ['.'] },
        {
          t: opts.tag,
          dockerfile,
          // Compose Dockerfiles commonly use BuildKit-only features such as
          // RUN --mount=type=cache. Docker's Engine API otherwise defaults to
          // the deprecated classic builder (version 1).
          version: '2',
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
        await withTimeout(
          this.ctx.client.getImage(imageTag).inspect(),
          IMAGE_INSPECT_TIMEOUT_MS,
          `Image inspect (${imageTag})`,
        );
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
      return await withTimeout(
        this.ctx.client.getImage(tag).inspect(),
        IMAGE_INSPECT_TIMEOUT_MS,
        `Image inspect (${tag})`,
      );
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
      const info = await withTimeout(
        image.inspect(),
        IMAGE_INSPECT_TIMEOUT_MS,
        `Image inspect (${imageTag})`,
      );
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
