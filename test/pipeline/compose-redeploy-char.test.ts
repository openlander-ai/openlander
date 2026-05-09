import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { DeployPipeline } from '../../src/pipeline/deploy.js';
import { Database } from '../../src/db/index.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import type { Docker } from '../../src/pipeline/docker.js';
import type { ProjectConfig } from '../../src/pipeline/deploy-core.js';
import { clearPortScanCache } from '../../src/pipeline/port.js';
import * as gitPipeline from '../../src/pipeline/git.js';
import * as dockerfileGen from '../../src/pipeline/dockerfile-gen.js';
import { createMockDocker } from '../helpers/docker-mocks.js';

describe('compose project redeploy characterization', () => {
  let tmpDir: string;
  let clonePath: string;
  let db: Database;
  let docker: Docker;
  let pipeline: DeployPipeline;
  let deploySpy: ReturnType<typeof vi.spyOn>;
  let cloneRepoSpy: ReturnType<typeof vi.spyOn>;
  let ensureDockerfileSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-compose-redeploy-char-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(
      join(clonePath, 'docker-compose.yml'),
      `version: '3.8'
services:
  web:
    image: node:20
    ports:
      - "3000:3000"
  api:
    image: node:20
    ports:
      - "3001:3001"
`,
      'utf8',
    );

    db = new Database(join(tmpDir, 'test.db'));
    docker = createMockDocker();
    docker.cleanupSecretFiles = vi.fn();
    const env = {
      getAll: vi.fn().mockReturnValue({}),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    };
    const testConfig = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;
    pipeline = new DeployPipeline(docker, db, env as never, testConfig);

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

    // Spy on deploy() to capture the config passed to it
    deploySpy = vi.spyOn(pipeline, 'deploy');
    deploySpy.mockResolvedValue({
      success: true,
      projectId: 'p1',
      projectName: 'test-project',
      commitSha: 'deadbeefcafebabe',
      imageTag: 'test-project:deadbeef',
      assignedPort: 3000,
      publicUrl: 'http://localhost:3000',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearPortScanCache();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('scenario 1: compose project redeploy loses composeServices (gap documentation)', async () => {
    // Create a compose project with composeServices specified
    db.createProject({
      id: 'p1',
      name: 'compose-app',
      repoUrl: 'https://github.com/example/compose-app',
      branch: 'main',
      dockerfilePath: 'docker-compose.yml',
    });
    db.updateProject('p1', {
      buildMethod: 'compose',
    });

    // Call redeploy
    const result = await pipeline.redeploy('p1');

    // Verify redeploy succeeded
    expect(result.success).toBe(true);
    expect(result.projectId).toBe('p1');

    // Capture the config passed to deploy()
    expect(deploySpy).toHaveBeenCalledOnce();
    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: composeServices is NOT reconstructed (gap in redeploy)
    // Even if the original deploy had composeServices=['web', 'api'],
    // redeploy() does not pass them through
    expect(capturedConfig.composeServices).toBeUndefined();
  });

  it('scenario 2: compose project redeploy sets preferDockerfile=false', async () => {
    // Create a compose project
    db.createProject({
      id: 'p2',
      name: 'compose-app',
      repoUrl: 'https://github.com/example/compose-app',
      branch: 'develop',
      dockerfilePath: 'docker-compose.yml',
    });
    db.updateProject('p2', {
      buildMethod: 'compose',
    });

    // Call redeploy
    const result = await pipeline.redeploy('p2');

    expect(result.success).toBe(true);

    // Capture the config
    expect(deploySpy).toHaveBeenCalledOnce();
    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: preferDockerfile is false for compose projects
    // This is set by: preferDockerfile: !isCompose (line 1539 in deploy-core.ts)
    expect(capturedConfig.preferDockerfile).toBe(false);
  });

  it('scenario 3: compose project redeploy does not reconstruct service filtering', async () => {
    // Create a compose project
    db.createProject({
      id: 'p3',
      name: 'compose-app',
      repoUrl: 'https://github.com/example/compose-app',
      branch: 'main',
      dockerfilePath: 'docker-compose.yml',
    });
    db.updateProject('p3', {
      buildMethod: 'compose',
    });

    // Call redeploy
    const result = await pipeline.redeploy('p3');

    expect(result.success).toBe(true);

    // Capture the config
    expect(deploySpy).toHaveBeenCalledOnce();
    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: composeServices is undefined (same as scenario 1)
    // This documents that service filtering (profiles + services) is lost on redeploy
    // The original deploy may have used profiles and services filtering (lines 684-685 in deploy-core.ts),
    // but redeploy() does not reconstruct them
    expect(capturedConfig.composeServices).toBeUndefined();
  });

  it('scenario 4: compose project redeploy preserves basic fields', async () => {
    // Create a compose project with all basic fields
    db.createProject({
      id: 'p4',
      name: 'multi-service-app',
      repoUrl: 'https://github.com/example/multi-service',
      branch: 'staging',
      dockerfilePath: 'docker-compose.yml',
      buildContext: '/some/context',
    });
    db.updateProject('p4', {
      visibility: 'shared',
      buildMethod: 'compose',
    });

    // Call redeploy
    const result = await pipeline.redeploy('p4');

    expect(result.success).toBe(true);

    // Capture the config
    expect(deploySpy).toHaveBeenCalledOnce();
    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: Basic fields are preserved
    expect(capturedConfig.repoUrl).toBe('https://github.com/example/multi-service');
    expect(capturedConfig.branch).toBe('staging');
    expect(capturedConfig.name).toBe('multi-service-app');
    expect(capturedConfig.visibility).toBe('shared');
    // buildContext is preserved (line 1538 in deploy-core.ts)
    expect(capturedConfig.buildContext).toBe('/some/context');
  });

  it('scenario 5: compose project redeploy excludes dockerTarget', async () => {
    // Create a compose project with dockerTarget (should be ignored for compose)
    db.createProject({
      id: 'p5',
      name: 'compose-app',
      repoUrl: 'https://github.com/example/compose-app',
      branch: 'main',
      dockerfilePath: 'docker-compose.yml',
      dockerTarget: 'production',
    });
    db.updateProject('p5', {
      buildMethod: 'compose',
    });

    // Call redeploy
    const result = await pipeline.redeploy('p5');

    expect(result.success).toBe(true);

    // Capture the config
    expect(deploySpy).toHaveBeenCalledOnce();
    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: dockerTarget is undefined for compose (line 1536: isCompose ? undefined : ...)
    expect(capturedConfig.dockerTarget).toBeUndefined();
  });

  it('scenario 6: compose project redeploy preserves port from previous deployment', async () => {
    // Create a compose project and simulate a previous deployment with assigned port
    db.createProject({
      id: 'p6',
      name: 'compose-app',
      repoUrl: 'https://github.com/example/compose-app',
      branch: 'main',
      dockerfilePath: 'docker-compose.yml',
    });
    db.updateProject('p6', {
      buildMethod: 'compose',
      assignedPort: 5432,
    });

    // Call redeploy
    const result = await pipeline.redeploy('p6');

    expect(result.success).toBe(true);

    // Capture the config
    expect(deploySpy).toHaveBeenCalledOnce();
    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: _preferredPort is set to the previous port (line 1541 in deploy-core.ts)
    expect(capturedConfig._preferredPort).toBe(5432);
  });
});
