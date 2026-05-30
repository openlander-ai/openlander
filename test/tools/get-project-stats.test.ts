import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function getProjectStatsTool(ctx: AppContext) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
    (entry) => entry.name === 'get_project_stats',
  );
  expect(tool).toBeDefined();
  return tool!;
}

function createContext(params: {
  project: Record<string, unknown> & { id: string; name: string };
  deployable: Record<string, unknown> | undefined;
}) {
  const getContainerStats = vi.fn();
  const ctx = {
    db: {
      getProject: vi.fn(async (id: string) =>
        id === params.project.id ? params.project : undefined,
      ),
      getProjectByName: vi.fn(async (name: string) =>
        name === params.project.name ? params.project : undefined,
      ),
      getDeployableForProject: vi.fn(async (id: string) =>
        id === params.project.id ? params.deployable : undefined,
      ),
    },
    docker: { getContainerStats, inspectContainer: vi.fn() },
  } as unknown as AppContext;
  return { ctx, getContainerStats };
}

// MCP results are JSON.stringify-ed, so an `undefined` field is omitted.
async function runWire(ctx: AppContext) {
  const result = await getProjectStatsTool(ctx).execute(
    { project_name: 'demo' },
    { target: 'mcp' },
  );
  return JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
}

describe('get_project_stats project-resolved omit-contract (S3.4 ServiceView)', () => {
  it('emits the canonical services-row status on the not-running early return', async () => {
    // The project row carries no status column post-0012 (services row is
    // canonical); the services row reports 'stopped'.
    const { ctx, getContainerStats } = createContext({
      project: { id: 'p1', name: 'demo' },
      deployable: { id: 'p1__svc', name: 'demo__svc', status: 'stopped', container_id: 'c1' },
    });

    const wire = await runWire(ctx);

    expect(wire).toMatchObject({ project: 'demo', status: 'stopped' });
    // not running ⇒ the stats path is skipped
    expect(getContainerStats).not.toHaveBeenCalled();
  });

  it('omits status on the wire when there is no services row', async () => {
    // No services row and no project status column ⇒ historic wire omitted
    // `status`. The view normalizes that bottom to 'idle', so the adapter
    // must restore the omit — the key must be absent, not 'idle'.
    const { ctx, getContainerStats } = createContext({
      project: { id: 'p1', name: 'demo' },
      deployable: undefined,
    });

    const wire = await runWire(ctx);

    expect(wire).not.toHaveProperty('status');
    expect(wire).toMatchObject({ project: 'demo', service: null });
    expect(getContainerStats).not.toHaveBeenCalled();
  });
});
