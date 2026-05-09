import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../src/app.js';
import { EnvManager } from '../src/pipeline/env.js';
import { createSharedToolRegistry, type LegacyToolSpec } from './tools/shared-tool-registry.js';

type EnvDbMock = {
  getEnvVars: ReturnType<typeof vi.fn>;
  getEnvVarsForService?: ReturnType<typeof vi.fn>;
  mergeEnvVarsDetailed: ReturnType<typeof vi.fn>;
  mergeEnvVarsForServiceDetailed?: ReturnType<typeof vi.fn>;
  getEnvironmentsByProject?: ReturnType<typeof vi.fn>;
};

function createEnvManager(db: EnvDbMock): EnvManager {
  return new EnvManager(db as unknown as ConstructorParameters<typeof EnvManager>[0]);
}

describe('EnvManager.verifyRoundTrip', () => {
  it('returns empty array when values match', async () => {
    const db = {
      getEnvVars: vi.fn().mockResolvedValue({ API_URL: 'https://api.example.com' }),
      mergeEnvVarsDetailed: vi.fn(),
    };
    const env = createEnvManager(db);

    await expect(env.verifyRoundTrip('p1', { API_URL: 'https://api.example.com' })).resolves.toEqual(
      [],
    );
  });

  it('returns mismatched keys when values differ', async () => {
    const db = {
      getEnvVars: vi.fn().mockResolvedValue({ API_URL: 'https://api.example.com', TOKEN: 'stored' }),
      mergeEnvVarsDetailed: vi.fn(),
    };
    const env = createEnvManager(db);

    await expect(
      env.verifyRoundTrip('p1', { API_URL: 'https://api.example.com', TOKEN: 'different' }),
    ).resolves.toEqual(['TOKEN']);
  });

  it('handles special characters without mangling', async () => {
    const vars = {
      PLUS: 'a+b+c',
      DOLLAR: 'cost-$100',
      SPACES: 'hello world value',
      QUOTES: '"quoted" and \'single\'',
      BACKSLASH: 'C:\\Users\\name\\file.txt',
    };
    const db = {
      getEnvVars: vi.fn().mockResolvedValue(vars),
      mergeEnvVarsDetailed: vi.fn(),
    };
    const env = createEnvManager(db);

    await expect(env.verifyRoundTrip('p1', vars)).resolves.toEqual([]);
  });
});

describe('set_env_vars round-trip verification', () => {
  function getSetEnvVarsTool(ctx: AppContext): LegacyToolSpec {
    const tool = createSharedToolRegistry(ctx, {
      target: 'mcp',
      names: ['set_env_vars'],
    }).find((entry) => entry.name === 'set_env_vars');

    if (!tool) throw new Error('set_env_vars tool not found');
    return tool;
  }

  it('set_env_vars returns error when round-trip verification fails', async () => {
    const redeploy = vi.fn();
    const setBulkDetailed = vi.fn().mockResolvedValue([{ key: 'API_KEY', op: 'update' }]);
    const verifyRoundTrip = vi.fn().mockResolvedValue(['API_KEY']);
    const getProjectByName = vi.fn().mockReturnValue({ id: 'p1', name: 'my-app', status: 'running' });
    const service = { id: 'svc1', name: 'web', project_id: 'p1', kind: 'git', source: 'git', status: 'running' };
    const ctx = {
      db: {
        getProjectByName,
        getProject: vi.fn().mockResolvedValue({ id: 'p1', name: 'my-app', status: 'running' }),
        getDeployablesByGroup: vi.fn().mockResolvedValue([service]),
        assertEnvToolSchemaReady: vi.fn().mockResolvedValue(undefined),
      },
      env: { setBulkForServiceDetailed: setBulkDetailed, verifyRoundTripForService: verifyRoundTrip },
      pipeline: { redeploy },
    } as unknown as AppContext;

    const tool = getSetEnvVarsTool(ctx);
    const result = await tool.execute(
      {
        project_name: 'my-app',
        variables: JSON.stringify({ API_KEY: 'sk-abc+123$ \\ "quoted"' }),
      },
      { target: 'mcp', appCtx: ctx },
    );

    expect(setBulkDetailed).toHaveBeenCalledWith('p1', 'svc1', {
      API_KEY: 'sk-abc+123$ \\ "quoted"',
    });
    expect(verifyRoundTrip).toHaveBeenCalledWith('p1', 'svc1', {
      API_KEY: 'sk-abc+123$ \\ "quoted"',
    });
    expect(redeploy).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'error',
      project: 'my-app',
      service: 'web',
      error:
        'Round-trip verification failed for keys: API_KEY. Values may have been mangled during storage.',
      keys: ['API_KEY'],
    });
  });
});

