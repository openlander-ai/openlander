import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../src/db/index.js';
import { EnvManager } from '../src/pipeline/env.js';

describe('EnvManager environment inheritance', () => {
  let db: Database;
  let env: EnvManager;
  let tmpDir: string;
  let productionEnvironmentId: string;
  let developmentEnvironmentId: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-env-manager-environments-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    env = new EnvManager(db);

    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });

    const production = db.getEnvironmentsByProject('p1').find((item) => item.type === 'production');
    if (!production) {
      throw new Error('production environment was not created');
    }
    productionEnvironmentId = production.id;

    db.createEnvironment({
      id: 'p1-development',
      projectId: 'p1',
      type: 'development',
      branch: 'develop',
    });
    developmentEnvironmentId = 'p1-development';
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('supports project scope and environment scope through getAll(projectId, environmentId?)', () => {
    env.set('p1', 'PROJECT_ONLY', 'project-value');
    env.set('p1', 'PRODUCTION_ONLY', 'production-value', productionEnvironmentId);
    env.set('p1', 'DEVELOPMENT_ONLY', 'dev-value', developmentEnvironmentId);

    expect(env.getAll('p1')).toEqual({ PROJECT_ONLY: 'project-value' });
    expect(env.getAll('p1', productionEnvironmentId)).toEqual({
      PRODUCTION_ONLY: 'production-value',
    });
    expect(env.getAll('p1', developmentEnvironmentId)).toEqual({
      DEVELOPMENT_ONLY: 'dev-value',
    });
  });

  it('returns production base + environment overrides via getAllWithInheritance', () => {
    env.set('p1', 'LEGACY_BASE', 'project-base');
    env.set('p1', 'SHARED_KEY', 'production-value', productionEnvironmentId);
    env.set('p1', 'PRODUCTION_ONLY', 'prod-only', productionEnvironmentId);
    env.set('p1', 'SHARED_KEY', 'development-override', developmentEnvironmentId);
    env.set('p1', 'DEVELOPMENT_ONLY', 'dev-only', developmentEnvironmentId);

    expect(env.getAllWithInheritance('p1', productionEnvironmentId)).toEqual({
      LEGACY_BASE: 'project-base',
      SHARED_KEY: 'production-value',
      PRODUCTION_ONLY: 'prod-only',
    });

    expect(env.getAllWithInheritance('p1', developmentEnvironmentId)).toEqual({
      LEGACY_BASE: 'project-base',
      SHARED_KEY: 'development-override',
      PRODUCTION_ONLY: 'prod-only',
      DEVELOPMENT_ONLY: 'dev-only',
    });
  });

  it('supports setBulk(projectId, vars, environmentId?) and keeps project behavior when omitted', () => {
    expect(env.setBulk('p1', { A: '1', B: '2' })).toBe(true);
    expect(env.setBulk('p1', { A: '1', B: '2' })).toBe(false);
    expect(env.getAll('p1')).toEqual({ A: '1', B: '2' });

    expect(env.setBulk('p1', { B: '2-env', C: '3-env' }, developmentEnvironmentId)).toBe(true);
    expect(env.setBulk('p1', { B: '2-env', C: '3-env' }, developmentEnvironmentId)).toBe(false);
    expect(env.getAll('p1', developmentEnvironmentId)).toEqual({ B: '2-env', C: '3-env' });
  });

  it('keeps getMergedForDeploy backward compatible and supports environment inheritance', () => {
    env.setGlobalSecret('GLOBAL_ONLY', 'global-value');
    env.set('p1', 'APP_MODE', 'project-mode');
    env.set('p1', 'API_URL', 'https://prod.example.com', productionEnvironmentId);
    env.set('p1', 'API_URL', 'https://dev.example.com', developmentEnvironmentId);

    expect(env.getMergedForDeploy('p1')).toEqual({
      GLOBAL_ONLY: 'global-value',
      APP_MODE: 'project-mode',
    });

    expect(env.getMergedForDeploy('p1', developmentEnvironmentId)).toEqual({
      GLOBAL_ONLY: 'global-value',
      APP_MODE: 'project-mode',
      API_URL: 'https://dev.example.com',
    });
  });

  it('returns source metadata with global, project, and environment labels', () => {
    env.setGlobalSecret('GLOBAL_ONLY', 'global-value');
    env.set('p1', 'PROJECT_ONLY', 'project-value');
    env.set('p1', 'PRODUCTION_ONLY', 'production-value', productionEnvironmentId);
    env.set('p1', 'SHARED_KEY', 'production-shared', productionEnvironmentId);
    env.set('p1', 'SHARED_KEY', 'development-shared', developmentEnvironmentId);

    expect(env.getInheritanceInfo('p1', developmentEnvironmentId)).toEqual({
      GLOBAL_ONLY: { value: 'global-value', source: 'global' },
      PROJECT_ONLY: { value: 'project-value', source: 'project' },
      PRODUCTION_ONLY: { value: 'production-value', source: 'production' },
      SHARED_KEY: { value: 'development-shared', source: 'environment', isOverride: true },
    });
  });
});
