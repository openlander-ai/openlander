import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn(),
  redactRepoUrl: vi.fn((url: string) => url),
}));

import {
  DockerfileSelectionRequiredError,
  TargetProjectServiceNameConflictError,
} from '../../../src/errors.js';
import { PlanEngine, type PlanEngineDeps } from '../../../src/pipeline/deploy-plan/engine.js';
import { cloneRepo } from '../../../src/pipeline/git.js';

describe('PlanEngine repository build selection', () => {
  let clonePath: string;
  let db: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    clonePath = mkdtempSync(join(tmpdir(), 'openlander-build-selection-'));
    db = {
      createDeployPlan: vi.fn().mockResolvedValue(undefined),
      getProject: vi.fn().mockResolvedValue(undefined),
      getProjectByName: vi.fn().mockResolvedValue(undefined),
      listServices: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(cloneRepo).mockResolvedValue({
      path: clonePath,
      commitSha: 'selection-sha',
      branch: 'main',
    });
  });

  afterEach(() => {
    rmSync(clonePath, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function createEngine(composePipeline?: Record<string, unknown>): PlanEngine {
    return new PlanEngine({
      db,
      pipeline: {},
      env: { getAll: vi.fn().mockResolvedValue({}) },
      serviceManager: {},
      autoDetector: {},
      config: {},
      ...(composePipeline ? { composePipeline } : {}),
    } as unknown as PlanEngineDeps);
  }

  it('requires a Dockerfile choice when Compose is absent and multiple candidates exist', async () => {
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM scratch\n');
    mkdirSync(join(clonePath, 'worker'));
    writeFileSync(join(clonePath, 'worker', 'Dockerfile'), 'FROM scratch\n');

    await expect(
      createEngine().createPlan({ repoUrl: 'https://example.test/multi.git', name: 'multi' }),
    ).rejects.toMatchObject({
      code: 'DOCKERFILE_SELECTION_REQUIRED',
      details: { candidates: ['Dockerfile', 'worker/Dockerfile'] },
    } satisfies Partial<DockerfileSelectionRequiredError>);
    expect(db['createDeployPlan']).not.toHaveBeenCalled();
  });

  it('creates one Application plan when dockerfile_path selects a candidate', async () => {
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM scratch\n');
    mkdirSync(join(clonePath, 'worker'));
    writeFileSync(join(clonePath, 'worker', 'Dockerfile'), 'FROM scratch\n');

    const plan = await createEngine().createPlan({
      repoUrl: 'https://example.test/multi.git',
      name: 'worker',
      dockerfilePath: 'worker/Dockerfile',
    });

    expect(plan.build).toMatchObject({
      method: 'dockerfile',
      dockerfile: 'worker/Dockerfile',
      dockerfiles_found: ['Dockerfile', 'worker/Dockerfile'],
    });
    expect(db['createDeployPlan']).toHaveBeenCalledTimes(1);
  });

  it('prefers valid Compose and permits attaching it to an existing Project', async () => {
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM scratch\n');
    writeFileSync(join(clonePath, 'compose.yml'), 'services: {}\n');
    db['getProject'].mockResolvedValue({ id: 'target', name: 'suite' });
    const composePipeline = {
      detectComposeFile: vi.fn().mockReturnValue(join(clonePath, 'compose.yml')),
      parseComposeFile: vi.fn().mockReturnValue({
        services: [
          { name: 'web', build: { context: '.', dockerfile: 'Dockerfile' }, ports: ['8080'] },
        ],
        composePath: join(clonePath, 'compose.yml'),
        projectPath: clonePath,
      }),
    };

    const plan = await createEngine(composePipeline).createPlan({
      repoUrl: 'https://example.test/stack.git',
      name: 'stack',
      targetProjectId: 'target',
    });

    expect(plan.build.method).toBe('compose');
    expect(plan.target_project_id).toBe('target');
    expect(plan.build.compose_services?.map((service) => service.name)).toEqual(['web']);
  });

  it('rejects a target Project service-name collision before persisting a plan', async () => {
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM scratch\n');
    db['getProject'].mockResolvedValue({ id: 'target', name: 'suite' });
    db['listServices'].mockResolvedValue([
      { id: 'existing-api', project_id: 'target', name: 'api__svc', kind: 'git' },
    ]);

    await expect(
      createEngine().createPlan({
        repoUrl: 'https://example.test/api.git',
        name: 'api',
        targetProjectId: 'target',
      }),
    ).rejects.toBeInstanceOf(TargetProjectServiceNameConflictError);
    expect(db['createDeployPlan']).not.toHaveBeenCalled();
  });
});
