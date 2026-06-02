import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createOpenLanderProjectCompositeTool } from '../../src/mcp/composite-tools.js';
import type { ToolContext } from '../../src/tools/defs/types.js';
import { projectOpsToolDefs } from '../../src/tools/defs/project-ops.js';

function projectRow(input: {
  id: string;
  name: string;
  displayName?: string;
  description?: string | null;
  tags?: string | null;
}) {
  return {
    id: input.id,
    name: input.name,
    display_name: input.displayName ?? input.name,
    description: input.description ?? null,
    tags: input.tags ?? null,
    archived_at: null,
  };
}

function contextWithDb(db: Record<string, unknown>): ToolContext {
  return {
    target: 'mcp',
    appCtx: { db } as unknown as AppContext,
  };
}

describe('openlander_project.create_project', () => {
  it('creates an empty project group and points the agent at project-first deployment', async () => {
    const db = {
      getProjectByName: vi.fn(async () => undefined),
      createProjectGroup: vi.fn(async (input: Record<string, unknown>) =>
        projectRow({
          id: String(input['id']),
          name: String(input['name']),
          displayName: String(input['displayName']),
          description: input['description'] as string | null,
          tags: input['tags'] as string | null,
        }),
      ),
    };
    const tool = createOpenLanderProjectCompositeTool(projectOpsToolDefs);

    const result = (await tool.execute(
      {
        action: 'create_project',
        params: {
          name: 'new-app',
          display_name: 'New App',
          description: 'QA project',
          tags: ['qa', 'qa'],
        },
      },
      contextWithDb(db),
    )) as Record<string, unknown>;

    expect(db.createProjectGroup).toHaveBeenCalledWith({
      id: expect.any(String),
      name: 'new-app',
      displayName: 'New App',
      description: 'QA project',
      tags: JSON.stringify(['qa']),
    });
    expect(result).toMatchObject({
      status: 'created',
      project_id: expect.any(String),
      project_name: 'new-app',
      project: {
        name: 'new-app',
        display_name: 'New App',
        description: 'QA project',
        tags: ['qa'],
      },
      suggested_call: {
        tool: 'openlander_managed_service',
        arguments: {
          action: 'create_service',
          params: {
            project_id: expect.any(String),
            template: 'postgresql',
          },
        },
      },
    });
    const guidance = result['_agent_guidance'] as { next_steps: string[] };
    expect(guidance.next_steps.join('\n')).toContain('deploy_app');
    expect(guidance.next_steps.join('\n')).toContain('target_project_id');
  });

  it('is idempotent when the project group already exists', async () => {
    const existing = projectRow({ id: 'proj-existing', name: 'existing-app', displayName: '' });
    const db = {
      getProjectByName: vi.fn(async () => existing),
      createProjectGroup: vi.fn(),
    };
    const tool = createOpenLanderProjectCompositeTool(projectOpsToolDefs);

    const result = (await tool.execute(
      { action: 'create_project', params: { name: 'existing-app' } },
      contextWithDb(db),
    )) as Record<string, unknown>;

    expect(db.createProjectGroup).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'exists',
      project_id: 'proj-existing',
      project: {
        display_name: 'existing-app',
      },
      suggested_call: {
        arguments: {
          action: 'create_service',
          params: { project_id: 'proj-existing' },
        },
      },
    });
  });
});
