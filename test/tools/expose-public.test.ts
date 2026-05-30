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
  deployableAssignedPort: number | null | undefined; // undefined => no services row
}) {
  const project = { id: 'demo-1', name: 'demo', assigned_port: opts.projectAssignedPort };
  const deployable =
    opts.deployableAssignedPort === undefined
      ? undefined
      : { id: 'demo-1__svc', name: 'demo__svc', assigned_port: opts.deployableAssignedPort };

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

describe('expose_public assignedPort gate (S3.1 ServiceView)', () => {
  it('exposes using the canonical services-row port, overriding a stale project column', async () => {
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

  it('falls back to the deprecated project column when no services row exists', async () => {
    const { ctx, exposeTunnel } = createContext({
      projectAssignedPort: 10002,
      deployableAssignedPort: undefined,
    });

    await getExposePublicTool(ctx).execute({ project_name: 'demo' }, { target: 'mcp' });

    expect(exposeTunnel).toHaveBeenCalledWith('demo-1', 10002);
  });

  it('throws "not running" and never opens a tunnel when neither row has a port', async () => {
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
