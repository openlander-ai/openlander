import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/app.js';
import { createOpenLanderProjectCompositeTool } from '../../src/mcp/composite-tools.js';
import { engagementToolDefs } from '../../src/tools/defs/engagement.js';
import type { ToolContext } from '../../src/tools/defs/types.js';
import type { RequestIdentity } from '../../src/types/identity.js';

function context(identity: RequestIdentity) {
  const list = vi.fn(async () => [
    {
      id: 'engagement-1',
      customer_name: 'Atlas Synthetic',
      title: 'Atlas rollout',
      status: 'active',
      runtime_health: 'healthy',
      project_count: 2,
      delivery_summary: {
        total: 3,
        blocker_count: 0,
        by_status: {
          draft: 0,
          in_review: 1,
          revision_requested: 0,
          approved: 0,
          ready: 1,
          delivered: 1,
          cancelled: 0,
        },
      },
      blocker_count: 0,
      recent_activity_at: '2026-07-25T00:00:00.000Z',
    },
  ]);
  const get = vi.fn(async () => ({
    id: 'engagement-1',
    customer_name: 'Atlas Synthetic',
    title: 'Atlas rollout',
    status: 'active',
    runtime_health: 'healthy',
    project_count: 2,
    delivery_summary: {
      total: 3,
      blocker_count: 0,
      by_status: {
        draft: 0,
        in_review: 1,
        revision_requested: 0,
        approved: 0,
        ready: 1,
        delivered: 1,
        cancelled: 0,
      },
    },
    blocker_count: 0,
    recent_activity_at: '2026-07-25T00:00:00.000Z',
    projects: [],
    blockers: [],
  }));
  const appCtx = {
    engagementService: {
      list,
      get,
    },
  } as unknown as AppContext;
  return {
    list,
    get,
    value: { target: 'mcp', appCtx, identity } satisfies ToolContext,
  };
}

describe('Engagement MCP scope boundary', () => {
  const tool = createOpenLanderProjectCompositeTool(engagementToolDefs);

  it('allows an organization-scoped token to read Engagement portfolio summaries', async () => {
    const { value, list } = context({
      source: 'mcp',
      mcpScopeKind: 'org',
      mcpScopeProjectId: null,
      mcpScopeServiceId: null,
    });

    const result = (await tool.execute(
      { action: 'list_engagements', params: {} },
      value,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'ok',
      count: 1,
      engagements: [
        {
          engagement_id: 'engagement-1',
          project_count: 2,
          delivery_count: 3,
          blocker_count: 0,
        },
      ],
    });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('allows an organization-scoped token to read one Engagement', async () => {
    const { value, get } = context({
      source: 'mcp',
      mcpScopeKind: 'org',
      mcpScopeProjectId: null,
      mcpScopeServiceId: null,
    });

    const result = (await tool.execute(
      { action: 'get_engagement', params: { engagement_id: 'engagement-1' } },
      value,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      status: 'ok',
      engagement_id: 'engagement-1',
      summary: {
        project_count: 2,
        delivery_count: 3,
        blocker_count: 0,
      },
      projects: [],
      blockers: [],
    });
    expect(get).toHaveBeenCalledWith('engagement-1');
  });

  const scopedIdentities = [
    {
      source: 'mcp' as const,
      mcpScopeKind: 'project' as const,
      mcpScopeProjectId: 'project-1',
      mcpScopeServiceId: null,
    },
    {
      source: 'mcp' as const,
      mcpScopeKind: 'service' as const,
      mcpScopeProjectId: 'project-1',
      mcpScopeServiceId: 'service-1',
    },
  ];

  it.each(scopedIdentities)(
    'rejects $mcpScopeKind tokens before any sibling Project list',
    async (identity) => {
      const { value, list } = context(identity);

      const result = (await tool.execute(
        { action: 'list_engagements', params: {} },
        value,
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        error: 'SCOPE_VIOLATION',
        code: 'SCOPE_VIOLATION',
        details: {
          tokenScopeKind: identity.mcpScopeKind,
          reason: 'target_required',
        },
      });
      expect(list).not.toHaveBeenCalled();
    },
  );

  it.each(scopedIdentities)(
    'rejects $mcpScopeKind tokens before any sibling Engagement detail read',
    async (identity) => {
      const { value, get } = context(identity);

      const result = (await tool.execute(
        { action: 'get_engagement', params: { engagement_id: 'engagement-1' } },
        value,
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        error: 'SCOPE_VIOLATION',
        code: 'SCOPE_VIOLATION',
        details: {
          tokenScopeKind: identity.mcpScopeKind,
          reason: 'target_required',
        },
      });
      expect(get).not.toHaveBeenCalled();
    },
  );
});
