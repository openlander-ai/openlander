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

describe('redeploy() config reconstruction characterization', () => {
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
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-redeploy-char-'));
    clonePath = join(tmpDir, 'repo');
    mkdirSync(clonePath, { recursive: true });
    writeFileSync(join(clonePath, 'Dockerfile'), 'FROM node:20\nEXPOSE 3000\n', 'utf8');

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

  it('scenario 1: Dockerfile project redeploy preserves and reconstructs config fields', async () => {
    // Create a Dockerfile project with all relevant fields
    db.createProject({
      id: 'p1',
      name: 'backend-service',
      repoUrl: 'https://github.com/example/backend',
      branch: 'main',
      dockerfilePath: 'backend/Dockerfile',
      dockerTarget: 'production',
      buildContext: 'backend',
    });
    db.updateProject('p1', {
      visibility: 'internal',
      buildMethod: 'dockerfile',
    });

    // Call redeploy
    const result = await pipeline.redeploy('p1');

    // Verify redeploy succeeded
    expect(result.success).toBe(true);
    expect(result.projectId).toBe('p1');

    // Capture the config passed to deploy()
    expect(deploySpy).toHaveBeenCalledOnce();
    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: Fields that SHOULD be present (preserved from DB)
    expect(capturedConfig.repoUrl).toBe('https://github.com/example/backend');
    expect(capturedConfig.branch).toBe('main');
    expect(capturedConfig.name).toBe('backend-service');
    expect(capturedConfig.visibility).toBe('internal');
    expect(capturedConfig.dockerTarget).toBe('production');
    expect(capturedConfig.dockerfilePath).toBe('backend/Dockerfile');
    expect(capturedConfig.buildContext).toBe('backend');
    expect(capturedConfig.preferDockerfile).toBe(true);

    // Assert: Fields that are NOT reconstructed (gaps in redeploy)
    expect(capturedConfig.sshKeyPath).toBeUndefined();
    expect(capturedConfig.envVars).toBeUndefined();
    expect(capturedConfig.composeServices).toBeUndefined();
    expect(capturedConfig.trigger).toBeUndefined();
  });

  it('scenario 2: Compose project redeploy skips docker-specific fields', async () => {
    // Create a compose project
    db.createProject({
      id: 'p2',
      name: 'compose-app',
      repoUrl: 'https://github.com/example/compose-app',
      branch: 'develop',
      dockerfilePath: '/absolute/path/docker-compose.yml',
      dockerTarget: 'staging',
      buildContext: '/absolute/context',
    });
    db.updateProject('p2', {
      visibility: 'shared',
      buildMethod: 'compose',
    });

    // Call redeploy
    const result = await pipeline.redeploy('p2');

    expect(result.success).toBe(true);

    // Capture the config
    expect(deploySpy).toHaveBeenCalledOnce();
    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: Basic fields are preserved
    expect(capturedConfig.repoUrl).toBe('https://github.com/example/compose-app');
    expect(capturedConfig.branch).toBe('develop');
    expect(capturedConfig.name).toBe('compose-app');
    expect(capturedConfig.visibility).toBe('shared');

    // Assert: Dockerfile-specific fields are skipped for compose
    // dockerTarget is undefined because isCompose=true
    expect(capturedConfig.dockerTarget).toBeUndefined();
    // dockerfilePath is undefined because absolute path fails isValidDockerfilePath check
    expect(capturedConfig.dockerfilePath).toBeUndefined();
    // preferDockerfile is false for compose
    expect(capturedConfig.preferDockerfile).toBe(false);

    // Assert: Gaps remain
    expect(capturedConfig.composeServices).toBeUndefined();
    expect(capturedConfig.sshKeyPath).toBeUndefined();
    expect(capturedConfig.envVars).toBeUndefined();
  });

  it('scenario 3: Non-existent project redeploy returns error', async () => {
    // Call redeploy with non-existent project ID
    const result = await pipeline.redeploy('nonexistent-project-id');

    // Assert: Returns failure with appropriate error message
    expect(result.success).toBe(false);
    expect(result.projectId).toBe('nonexistent-project-id');
    expect(result.projectName).toBe('unknown');
    expect(result.error).toContain('not found');

    // Assert: deploy() was never called
    expect(deploySpy).not.toHaveBeenCalled();
  });

  it('scenario 4: Redeploy with relative dockerfile path (valid) includes it in config', async () => {
    // Create project with valid relative dockerfile path
    db.createProject({
      id: 'p3',
      name: 'monorepo-service',
      repoUrl: 'https://github.com/example/monorepo',
      branch: 'main',
      dockerfilePath: 'services/api/Dockerfile',
      buildContext: 'services/api',
    });
    db.updateProject('p3', {
      buildMethod: 'dockerfile',
    });

    const result = await pipeline.redeploy('p3');
    expect(result.success).toBe(true);

    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: Valid relative path is included
    expect(capturedConfig.dockerfilePath).toBe('services/api/Dockerfile');
    expect(capturedConfig.buildContext).toBe('services/api');
  });

  it('scenario 5: Redeploy with root Dockerfile (invalid) excludes it from config', async () => {
    // Create project with root Dockerfile (fails isValidDockerfilePath check)
    db.createProject({
      id: 'p4',
      name: 'simple-app',
      repoUrl: 'https://github.com/example/simple',
      branch: 'main',
      dockerfilePath: 'Dockerfile',
      buildContext: '',
    });
    db.updateProject('p4', {
      buildMethod: 'dockerfile',
    });

    const result = await pipeline.redeploy('p4');
    expect(result.success).toBe(true);

    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: Root Dockerfile is excluded (isValidDockerfilePath check fails)
    expect(capturedConfig.dockerfilePath).toBeUndefined();
  });

  it('scenario 6: Redeploy preserves port from previous deployment', async () => {
    // Create project and simulate a previous deployment with assigned port
    db.createProject({
      id: 'p5',
      name: 'port-test',
      repoUrl: 'https://github.com/example/port-test',
      branch: 'main',
    });
    db.updateProject('p5', {
      assignedPort: 5432,
    });

    const result = await pipeline.redeploy('p5');
    expect(result.success).toBe(true);

    const capturedConfig = deploySpy.mock.calls[0][0] as ProjectConfig;

    // Assert: _preferredPort is set to the previous port
    expect(capturedConfig._preferredPort).toBe(5432);
  });
});
