import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../../src/db/index.js';
import { _resetCachedKey, decrypt, encrypt } from '../../src/env/crypto.js';
import { EnvManager } from '../../src/pipeline/env.js';

function setEncryptedGlobalSecret(db: Database, key: string, value: string): void {
  const payload = encrypt(value);
  db.setGlobalSecret(key, payload.encrypted, payload.iv);
}

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

describe('env merge precedence characterization', () => {
  let tmpDir: string;
  let db: Database;
  let env: EnvManager;
  let previousMasterKey: string | undefined;

  beforeEach(() => {
    previousMasterKey = process.env['OPENLANDER_MASTER_KEY'];
    process.env['OPENLANDER_MASTER_KEY'] = 'a'.repeat(64);
    _resetCachedKey();

    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-env-merge-precedence-'));
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

  it('getMergedForDeploy uses project over global for same key', () => {
    const projectId = 'p-merged';
    createProjectWithDevelopmentEnvironment(db, projectId);
    setEncryptedGlobalSecret(db, 'TEST_KEY', 'global');
    env.set(projectId, 'TEST_KEY', 'project');

    const stored = db.getGlobalSecret('TEST_KEY');
    expect(stored).toBeDefined();
    expect(decrypt(stored!.encrypted_value, stored!.iv)).toBe('global');

    const merged = env.getMergedForDeploy(projectId);
    expect(merged['TEST_KEY']).toBe('project');
  });

  it('getAllWithInheritance uses environment over production over project', () => {
    const projectId = 'p-inheritance';
    const { productionEnvironmentId, environmentId } = createProjectWithDevelopmentEnvironment(
      db,
      projectId,
    );

    env.set(projectId, 'SHARED', 'project');
    env.set(projectId, 'SHARED', 'prod', productionEnvironmentId);
    env.set(projectId, 'SHARED', 'env', environmentId);

    const inherited = env.getAllWithInheritance(projectId, environmentId);
    expect(inherited['SHARED']).toBe('env');
  });

  it('getInheritanceInfo marks source and override for multi-layer keys', () => {
    const projectId = 'p-source';
    const { productionEnvironmentId, environmentId } = createProjectWithDevelopmentEnvironment(
      db,
      projectId,
    );

    setEncryptedGlobalSecret(db, 'GLOBAL_ONLY', 'global-value');
    setEncryptedGlobalSecret(db, 'OVERRIDE_KEY', 'global');
    env.set(projectId, 'PROJECT_ONLY', 'project-value');
    env.set(projectId, 'OVERRIDE_KEY', 'project');
    env.set(projectId, 'PROD_ONLY', 'production-value', productionEnvironmentId);
    env.set(projectId, 'OVERRIDE_KEY', 'production', productionEnvironmentId);
    env.set(projectId, 'ENV_ONLY', 'environment-value', environmentId);
    env.set(projectId, 'OVERRIDE_KEY', 'environment', environmentId);

    const info = env.getInheritanceInfo(projectId, environmentId);

    expect(info['GLOBAL_ONLY']).toEqual({ value: 'global-value', source: 'global' });
    expect(info['PROJECT_ONLY']).toEqual({ value: 'project-value', source: 'project' });
    expect(info['PROD_ONLY']).toEqual({ value: 'production-value', source: 'production' });
    expect(info['ENV_ONLY']).toEqual({
      value: 'environment-value',
      source: 'environment',
      isOverride: false,
    });
    expect(info['OVERRIDE_KEY']).toEqual({
      value: 'environment',
      source: 'environment',
      isOverride: true,
    });
  });

  it('captures deploy-core spread precedence where DB merged overrides inline config', () => {
    const projectId = 'p-deploy-core';
    createProjectWithDevelopmentEnvironment(db, projectId);
    setEncryptedGlobalSecret(db, 'TEST_KEY', 'global');
    env.set(projectId, 'TEST_KEY', 'project');

    const inlineConfigEnv = { TEST_KEY: 'inline', INLINE_ONLY: 'inline-only' };
    const allEnvVarsForBuild = {
      ...inlineConfigEnv,
      ...env.getMergedForDeploy(projectId),
    };

    expect(allEnvVarsForBuild['TEST_KEY']).toBe('project');
    expect(allEnvVarsForBuild['INLINE_ONLY']).toBe('inline-only');
  });

  it('captures monorepo and executePlan spread precedence behavior', () => {
    const projectId = 'p-monorepo';
    createProjectWithDevelopmentEnvironment(db, projectId);
    setEncryptedGlobalSecret(db, 'SHARED', 'global');
    env.set(projectId, 'SHARED', 'project');

    const inlineConfigEnv = { SHARED: 'inline', INLINE_ONLY: 'inline-only' };
    const serviceEnv = { SHARED: 'service', SERVICE_ONLY: 'service-only' };

    const monorepoEnv = {
      ...inlineConfigEnv,
      ...serviceEnv,
      ...env.getMergedForDeploy(projectId),
    };

    expect(monorepoEnv['SHARED']).toBe('project');
    expect(monorepoEnv['INLINE_ONLY']).toBe('inline-only');
    expect(monorepoEnv['SERVICE_ONLY']).toBe('service-only');

    const executePlanMerged = {
      ...{ TEST_KEY: 'auto', AUTO_ONLY: 'auto-only' },
      ...{ TEST_KEY: 'provided', PROVIDED_ONLY: 'provided-only' },
    };

    expect(executePlanMerged['TEST_KEY']).toBe('provided');
    expect(executePlanMerged['AUTO_ONLY']).toBe('auto-only');
    expect(executePlanMerged['PROVIDED_ONLY']).toBe('provided-only');
  });

  it('keeps layer isolation when only one layer defines a key', () => {
    const projectId = 'p-isolation';
    const { productionEnvironmentId, environmentId } = createProjectWithDevelopmentEnvironment(
      db,
      projectId,
    );

    setEncryptedGlobalSecret(db, 'GLOBAL_ONLY', 'global');
    expect(env.getMergedForDeploy(projectId)['GLOBAL_ONLY']).toBe('global');

    env.deleteGlobalSecret('GLOBAL_ONLY');
    env.set(projectId, 'PROJECT_ONLY', 'project');
    expect(env.getMergedForDeploy(projectId)['PROJECT_ONLY']).toBe('project');

    env.set(projectId, 'PRODUCTION_ONLY', 'prod', productionEnvironmentId);
    expect(env.getAllWithInheritance(projectId, productionEnvironmentId)['PRODUCTION_ONLY']).toBe(
      'prod',
    );

    env.set(projectId, 'ENV_ONLY', 'env', environmentId);
    expect(env.getAllWithInheritance(projectId, environmentId)['ENV_ONLY']).toBe('env');

    const serviceOnly = {
      ...{},
      ...{ SERVICE_ONLY: 'service' },
      ...{},
    };
    expect(serviceOnly['SERVICE_ONLY']).toBe('service');

    const inlineOnly = {
      ...{ INLINE_ONLY: 'inline' },
      ...{},
    };
    expect(inlineOnly['INLINE_ONLY']).toBe('inline');
  });

  it('merges unique keys from all layers without collisions', () => {
    const projectId = 'p-unique';
    const { productionEnvironmentId, environmentId } = createProjectWithDevelopmentEnvironment(
      db,
      projectId,
    );

    setEncryptedGlobalSecret(db, 'GLOBAL_UNIQUE', 'global');
    env.set(projectId, 'PROJECT_UNIQUE', 'project');
    env.set(projectId, 'PROD_UNIQUE', 'prod', productionEnvironmentId);
    env.set(projectId, 'ENV_UNIQUE', 'env', environmentId);

    const mergedFromDb = env.getMergedForDeploy(projectId, environmentId);
    const combined = {
      ...{ INLINE_UNIQUE: 'inline' },
      ...{ SERVICE_UNIQUE: 'service' },
      ...mergedFromDb,
    };

    expect(combined).toEqual({
      INLINE_UNIQUE: 'inline',
      SERVICE_UNIQUE: 'service',
      GLOBAL_UNIQUE: 'global',
      PROJECT_UNIQUE: 'project',
      PROD_UNIQUE: 'prod',
      ENV_UNIQUE: 'env',
    });
  });
});
