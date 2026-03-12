import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../src/pipeline/deploy.js';
import { Database } from '../src/db/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import { clearPortScanCache } from '../src/pipeline/port.js';
import { cloneRepo } from '../src/pipeline/git.js';

vi.mock('../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn(),
}));

type EnvLike = {
  getAll: (projectId: string, environmentId?: string) => Record<string, string>;
  getMergedForDeploy: (projectId: string, environmentId?: string) => Record<string, string>;
};

function createMockDocker(): Docker {
  return {
    buildImage: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-abc123456789'),
    waitForHealthy: vi.fn().mockResolvedValue({ healthy: true }),
    getLogs: vi.fn().mockResolvedValue(''),
    listAllContainers: vi.fn().mockResolvedValue([]),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    stopContainer: vi.fn().mockResolvedValue(undefined),
  } as unknown as Docker;
}

describe('DeployPipeline deployEnvironment', () => {
  let tmpDir: string;
  let clonePath: string;
  let db: Database;
  let docker: Docker;
  let env: EnvLike;
  let pipeline: DeployPipeline;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-deploy-environment-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n', 'utf8');

    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();
    env = {
      getAll: vi.fn().mockReturnValue({}),
      getMergedForDeploy: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
    };
    pipeline = new DeployPipeline(docker, db, env as never);

    (cloneRepo as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      path: clonePath,
      commitSha: 'deadbeefcafebabe',
    });
  });

  afterEach(() => {
    clearPortScanCache();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('deployEnvironment clones environment branch and uses merged env by environment', async () => {
    db.createProject({
      id: 'p1',
      name: 'demo-app',
      repoUrl: 'https://github.com/openlander/demo-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p1-staging',
      projectId: 'p1',
      type: 'staging',
      branch: 'develop',
    });

    const result = await pipeline.deployEnvironment('p1', 'p1-staging', {
      repoUrl: 'https://github.com/openlander/demo-app',
    });

    expect(result.success).toBe(true);
    expect(cloneRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        repoUrl: 'https://github.com/openlander/demo-app',
        branch: 'develop',
      }),
    );
    expect(env.getMergedForDeploy).toHaveBeenCalledWith('p1', 'p1-staging');
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ol-demo-app-staging',
      }),
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        traefikLabels: expect.objectContaining({
          'traefik.http.routers.ol-demo-app.rule': expect.stringContaining('staging-demo-app.'),
        }),
      }),
    );
    expect(result.url).toContain('staging-demo-app.');

    const stagingEnvironment = db.getEnvironment('p1-staging');
    expect(stagingEnvironment?.status).toBe('running');
    expect(stagingEnvironment?.container_id).toBe('container-abc123456789');
    expect(stagingEnvironment?.assigned_port).toBeGreaterThanOrEqual(10001);
    expect(stagingEnvironment?.image_tag).toBe('openlander/demo-app-staging:latest');
  });

  it('deploy() stays backward compatible by routing through production environment', async () => {
    db.createProject({
      id: 'p2',
      name: 'prod-app',
      repoUrl: 'https://github.com/openlander/prod-app',
      branch: 'main',
    });

    const productionEnvironment = db
      .getEnvironmentsByProject('p2')
      .find((environment) => environment.type === 'production');
    expect(productionEnvironment).toBeDefined();

    db.updateEnvironment(productionEnvironment!.id, { branch: 'release' });

    const result = await pipeline.deploy({
      repoUrl: 'https://github.com/openlander/prod-app',
      branch: 'feature/do-not-use',
      name: 'prod-app',
      _projectId: 'p2',
    });

    expect(result.success).toBe(true);
    expect(cloneRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: 'release',
      }),
    );
    expect(env.getMergedForDeploy).toHaveBeenCalledWith('p2', productionEnvironment!.id);
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ol-prod-app',
      }),
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        traefikLabels: expect.objectContaining({
          'traefik.http.routers.ol-prod-app.rule': expect.stringContaining('prod-app.'),
        }),
      }),
    );
    expect(result.url).toContain('prod-app.');

    const refreshedProductionEnvironment = db.getEnvironment(productionEnvironment!.id);
    const project = db.getProject('p2');
    expect(refreshedProductionEnvironment?.status).toBe('running');
    expect(project?.status).toBe('running');
    expect(refreshedProductionEnvironment?.container_id).toBe('container-abc123456789');
    expect(project?.container_id).toBe('container-abc123456789');
  });

  it('deployEnvironment uses dev suffix for development container naming', async () => {
    db.createProject({
      id: 'p3',
      name: 'dev-app',
      repoUrl: 'https://github.com/openlander/dev-app',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'p3-development',
      projectId: 'p3',
      type: 'development',
      branch: 'dev',
    });

    const result = await pipeline.deployEnvironment('p3', 'p3-development', {
      repoUrl: 'https://github.com/openlander/dev-app',
    });

    expect(result.success).toBe(true);
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ol-dev-app-dev',
      }),
    );
    expect(docker.runContainer as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        traefikLabels: expect.objectContaining({
          'traefik.http.routers.ol-dev-app.rule': expect.stringContaining('dev-dev-app.'),
        }),
      }),
    );
    expect(result.url).toContain('dev-dev-app.');

    const developmentEnvironment = db.getEnvironment('p3-development');
    expect(developmentEnvironment?.image_tag).toBe('openlander/dev-app-dev:latest');
  });
});
