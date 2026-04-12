import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/app.js';
import { ProjectNotFoundError } from '../../src/errors.js';
import { DEFAULT_OPS_CONFIG } from '../../src/monitor/ops-types.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

function getAutomationTool(
  ctx: AppContext,
  name: 'get_automation_policy' | 'set_automation_policy',
) {
  const tool = createSharedToolRegistry(ctx, { target: 'mcp' }).find(
    (entry) => entry.name === name,
  );
  expect(tool).toBeDefined();
  return tool!;
}

function createMockContext() {
  const project = {
    id: 'project-1',
    name: 'demo-app',
  };

  const ctx = {
    db: {
      getProjectByName: vi.fn((name: string) => (name === 'demo-app' ? project : undefined)),
      getProjectOpsOverride: vi.fn(() => undefined),
      setProjectOpsOverride: vi.fn(),
    },
    opsAgent: {
      getConfig: vi.fn(() => DEFAULT_OPS_CONFIG),
    },
  } as unknown as AppContext;

  return { ctx, project };
}

describe('ops-automation tools', () => {
  describe('get_automation_policy', () => {
    it('returns policy for found project', async () => {
      const { ctx } = createMockContext();

      const result = await getAutomationTool(ctx, 'get_automation_policy').execute(
        { project_name: 'demo-app' },
        { target: 'mcp' },
      );

      expect(result).toEqual({
        project: 'demo-app',
        effective: {
          restart: 'auto',
          diagnosis: 'auto',
          apply_fixes: 'confirm',
          rollback: 'confirm',
        },
        overrides: null,
        isAutopilot: false,
        recoveryEnabled: true,
        _agent_guidance: {
          next_steps: ['Use set_automation_policy to modify settings for specific steps'],
          note: 'null policy means recovery is disabled globally',
        },
      });
    });

    it('throws ProjectNotFoundError for missing project', async () => {
      const { ctx } = createMockContext();

      expect(() =>
        getAutomationTool(ctx, 'get_automation_policy').execute(
          { project_name: 'nonexistent' },
          { target: 'mcp' },
        ),
      ).toThrow(ProjectNotFoundError);
    });

    it('returns overrides when project has custom policy', async () => {
      const { ctx } = createMockContext();
      const customOverride = { automation: { restart: 'confirm', apply_fixes: 'auto' } };
      (ctx.db.getProjectOpsOverride as any).mockReturnValue(customOverride);

      const result = await getAutomationTool(ctx, 'get_automation_policy').execute(
        { project_name: 'demo-app' },
        { target: 'mcp' },
      );

      expect(result.overrides).toEqual(customOverride.automation);
      expect(result.effective).toEqual({
        restart: 'confirm',
        diagnosis: 'auto',
        apply_fixes: 'auto',
        rollback: 'confirm',
      });
      expect(result.isAutopilot).toBe(false);
    });
  });

  describe('set_automation_policy', () => {
    it('saves partial override and returns merged policy', async () => {
      const { ctx, project } = createMockContext();

      const result = await getAutomationTool(ctx, 'set_automation_policy').execute(
        {
          project_name: 'demo-app',
          automation: {
            restart: 'confirm',
            apply_fixes: 'auto',
          },
        },
        { target: 'mcp' },
      );

      expect(ctx.db.setProjectOpsOverride).toHaveBeenCalledWith(project.id, {
        automation: {
          restart: 'confirm',
          apply_fixes: 'auto',
        },
      });

      expect(result.project).toBe('demo-app');
      expect(result._agent_guidance).toEqual({
        next_steps: ['Use get_automation_policy to verify the change'],
      });
    });

    it('throws ProjectNotFoundError for missing project', async () => {
      const { ctx } = createMockContext();

      expect(() =>
        getAutomationTool(ctx, 'set_automation_policy').execute(
          {
            project_name: 'nonexistent',
            automation: { restart: 'auto' },
          },
          { target: 'mcp' },
        ),
      ).toThrow(ProjectNotFoundError);
    });

    it('ignores undefined fields in automation object', async () => {
      const { ctx, project } = createMockContext();

      await getAutomationTool(ctx, 'set_automation_policy').execute(
        {
          project_name: 'demo-app',
          automation: {
            restart: 'confirm',
            diagnosis: undefined,
            apply_fixes: undefined,
            rollback: undefined,
          },
        },
        { target: 'mcp' },
      );

      expect(ctx.db.setProjectOpsOverride).toHaveBeenCalledWith(project.id, {
        automation: {
          restart: 'confirm',
        },
      });
    });

    it('returns isAutopilot true when all steps are auto', async () => {
      const { ctx } = createMockContext();
      const allAutoOverride = {
        automation: {
          restart: 'auto',
          diagnosis: 'auto',
          apply_fixes: 'auto',
          rollback: 'auto',
        },
      };
      (ctx.db.getProjectOpsOverride as any).mockReturnValue(allAutoOverride);

      const result = await getAutomationTool(ctx, 'set_automation_policy').execute(
        {
          project_name: 'demo-app',
          automation: {
            apply_fixes: 'auto',
            rollback: 'auto',
          },
        },
        { target: 'mcp' },
      );

      expect(result.isAutopilot).toBe(true);
    });

    it('merges with existing overrides instead of replacing', async () => {
      const { ctx, project } = createMockContext();
      const existingOverride = {
        automation: {
          rollback: 'confirm',
        },
      };
      (ctx.db.getProjectOpsOverride as any).mockReturnValue(existingOverride);

      // First call sets rollback to confirm
      await getAutomationTool(ctx, 'set_automation_policy').execute(
        {
          project_name: 'demo-app',
          automation: {
            rollback: 'confirm',
          },
        },
        { target: 'mcp' },
      );

      // Reset mock to return the merged result
      (ctx.db.getProjectOpsOverride as any).mockReturnValue({
        automation: {
          rollback: 'confirm',
          restart: 'confirm',
        },
      });

      // Second call adds restart to confirm
      const result = await getAutomationTool(ctx, 'set_automation_policy').execute(
        {
          project_name: 'demo-app',
          automation: {
            restart: 'confirm',
          },
        },
        { target: 'mcp' },
      );

      // Verify that both rollback and restart are in the merged result
      expect(ctx.db.setProjectOpsOverride).toHaveBeenLastCalledWith(project.id, {
        automation: {
          rollback: 'confirm',
          restart: 'confirm',
        },
      });

      expect(result.overrides).toEqual({
        rollback: 'confirm',
        restart: 'confirm',
      });
    });
  });
});
