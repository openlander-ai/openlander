import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContainerOps } from '../../src/pipeline/docker/container.js';
import { Docker } from '../../src/pipeline/docker/facade.js';
import * as portPipeline from '../../src/pipeline/port.js';

const runContainerOptions: Parameters<ContainerOps['runContainer']>[0] = {
  imageTag: 'openlander/app:latest',
  name: 'ol-cache-app',
  port: 12001,
  envVars: {},
};

const runServiceOptions: Parameters<ContainerOps['runServiceContainer']>[0] = {
  imageTag: 'postgres:16-alpine',
  name: 'ol-svc-cache-pg',
  port: 5432,
  hostPort: 12002,
  envVars: {},
  serviceName: 'cache-pg',
};

describe('Docker facade port scan cache invalidation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears the port scan cache after app container start succeeds', async () => {
    const runSpy = vi.spyOn(ContainerOps.prototype, 'runContainer').mockResolvedValue('app-id');
    const clearSpy = vi.spyOn(portPipeline, 'clearPortScanCache');
    const docker = new Docker();

    await expect(docker.runContainer(runContainerOptions)).resolves.toBe('app-id');

    expect(clearSpy).toHaveBeenCalledOnce();
    expect(runSpy.mock.invocationCallOrder[0]).toBeLessThan(
      clearSpy.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('clears the port scan cache after managed service container start succeeds', async () => {
    const runSpy = vi
      .spyOn(ContainerOps.prototype, 'runServiceContainer')
      .mockResolvedValue('service-id');
    const clearSpy = vi.spyOn(portPipeline, 'clearPortScanCache');
    const docker = new Docker();

    await expect(docker.runServiceContainer(runServiceOptions)).resolves.toBe('service-id');

    expect(clearSpy).toHaveBeenCalledOnce();
    expect(runSpy.mock.invocationCallOrder[0]).toBeLessThan(
      clearSpy.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
