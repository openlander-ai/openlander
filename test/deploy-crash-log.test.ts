import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../src/pipeline/deploy.js';
import { Database } from '../src/db/index.js';
import { JobManager } from '../src/pipeline/job-manager.js';
import type { Docker } from '../src/pipeline/docker.js';
import { clearPortScanCache } from '../src/pipeline/port.js';

function createMockDocker(): Docker {
  return {
    buildImage: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-crash-log'),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    getLogs: vi.fn().mockResolvedValue(''),
    listContainers: vi.fn().mockResolvedValue([]),
    listAllContainers: vi.fn().mockResolvedValue([]),
    inspectContainer: vi.fn().mockResolvedValue(null),
  } as unknown as Docker;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('DeployPipeline crash logging from startDeploy', () => {
  let tmpDir: string;
  let db: Database;
  let jobManager: JobManager;
  let pipeline: DeployPipeline;

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-deploy-crash-log-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    jobManager = new JobManager();
    pipeline = new DeployPipeline(
      createMockDocker(),
      db,
      {
        getEnvVars: vi.fn().mockReturnValue({}),
        getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
      } as never,
      jobManager,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearPortScanCache();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates deploy log when deploy() crashes before build step', async () => {
    vi.spyOn(pipeline, 'deploy').mockRejectedValue(new Error('simulated early crash'));

    const started = await pipeline.startDeploy({
      repoUrl: 'https://github.com/openlander/crash-log-app',
    });
    await flushMicrotasks();

    const logs = db.getDeployLogs(started.projectId, 5);
    expect(logs[0]?.status).toBe('failed');
    expect(logs[0]?.build_log).toContain(
      '[fatal] Deploy crashed before build: simulated early crash',
    );
  });

  it('updates project status to error on crash', async () => {
    vi.spyOn(pipeline, 'deploy').mockRejectedValue(new Error('simulated early crash'));

    const started = await pipeline.startDeploy({
      repoUrl: 'https://github.com/openlander/crash-status-app',
    });
    await flushMicrotasks();

    const project = db.getProject(started.projectId);
    expect(project?.status).toBe('error');
  });

  it('updates job phase to failed on crash', async () => {
    vi.spyOn(pipeline, 'deploy').mockRejectedValue(new Error('simulated early crash'));

    const started = await pipeline.startDeploy({
      repoUrl: 'https://github.com/openlander/crash-job-app',
    });
    await flushMicrotasks();

    const job = jobManager.getStatus(started.projectId);
    expect(job?.phase).toBe('failed');
    expect(job?.errorSummary).toContain('simulated early crash');
  });
});
