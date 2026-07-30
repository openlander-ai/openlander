import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

import { DockerBuildError } from '../src/errors.js';
import { Docker } from '../src/pipeline/docker.js';

const describeDocker = describe;

const mockBuildImage = vi.fn();

const require = createRequire(import.meta.url);
const mockDockerodeClass = vi.fn(function (this: Record<string, unknown>) {
  this.ping = vi.fn();
  this.listContainers = vi.fn();
  this.buildImage = mockBuildImage;
  this.modem = {
    followProgress: vi.fn(),
  };
});

const dockerodePath = require.resolve('dockerode');
require.cache[dockerodePath] = {
  id: dockerodePath,
  filename: dockerodePath,
  loaded: true,
  exports: mockDockerodeClass,
} as unknown as NodeJS.Module;

describeDocker('Docker build startup error context', () => {
  it('keeps the complete log internally while exposing only a bounded error preview', () => {
    const completeLog = `${'build output\n'.repeat(300)}terminal failure\n`;
    const error = new DockerBuildError('acme/repo-app:latest', completeLog);

    expect(error.buildLog).toBe(completeLog);
    expect(error.details?.['buildLog']).toBe(completeLog.slice(-2000));
  });

  it('includes image tag and context path in DockerBuildError when stream fails to start', async () => {
    mockBuildImage.mockRejectedValueOnce(new Error('Cannot connect to Docker daemon'));
    const docker = new Docker();

    const error = await docker
      .buildImage('/tmp/repo-app', 'acme/repo-app:latest')
      .catch((err: unknown) => err);

    expect(error).toMatchObject({ name: 'DockerBuildError' });
    expect((error as { details?: { buildLog?: string } }).details?.buildLog).toContain(
      'Build failed for acme/repo-app:latest (context: /tmp/repo-app): Cannot connect to Docker daemon',
    );
  });
});
