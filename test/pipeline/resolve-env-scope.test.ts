import { describe, expect, it, vi } from 'vitest';

import { resolveEnvVars, resolveEnvVarsForBuild } from '../../src/pipeline/resolve-env.js';

function createEnvDeps() {
  const env = {
    getGlobalSecrets: vi.fn().mockResolvedValue({ TEST_KEY: 'global', GLOBAL_ONLY: 'global' }),
    getAll: vi.fn().mockResolvedValue({ TEST_KEY: 'project', PROJECT_ONLY: 'project' }),
    getAllWithInheritance: vi.fn().mockResolvedValue({
      TEST_KEY: 'project-environment',
      PROJECT_ONLY: 'project',
      ENVIRONMENT_ONLY: 'environment',
    }),
    getAllForService: vi.fn(
      async (_projectId: string, _serviceId: string, environmentId?: string) =>
        environmentId === undefined
          ? { TEST_KEY: 'service-shared', SERVICE_ONLY: 'service' }
          : { TEST_KEY: 'service-environment', SERVICE_ENVIRONMENT_ONLY: 'service-environment' },
    ),
  };
  return { env };
}

describe('resolveEnvVars scope precedence', () => {
  it('applies project, environment, service, inline, and generated layers in order', async () => {
    const { env } = createEnvDeps();

    const resolved = await resolveEnvVars(
      {
        projectId: 'p1',
        serviceId: 'svc1',
        environmentId: 'env-development',
        serviceEnvVars: { TEST_KEY: 'service-inline', SERVICE_INLINE_ONLY: 'service-inline' },
        inlineEnvVars: { TEST_KEY: 'inline', INLINE_ONLY: 'inline' },
        autoEnvVars: { TEST_KEY: 'auto', AUTO_ONLY: 'auto' },
        runtimeEnvVars: { TEST_KEY: 'generated', GENERATED_ONLY: 'generated' },
      },
      { env },
    );

    expect(resolved).toEqual({
      TEST_KEY: 'generated',
      GLOBAL_ONLY: 'global',
      PROJECT_ONLY: 'project',
      ENVIRONMENT_ONLY: 'environment',
      SERVICE_ONLY: 'service',
      SERVICE_ENVIRONMENT_ONLY: 'service-environment',
      SERVICE_INLINE_ONLY: 'service-inline',
      INLINE_ONLY: 'inline',
      AUTO_ONLY: 'auto',
      GENERATED_ONLY: 'generated',
    });
    expect(env.getAllWithInheritance).toHaveBeenCalledWith('p1', 'env-development');
    expect(env.getAllForService).toHaveBeenCalledWith('p1', 'svc1');
    expect(env.getAllForService).toHaveBeenCalledWith('p1', 'svc1', 'env-development');
  });

  it('uses project shared vars and skips service environment vars without an environment id', async () => {
    const { env } = createEnvDeps();

    const resolved = await resolveEnvVars(
      {
        projectId: 'p1',
        serviceId: 'svc1',
      },
      { env },
    );

    expect(resolved).toMatchObject({
      TEST_KEY: 'service-shared',
      PROJECT_ONLY: 'project',
      SERVICE_ONLY: 'service',
    });
    expect(env.getAll).toHaveBeenCalledWith('p1');
    expect(env.getAllWithInheritance).not.toHaveBeenCalled();
    expect(env.getAllForService).toHaveBeenCalledTimes(1);
    expect(env.getAllForService).toHaveBeenCalledWith('p1', 'svc1');
  });

  it('filters the fully resolved env to build-time variable prefixes', async () => {
    const env = {
      getGlobalSecrets: vi.fn().mockResolvedValue({ SECRET_ONLY: 'secret' }),
      getAll: vi.fn().mockResolvedValue({ NEXT_PUBLIC_API_URL: 'project-public' }),
      getAllWithInheritance: vi.fn().mockResolvedValue({}),
      getAllForService: vi.fn().mockResolvedValue({ VITE_REGION: 'kr' }),
    };

    const filtered = await resolveEnvVarsForBuild(
      {
        projectId: 'p1',
        serviceId: 'svc1',
        inlineEnvVars: {
          NEXT_PUBLIC_API_URL: 'inline-public',
          INTERNAL_TOKEN: 'hidden',
        },
        autoEnvVars: {
          PUBLIC_RUNTIME_URL: 'runtime-public',
        },
      },
      { env },
    );

    expect(filtered).toEqual({
      NEXT_PUBLIC_API_URL: 'inline-public',
      VITE_REGION: 'kr',
      PUBLIC_RUNTIME_URL: 'runtime-public',
    });
  });
});
