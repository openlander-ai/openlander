import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Docker } from '../docker.js';
import type { FrameworkDetection } from '../dockerfile-gen.js';
import { ensureDockerfile } from '../dockerfile-gen.js';
import { DockerfileNotFoundError } from '../../errors.js';

export interface BuildStepConfig {
  docker: Docker;
  projectPath: string;
  imageTag: string;
  onDockerfileReady?: (state: { generated: boolean; detection: FrameworkDetection | null }) => void;
}

export interface BuildStepResult {
  imageTag: string;
  buildDurationMs: number;
  dockerfileGenerated: boolean;
  detection: FrameworkDetection | null;
}

export async function executeBuildStep(config: BuildStepConfig): Promise<BuildStepResult> {
  const dockerfileResult = ensureDockerfile(config.projectPath);
  const dockerfilePath = join(config.projectPath, 'Dockerfile');

  if (!existsSync(dockerfilePath)) {
    throw new DockerfileNotFoundError(config.projectPath);
  }

  config.onDockerfileReady?.({
    generated: dockerfileResult.generated,
    detection: dockerfileResult.detection,
  });

  const buildStart = Date.now();
  await config.docker.buildImage(config.projectPath, config.imageTag);
  const buildDurationMs = Date.now() - buildStart;

  return {
    imageTag: config.imageTag,
    buildDurationMs,
    dockerfileGenerated: dockerfileResult.generated,
    detection: dockerfileResult.detection,
  };
}
