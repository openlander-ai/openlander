import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { OpenLanderError } from '../../src/errors.js';
import { envToolDefs } from '../../src/tools/defs/env.js';

const project = { id: 'p1', name: 'my-app', status: 'running' };
const service = {
  id: 'svc1',
  name: 'web',
  project_id: 'p1',
  kind: 'git',
  source: 'git',
  status: 'running',
};

function createEnvToolContext() {
  const db = {
    getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
    getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
    getDeployablesByGroup: vi.fn().mockResolvedValue([service]),
    assertEnvToolSchemaReady: vi.fn().mockResolvedValue(undefined),
    insertActivityLog: vi.fn().mockResolvedValue(undefined),
  };
  const env = {
    getAll: vi.fn().mockResolvedValue({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      NEXT_PUBLIC_URL: 'https://public.example.com',
      EMPTY_VALUE: '',
    }),
    getAllMasked: vi.fn().mockResolvedValue({
      DATABASE_URL: 'pos****2/db',
      NEXT_PUBLIC_URL: 'https://public.example.com',
      EMPTY_VALUE: '""',
    }),
    getAllForService: vi.fn().mockResolvedValue({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      NEXT_PUBLIC_URL: 'https://public.example.com',
      EMPTY_VALUE: '',
    }),
    getAllForServiceMasked: vi.fn().mockResolvedValue({
      DATABASE_URL: 'pos****2/db',
      NEXT_PUBLIC_URL: 'https://public.example.com',
      EMPTY_VALUE: '""',
    }),
    setBulkForServiceDetailed: vi.fn().mockResolvedValue([{ key: 'DATABASE_URL', op: 'update' }]),
    verifyRoundTripForService: vi.fn().mockResolvedValue([]),
    deleteForService: vi.fn().mockResolvedValue(true),
    deleteBulkForService: vi.fn().mockResolvedValue({
      deleted: ['DATABASE_URL'],
      notFound: ['MISSING'],
      changed: true,
    }),
  };
  const pipeline = { redeploy: vi.fn().mockResolvedValue({ status: 'redeployed' }) };

  const ctx = { db, env, pipeline } as unknown as AppContext;
  return { ctx, db, env, pipeline };
}

function getEnvTool(name: string) {
  const tool = envToolDefs.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe('env MCP tools', () => {
  it('list_env_vars returns masked service env vars by default', async () => {
    const { ctx, env } = createEnvToolContext();

    const result = await getEnvTool('list_env_vars').execute(
      { project_name: 'my-app' },
      { appCtx: ctx, target: 'mcp' },
    );

    expect(env.getAllForServiceMasked).toHaveBeenCalledWith('p1', 'svc1');
    expect(env.getAllForService).not.toHaveBeenCalled();
    expect(result).toEqual({
      project: 'my-app',
      service: 'web',
      variables: {
        DATABASE_URL: 'pos****2/db',
        NEXT_PUBLIC_URL: 'https://public.example.com',
        EMPTY_VALUE: '""',
      },
      count: 3,
      revealed: false,
    });
  });

  it('list_env_vars supports reveal=true raw values', async () => {
    const { ctx, env } = createEnvToolContext();

    const result = await getEnvTool('list_env_vars').execute(
      { project_name: 'my-app', reveal: true },
      { appCtx: ctx, target: 'mcp' },
    );

    expect(env.getAllForService).toHaveBeenCalledWith('p1', 'svc1');
    expect(result).toMatchObject({
      variables: {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        EMPTY_VALUE: '',
      },
      revealed: true,
    });
  });

  it('set_env_vars rejects null values and does not redeploy by default', async () => {
    const { ctx, env, pipeline } = createEnvToolContext();

    await expect(
      getEnvTool('set_env_vars').execute(
        { project_name: 'my-app', variables: JSON.stringify({ API_KEY: null }) },
        { appCtx: ctx, target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const result = await getEnvTool('set_env_vars').execute(
      { project_name: 'my-app', variables: JSON.stringify({ DATABASE_URL: 'postgres://new' }) },
      { appCtx: ctx, target: 'mcp' },
    );

    expect(env.setBulkForServiceDetailed).toHaveBeenCalledWith('p1', 'svc1', {
      DATABASE_URL: 'postgres://new',
    });
    expect(pipeline.redeploy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      keys: ['DATABASE_URL'],
      changed: [{ key: 'DATABASE_URL', op: 'update' }],
      needs_redeploy: true,
    });
  });

  it('set_env_vars marks healthy services as needing redeploy', async () => {
    const { ctx, db, pipeline } = createEnvToolContext();
    const healthyService = { ...service, status: 'healthy' };
    db.getDeployablesByGroup = vi.fn().mockResolvedValue([healthyService]);

    const result = await getEnvTool('set_env_vars').execute(
      { project_name: 'my-app', variables: { DATABASE_URL: 'postgres://healthy' } },
      { appCtx: ctx, target: 'mcp' },
    );

    expect(pipeline.redeploy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      keys: ['DATABASE_URL'],
      needs_redeploy: true,
    });
  });

  it('export_env_vars returns dotenv text and records an audit activity', async () => {
    const { ctx, db } = createEnvToolContext();

    const result = (await getEnvTool('export_env_vars').execute(
      { project_name: 'my-app' },
      { appCtx: ctx, target: 'mcp' },
    )) as { env: string; count: number };

    expect(result.count).toBe(3);
    expect(result.env).toContain('DATABASE_URL=postgresql://user:pass@localhost:5432/db');
    expect(result.env).toContain('EMPTY_VALUE=""');
    expect(db.insertActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'env:changed', severity: 'warning' }),
    );
  });

  it('bulk_delete_env_vars previews without confirm and deletes with confirm=true', async () => {
    const { ctx, env } = createEnvToolContext();
    const tool = getEnvTool('bulk_delete_env_vars');

    await expect(
      tool.execute(
        { project_name: 'my-app', keys: ['DATABASE_URL', 'MISSING'] },
        { appCtx: ctx, target: 'mcp' },
      ),
    ).resolves.toEqual({
      would_delete: ['DATABASE_URL'],
      not_found: ['MISSING'],
      count_to_delete: 1,
      confirm_required: true,
    });
    expect(env.deleteBulkForService).not.toHaveBeenCalled();

    await expect(
      tool.execute(
        { project_name: 'my-app', keys: ['DATABASE_URL', 'MISSING'], confirm: true },
        { appCtx: ctx, target: 'mcp' },
      ),
    ).resolves.toMatchObject({
      status: 'deleted',
      deleted: ['DATABASE_URL'],
      not_found: ['MISSING'],
      needs_redeploy: true,
    });
    expect(env.deleteBulkForService).toHaveBeenCalledWith('p1', 'svc1', [
      'DATABASE_URL',
      'MISSING',
    ]);
  });

  it('get_env_var uses NOT_FOUND for missing keys', async () => {
    const { ctx, env } = createEnvToolContext();
    env.getAllForService.mockResolvedValueOnce({});

    await expect(
      getEnvTool('get_env_var').execute(
        { project_name: 'my-app', key: 'MISSING' },
        { appCtx: ctx, target: 'mcp' },
      ),
    ).rejects.toBeInstanceOf(OpenLanderError);
  });
});
