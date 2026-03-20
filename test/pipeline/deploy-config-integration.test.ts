import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _resetCachedKey } from '../../src/env/crypto.js';
import { Database } from '../../src/db/index.js';
import { buildDeployConfig } from '../../src/pipeline/build-deploy-config.js';
import { persistDeployConfig } from '../../src/pipeline/config-snapshot.js';
import { EnvManager } from '../../src/pipeline/env.js';
import { resolveEnvVars } from '../../src/pipeline/resolve-env.js';

function createProjectWithDevelopmentEnvironment(
  db: Database,
  projectId: string,
): { productionEnvironmentId: string; environmentId: string } {
  db.createProject({
    id: projectId,
    name: projectId,
    repoUrl: `https://github.com/example/${projectId}`,
    branch: 'main',
  });

  const production = db
    .getEnvironmentsByProject(projectId)
    .find((environment) => environment.type === 'production');
  if (!production) {
    throw new Error('production environment not created');
  }

  const environmentId = `${projectId}-development`;
  db.createEnvironment({
    id: environmentId,
    projectId,
    type: 'development',
    branch: 'develop',
  });

  return {
    productionEnvironmentId: production.id,
    environmentId,
  };
}

describe('deploy config integration lifecycle', () => {
  let tmpDir: string;
  let db: Database;
  let env: EnvManager;
  let previousMasterKey: string | undefined;

  beforeEach(() => {
    previousMasterKey = process.env['OPENLANDER_MASTER_KEY'];
    process.env['OPENLANDER_MASTER_KEY'] = 'a'.repeat(64);
    _resetCachedKey();

    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-deploy-config-integration-'));
    db = new Database(join(tmpDir, 'test.db'));
    env = new EnvManager(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });

    if (previousMasterKey === undefined) {
      delete process.env['OPENLANDER_MASTER_KEY'];
    } else {
      process.env['OPENLANDER_MASTER_KEY'] = previousMasterKey;
    }
    _resetCachedKey();
  });

  it('full lifecycle restores stored config for docker projects', () => {
    db.createProject({
      id: 'docker-p1',
      name: 'docker-service',
      repoUrl: 'https://github.com/example/docker-service',
      branch: 'main',
      dockerTarget: 'runtime',
    });

    persistDeployConfig({
      projectId: 'docker-p1',
      db,
      config: {
        repoUrl: 'https://github.com/override/ignored',
        branch: 'feature',
        sshKeyPath: '/home/.ssh/key',
        composeServices: ['web'],
      },
    });

    const config = buildDeployConfig({ projectId: 'docker-p1', db });

    expect(config.sshKeyPath).toBe('/home/.ssh/key');
    expect(config.composeServices).toEqual(['web']);
    expect(config.repoUrl).toBe('https://github.com/example/docker-service');
    expect(config.branch).toBe('main');
  });

  it('full lifecycle restores compose services for compose projects', () => {
    db.createProject({
      id: 'compose-p1',
      name: 'compose-service',
      repoUrl: 'https://github.com/example/compose-service',
      branch: 'develop',
      dockerTarget: 'should-be-ignored',
    });
    db.updateProject('compose-p1', {
      buildMethod: 'compose',
    });

    persistDeployConfig({
      projectId: 'compose-p1',
      db,
      config: {
        repoUrl: 'https://github.com/example/compose-service',
        branch: 'develop',
        composeServices: ['web', 'api'],
        environment: 'production',
      },
    });

    const config = buildDeployConfig({ projectId: 'compose-p1', db });

    expect(config.composeServices).toEqual(['web', 'api']);
    expect(config.environment).toBe('production');
    expect(config.dockerTarget).toBeUndefined();
  });

  it('falls back to DB-only config when deploy_configs does not exist', () => {
    db.createProject({
      id: 'fallback-p1',
      name: 'fallback-app',
      repoUrl: 'https://github.com/example/fallback-app',
      branch: 'release',
    });

    const config = buildDeployConfig({ projectId: 'fallback-p1', db });

    expect(config.sshKeyPath).toBeUndefined();
    expect(config.repoUrl).toBe('https://github.com/example/fallback-app');
    expect(config.branch).toBe('release');
    expect(config.name).toBe('fallback-app');
  });

  it('ignores corrupt deploy config JSON and safely falls back', () => {
    db.createProject({
      id: 'corrupt-p1',
      name: 'corrupt-app',
      repoUrl: 'https://github.com/example/corrupt-app',
      branch: 'main',
    });
    db.saveDeployConfig('corrupt-p1', 'not valid json', 1);

    expect(() => buildDeployConfig({ projectId: 'corrupt-p1', db })).not.toThrow();
    const config = buildDeployConfig({ projectId: 'corrupt-p1', db });

    expect(config.sshKeyPath).toBeUndefined();
    expect(config.repoUrl).toBe('https://github.com/example/corrupt-app');
  });

  it('gives runtime overrides final precedence over stored and DB config', () => {
    db.createProject({
      id: 'override-p1',
      name: 'override-app',
      repoUrl: 'https://github.com/example/override-app',
      branch: 'main',
    });
    db.updateProject('override-p1', {
      visibility: 'internal',
    });

    persistDeployConfig({
      projectId: 'override-p1',
      db,
      config: {
        repoUrl: 'https://github.com/example/override-app',
        visibility: 'internal',
      },
    });

    const runtimeOverrides = {
      visibility: 'public',
    } as unknown as NonNullable<Parameters<typeof buildDeployConfig>[0]['runtimeOverrides']>;

    const config = buildDeployConfig({
      projectId: 'override-p1',
      db,
      runtimeOverrides,
    });

    expect(config.visibility).toBe('public');
  });

  it('resolveEnvVars merges 7 layers with deterministic priority', () => {
    const projectId = 'env-p1';
    const { productionEnvironmentId, environmentId } = createProjectWithDevelopmentEnvironment(
      db,
      projectId,
    );

    env.setGlobalSecret('PRIORITY_KEY', 'global');
    env.setGlobalSecret('PROJECT_BEATS_GLOBAL', 'global-value');
    env.set(projectId, 'PRIORITY_KEY', 'project');
    env.set(projectId, 'PROJECT_BEATS_GLOBAL', 'project-value');
    env.set(projectId, 'PRIORITY_KEY', 'production', productionEnvironmentId);
    env.set(projectId, 'PRIORITY_KEY', 'environment', environmentId);

    const resolved = resolveEnvVars(
      {
        projectId,
        environmentId,
        autoEnvVars: { PRIORITY_KEY: 'auto' },
        serviceEnvVars: { PRIORITY_KEY: 'service' },
        inlineEnvVars: { PRIORITY_KEY: 'inline' },
      },
      { env },
    );

    expect(resolved['PRIORITY_KEY']).toBe('inline');
    expect(resolved['PROJECT_BEATS_GLOBAL']).toBe('project-value');
  });
});
