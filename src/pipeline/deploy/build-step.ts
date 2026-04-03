import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Docker } from '../docker.js';
import { injectBuildArgs } from '../build-args.js';
import { ensureDockerfile } from '../dockerfile-gen.js';
import { DockerfileNotFoundError } from '../../errors.js';
import { resolveDockerfilePath } from './helpers.js';

export interface BuildContext {
  clonePath: string;
  projectId: string;
  imageTag: string;
  dockerfilePath?: string;
  buildArgs?: Record<string, string>;
  noCache?: boolean;
  buildContext?: string;
  dockerTarget?: string;
}

export class BuildExecutor {
  constructor(private readonly docker: Docker) {}

  async build(context: BuildContext, onProgress?: (line: string) => void): Promise<void> {
    const dockerfilePath = resolveDockerfilePath(context.clonePath, context.dockerfilePath);
    const hasExplicitDockerfilePath =
      typeof context.dockerfilePath === 'string' && context.dockerfilePath.trim().length > 0;

    if (!hasExplicitDockerfilePath) {
      ensureDockerfile(context.clonePath);
    }

    if (!existsSync(dockerfilePath)) {
      throw new DockerfileNotFoundError(context.clonePath);
    }

    if (context.buildArgs && Object.keys(context.buildArgs).length > 0) {
      const dfContent = readFileSync(dockerfilePath, 'utf8');
      writeFileSync(
        dockerfilePath,
        injectBuildArgs(dfContent, Object.keys(context.buildArgs)),
        'utf8',
      );
    }

    const buildContextPath = context.buildContext
      ? join(context.clonePath, context.buildContext)
      : context.clonePath;
    const relativeDockerfile = relative(buildContextPath, dockerfilePath);

    await this.docker.buildImage(buildContextPath, context.imageTag, {
      noCache: context.noCache === true,
      buildArgs: context.buildArgs,
      target: context.dockerTarget,
      dockerfile: relativeDockerfile,
      projectId: context.projectId,
      onProgress: (event) => {
        const line = event.stream?.trim() ?? event.error ?? '';
        if (!line) {
          return;
        }
        onProgress?.(line);
      },
    });
  }
}
