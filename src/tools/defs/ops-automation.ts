import { z } from 'zod';
import { ProjectNotFoundError } from '../../errors.js';
import { DEFAULT_OPS_CONFIG, type RecoveryAutomationPolicy } from '../../monitor/ops-types.js';
import { isAutopilot, resolveAutomationPolicy } from '../../monitor/ops-config-resolver.js';
import type { ToolDef } from './types.js';

const getAutomationPolicySchema = z.object({
  project_name: z.string().describe('Name of the project to get automation policy for'),
});

const setAutomationPolicySchema = z.object({
  project_name: z.string().describe('Name of the project to configure'),
  automation: z
    .object({
      restart: z.enum(['auto', 'confirm']).optional().describe('Container restart mode'),
      diagnosis: z.enum(['auto', 'confirm']).optional().describe('LLM crash diagnosis mode'),
      apply_fixes: z
        .enum(['auto', 'confirm'])
        .optional()
        .describe('Deterministic fix application mode (port conflicts, OOM detection)'),
      rollback: z.enum(['auto', 'confirm']).optional().describe('Rollback to previous image mode'),
    })
    .describe(
      'Step-to-mode mapping. Only specified steps are updated; others keep their current value.',
    ),
});

export const opsAutomationToolDefs: ToolDef[] = [
  {
    name: 'get_automation_policy',
    description:
      'Get the effective recovery automation policy for a project. Shows which recovery steps (restart, diagnosis, apply_fixes, rollback) are set to automatic execution vs requiring operator confirmation.',
    inputSchema: getAutomationPolicySchema,
    execute: (args, context) => {
      const projectName = args['project_name'] as string;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      const config = context.appCtx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
      const override = context.appCtx.db.getProjectOpsOverride(project.id);
      const policy = resolveAutomationPolicy(config, override);

      return {
        project: projectName,
        effective: policy,
        overrides: override?.automation ?? null,
        isAutopilot: policy ? isAutopilot(policy) : false,
        recoveryEnabled: config.recovery.enabled,
        _agent_guidance: {
          next_steps: ['Use set_automation_policy to modify settings for specific steps'],
          note: 'null policy means recovery is disabled globally',
        },
      };
    },
    targets: ['agent', 'mcp'],
  },
  {
    name: 'set_automation_policy',
    description:
      'Set per-project recovery automation policy. Each recovery step can be "auto" (executes immediately) or "confirm" (requires operator approval before executing). Use this to tune which recovery actions happen automatically vs need human confirmation.',
    inputSchema: setAutomationPolicySchema,
    execute: (args, context) => {
      const projectName = args['project_name'] as string;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      const patch: Partial<RecoveryAutomationPolicy> = {};
      const automation = args['automation'] as Record<string, string | undefined>;
      if (automation.restart !== undefined)
        patch.restart = automation.restart as 'auto' | 'confirm';
      if (automation.diagnosis !== undefined)
        patch.diagnosis = automation.diagnosis as 'auto' | 'confirm';
      if (automation.apply_fixes !== undefined)
        patch.apply_fixes = automation.apply_fixes as 'auto' | 'confirm';
      if (automation.rollback !== undefined)
        patch.rollback = automation.rollback as 'auto' | 'confirm';

      const existing = context.appCtx.db.getProjectOpsOverride(project.id);
      const merged = { ...existing?.automation, ...patch };
      context.appCtx.db.setProjectOpsOverride(project.id, { automation: merged });

      const config = context.appCtx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
      const override = context.appCtx.db.getProjectOpsOverride(project.id);
      const policy = resolveAutomationPolicy(config, override);

      return {
        project: projectName,
        effective: policy,
        overrides: override?.automation ?? null,
        isAutopilot: policy ? isAutopilot(policy) : false,
        _agent_guidance: {
          next_steps: ['Use get_automation_policy to verify the change'],
        },
      };
    },
    targets: ['agent', 'mcp'],
  },
];
