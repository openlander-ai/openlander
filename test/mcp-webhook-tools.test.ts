import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../src/app.js';
import { ProjectNotFoundError } from '../src/errors.js';
import { webhookToolDefs } from '../src/tools/defs/webhook.js';
import type { ToolDef, ToolTarget } from '../src/tools/defs/types.js';
import { createSharedToolRegistry } from './tools/shared-tool-registry.js';

interface LegacyToolSpec {
  name: string;
  inputSchema: ToolDef['inputSchema'];
  execute: (
    args: Record<string, unknown>,
    context: {
      target: ToolTarget;
    },
  ) => Promise<unknown> | unknown;
}

function createMockContext() {
  const db = {
    getProjectByName: vi.fn(),
    getWebhookConfigs: vi.fn(),
    setWebhookConfig: vi.fn(),
    setWebhookEnabled: vi.fn(),
  };

  const webhookManager = {
    generateSecret: vi.fn(),
  };

  const ctx = {
    db,
    webhookManager,
  } as unknown as AppContext;

  return {
    ctx,
    db,
    webhookManager,
  };
}

function createWebhookRegistry(appCtx: AppContext): LegacyToolSpec[] {
  return webhookToolDefs.map((def) => ({
    name: def.name,
    inputSchema: def.inputSchema,
    execute: (args, context) =>
      def.execute(args, {
        target: context.target,
        appCtx,
      }),
  }));
}

