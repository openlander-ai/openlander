import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AppContext } from '../src/app.js';
import { Database } from '../src/db/index.js';
import { EnvManager } from '../src/pipeline/env.js';
import { createSharedToolRegistry } from './tools/shared-tool-registry.js';

describe('EnvManager.verifyRoundTrip', () => {
  let db: Database;
  let env: EnvManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-env-roundtrip-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    env = new EnvManager(db);
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('verifyRoundTrip returns empty array when values match', () => {
    const vars = { API_URL: 'https://api.example.com', FEATURE_FLAG: 'true' };
    env.setBulk('p1', vars);

    expect(env.verifyRoundTrip('p1', vars)).toEqual([]);
  });

  it('verifyRoundTrip returns mismatched keys when values differ', () => {
    env.setBulk('p1', {
      API_URL: 'https://api.example.com',
      TOKEN: 'stored-value',
    });

    const mismatches = env.verifyRoundTrip('p1', {
      API_URL: 'https://api.example.com',
      TOKEN: 'different-value',
    });

    expect(mismatches).toEqual(['TOKEN']);
  });

  it('handles special characters: +, $, spaces, quotes, backslashes', () => {
    const vars = {
      PLUS: 'a+b+c',
      DOLLAR: 'cost-$100',
      SPACES: 'hello world value',
      QUOTES: '"quoted" and \'single\'',
      BACKSLASH: 'C:\\Users\\name\\file.txt',
    };
    env.setBulk('p1', vars);

    expect(env.verifyRoundTrip('p1', vars)).toEqual([]);
  });
});

describe('set_env_vars round-trip verification', () => {
  function getSetEnvVarsTool(ctx: AppContext) {
    const tool = createSharedToolRegistry(ctx, {
      target: 'mcp',
      names: ['set_env_vars'],
    }).find((entry) => entry.name === 'set_env_vars');

    if (!tool) {
      throw new Error('set_env_vars tool not found');
    }

    return tool;
  }

  it('set_env_vars returns error when round-trip verification fails', async () => {
    const redeploy = vi.fn();
    const setBulk = vi.fn().mockReturnValue(true);
    const verifyRoundTrip = vi.fn().mockReturnValue(['API_KEY']);
    const getProjectByName = vi.fn().mockReturnValue({
      id: 'p1',
      name: 'my-app',
      status: 'running',
    });

    const ctx = {
      db: { getProjectByName },
      env: { setBulk, verifyRoundTrip },
      pipeline: { redeploy },
    } as unknown as AppContext;

    const tool = getSetEnvVarsTool(ctx);
    const result = await tool.execute(
      {
        project_name: 'my-app',
        variables: JSON.stringify({ API_KEY: 'sk-abc+123$ \\ "quoted"' }),
      },
      { target: 'mcp' },
    );

    expect(setBulk).toHaveBeenCalledWith('p1', { API_KEY: 'sk-abc+123$ \\ "quoted"' });
    expect(verifyRoundTrip).toHaveBeenCalledWith('p1', { API_KEY: 'sk-abc+123$ \\ "quoted"' });
    expect(redeploy).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'error',
      project: 'my-app',
      error:
        'Round-trip verification failed for keys: API_KEY. Values may have been mangled during storage.',
      keys: ['API_KEY'],
    });
  });
});
