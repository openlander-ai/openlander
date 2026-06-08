import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function getExposePublicTool(ctx: AppContext) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
    (entry) => entry.name === 'expose_public',
  );
  expect(tool).toBeDefined();
  return tool!;
}

function createContext(opts: {
  projectAssignedPort: number | null;
  deployableAssignedPort: number | null | undefined;
  deployablePublicUrl?: string | null;
}) {
  const project = { id: 'demo-1', name: 'demo', assigned_port: opts.projectAssignedPort };
  const deployable =
    opts.deployableAssignedPort === undefined
      ? undefined
      : {
          id: 'demo-1__svc',
          name: 'demo__svc',
          assigned_port: opts.deployableAssignedPort,
          public_url: opts.deployablePublicUrl ?? null,
        };

  const exposeTunnel = vi.fn(async () => 'https://demo.tunnel.example');
  const ctx = {
    db: {
      getProjectByName: vi.fn(async (name: string) => (name === project.name ? project : null)),
      getDeployableForProject: vi.fn(async (id: string) =>
        id === project.id ? deployable : undefined,
      ),
    },
    pipeline: { exposeTunnel },
  } as unknown as AppContext;

  return { ctx, exposeTunnel };
}

async function withRouteEnv<T>(
  overrides: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const keys = [
    'OPENLANDER_PUBLIC_HOST',
    'OPENLANDER_CONTAINERIZED',
    'HOST_IP',
    'HOST_VPN_IP',
    'DOCKER_HOST',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    return await run();
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('expose_public assignedPort gate', () => {
  it('returns already_public without opening a tunnel when the service has an external route', async () => {
    await withRouteEnv({ OPENLANDER_PUBLIC_HOST: 'apps.example.com' }, async () => {
      const { ctx, exposeTunnel } = createContext({
        projectAssignedPort: null,
        deployableAssignedPort: 10001,
      });

      const result = await getExposePublicTool(ctx).execute(
        { project_name: 'demo' },
        { target: 'mcp' },
      );

      expect(exposeTunnel).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        status: 'already_public',
        project: 'demo',
        publicUrl: 'http://demo.apps.example.com',
        preferred_url: 'http://demo.apps.example.com',
        _agent_guidance: {
          message: expect.stringContaining('already has a reachable public route'),
          next_steps: expect.arrayContaining([
            'Do not call expose_public again unless the user explicitly asks for a temporary tunnel URL.',
          ]),
        },
      });
    });
  });

  it('uses the canonical services-row port when the project column is stale', async () => {
    await withRouteEnv({ OPENLANDER_CONTAINERIZED: 'true' }, async () => {
      const { ctx, exposeTunnel } = createContext({
        projectAssignedPort: null,
        deployableAssignedPort: 10001,
      });

      const result = await getExposePublicTool(ctx).execute(
        { project_name: 'demo' },
        { target: 'mcp' },
      );

      expect(exposeTunnel).toHaveBeenCalledWith('demo-1', 10001);
      expect(result).toMatchObject({
        status: 'exposed',
        project: 'demo',
        publicUrl: 'https://demo.tunnel.example',
      });
    });
  });

  it('falls back to the deprecated project column when no services row exists', async () => {
    await withRouteEnv({ OPENLANDER_CONTAINERIZED: 'true' }, async () => {
      const { ctx, exposeTunnel } = createContext({
        projectAssignedPort: 10002,
        deployableAssignedPort: undefined,
      });

      await getExposePublicTool(ctx).execute({ project_name: 'demo' }, { target: 'mcp' });

      expect(exposeTunnel).toHaveBeenCalledWith('demo-1', 10002);
    });
  });

  it('does not open a tunnel when neither row has a port', async () => {
    const { ctx, exposeTunnel } = createContext({
      projectAssignedPort: null,
      deployableAssignedPort: null,
    });

    await expect(
      getExposePublicTool(ctx).execute({ project_name: 'demo' }, { target: 'mcp' }),
    ).rejects.toThrow(/not running/i);
    expect(exposeTunnel).not.toHaveBeenCalled();
  });
});