function getTool(ctx: AppContext, name: string) {
  const tool = [
    ...createSharedToolRegistry(ctx, { target: 'mcp' }),
    ...createWebhookRegistry(ctx),
  ].find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe('MCP webhook tools', () => {
  it('enable_webhook creates config and returns webhook info', () => {
    const { ctx, db, webhookManager } = createMockContext();
    db.getProjectByName.mockReturnValue({ id: 'proj-1', name: 'demo' });
    db.getWebhookConfigs.mockReturnValue([]);
    webhookManager.generateSecret.mockReturnValue('proj-1.super-secret');

    const tool = getTool(ctx, 'enable_webhook');
    const result = tool.execute(
      {
        project_name: 'demo',
        source: 'github',
        branch_filter: 'develop',
      },
      { target: 'mcp' },
    ) as Record<string, unknown>;

    expect(db.setWebhookConfig).toHaveBeenCalledWith({
      id: expect.any(String),
      projectId: 'proj-1',
      source: 'github',
      secret: 'proj-1.super-secret',
      branchFilter: 'develop',
      enabled: true,
    });
    expect(result).toMatchObject({
      source: 'github',
      secret: 'proj-1.super-secret',
      enabled: true,
      branchFilter: 'develop',
      webhookPath: '/api/webhooks/proj-1/github',
      reused: false,
    });
    expect(typeof result.id).toBe('string');
  });

  it('enable_webhook returns error for non-existent project', () => {
    const { ctx, db } = createMockContext();
    db.getProjectByName.mockReturnValue(undefined);

    const tool = getTool(ctx, 'enable_webhook');

    expect(() =>
      tool.execute(
        {
          project_name: 'missing-project',
          source: 'github',
        },
        { target: 'mcp' },
      ),
    ).toThrow(ProjectNotFoundError);
  });

  it('disable_webhook disables existing config', () => {
    const { ctx, db } = createMockContext();
    db.getProjectByName.mockReturnValue({ id: 'proj-1', name: 'demo' });
    db.getWebhookConfigs.mockReturnValue([
      {
        id: 'wh-1',
        source: 'github',
        enabled: 1,
        branch_filter: 'main',
        secret: 'proj-1.abc123',
      },
    ]);

    const tool = getTool(ctx, 'disable_webhook');
    const result = tool.execute(
      {
        project_name: 'demo',
        source: 'github',
      },
      { target: 'mcp' },
    );

    expect(db.setWebhookEnabled).toHaveBeenCalledWith('wh-1', false);
    expect(result).toEqual({
      status: 'disabled',
      project: 'demo',
      source: 'github',
    });
  });

  it('disable_webhook returns error when no webhook found', () => {
    const { ctx, db } = createMockContext();
    db.getProjectByName.mockReturnValue({ id: 'proj-1', name: 'demo' });
    db.getWebhookConfigs.mockReturnValue([]);

    const tool = getTool(ctx, 'disable_webhook');

    expect(() =>
      tool.execute(
        {
          project_name: 'demo',
          source: 'gitlab',
        },
        { target: 'mcp' },
      ),
    ).toThrow('WEBHOOK_NOT_FOUND: No webhook configured for gitlab on project demo');

    expect(db.setWebhookEnabled).not.toHaveBeenCalled();
  });

  it('get_webhook_config returns all webhooks with masked secrets', () => {
    const { ctx, db } = createMockContext();
    db.getProjectByName.mockReturnValue({ id: 'proj-1', name: 'demo' });
    db.getWebhookConfigs.mockReturnValue([
      {
        id: 'wh-gh',
        source: 'github',
        enabled: 1,
        branch_filter: 'main',
        secret: 'proj-1.1234567890abcdef',
      },
      {
        id: 'wh-gl',
        source: 'gitlab',
        enabled: 0,
        branch_filter: 'release',
        secret: 'proj-1.abcdef1234567890',
      },
    ]);

    const tool = getTool(ctx, 'get_webhook_config');
    const result = tool.execute(
      {
        project_name: 'demo',
      },
      { target: 'mcp' },
    ) as {
      count: number;
      webhooks: Array<{ secret: string; enabled: boolean }>;
    };

    expect(result.count).toBe(2);
    expect(result.webhooks).toHaveLength(2);
    expect(result.webhooks[0]?.secret).toBe('proj-1.1...');
    expect(result.webhooks[1]?.secret).toBe('proj-1.a...');
    expect(result.webhooks[0]?.enabled).toBe(true);
    expect(result.webhooks[1]?.enabled).toBe(false);
    expect(result.webhooks.every((entry) => entry.secret.endsWith('...'))).toBe(true);
  });

  it('get_webhook_config returns empty list for project with no webhooks', () => {
    const { ctx, db } = createMockContext();
    db.getProjectByName.mockReturnValue({ id: 'proj-1', name: 'demo' });
    db.getWebhookConfigs.mockReturnValue([]);

    const tool = getTool(ctx, 'get_webhook_config');
    const result = tool.execute(
      {
        project_name: 'demo',
      },
      { target: 'mcp' },
    );

    expect(result).toEqual({
      count: 0,
      webhooks: [],
    });
  });

  it('enable_webhook reuses existing disabled webhook credentials', () => {
    const { ctx, db, webhookManager } = createMockContext();
    db.getProjectByName.mockReturnValue({ id: 'proj-1', name: 'demo' });
    db.getWebhookConfigs.mockReturnValue([
      {
        id: 'wh-existing',
        source: 'github',
        enabled: 0,
        branch_filter: 'main',
        secret: 'proj-1.existing-secret',
      },
    ]);

    const tool = getTool(ctx, 'enable_webhook');
    const result = tool.execute(
      {
        project_name: 'demo',
        source: 'github',
        branch_filter: 'develop',
      },
      { target: 'mcp' },
    ) as Record<string, unknown>;

    expect(db.setWebhookEnabled).toHaveBeenCalledWith('wh-existing', true);
    expect(db.setWebhookConfig).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'wh-existing',
      source: 'github',
      secret: 'proj-1.existing-secret',
      enabled: true,
      reused: true,
    });
    expect(result._agent_guidance).toMatchObject({
      next_steps: expect.arrayContaining([
        expect.stringContaining('existing GitHub webhook settings are still valid'),
      ]),
    });
  });

  it('enable_webhook generates new credentials when no existing webhook', () => {
    const { ctx, db, webhookManager } = createMockContext();
    db.getProjectByName.mockReturnValue({ id: 'proj-1', name: 'demo' });
    db.getWebhookConfigs.mockReturnValue([]);
    webhookManager.generateSecret.mockReturnValue('proj-1.new-secret');

    const tool = getTool(ctx, 'enable_webhook');
    const result = tool.execute(
      {
        project_name: 'demo',
        source: 'github',
      },
      { target: 'mcp' },
    ) as Record<string, unknown>;

    expect(db.setWebhookConfig).toHaveBeenCalledWith({
      id: expect.any(String),
      projectId: 'proj-1',
      source: 'github',
      secret: 'proj-1.new-secret',
      branchFilter: undefined,
      enabled: true,
    });
    expect(db.setWebhookEnabled).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      source: 'github',
      secret: 'proj-1.new-secret',
      enabled: true,
      reused: false,
    });
    expect(result._agent_guidance).toMatchObject({
      next_steps: expect.arrayContaining([
        expect.stringContaining('Configure this webhook URL and secret in git provider settings'),
      ]),
    });
  });

  it('enable_webhook generates new credentials when existing webhook is enabled', () => {
    const { ctx, db, webhookManager } = createMockContext();
    db.getProjectByName.mockReturnValue({ id: 'proj-1', name: 'demo' });
    db.getWebhookConfigs.mockReturnValue([
      {
        id: 'wh-existing',
        source: 'github',
        enabled: 1,
        branch_filter: 'main',
        secret: 'proj-1.existing-secret',
      },
    ]);
    webhookManager.generateSecret.mockReturnValue('proj-1.new-secret');

    const tool = getTool(ctx, 'enable_webhook');
    const result = tool.execute(
      {
        project_name: 'demo',
        source: 'github',
      },
      { target: 'mcp' },
    ) as Record<string, unknown>;

    expect(db.setWebhookConfig).toHaveBeenCalledWith({
      id: expect.any(String),
      projectId: 'proj-1',
      source: 'github',
      secret: 'proj-1.new-secret',
      branchFilter: undefined,
      enabled: true,
    });
    expect(db.setWebhookEnabled).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reused: false,
    });
  });
});
