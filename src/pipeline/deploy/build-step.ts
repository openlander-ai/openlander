import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { RuntimeBackend } from '../runtime/index.js';
import {
  injectBuildArgs,
  injectDependencyCacheBust,
  OPENLANDER_DEPENDENCY_CACHE_KEY_ARG,
} from '../build-args.js';
import { ensureDockerfile } from '../dockerfile-gen.js';
import { DockerfileNotFoundError } from '../../errors.js';
import { resolveDockerfilePath } from './helpers.js';

export interface BuildContext {
  clonePath: string;
  projectId: string;
  imageTag: string;
  dockerfilePath?: string;
  buildArgs?: Record<string, string>;
  dependencyCacheKey?: string;
  noCache?: boolean;
  buildContext?: string;
  dockerTarget?: string;
}

export class BuildExecutor {
  constructor(private readonly runtime: RuntimeBackend) {}

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

    const buildArgs = { ...(context.buildArgs ?? {}) };
    let dfContent: string | undefined;
    let shouldWriteDockerfile = false;

    if (context.dependencyCacheKey) {
      dfContent = dfContent ?? readFileSync(dockerfilePath, 'utf8');
      const dependencyCacheBust = injectDependencyCacheBust(dfContent);
      if (dependencyCacheBust.injected) {
        dfContent = dependencyCacheBust.content;
        buildArgs[OPENLANDER_DEPENDENCY_CACHE_KEY_ARG] = context.dependencyCacheKey;
        shouldWriteDockerfile = true;
      }
    }

    if (Object.keys(buildArgs).length > 0) {
      dfContent = dfContent ?? readFileSync(dockerfilePath, 'utf8');
      dfContent = injectBuildArgs(dfContent, Object.keys(context.buildArgs ?? {}));
      shouldWriteDockerfile = true;
    }

    if (shouldWriteDockerfile && dfContent !== undefined) {
      writeFileSync(dockerfilePath, dfContent, 'utf8');
    }

    const buildContextPath = context.buildContext
      ? join(context.clonePath, context.buildContext)
      : context.clonePath;
    const relativeDockerfile = relative(buildContextPath, dockerfilePath);

    await this.runtime.buildImage(buildContextPath, context.imageTag, {
      noCache: context.noCache === true,
      buildArgs: Object.keys(buildArgs).length > 0 ? buildArgs : undefined,
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
