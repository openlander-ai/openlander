import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import type { AppContext } from '../../src/app.js';
import { Database } from '../../src/db/index.js';
import { EnvManager } from '../../src/pipeline/env.js';
import { ProjectNotFoundError } from '../../src/errors.js';
import { envToolDefs } from '../../src/tools/defs/env.js';
import { createMockContext } from '../helpers/web-route-mocks.js';

describe('list_env_vars tool with source tracking', () => {
  let db: Database;
  let tmpDir: string;
  let ctx: AppContext;
  let listEnvVarsTool: (typeof envToolDefs)[0];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-env-source-test-'));
    db = new Database(join(tmpDir, 'test.db'));

    ctx = createMockContext(db);
    ctx.env = new EnvManager(db) as AppContext['env'];

    listEnvVarsTool = envToolDefs.find((tool) => tool.name === 'list_env_vars')!;
    expect(listEnvVarsTool).toBeDefined();
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('backward compatibility (no environment_name)', () => {
    it('returns plaintext format when environment_name is omitted', async () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });
      const env = new EnvManager(db);
      env.set('p1', 'DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');
      env.set('p1', 'API_KEY', 'sk-1234567890abcdef');

      const result = (await listEnvVarsTool.execute(
        { project_name: 'my-app' },
        { appCtx: ctx, target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result).toEqual({
        variables: {
          DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
          API_KEY: 'sk-1234567890abcdef',
        },
        count: 2,
      });
    });

    it('returns empty variables when no env vars are set', async () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });

      const result = (await listEnvVarsTool.execute(
        { project_name: 'my-app' },
        { appCtx: ctx, target: 'mcp' },
      )) as Record<string, unknown>;

      expect(result).toEqual({
        variables: {},
        count: 0,
      });
    });
  });

  describe('source tracking (with environment_name)', () => {
    it('returns source tracking for production environment', async () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });
      const production = db
        .getEnvironmentsByProject('p1')
        .find((environment) => environment.type === 'production')!;

      const env = new EnvManager(db);
      env.setGlobalSecret('GLOBAL_KEY', 'global-value');
      env.set('p1', 'PROJECT_KEY', 'project-value');
      env.set('p1', 'PROD_KEY', 'prod-value', production.id);

      const result = await listEnvVarsTool.execute(
        { project_name: 'my-app', environment_name: 'production' },
        { appCtx: ctx, target: 'mcp' },
      );

      expect(result).toEqual({
        variables: {
          GLOBAL_KEY: { value: 'glo****alue', source: 'global' },
          PROJECT_KEY: { value: 'pro****alue', source: 'project' },
          PROD_KEY: { value: 'pro****alue', source: 'production' },
        },
        count: 3,
      });
    });

    it('returns source tracking for custom environment', async () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });
      const development = db.createEnvironment({
        id: 'env-dev',
        projectId: 'p1',
        type: 'development',
        branch: 'develop',
      });

      const env = new EnvManager(db);
      env.setGlobalSecret('GLOBAL_KEY', 'global-value');
      env.set('p1', 'PROJECT_KEY', 'project-value');
      env.set('p1', 'DEV_KEY', 'dev-value', development.id);

      const result = await listEnvVarsTool.execute(
        { project_name: 'my-app', environment_name: 'development' },
        { appCtx: ctx, target: 'mcp' },
      );

      expect(result).toEqual({
        variables: {
          GLOBAL_KEY: { value: 'glo****alue', source: 'global' },
          PROJECT_KEY: { value: 'pro****alue', source: 'project' },
          DEV_KEY: { value: 'dev****alue', source: 'environment' },
        },
        count: 3,
      });
    });

    it('shows override flag when environment overrides inherited value', async () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });
      const development = db.createEnvironment({
        id: 'env-dev',
        projectId: 'p1',
        type: 'development',
        branch: 'develop',
      });

      const env = new EnvManager(db);
      env.set('p1', 'SHARED_KEY', 'project-value');
      env.set('p1', 'SHARED_KEY', 'dev-override', development.id);

      const result = (await listEnvVarsTool.execute(
        { project_name: 'my-app', environment_name: 'development' },
        { appCtx: ctx, target: 'mcp' },
      )) as Record<string, Record<string, { value: string; source: string }>>;

      expect(result.variables.SHARED_KEY).toEqual({
        value: 'dev****ride',
        source: 'environment',
      });
    });

    it('masks all values regardless of source', async () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });
      const production = db
        .getEnvironmentsByProject('p1')
        .find((environment) => environment.type === 'production')!;

      const env = new EnvManager(db);
      env.setGlobalSecret('GLOBAL_SECRET', 'super-secret-global-key-12345');
      env.set('p1', 'PROJECT_SECRET', 'super-secret-project-key-12345');
      env.set('p1', 'PROD_SECRET', 'super-secret-prod-key-12345', production.id);

      const result = (await listEnvVarsTool.execute(
        { project_name: 'my-app', environment_name: 'production' },
        { appCtx: ctx, target: 'mcp' },
      )) as Record<string, Record<string, { value: string; source: string }>>;

      // Verify no plaintext secrets in response
      const variables = result.variables as Record<string, { value: string; source: string }>;
      expect(variables.GLOBAL_SECRET.value).not.toContain('super-secret');
      expect(variables.PROJECT_SECRET.value).not.toContain('super-secret');
      expect(variables.PROD_SECRET.value).not.toContain('super-secret');

      // Verify masking pattern (first 3 + **** + last 4)
      expect(variables.GLOBAL_SECRET.value).toBe('sup****2345');
      expect(variables.PROJECT_SECRET.value).toBe('sup****2345');
      expect(variables.PROD_SECRET.value).toBe('sup****2345');
    });
  });

  describe('error handling', () => {
    it('throws error when project not found', () => {
      expect(() => {
        listEnvVarsTool.execute({ project_name: 'nonexistent' }, { appCtx: ctx, target: 'mcp' });
      }).toThrow('Project not found: nonexistent');
    });

    it('throws error when environment not found', async () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });

      expect(() => {
        listEnvVarsTool.execute(
          { project_name: 'my-app', environment_name: 'nonexistent' },
          { appCtx: ctx, target: 'mcp' },
        );
      }).toThrow('ENVIRONMENT_NOT_FOUND');
    });

    it('gracefully handles invalid environment_name without crashing', async () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });

      expect(() => {
        listEnvVarsTool.execute(
          { project_name: 'my-app', environment_name: 'staging' },
          { appCtx: ctx, target: 'mcp' },
        );
      }).toThrow('ENVIRONMENT_NOT_FOUND');
    });
  });

  describe('inheritance precedence', () => {
    it('respects inheritance order: global < project < production < environment', async () => {
      db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });
      const production = db
        .getEnvironmentsByProject('p1')
        .find((environment) => environment.type === 'production')!;
      const development = db.createEnvironment({
        id: 'env-dev',
        projectId: 'p1',
        type: 'development',
        branch: 'develop',
      });

      const env = new EnvManager(db);
      // Set same key at all levels
      env.setGlobalSecret('SHARED', 'global-value');
      env.set('p1', 'SHARED', 'project-value');
      env.set('p1', 'SHARED', 'prod-value', production.id);
      env.set('p1', 'SHARED', 'dev-value', development.id);

      const result = (await listEnvVarsTool.execute(
        { project_name: 'my-app', environment_name: 'development' },
        { appCtx: ctx, target: 'mcp' },
      )) as Record<string, Record<string, { value: string; source: string }>>;

      // Environment should win
      expect(result.variables.SHARED).toEqual({
        value: 'dev****alue',
        source: 'environment',
      });
    });
  });
});
