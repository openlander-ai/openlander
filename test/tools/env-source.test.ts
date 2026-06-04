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
const developmentEnvironment = {
  id: 'env-development',
  service_id: 'svc1',
  project_id: 'p1',
  type: 'development',
  branch: 'develop',
  status: 'running',
};

function createEnvToolContext() {
  const db = {
    getProjectByName: vi.fn((name: string) => (name === project.name ? project : undefined)),
    getProject: vi.fn((id: string) => (id === project.id ? project : undefined)),
    getDeployablesByGroup: vi.fn().mockResolvedValue([service]),
    getEnvironmentsByProject: vi.fn().mockResolvedValue([developmentEnvironment]),
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
    setBulkDetailed: vi.fn().mockResolvedValue([{ key: 'DATABASE_URL', op: 'update' }]),
    verifyRoundTrip: vi.fn().mockResolvedValue([]),
    setBulkForServiceDetailed: vi.fn().mockResolvedValue([{ key: 'DATABASE_URL', op: 'update' }]),
    verifyRoundTripForService: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
    deleteBulk: vi.fn().mockResolvedValue({
      deleted: ['DATABASE_URL'],
      notFound: ['MISSING'],
      changed: true,
    }),
    deleteForService: vi.fn().mockResolvedValue(true),
    deleteBulkForService: vi.fn().mockResolvedValue({
      deleted: ['DATABASE_URL'],
      notFound: ['MISSING'],
      changed: true,
    }),
  };
  const pipeline = {
    redeploy: vi.fn().mockResolvedValue({ status: 'redeployed' }),
    redeployService: vi.fn().mockResolvedValue({ status: 'redeployed' }),
  };

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

  it('list_env_vars can inspect project-environment and service-environment scopes', async () => {
    const { ctx, env } = createEnvToolContext();

    const projectResult = await getEnvTool('list_env_vars').execute(
      {
        project_id: 'p1',
        scope: 'project_environment',
        environment_key: 'development',
      },
      { appCtx: ctx, target: 'mcp' },
    );
    const serviceResult = await getEnvTool('list_env_vars').execute(
      {
        project_name: 'my-app',
        scope: 'service_environment',
        environment_key: 'development',
        reveal: true,
      },
      { appCtx: ctx, target: 'mcp' },
    );

    expect(env.getAllMasked).toHaveBeenCalledWith('p1', 'env-development');
    expect(env.getAllForService).toHaveBeenCalledWith('p1', 'svc1', 'env-development');
    expect(projectResult).toMatchObject({
      project: 'my-app',
      scope: 'project_environment',
      environment_key: 'development',
      revealed: false,
    });
    expect(serviceResult).toMatchObject({
      project: 'my-app',
      service: 'web',
      scope: 'service_environment',
      environment_key: 'development',
      revealed: true,
    });
  });

  it('get_env_var can read project-environment vars by scope', async () => {
    const { ctx, env } = createEnvToolContext();

    const result = await getEnvTool('get_env_var').execute(
      {
        project_id: 'p1',
        scope: 'project_environment',
        environment_key: 'development',
        key: 'DATABASE_URL',
      },
      { appCtx: ctx, target: 'mcp' },
    );

    expect(env.getAll).toHaveBeenCalledWith('p1', 'env-development');
    expect(result).toMatchObject({
      project: 'my-app',
      scope: 'project_environment',
      environment_key: 'development',
      key: 'DATABASE_URL',
      value: 'postgresql://user:pass@localhost:5432/db',
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

  it('set_env_vars can write project-shared scope by project_id', async () => {
    const { ctx, env, pipeline } = createEnvToolContext();

    const result = await getEnvTool('set_env_vars').execute(
      {
        project_id: 'p1',
        scope: 'project',
        variables: { DATABASE_URL: 'postgres://project' },
      },
      { appCtx: ctx, target: 'mcp' },
    );

    expect(env.setBulkDetailed).toHaveBeenCalledWith('p1', {
      DATABASE_URL: 'postgres://project',
    });
    expect(env.verifyRoundTrip).toHaveBeenCalledWith('p1', {
      DATABASE_URL: 'postgres://project',
    });
    expect(env.setBulkForServiceDetailed).not.toHaveBeenCalled();
    expect(pipeline.redeploy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'updated',
      project: 'my-app',
      scope: 'project',
      needs_redeploy: true,
    });
  });

  it('set_env_vars can write project-environment scope by environment_key', async () => {
    const { ctx, env } = createEnvToolContext();

    const result = await getEnvTool('set_env_vars').execute(
      {
        project_id: 'p1',
        scope: 'project_environment',
        environment_key: 'development',
        variables: { DATABASE_URL: 'postgres://project-dev' },
      },
      { appCtx: ctx, target: 'mcp' },
    );

    expect(env.setBulkDetailed).toHaveBeenCalledWith(
      'p1',
      { DATABASE_URL: 'postgres://project-dev' },
      'env-development',
    );
    expect(env.verifyRoundTrip).toHaveBeenCalledWith(
      'p1',
      { DATABASE_URL: 'postgres://project-dev' },
      'env-development',
    );
    expect(result).toMatchObject({
      status: 'updated',
      project: 'my-app',
      scope: 'project_environment',
      environment_key: 'development',
      needs_redeploy: true,
    });
  });

  it('set_env_vars can write service-environment scope by environment_key', async () => {
    const { ctx, env } = createEnvToolContext();

    const result = await getEnvTool('set_env_vars').execute(
      {
        project_name: 'my-app',
        scope: 'service_environment',
        environment_key: 'development',
        variables: { DATABASE_URL: 'postgres://service-dev' },
      },
      { appCtx: ctx, target: 'mcp' },
    );

    expect(env.setBulkForServiceDetailed).toHaveBeenCalledWith(
      'p1',
      'svc1',
      { DATABASE_URL: 'postgres://service-dev' },
      'env-development',
    );
    expect(env.verifyRoundTripForService).toHaveBeenCalledWith(
      'p1',
      'svc1',
      { DATABASE_URL: 'postgres://service-dev' },
      'env-development',
    );
    expect(result).toMatchObject({
      status: 'updated',
      project: 'my-app',
      service: 'web',
      scope: 'service_environment',
      environment_key: 'development',
      needs_redeploy: true,
    });
  });

  it('set_env_vars rejects invalid or missing environment_key before writing', async () => {
    const { ctx, env } = createEnvToolContext();

    await expect(
      getEnvTool('set_env_vars').execute(
        {
          project_id: 'p1',
          scope: 'project_environment',
          variables: { DATABASE_URL: 'postgres://project-dev' },
        },
        { appCtx: ctx, target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'MISSING_FIELD', statusCode: 400 });

    await expect(
      getEnvTool('set_env_vars').execute(
        {
          project_id: 'p1',
          scope: 'project_environment',
          environment_key: 'preview',
          variables: { DATABASE_URL: 'postgres://project-dev' },
        },
        { appCtx: ctx, target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_FIELD', statusCode: 400 });

    expect(env.setBulkDetailed).not.toHaveBeenCalled();
    expect(env.setBulkForServiceDetailed).not.toHaveBeenCalled();
  });

  it('set_env_vars rejects missing environment rows before writing', async () => {
    const { ctx, db, env } = createEnvToolContext();
    db.getEnvironmentsByProject.mockResolvedValueOnce([]);

    await expect(
      getEnvTool('set_env_vars').execute(
        {
          project_id: 'p1',
          scope: 'project_environment',
          environment_key: 'development',
          variables: { DATABASE_URL: 'postgres://project-dev' },
        },
        { appCtx: ctx, target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'ENVIRONMENT_NOT_FOUND', statusCode: 404 });

    expect(env.setBulkDetailed).not.toHaveBeenCalled();
    expect(env.setBulkForServiceDetailed).not.toHaveBeenCalled();
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

  it('set_env_vars immediate redeploy preserves MCP trigger attribution', async () => {
    const { ctx, pipeline } = createEnvToolContext();

    const result = await getEnvTool('set_env_vars').execute(
      {
        project_name: 'my-app',
        variables: { DATABASE_URL: 'postgres://applied' },
        defer_redeploy: false,
      },
      { appCtx: ctx, target: 'mcp' },
    );

    expect(pipeline.redeployService).toHaveBeenCalledWith('svc1', { trigger: 'chat' });
    expect(pipeline.redeploy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'updated_and_redeployed',
      needs_redeploy: false,
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

  it('export_env_vars can export service-environment scope', async () => {
    const { ctx, db, env } = createEnvToolContext();

    const result = (await getEnvTool('export_env_vars').execute(
      {
        project_name: 'my-app',
        scope: 'service_environment',
        environment_key: 'development',
      },
      { appCtx: ctx, target: 'mcp' },
    )) as { env: string; scope: string; environment_key: string };

    expect(env.getAllForService).toHaveBeenCalledWith('p1', 'svc1', 'env-development');
    expect(result).toMatchObject({
      scope: 'service_environment',
      environment_key: 'development',
    });
    expect(result.env).toContain('DATABASE_URL=postgresql://user:pass@localhost:5432/db');
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

  it('delete_env_var and bulk_delete_env_vars can delete project-environment scope', async () => {
    const { ctx, env, pipeline } = createEnvToolContext();

    const deleteResult = await getEnvTool('delete_env_var').execute(
      {
        project_id: 'p1',
        scope: 'project_environment',
        environment_key: 'development',
        key: 'DATABASE_URL',
      },
      { appCtx: ctx, target: 'mcp' },
    );
    const previewResult = await getEnvTool('bulk_delete_env_vars').execute(
      {
        project_id: 'p1',
        scope: 'project_environment',
        environment_key: 'development',
        keys: ['DATABASE_URL', 'MISSING'],
      },
      { appCtx: ctx, target: 'mcp' },
    );
    const confirmedResult = await getEnvTool('bulk_delete_env_vars').execute(
      {
        project_id: 'p1',
        scope: 'project_environment',
        environment_key: 'development',
        keys: ['DATABASE_URL', 'MISSING'],
        confirm: true,
      },
      { appCtx: ctx, target: 'mcp' },
    );

    expect(env.delete).toHaveBeenCalledWith('p1', 'DATABASE_URL', 'env-development');
    expect(env.getAll).toHaveBeenCalledWith('p1', 'env-development');
    expect(env.deleteBulk).toHaveBeenCalledWith(
      'p1',
      ['DATABASE_URL', 'MISSING'],
      'env-development',
    );
    expect(pipeline.redeploy).not.toHaveBeenCalled();
    expect(deleteResult).toMatchObject({
      status: 'deleted',
      scope: 'project_environment',
      environment_key: 'development',
      needs_redeploy: true,
    });
    expect(previewResult).toMatchObject({
      project: 'my-app',
      scope: 'project_environment',
      environment_key: 'development',
      would_delete: ['DATABASE_URL'],
      not_found: ['MISSING'],
      confirm_required: true,
    });
    expect(confirmedResult).toMatchObject({
      status: 'deleted',
      scope: 'project_environment',
      environment_key: 'development',
      deleted: ['DATABASE_URL'],
      not_found: ['MISSING'],
      needs_redeploy: true,
    });
  });

  it('delete_env_var can delete service-environment scope', async () => {
    const { ctx, env, pipeline } = createEnvToolContext();

    const result = await getEnvTool('delete_env_var').execute(
      {
        project_name: 'my-app',
        scope: 'service_environment',
        environment_key: 'development',
        key: 'DATABASE_URL',
      },
      { appCtx: ctx, target: 'mcp' },
    );

    expect(env.deleteForService).toHaveBeenCalledWith(
      'p1',
      'svc1',
      'DATABASE_URL',
      'env-development',
    );
    expect(pipeline.redeploy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'deleted',
      service: 'web',
      scope: 'service_environment',
      environment_key: 'development',
      needs_redeploy: true,
    });
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
