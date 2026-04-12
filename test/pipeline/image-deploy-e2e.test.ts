import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Database } from '../../src/db/index.js';
import { buildDeployConfig } from '../../src/pipeline/build-deploy-config.js';
import { PlanEngine } from '../../src/pipeline/deploy-plan/engine.js';
import type { CreatePlanOptions, PlanEngineDeps } from '../../src/pipeline/deploy-plan/engine.js';
import { parseImageUrl } from '../../src/pipeline/image-utils.js';
import type { ProjectConfig } from '../../src/pipeline/deploy-core.js';
import { createDeployPlanSchema } from '../../src/tools/defs/schemas.js';

function mapApiRequestToCreatePlanOptions(input: unknown): CreatePlanOptions {
  const parsed = createDeployPlanSchema.parse(input);
  const envVars = parsed.env_vars
    ? (JSON.parse(parsed.env_vars) as Record<string, string>)
    : undefined;

  return {
    repoUrl: parsed.repo_url,
    branch: parsed.branch,
    name: parsed.name,
    source: parsed.source,
    imageUrl: parsed.image,
    imageCmd: parsed.cmd,
    containerPort: parsed.port,
    envVars,
    preferDockerfile: parsed.prefer_dockerfile,
    dockerfilePath: parsed.dockerfile_path,
    dockerTarget: parsed.docker_target,
  };
}

describe('image deploy e2e flow (mock integration)', () => {
  let tempDir: string;
  let db: Database;
  let engine: PlanEngine;
  let mockStartDeploy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openlander-image-e2e-'));
    db = new Database(join(tempDir, 'test.db'));
    mockStartDeploy = vi.fn();

    const deps: PlanEngineDeps = {
      db,
      pipeline: {
        startDeploy: mockStartDeploy,
        startMonorepoDeploy: vi.fn(),
      } as unknown as PlanEngineDeps['pipeline'],
      env: {
        getAll: vi.fn().mockReturnValue({}),
        getGlobalSecrets: vi.fn().mockReturnValue({}),
      } as unknown as PlanEngineDeps['env'],
      serviceManager: {
        create: vi.fn(),
      } as unknown as PlanEngineDeps['serviceManager'],
      autoDetector: {} as PlanEngineDeps['autoDetector'],
      config: {} as PlanEngineDeps['config'],
    };

    engine = new PlanEngine(deps);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('validates image API input and creates ready image plan persisted in DB', async () => {
    const apiRequest = {
      source: 'image',
      image: 'ghcr.io/openlander/sample-api:v1',
      name: 'sample-api',
      cmd: ['node', 'server.js'],
      port: 3000,
      env_vars: '{"NODE_ENV":"production"}',
    };

    const plan = await engine.createPlan(mapApiRequestToCreatePlanOptions(apiRequest));

    expect(plan.build.method).toBe('image');
    expect(plan.status).toBe('ready');
    expect(plan.app.source.image_url).toBe('ghcr.io/openlander/sample-api:v1');
    expect(plan.env.provided).toEqual({ NODE_ENV: 'production' });

    const storedPlan = db.getDeployPlan(plan.plan_id);
    expect(storedPlan).toBeDefined();
    expect(storedPlan?.status).toBe('ready');
    expect(storedPlan?.project_name).toBe('sample-api');
  });

  it('parses image URL into registry/name/tag for pipeline use', () => {
    expect(parseImageUrl('ghcr.io/openlander/worker:v2.3.1')).toEqual({
      registry: 'ghcr.io',
      name: 'openlander/worker',
      tag: 'v2.3.1',
    });

    expect(parseImageUrl('localhost:5000/internal/api')).toEqual({
      registry: 'localhost:5000',
      name: 'internal/api',
      tag: 'latest',
    });
  });

  it('runs full mocked flow: schema -> plan -> execute -> config assembly with propagated fields', async () => {
    const apiRequest = {
      source: 'image',
      image: 'docker.io/library/nginx:1.27-alpine',
      name: 'edge-nginx',
      cmd: ['nginx', '-g', 'daemon off;'],
      port: 8080,
      env_vars: '{"NODE_ENV":"production","LOG_LEVEL":"info"}',
    };

    const createPlanOptions = mapApiRequestToCreatePlanOptions(apiRequest);
    const plan = await engine.createPlan(createPlanOptions);

    mockStartDeploy.mockImplementation(async (config: ProjectConfig) => {
      const projectName = config.name ?? 'edge-nginx';

      db.createProject({
        id: 'proj-edge-nginx',
        name: projectName,
        repoUrl: config.repoUrl,
        source: config.source,
        imageUrl: config.imageUrl,
        imageCmd: config.imageCmd,
        containerPort: config.containerPort,
      });

      return {
        status: 'building',
        projectId: 'proj-edge-nginx',
        projectName,
      };
    });

    const result = await engine.executePlan(plan.plan_id);
    expect(result.status).toBe('building');
    expect(result.project_id).toBe('proj-edge-nginx');

    expect(mockStartDeploy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'image',
        imageUrl: 'docker.io/library/nginx:1.27-alpine',
        imageCmd: ['nginx', '-g', 'daemon off;'],
        containerPort: 8080,
        preferDockerfile: true,
        envVars: {
          NODE_ENV: 'production',
          LOG_LEVEL: 'info',
        },
      }),
    );

    const buildDeployConfigMock = vi.fn((projectId: string) =>
      buildDeployConfig({
        projectId,
        db,
      }),
    );

    const assembledConfig = buildDeployConfigMock('proj-edge-nginx');
    expect(assembledConfig.source).toBe('image');
    expect(assembledConfig.imageUrl).toBe('docker.io/library/nginx:1.27-alpine');
    expect(assembledConfig.imageCmd).toEqual(['nginx', '-g', 'daemon off;']);
    expect(assembledConfig.containerPort).toBe(8080);
    expect(assembledConfig.preferDockerfile).toBe(true);

    expect(buildDeployConfigMock).toHaveBeenCalledWith('proj-edge-nginx');

    const persistedPlanRow = db.getDeployPlan(plan.plan_id);
    expect(persistedPlanRow?.status).toBe('executing');
  });
});
