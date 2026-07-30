import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import type { ServiceRow } from '../../src/db/index.js';
import {
  CONFIG_VERSION,
  serializeConfig,
  validateStoredConfig,
} from '../../src/pipeline/config-snapshot.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function getTool(ctx: AppContext) {
  const tool = createSharedToolRegistry(ctx, {
    target: 'mcp',
    names: ['update_service_config'],
  }).find((entry) => entry.name === 'update_service_config');
  expect(tool).toBeDefined();
  return tool!;
}

function serviceRow(partial: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'incar__svc',
    name: 'incar',
    project_id: 'incar',
    kind: 'compose',
    source: 'compose',
    repo_url: 'https://github.com/Team-SpaceY/incar-app.git',
    branch: 'main',
    dockerfile_path: 'docker-compose.yml',
    docker_target: null,
    build_context: '.',
    status: 'running',
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
    ...partial,
  } as unknown as ServiceRow;
}

function createContext(service: ServiceRow, configJson?: string) {
  const project = { id: 'incar', name: 'incar', status: 'running', archived_at: null };
  const db = {
    getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
    getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
    updateService: vi.fn(async () => undefined),
    loadDeployConfigForService: vi.fn(async () =>
      configJson
        ? {
            service_id: service.id,
            config_json: configJson,
            config_version: CONFIG_VERSION,
          }
        : null,
    ),
    saveDeployConfigForService: vi.fn(async () => undefined),
  };
  return { ctx: { db } as unknown as AppContext, db };
}

describe('update_service_config Compose selection', () => {
  it('publishes memory profile inputs in the existing action schema', () => {
    const { ctx } = createContext(serviceRow());
    const schema = getTool(ctx).inputSchema;

    expect(schema.safeParse({ service_id: 'incar__svc', resource_profile: 'large' }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({
        service_id: 'incar__svc',
        resource_profile: 'custom',
        memory_mb: 2048,
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ service_id: 'incar__svc', resource_profile: 'custom' }).success).toBe(
      false,
    );
    expect(schema.safeParse({ service_id: 'incar__svc', memory_mb: 2048 }).success).toBe(false);
  });

  it('replaces Compose files while preserving unrelated saved configuration', async () => {
    const initial = serializeConfig({
      sshKeyPath: '/run/secrets/deploy-key',
      composeFiles: ['docker-compose.yml', 'deploy/docker-compose.prod.yml'],
      composeProfiles: ['legacy'],
      trafficService: 'web',
      environment: 'production',
    });
    const { ctx, db } = createContext(serviceRow(), initial);

    const result = (await getTool(ctx).execute(
      {
        service_id: 'incar__svc',
        compose_files: [
          'docker-compose.yml',
          'deploy/docker-compose.prod.yml',
          'deploy/docker-compose.openlander.yml',
        ],
        compose_profiles: [],
        compose_services: [],
        traffic_service: 'web',
        environment: 'production',
      },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(db.saveDeployConfigForService).toHaveBeenCalledOnce();
    const [, savedJson, savedVersion] = db.saveDeployConfigForService.mock.calls[0]!;
    expect(savedVersion).toBe(CONFIG_VERSION);
    expect(validateStoredConfig(savedJson)?.snapshot).toEqual({
      sshKeyPath: '/run/secrets/deploy-key',
      composeFiles: [
        'docker-compose.yml',
        'deploy/docker-compose.prod.yml',
        'deploy/docker-compose.openlander.yml',
      ],
      composeProfiles: [],
      composeServices: [],
      trafficService: 'web',
      environment: 'production',
    });
    expect(db.updateService).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'updated',
      project_id: 'incar',
      service_id: 'incar__svc',
      config: {
        compose_files: [
          'docker-compose.yml',
          'deploy/docker-compose.prod.yml',
          'deploy/docker-compose.openlander.yml',
        ],
        compose_profiles: [],
        compose_services: [],
        traffic_service: 'web',
        environment: 'production',
      },
      needs_redeploy: true,
      suggested_call: {
        tool: 'openlander_service',
        action: 'update_app',
        params: { service_id: 'incar__svc' },
      },
    });
    expect(JSON.stringify(result)).not.toContain('deploy-key');
  });

  it('rejects unsafe or duplicate Compose file selections', async () => {
    const { ctx } = createContext(serviceRow());

    await expect(
      getTool(ctx).execute(
        { service_id: 'incar__svc', compose_files: ['docker-compose.yml', '../secret.yml'] },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SERVICE_CONFIG' });

    await expect(
      getTool(ctx).execute(
        { service_id: 'incar__svc', compose_files: ['docker-compose.yml', 'docker-compose.yml'] },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SERVICE_CONFIG' });
  });

  it('rejects Compose selection fields for non-Compose services', async () => {
    const { ctx, db } = createContext(serviceRow({ kind: 'git', source: 'git' }));

    await expect(
      getTool(ctx).execute(
        { service_id: 'incar__svc', compose_files: ['docker-compose.yml'] },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SERVICE_CONFIG' });
    expect(db.saveDeployConfigForService).not.toHaveBeenCalled();
  });

  it('does not overwrite an unreadable saved snapshot', async () => {
    const { ctx, db } = createContext(serviceRow(), '{not-json');

    await expect(
      getTool(ctx).execute({ service_id: 'incar__svc', compose_profiles: [] }, { target: 'mcp' }),
    ).rejects.toMatchObject({ code: 'INVALID_SERVICE_CONFIG', statusCode: 409 });
    expect(db.saveDeployConfigForService).not.toHaveBeenCalled();
  });

  it('saves a named memory profile for a non-Compose Application', async () => {
    const initial = serializeConfig({ environment: 'production', resourceProfile: 'small' });
    const { ctx, db } = createContext(serviceRow({ kind: 'git', source: 'git' }), initial);

    const result = (await getTool(ctx).execute(
      { service_id: 'incar__svc', resource_profile: 'large' },
      { target: 'mcp' },
    )) as Record<string, unknown>;

    expect(db.saveDeployConfigForService).toHaveBeenCalledOnce();
    const [, savedJson] = db.saveDeployConfigForService.mock.calls[0]!;
    expect(validateStoredConfig(savedJson)?.snapshot).toEqual({
      environment: 'production',
      resourceProfile: 'large',
      memoryLimitBytes: 2147483648,
    });
    expect(result).toMatchObject({
      status: 'updated',
      config: { resource_profile: 'large', memory_mb: 2048 },
      needs_redeploy: true,
      suggested_call: {
        tool: 'openlander_service',
        action: 'update_app',
        params: { service_id: 'incar__svc' },
      },
    });
  });

  it('saves custom memory and rejects unsafe host allocations', async () => {
    const { ctx, db } = createContext(serviceRow({ kind: 'git', source: 'git' }));

    await getTool(ctx).execute(
      { service_id: 'incar__svc', resource_profile: 'custom', memory_mb: 768 },
      { target: 'mcp' },
    );
    const [, savedJson] = db.saveDeployConfigForService.mock.calls[0]!;
    expect(validateStoredConfig(savedJson)?.snapshot).toMatchObject({
      resourceProfile: 'custom',
      memoryLimitBytes: 805306368,
    });

    await expect(
      getTool(ctx).execute(
        {
          service_id: 'incar__svc',
          resource_profile: 'custom',
          memory_mb: Number.MAX_SAFE_INTEGER,
        },
        { target: 'mcp' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_SERVICE_CONFIG', statusCode: 400 });
  });
});
