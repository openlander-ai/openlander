import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AppContext } from '../src/app.js';
import { Database } from '../src/db/index.js';
import { EnvManager } from '../src/pipeline/env.js';
import { createSharedToolRegistry, type LegacyToolSpec } from './tools/shared-tool-registry.js';

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
    const getEnvironmentsByProject = vi
      .fn()
      .mockReturnValue([{ id: 'env-prod', type: 'production' }]);

    const ctx = {
      db: { getProjectByName, getEnvironmentsByProject },
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

    expect(setBulk).toHaveBeenCalledWith('p1', { API_KEY: 'sk-abc+123$ \\ "quoted"' }, 'env-prod');
    expect(verifyRoundTrip).toHaveBeenCalledWith(
      'p1',
      { API_KEY: 'sk-abc+123$ \\ "quoted"' },
      'env-prod',
    );
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

describe('BUG-013: MCP and HTTP env vars share same storage path', () => {
  let db: Database;
  let env: EnvManager;
  let tmpDir: string;
  let prodEnvId: string;
  let tools: LegacyToolSpec[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-env-bug013-'));
    db = new Database(join(tmpDir, 'test.db'));
    env = new EnvManager(db);
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/test/a' });

    const prodEnv = db.getEnvironmentsByProject('p1').find((e) => e.type === 'production');
    prodEnvId = prodEnv!.id;

    const ctx = {
      db,
      env,
      pipeline: { redeploy: vi.fn() },
      deployQueue: { acquire: vi.fn().mockResolvedValue(() => {}) },
    } as unknown as AppContext;

    tools = createSharedToolRegistry(ctx, {
      target: 'mcp',
      names: ['set_env_vars', 'list_env_vars', 'get_env_var'],
    });
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function getTool(name: string): LegacyToolSpec {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool;
  }

  it('MCP set_env_vars → HTTP getAllWithInheritance shows the vars', async () => {
    const setTool = getTool('set_env_vars');
    await setTool.execute(
      { project_name: 'my-app', variables: JSON.stringify({ DB_URL: 'postgres://localhost/db' }) },
      { target: 'mcp' },
    );

    const httpResult = env.getAllWithInheritance('p1', prodEnvId);
    expect(httpResult).toHaveProperty('DB_URL', 'postgres://localhost/db');
  });

  it('HTTP setBulk with envId → MCP list_env_vars shows the vars', async () => {
    env.setBulk('p1', { API_KEY: 'sk-secret-123' }, prodEnvId);

    const listTool = getTool('list_env_vars');
    const result = (await listTool.execute({ project_name: 'my-app' }, { target: 'mcp' })) as {
      variables: Record<string, string>;
    };

    expect(result.variables).toHaveProperty('API_KEY', 'sk-****-123');
  });

  it('HTTP setBulk with envId → MCP get_env_var returns the value', async () => {
    env.setBulk('p1', { SECRET: 'top-secret' }, prodEnvId);

    const getVarTool = getTool('get_env_var');
    const result = (await getVarTool.execute(
      { project_name: 'my-app', key: 'SECRET' },
      { target: 'mcp' },
    )) as { key: string; value: string };

    expect(result).toEqual({ key: 'SECRET', value: 'top-secret' });
  });

  it('both paths see vars set by the other path', async () => {
    env.setBulk('p1', { FROM_HTTP: 'http-value' }, prodEnvId);

    const setTool = getTool('set_env_vars');
    await setTool.execute(
      { project_name: 'my-app', variables: JSON.stringify({ FROM_MCP: 'mcp-value' }) },
      { target: 'mcp' },
    );

    const httpResult = env.getAllWithInheritance('p1', prodEnvId);
    expect(httpResult).toHaveProperty('FROM_HTTP', 'http-value');
    expect(httpResult).toHaveProperty('FROM_MCP', 'mcp-value');

    const listTool = getTool('list_env_vars');
    const mcpResult = (await listTool.execute({ project_name: 'my-app' }, { target: 'mcp' })) as {
      variables: Record<string, string>;
    };
    expect(mcpResult.variables).toHaveProperty('FROM_HTTP', 'htt****alue');
    expect(mcpResult.variables).toHaveProperty('FROM_MCP', 'mcp****alue');
  });
});
