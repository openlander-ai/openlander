import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import type { AppContext } from '../../src/app.js';
import { Database } from '../../src/db/index.js';
import { EnvManager } from '../../src/pipeline/env.js';
import { envToolDefs } from '../../src/tools/defs/env.js';
import { createMockContext } from '../helpers/web-route-mocks.js';

describe('list_env_vars tool', () => {
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

  it.skip('returns masked project env vars when environment_name is omitted', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });
    ctx.env.set('p1', 'DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');
    ctx.env.set('p1', 'API_KEY', 'sk-1234567890abcdef');

    const result = (await listEnvVarsTool.execute(
      { project_name: 'my-app' },
      { appCtx: ctx, target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toEqual({
      variables: {
        DATABASE_URL: 'pos****2/db',
        API_KEY: 'sk-****cdef',
      },
      count: 2,
    });
  });

  it.skip('ignores environment_name and still returns project-scoped env vars', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/repo' });
    db.createEnvironment({
      id: 'env-dev',
      projectId: 'p1',
      type: 'development',
      branch: 'develop',
    });

    ctx.env.setGlobalSecret('GLOBAL_KEY', 'global-value');
    ctx.env.set('p1', 'PROJECT_KEY', 'project-value');
    ctx.env.set('p1', 'DEV_KEY', 'dev-value', 'env-dev');

    const result = (await listEnvVarsTool.execute(
      { project_name: 'my-app', environment_name: 'development' },
      { appCtx: ctx, target: 'mcp' },
    )) as Record<string, unknown>;

    expect(result).toEqual({
      variables: {
        PROJECT_KEY: 'pro****alue',
      },
      count: 1,
    });
  });

  it('throws error when project not found', () => {
    expect(() => {
      listEnvVarsTool.execute({ project_name: 'nonexistent' }, { appCtx: ctx, target: 'mcp' });
    }).toThrow('Project not found: nonexistent');
  });
});
