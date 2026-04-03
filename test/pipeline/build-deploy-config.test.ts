import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Database } from '../../src/db/index.js';
import { buildDeployConfig } from '../../src/pipeline/build-deploy-config.js';
import { CONFIG_VERSION, serializeConfig } from '../../src/pipeline/config-snapshot.js';

describe('buildDeployConfig', () => {
  let tempDir: string;
  let db: Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openlander-build-deploy-config-'));
    db = new Database(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('applies precedence runtime > DB columns > stored snapshot', () => {
    db.createProject({
      id: 'p1',
      name: 'api-service',
      repoUrl: 'https://github.com/example/repo',
      branch: 'main',
      dockerfilePath: 'apps/api/Dockerfile',
      dockerTarget: 'db-target',
      buildContext: 'apps/api',
    });

    db.saveDeployConfig(
      'p1',
      serializeConfig({
        dockerTarget: 'stored-target',
        buildContext: 'stored-context',
        preferDockerfile: false,
      }),
      CONFIG_VERSION,
    );

    const config = buildDeployConfig({
      projectId: 'p1',
      db,
      runtimeOverrides: {
        dockerTarget: 'runtime-target',
        _noCacheBuild: true,
      },
    });

    expect(config.dockerTarget).toBe('runtime-target');
    expect(config.buildContext).toBe('apps/api');
    expect(config.preferDockerfile).toBe(true);
    expect(config._noCacheBuild).toBe(true);
  });

  it('matches redeploy fallback behavior when no stored snapshot exists', () => {
    db.createProject({
      id: 'p2',
      name: 'fallback-app',
      repoUrl: 'https://github.com/example/fallback',
      branch: 'develop',
      dockerfilePath: 'Dockerfile',
      dockerTarget: 'production',
      buildContext: '',
    });
    db.updateProject('p2', {
      visibility: 'shared',
      buildMethod: 'dockerfile',
      assignedPort: 4100,
    });

    const config = buildDeployConfig({
      projectId: 'p2',
      db,
      runtimeOverrides: {
        _noCacheBuild: true,
      },
    });

    expect(config).toEqual({
      repoUrl: 'https://github.com/example/fallback',
      branch: 'develop',
      name: 'fallback-app',
      visibility: 'shared',
      source: 'git',
      imageUrl: undefined,
      imageCmd: undefined,
      containerPort: undefined,
      dockerTarget: 'production',
      dockerfilePath: undefined,
      buildContext: '',
      preferDockerfile: true,
      _projectId: 'p2',
      _preferredPort: 4100,
      _noCacheBuild: true,
    });
  });

  it('omits dockerTarget and dockerfilePath for compose projects', () => {
    db.createProject({
      id: 'p3',
      name: 'compose-app',
      repoUrl: 'https://github.com/example/compose',
      branch: 'main',
      dockerfilePath: 'apps/web/Dockerfile',
      dockerTarget: 'web',
      buildContext: 'apps/web',
    });
    db.updateProject('p3', {
      buildMethod: 'compose',
    });

    const config = buildDeployConfig({
      projectId: 'p3',
      db,
    });

    expect(config.dockerTarget).toBeUndefined();
    expect(config.dockerfilePath).toBeUndefined();
    expect(config.preferDockerfile).toBe(false);
  });

  it('restores sshKeyPath and composeServices from stored snapshot', () => {
    db.createProject({
      id: 'p4',
      name: 'private-compose',
      repoUrl: 'https://github.com/example/private-compose',
      branch: 'main',
    });

    db.saveDeployConfig(
      'p4',
      serializeConfig({
        sshKeyPath: '/home/user/.ssh/id_rsa',
        composeServices: ['web', 'worker'],
      }),
      CONFIG_VERSION,
    );

    const config = buildDeployConfig({
      projectId: 'p4',
      db,
    });

    expect(config.sshKeyPath).toBe('/home/user/.ssh/id_rsa');
    expect(config.composeServices).toEqual(['web', 'worker']);
  });

  it('lets runtime visibility override DB visibility', () => {
    db.createProject({
      id: 'p5',
      name: 'visibility-app',
      repoUrl: 'https://github.com/example/visibility',
      branch: 'main',
    });
    db.updateProject('p5', {
      visibility: 'internal',
    });

    const config = buildDeployConfig({
      projectId: 'p5',
      db,
      runtimeOverrides: {
        visibility: 'production',
      },
    });

    expect(config.visibility).toBe('production');
  });

  it('throws when the project does not exist', () => {
    expect(() => {
      buildDeployConfig({
        projectId: 'missing-project',
        db,
      });
    }).toThrow('Project not found: missing-project');
  });

  it('BUG-005: respects dockerfile_path from DB config over stored snapshot', () => {
    db.createProject({
      id: 'p6',
      name: 'dockerfile-override-app',
      repoUrl: 'https://github.com/example/dockerfile-override',
      branch: 'main',
      dockerfilePath: 'worker/Dockerfile',
    });

    // Simulate a previous deploy with a different dockerfile path stored in snapshot
    db.saveDeployConfig(
      'p6',
      serializeConfig({
        dockerfilePath: 'api/Dockerfile',
      }),
      CONFIG_VERSION,
    );

    // User updates the project config to use a new dockerfile path
    db.updateProject('p6', {
      dockerfilePath: 'worker/Dockerfile',
    });

    const config = buildDeployConfig({
      projectId: 'p6',
      db,
    });

    // DB config (worker/Dockerfile) should take precedence over stored snapshot (api/Dockerfile)
    expect(config.dockerfilePath).toBe('worker/Dockerfile');
  });
});
