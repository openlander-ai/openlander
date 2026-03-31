import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../src/app.js';
import type { EnvironmentRow } from '../src/db/index.js';
import { environmentToolDefs } from '../src/tools/defs/environment.js';
import type { ToolDef, ToolTarget } from '../src/tools/defs/types.js';
import { createSharedToolRegistry } from './tools/shared-tool-registry.js';

interface LegacyToolSpec {
  name: string;
  description: string;
  inputSchema: ToolDef['inputSchema'];
  execute: (args: Record<string, unknown>, context: { target: ToolTarget }) => Promise<any> | any;
  targets?: ToolDef['targets'];
}

function createEnvironmentRow(partial: Partial<EnvironmentRow>): EnvironmentRow {
  return {
    id: partial.id ?? 'proj-1-production',
    project_id: partial.project_id ?? 'proj-1',
    type: partial.type ?? 'production',
    branch: partial.branch ?? 'main',
    status: partial.status ?? 'idle',
    assigned_port: partial.assigned_port ?? null,
    container_id: partial.container_id ?? null,
    image_tag: partial.image_tag ?? null,
    previous_image_tag: partial.previous_image_tag ?? null,
    public_url: partial.public_url ?? null,
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-01-01T00:00:00.000Z',
  };
}

function createMockContext(options?: {
  project?: { id: string; name: string } | null;
  environments?: EnvironmentRow[];
}) {
  const project =
    options && 'project' in options ? options.project : { id: 'proj-1', name: 'my-app' };
  const environments = options?.environments ?? [];

  const db = {
    getProjectByName: vi.fn(() => project),
    getEnvironmentsByProject: vi.fn(() => environments),
  };

  const ctx = {
    db,
  } as unknown as AppContext;

  return { ctx, db };
}

function getTool(ctx: AppContext, name: string) {
  const environmentRegistry: LegacyToolSpec[] = environmentToolDefs.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    targets: def.targets,
    execute: (args, context) =>
      def.execute(args, {
        target: context.target,
        appCtx: ctx,
      }),
  }));

  const tool = [...createSharedToolRegistry(ctx, { target: 'mcp' }), ...environmentRegistry].find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

describe('MCP environment tools', () => {
  it('list_environments returns all environments', () => {
    const envs: EnvironmentRow[] = [
      createEnvironmentRow({
        id: 'project-123-production',
        project_id: 'project-123',
        type: 'production',
        branch: 'main',
        status: 'running',
        container_id: 'container-prod',
        public_url: 'https://prod.example.com',
      }),
      createEnvironmentRow({
        id: 'project-123-development',
        project_id: 'project-123',
        type: 'development',
        branch: 'feature/foo',
        status: 'idle',
        container_id: null,
        public_url: null,
      }),
    ];
    const { ctx } = createMockContext({
      project: { id: 'project-123', name: 'my-app' },
      environments: envs,
    });
    const tool = getTool(ctx, 'list_environments');

    const result = tool.execute({ project_name: 'my-app' }, { target: 'mcp' });

    expect(result).toEqual({
      count: 2,
      environments: [
        {
          id: 'project-123-production',
          type: 'production',
          branch: 'main',
          status: 'running',
          containerId: 'container-prod',
          publicUrl: 'https://prod.example.com',
        },
        {
          id: 'project-123-development',
          type: 'development',
          branch: 'feature/foo',
          status: 'idle',
          containerId: null,
          publicUrl: null,
        },
      ],
    });
  });
});