describe('service-scoped MCP env storage', () => {
  function createContext() {
    const vars: Record<string, string> = {};
    const getEnvVars = vi.fn(async () => ({ ...vars }));
    const getEnvVarsForService = vi.fn(async () => ({ ...vars }));
    const mergeEnvVarsDetailed = vi.fn(async (_projectId: string, next: Record<string, string>) => {
      const changes = Object.entries(next).map(([key, value]) => {
        const exists = key in vars;
        const op = exists ? (vars[key] === value ? 'noop' : 'update') : 'insert';
        vars[key] = value;
        return { key, op };
      });
      return changes;
    });
    const mergeEnvVarsForServiceDetailed = vi.fn(
      async (_projectId: string, _serviceId: string, next: Record<string, string>) => {
        const changes = Object.entries(next).map(([key, value]) => {
          const exists = key in vars;
          const op = exists ? (vars[key] === value ? 'noop' : 'update') : 'insert';
          vars[key] = value;
          return { key, op };
        });
        return changes;
      },
    );
    const env = createEnvManager({
      getEnvVars,
      getEnvVarsForService,
      mergeEnvVarsDetailed,
      mergeEnvVarsForServiceDetailed,
      getEnvironmentsByProject: vi.fn().mockResolvedValue([]),
    });
    const project = { id: 'p1', name: 'my-app', status: 'running' };
    const service = { id: 'svc1', name: 'web', project_id: 'p1', kind: 'git', source: 'git', status: 'running' };
    const ctx = {
      db: {
        getProjectByName: vi.fn().mockReturnValue(project),
        getProject: vi.fn().mockReturnValue(project),
        getDeployablesByGroup: vi.fn().mockReturnValue([service]),
        assertEnvToolSchemaReady: vi.fn().mockResolvedValue(undefined),
      },
      env,
      pipeline: { redeploy: vi.fn() },
    } as unknown as AppContext;
    const tools = createSharedToolRegistry(ctx, {
      target: 'mcp',
      names: ['set_env_vars', 'list_env_vars', 'get_env_var'],
    });
    const getTool = (name: string) => {
      const tool = tools.find((entry) => entry.name === name);
      if (!tool) throw new Error(`Tool ${name} not found`);
      return tool;
    };
    return { env, getTool, vars };
  }

  it('MCP set_env_vars and EnvManager service reads use the same storage path', async () => {
    const { env, getTool } = createContext();

    await getTool('set_env_vars').execute(
      { project_name: 'my-app', variables: JSON.stringify({ DB_URL: 'postgres://localhost/db' }) },
      { target: 'mcp' },
    );

    await expect(env.getAllForService('p1', 'svc1')).resolves.toHaveProperty(
      'DB_URL',
      'postgres://localhost/db',
    );
  });

  it('EnvManager service setBulk and MCP list/get see the same vars', async () => {
    const { env, getTool } = createContext();
    await env.setBulkForService('p1', 'svc1', { API_KEY: 'sk-secret-123' });

    const listResult = (await getTool('list_env_vars').execute(
      { project_name: 'my-app' },
      { target: 'mcp' },
    )) as { variables: Record<string, string> };
    expect(listResult.variables).toHaveProperty('API_KEY', 'sk-****-123');

    const getResult = (await getTool('get_env_var').execute(
      { project_name: 'my-app', key: 'API_KEY' },
      { target: 'mcp' },
    )) as { project: string; service: string; key: string; value: string };
    expect(getResult).toEqual({
      project: 'my-app',
      service: 'web',
      key: 'API_KEY',
      value: 'sk-secret-123',
    });
  });
});
