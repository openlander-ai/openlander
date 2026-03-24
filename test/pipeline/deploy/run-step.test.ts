import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../src/db/index.js';
import type { Docker } from '../../../src/pipeline/docker.js';
import * as portPipeline from '../../../src/pipeline/port.js';
import { ContainerRunner } from '../../../src/pipeline/deploy/run-step.js';

function createMockDocker(): Docker {
  return {
    removeContainer: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-abc123456789'),
  } as unknown as Docker;
}

function createMockDatabase(): Database {
  return {
    getUsedPorts: vi.fn().mockReturnValue([]),
  } as unknown as Database;
}

describe('ContainerRunner', () => {
  it('runs container with allocated port and returns run metadata', async () => {
    const docker = createMockDocker();
    const db = createMockDatabase();
    const runner = new ContainerRunner(docker, db);
    const allocatePortSpy = vi.spyOn(portPipeline, 'allocatePort').mockResolvedValue(12001);

    const result = await runner.run({
      imageTag: 'openlander/demo:latest',
      projectName: 'demo-app',
      projectId: 'p1',
      environmentType: 'development',
      environmentId: 'p1-development',
      envVars: { NODE_ENV: 'test' },
      preferredPort: 12001,
      secretFiles: [{ filename: '.env', content: 'A=1', mountPath: '/run/secrets/.env' }],
    });

    expect(allocatePortSpy).toHaveBeenCalledWith(
      db,
      docker,
      { preferredPort: 12001 },
      'development',
    );
    expect(docker.removeContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('ol-demo-app');
    expect(
      (docker.removeContainer as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    ).toBeLessThan((docker.runContainer as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        imageTag: 'openlander/demo:latest',
        name: 'ol-demo-app',
        port: 12001,
        containerPort: 12001,
        envVars: { NODE_ENV: 'test' },
        network: 'openlander-dev',
        secretFiles: [{ filename: '.env', content: 'A=1', mountPath: '/run/secrets/.env' }],
      }),
    );
    expect(result).toEqual({
      containerId: 'container-abc123456789',
      port: 12001,
      url: expect.stringContaining('dev-demo-app.'),
    });
  });

  it('uses custom containerPort when provided', async () => {
    const docker = createMockDocker();
    const db = createMockDatabase();
    const runner = new ContainerRunner(docker, db);
    vi.spyOn(portPipeline, 'allocatePort').mockResolvedValue(13000);

    const result = await runner.run({
      imageTag: 'openlander/api:latest',
      projectName: 'mono-api',
      projectId: 'child-1',
      envVars: { NODE_ENV: 'production' },
      containerPort: 8080,
    });

    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        containerPort: 8080,
      }),
    );
    expect(result.url).toContain('mono-api.');
  });

  it('passes production network for production environment', async () => {
    const docker = createMockDocker();
    const db = createMockDatabase();
    const runner = new ContainerRunner(docker, db);
    vi.spyOn(portPipeline, 'allocatePort').mockResolvedValue(14000);

    await runner.run({
      imageTag: 'openlander/fail:latest',
      projectName: 'failing-app',
      projectId: 'p-fail',
      environmentId: 'p-fail-production',
      environmentType: 'production',
      envVars: {},
    });

    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        network: 'openlander-prod',
      }),
    );
  });

  it('returns deploy:run payload fields for upstream event emission', async () => {
    const docker = createMockDocker();
    const db = createMockDatabase();
    const runner = new ContainerRunner(docker, db);
    vi.spyOn(portPipeline, 'allocatePort').mockResolvedValue(15000);

    const runResult = await runner.run({
      imageTag: 'openlander/event:latest',
      projectName: 'event-app',
      projectId: 'p-event',
      envVars: {},
    });

    expect(runResult).toEqual({
      containerId: 'container-abc123456789',
      port: 15000,
      url: expect.stringContaining('event-app.'),
    });
  });
});
