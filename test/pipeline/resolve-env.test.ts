import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '../../src/db/index.js';
import { _resetCachedKey } from '../../src/env/crypto.js';
import { EnvManager } from '../../src/pipeline/env.js';
import { resolveEnvVars, resolveEnvVarsForBuild } from '../../src/pipeline/resolve-env.js';

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

describe('resolveEnvVars', () => {
  let tmpDir: string;
  let db: Database;
  let env: EnvManager;
  let previousMasterKey: string | undefined;

  beforeEach(() => {
    previousMasterKey = process.env['OPENLANDER_MASTER_KEY'];
    process.env['OPENLANDER_MASTER_KEY'] = 'a'.repeat(64);
    _resetCachedKey();

    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-resolve-env-'));
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

  it('applies 7-layer precedence with inline env vars as highest priority', () => {
    const projectId = 'p-precedence';
    const { productionEnvironmentId, environmentId } = createProjectWithDevelopmentEnvironment(
      db,
      projectId,
    );

    env.setGlobalSecret('TEST_KEY', 'global');
    env.set(projectId, 'TEST_KEY', 'project');
    env.set(projectId, 'TEST_KEY', 'production', productionEnvironmentId);
    env.set(projectId, 'TEST_KEY', 'environment', environmentId);

    const resolved = resolveEnvVars(
      {
        projectId,
        environmentId,
        autoEnvVars: { TEST_KEY: 'auto' },
        serviceEnvVars: { TEST_KEY: 'service' },
        inlineEnvVars: { TEST_KEY: 'inline' },
      },
      { env },
    );

    expect(resolved['TEST_KEY']).toBe('inline');
  });

  it('keeps each layer value when keys do not collide', () => {
    const projectId = 'p-isolation';
    const { productionEnvironmentId, environmentId } = createProjectWithDevelopmentEnvironment(
      db,
      projectId,
    );

    env.setGlobalSecret('GLOBAL_ONLY', 'global');
    env.set(projectId, 'PROJECT_ONLY', 'project');
    env.set(projectId, 'PRODUCTION_ONLY', 'production', productionEnvironmentId);
    env.set(projectId, 'ENVIRONMENT_ONLY', 'environment', environmentId);

    const resolved = resolveEnvVars(
      {
        projectId,
        environmentId,
        autoEnvVars: { AUTO_ONLY: 'auto' },
        serviceEnvVars: { SERVICE_ONLY: 'service' },
        inlineEnvVars: { INLINE_ONLY: 'inline' },
      },
      { env },
    );

    expect(resolved).toMatchObject({
      AUTO_ONLY: 'auto',
      GLOBAL_ONLY: 'global',
      PROJECT_ONLY: 'project',
      PRODUCTION_ONLY: 'production',
      ENVIRONMENT_ONLY: 'environment',
      SERVICE_ONLY: 'service',
      INLINE_ONLY: 'inline',
    });
  });

  it('skips environment-specific layers when environmentId is missing', () => {
    const projectId = 'p-missing-env';
    createProjectWithDevelopmentEnvironment(db, projectId);

    env.setGlobalSecret('GLOBAL_ONLY', 'global');
    env.set(projectId, 'PROJECT_ONLY', 'project');
    env.set(projectId, 'PRODUCTION_ONLY', 'production', `${projectId}-production`);

    const resolved = resolveEnvVars({ projectId }, { env });

    expect(resolved).toEqual({
      GLOBAL_ONLY: 'global',
      PROJECT_ONLY: 'project',
    });
  });

  it('filters resolved vars to build-time prefixes', () => {
    const projectId = 'p-build-filter';
    const { environmentId } = createProjectWithDevelopmentEnvironment(db, projectId);

    env.set(projectId, 'DATABASE_URL', 'project-db-url');
    env.set(projectId, 'NEXT_PUBLIC_API_URL', 'project-public-url');

    const filtered = resolveEnvVarsForBuild(
      {
        projectId,
        environmentId,
        autoEnvVars: {
          REACT_APP_THEME: 'light',
          SECRET_KEY: 'auto-secret',
        },
        serviceEnvVars: {
          VITE_REGION: 'kr',
        },
        inlineEnvVars: {
          NEXT_PUBLIC_API_URL: 'inline-public-url',
          INTERNAL_TOKEN: 'inline-token',
        },
      },
      { env },
    );

    expect(filtered).toEqual({
      REACT_APP_THEME: 'light',
      NEXT_PUBLIC_API_URL: 'inline-public-url',
      VITE_REGION: 'kr',
    });
  });

  it('returns empty object when every layer is empty', () => {
    const resolved = resolveEnvVars({ projectId: 'p-empty' }, { env });
    expect(resolved).toEqual({});
  });
});
