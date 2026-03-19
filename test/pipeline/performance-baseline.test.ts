import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../../src/pipeline/deploy.js';
import { Database } from '../../src/db/index.js';
import type { Docker } from '../../src/pipeline/docker.js';
import { clearPortScanCache } from '../../src/pipeline/port.js';
import * as gitPipeline from '../../src/pipeline/git.js';
import * as dockerfileGen from '../../src/pipeline/dockerfile-gen.js';

const BASELINE_TIME_MS = 100;
const TOLERANCE_PERCENT = 10;

type EnvLike = {
  getAll: (projectId: string, environmentId?: string) => Record<string, string>;
  getMergedForDeploy: (projectId: string, environmentId?: string) => Record<string, string>;
  getSecretFilesForDeploy: (
    projectId: string,
  ) => Array<{ filename: string; content: string; mountPath: string }>;
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

describe('DeployPipeline performance baseline', () => {
  let tmpDir: string;
  let clonePath: string;
  let db: Database;
  let docker: Docker;
  let env: EnvLike;
  let pipeline: DeployPipeline;
  let cloneRepoSpy: ReturnType<typeof vi.spyOn>;
  let ensureDockerfileSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-perf-baseline-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n', 'utf8');

    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();
    env = {
      getAll: vi.fn().mockReturnValue({}),
      getMergedForDeploy: vi.fn().mockReturnValue({ NODE_ENV: 'test' }),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    };
    pipeline = new DeployPipeline(docker, db, env as never);

    cloneRepoSpy = vi.spyOn(gitPipeline, 'cloneRepo');
    cloneRepoSpy.mockResolvedValue({
      path: clonePath,
      commitSha: 'deadbeefcafebabe',
    });

    ensureDockerfileSpy = vi.spyOn(dockerfileGen, 'ensureDockerfile');
    ensureDockerfileSpy.mockReturnValue({
      generated: false,
      detection: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearPortScanCache();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('measures mock deploy flow execution time and validates baseline', async () => {
    const timings: number[] = [];
    const iterations = 3;

    for (let i = 0; i < iterations; i++) {
      const startTime = performance.now();

      const result = await pipeline.deploy({
        name: `perf-test-app-${i}`,
        repoUrl: 'https://github.com/test/perf-test-app',
        branch: 'main',
      });

      const endTime = performance.now();
      const duration = endTime - startTime;
      timings.push(duration);

      expect(result.success).toBe(true);
    }

    const averageTime = timings.reduce((a, b) => a + b, 0) / timings.length;
    const maxAllowedTime = BASELINE_TIME_MS * (1 + TOLERANCE_PERCENT / 100);

    console.log(`Performance Baseline Results:`);
    console.log(`  Iterations: ${iterations}`);
    console.log(`  Timings (ms): ${timings.map((t) => t.toFixed(2)).join(', ')}`);
    console.log(`  Average: ${averageTime.toFixed(2)}ms`);
    console.log(`  Baseline: ${BASELINE_TIME_MS}ms`);
    console.log(`  Max Allowed (${TOLERANCE_PERCENT}% tolerance): ${maxAllowedTime.toFixed(2)}ms`);

    expect(averageTime).toBeLessThanOrEqual(maxAllowedTime);
  });

  it('verifies clone and build steps are called during deploy', async () => {
    db.createProject({
      id: 'perf-test-p2',
      name: 'perf-test-app-2',
      repoUrl: 'https://github.com/test/perf-test-app-2',
      branch: 'main',
    });
    db.createEnvironment({
      id: 'perf-test-p2-development',
      projectId: 'perf-test-p2',
      type: 'development',
      branch: 'main',
    });

    await pipeline.deployEnvironment('perf-test-p2', 'perf-test-p2-development', {
      repoUrl: 'https://github.com/test/perf-test-app-2',
    });

    expect(cloneRepoSpy).toHaveBeenCalled();
    expect(ensureDockerfileSpy).toHaveBeenCalled();
  });

  it('baseline does not regress >10% on repeated runs', async () => {
    const timings: number[] = [];
    for (let i = 0; i < 5; i++) {
      const startTime = performance.now();

      await pipeline.deploy({
        name: `perf-test-app-3-${i}`,
        repoUrl: 'https://github.com/test/perf-test-app-3',
        branch: 'main',
      });

      const endTime = performance.now();
      timings.push(endTime - startTime);
    }

    const firstHalf = timings.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
    const secondHalf = timings.slice(3, 5).reduce((a, b) => a + b, 0) / 2;

    const regressionPercent = ((secondHalf - firstHalf) / firstHalf) * 100;
    expect(regressionPercent).toBeLessThan(TOLERANCE_PERCENT);
  });
});
