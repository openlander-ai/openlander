import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import type { Docker } from '../../../src/pipeline/docker.js';
import { BuildExecutor } from '../../../src/pipeline/deploy/build-step.js';

function createMockDocker(): Docker {
  return {
    buildImage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Docker;
}

describe('BuildExecutor', () => {
  let tmpDir: string;
  let clonePath: string;
  let docker: Docker;
  let executor: BuildExecutor;

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-build-step-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    docker = createMockDocker();
    executor = new BuildExecutor(docker);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds successfully and forwards progress lines', async () => {
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n', 'utf8');

    (docker.buildImage as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_context, _tag, options) => {
        options?.onProgress?.({ stream: 'Step 1/2 : FROM node:20\n' });
        options?.onProgress?.({ error: 'build warning' });
      },
    );

    const lines: string[] = [];
    await executor.build(
      {
        clonePath,
        projectId: 'p1',
        imageTag: 'openlander/demo:latest',
      },
      (line) => lines.push(line),
    );

    expect(docker.buildImage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      clonePath,
      'openlander/demo:latest',
      expect.objectContaining({
        dockerfile: 'Dockerfile',
      }),
    );
    expect(lines).toEqual(['Step 1/2 : FROM node:20', 'build warning']);
  });

  it('uses a custom Dockerfile path when provided', async () => {
    mkdirSync(join(clonePath, 'docker'), { recursive: true });
    writeFileSync(join(clonePath, 'docker', 'Dockerfile.custom'), 'FROM node:20\n', 'utf8');

    await executor.build({
      clonePath,
      projectId: 'p2',
      imageTag: 'openlander/custom:latest',
      dockerfilePath: 'docker/Dockerfile.custom',
    });

    expect(docker.buildImage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      clonePath,
      'openlander/custom:latest',
      expect.objectContaining({
        dockerfile: 'docker/Dockerfile.custom',
      }),
    );
  });

  it('injects build args into Dockerfile and forwards buildArgs to docker', async () => {
    writeFileSync(
      join(clonePath, 'Dockerfile'),
      'FROM node:20 AS builder\nRUN npm ci\nFROM node:20 AS runner\n',
      'utf8',
    );

    await executor.build({
      clonePath,
      projectId: 'p3',
      imageTag: 'openlander/build-args:latest',
      buildArgs: {
        NEXT_PUBLIC_API_URL: 'https://api.example.com',
        VITE_CLIENT_FLAG: 'enabled',
      },
    });

    const dockerfileContent = readFileSync(join(clonePath, 'Dockerfile'), 'utf8');
    expect(dockerfileContent).toContain('ARG NEXT_PUBLIC_API_URL');
    expect(dockerfileContent).toContain('ARG VITE_CLIENT_FLAG');
    expect(docker.buildImage as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      clonePath,
      'openlander/build-args:latest',
      expect.objectContaining({
        buildArgs: {
          NEXT_PUBLIC_API_URL: 'https://api.example.com',
          VITE_CLIENT_FLAG: 'enabled',
        },
      }),
    );
  });

  it('propagates docker build failures', async () => {
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:20\n', 'utf8');
    (docker.buildImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));

    await expect(
      executor.build({
        clonePath,
        projectId: 'p4',
        imageTag: 'openlander/fail:latest',
      }),
    ).rejects.toThrow('boom');
  });
});
