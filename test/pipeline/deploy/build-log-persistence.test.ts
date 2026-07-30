import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../../src/db/index.js';
import type { EnvManager } from '../../../src/pipeline/env.js';
import {
  buildProject,
  type DeployOrchestrationDeps,
} from '../../../src/pipeline/deploy/orchestrator.js';
import { JobManager } from '../../../src/pipeline/job-manager.js';
import type { RuntimeBackend } from '../../../src/pipeline/runtime/index.js';

describe('successful Dockerfile build logging', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs) rmSync(tempDir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  it('keeps complete successful builder output and updates the active 30-line tail', async () => {
    const clonePath = mkdtempSync(join(tmpdir(), 'openlander-build-log-'));
    tempDirs.push(clonePath);
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:22\nRUN npm ci\n', 'utf8');

    const jobManager = new JobManager();
    jobManager.trackJob('project-1', 'app');
    const deps = {
      runtime: {} as RuntimeBackend,
      db: {
        updateProject: vi.fn(async () => undefined),
        getService: vi.fn(async () => undefined),
        getDeployableForProject: vi.fn(async () => undefined),
      } as unknown as Database,
      env: {
        getGlobalSecrets: vi.fn(async () => ({})),
        getAllWithInheritance: vi.fn(async () => ({})),
        getAllForService: vi.fn(async () => ({})),
      } as unknown as EnvManager,
      buildExecutor: {
        build: vi.fn(async (_context, onProgress?: (line: string) => void) => {
          onProgress?.('#7 [2/4] RUN npm ci');
          onProgress?.('#7 DONE 12.4s');
        }),
      },
      jobManager,
    } as unknown as DeployOrchestrationDeps;

    const result = await buildProject(deps, {
      projectId: 'project-1',
      environmentId: 'environment-1',
      routeName: 'app',
      trigger: 'api',
      imageTag: 'openlander/app:latest',
      repoUrl: 'https://example.invalid/app.git',
      startTime: Date.now(),
      shouldSyncProjectState: true,
      config: { source: 'git' },
      clonePath,
      commitSha: 'abc123',
      sourceRevisionChanged: true,
      buildLog: '[clone] Done\n',
    });

    expect(result.type).toBe('docker');
    expect(result.buildLog).toContain(
      '--- Docker build output ---\n#7 [2/4] RUN npm ci\n#7 DONE 12.4s\n',
    );
    expect(jobManager.getStatus('project-1')).toMatchObject({
      phase: 'building',
      buildLogTail: '#7 [2/4] RUN npm ci\n#7 DONE 12.4s',
      buildStep: 2,
      buildStepTotal: 4,
    });
  });
});
