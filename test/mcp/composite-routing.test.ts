import { describe, expect, it } from 'vitest';
import { debugToolDefs } from '../../src/tools/defs/debug.js';
import { deployToolDefs } from '../../src/tools/defs/deploy.js';
import { deployPlanToolDefs } from '../../src/tools/defs/deploy-plan.js';
import { envToolDefs } from '../../src/tools/defs/env.js';
import { gitToolDefs } from '../../src/tools/defs/git.js';
import { infraToolDefs } from '../../src/tools/defs/infra.js';
import { monitoringToolDefs } from '../../src/tools/defs/monitoring.js';
import { opsAutomationToolDefs } from '../../src/tools/defs/ops-automation.js';
import { projectOpsToolDefs } from '../../src/tools/defs/project-ops.js';
import { serviceToolDefs } from '../../src/tools/defs/service.js';
import { volumeToolDefs } from '../../src/tools/defs/volume.js';
import { webhookToolDefs } from '../../src/tools/defs/webhook.js';
import type { ToolDef, ToolContext } from '../../src/tools/defs/types.js';
import {
  createCompositeTools,
  DEPLOY_ACTIONS,
  PROJECT_ACTIONS,
  PROJECT_TO_SERVICE_ALIASES,
  SERVICE_ACTIONS,
  MONITOR_ACTIONS,
  type CompositeTool,
} from '../../src/mcp/composite-tools.js';
import type { AppContext } from '../../src/app.js';

const allToolDefs: ToolDef[] = [
  ...deployToolDefs,
  ...deployPlanToolDefs,
  ...projectOpsToolDefs,
  ...envToolDefs,
  ...serviceToolDefs,
  ...volumeToolDefs,
  ...infraToolDefs,
  ...gitToolDefs,
  ...monitoringToolDefs,
  ...opsAutomationToolDefs,
  ...debugToolDefs,
  ...webhookToolDefs,
];

const composites = createCompositeTools(allToolDefs);
const mockContext: ToolContext = { target: 'mcp', appCtx: {} as AppContext };

function findComposite(name: string): CompositeTool {
  const found = composites.find((c) => c.name === name);
  if (!found) throw new Error(`Composite ${name} not found`);
  return found;
}

describe('Composite Action Routing', () => {
  describe('openlander_deploy', () => {
    const tool = findComposite('openlander_deploy');

    it('routes help action with correct structure', async () => {
      const result = (await tool.execute({ action: 'help' }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('composite', 'openlander_deploy');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('actions');
      expect(result).toHaveProperty('_agent_guidance');
      const actions = result['actions'] as Array<{
        name: string;
        description: string;
        input_schema: Record<string, unknown>;
        allowed_params: string[];
        required_params: string[];
        optional_params: string[];
      }>;
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(action).toHaveProperty('name');
        expect(action).toHaveProperty('description');
        expect(action).toHaveProperty('input_schema');
        expect(Array.isArray(action.allowed_params)).toBe(true);
        expect(Array.isArray(action.required_params)).toBe(true);
        expect(Array.isArray(action.optional_params)).toBe(true);
      }
    });

    it('returns scoped help with conditional requirements for deploy', async () => {
      const result = (await tool.execute(
        { action: 'help', params: { action_name: 'deploy' } },
        mockContext,
      )) as Record<string, unknown>;
      const actions = result['actions'] as Array<{
        name: string;
        required_one_of?: string[][];
      }>;
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        name: 'deploy',
        required_one_of: [['repo_url'], ['source', 'image']],
      });
    });

    it('returns UNKNOWN_ACTION for unknown action', async () => {
      const result = (await tool.execute({ action: 'nonexistent_action' }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('error', 'UNKNOWN_ACTION');
      expect(result).toHaveProperty('action', 'nonexistent_action');
      expect(result).toHaveProperty('composite', 'openlander_deploy');
      expect(result).toHaveProperty('available_actions');
      expect(result).toHaveProperty('_agent_guidance');
    });

    it('routes rollback_project action (validates params)', async () => {
      const result = (await tool.execute(
        { action: 'rollback_project', params: {} },
        mockContext,
      )) as Record<string, unknown>;
      expect(result).toHaveProperty('error', 'INVALID_PARAMS');
      expect(result).toHaveProperty('action', 'rollback_project');
      expect(result).toHaveProperty('composite', 'openlander_deploy');
      expect(result).toMatchObject({
        allowed_params: ['project_name'],
        required_params: ['project_name'],
        optional_params: [],
        suggested_call: {
          tool: 'openlander_deploy',
          arguments: {
            action: 'rollback_project',
            params: { project_name: '<project_name>' },
          },
        },
      });
    });

    it('routes rollback_service alias action (validates params)', async () => {
      const result = (await tool.execute(
        { action: 'rollback_service', params: {} },
        mockContext,
      )) as Record<string, unknown>;
      expect(result).toHaveProperty('error', 'INVALID_PARAMS');
      expect(result).toHaveProperty('action', 'rollback_service');
      expect(result).toHaveProperty('composite', 'openlander_deploy');
    });

    it('help action lists all registered deploy actions', async () => {
      const result = (await tool.execute({ action: 'help' }, mockContext)) as Record<
        string,
        unknown
      >;
      const actionNames = (result['actions'] as Array<{ name: string }>).map((a) => a.name);
      for (const name of DEPLOY_ACTIONS) {
        if (allToolDefs.some((d) => d.name === name)) {
          expect(actionNames).toContain(name);
        }
      }
    });
  });

  describe('openlander_project', () => {
    const tool = findComposite('openlander_project');

    it('routes help action', async () => {
      const result = (await tool.execute({ action: 'help' }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('composite', 'openlander_project');
      expect(result).toHaveProperty('actions');
      const actions = result['actions'] as Array<{ name: string }>;
      expect(actions.length).toBeGreaterThan(0);
    });

    it('returns UNKNOWN_ACTION for unknown action', async () => {
      const result = (await tool.execute({ action: 'does_not_exist' }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('error', 'UNKNOWN_ACTION');
      expect(result).toHaveProperty('composite', 'openlander_project');
    });

    it('routes stop_project action (validates params)', async () => {
      const result = (await tool.execute(
        { action: 'stop_project', params: {} },
        mockContext,
      )) as Record<string, unknown>;
      expect(result).toHaveProperty('error', 'INVALID_PARAMS');
      expect(result).toHaveProperty('action', 'stop_project');
      expect(result).toHaveProperty('composite', 'openlander_project');
    });

    it('routes restart_project action (validates params)', async () => {
      const result = (await tool.execute(
        { action: 'restart_project', params: {} },
        mockContext,
      )) as Record<string, unknown>;
      expect(result).toHaveProperty('error', 'INVALID_PARAMS');
      expect(result).toHaveProperty('action', 'restart_project');
    });
  });

  describe('openlander_service', () => {
    const tool = findComposite('openlander_service');

    it('routes help action', async () => {
      const result = (await tool.execute({ action: 'help' }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('composite', 'openlander_service');
      expect(result).toHaveProperty('actions');
      const actions = result['actions'] as Array<{ name: string }>;
      expect(actions.length).toBeGreaterThan(0);
    });

    it('returns UNKNOWN_ACTION for unknown action', async () => {
      const result = (await tool.execute({ action: 'fake_service_action' }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('error', 'UNKNOWN_ACTION');
      expect(result).toHaveProperty('composite', 'openlander_service');
    });

    it('routes create_service action (validates params)', async () => {
      const result = (await tool.execute(
        { action: 'create_service', params: {} },
        mockContext,
      )) as Record<string, unknown>;
      expect(result).toHaveProperty('error', 'INVALID_PARAMS');
      expect(result).toHaveProperty('action', 'create_service');
    });

    it('rc.2: remove_service is in MANAGED_SERVICE_ACTIONS, not openlander_service', async () => {
      // rc.2 split: openlander_service is the deployable-vocab composite,
      // and remove_service moved to openlander_managed_service. Calling
      // it on openlander_service routes through the disambiguator —
      // empty params + no service_id → falls through to deployable
      // (where remove_service is not registered, so UNKNOWN_ACTION).
      const result = (await tool.execute(
        { action: 'remove_service', params: {} },
        mockContext,
      )) as Record<string, unknown>;
      expect(result).toHaveProperty('error', 'UNKNOWN_ACTION');
      expect(result).toHaveProperty('composite', 'openlander_service');
    });
  });

  describe('openlander_monitor', () => {
    const tool = findComposite('openlander_monitor');

    it('routes help action', async () => {
      const result = (await tool.execute({ action: 'help' }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('composite', 'openlander_monitor');
      expect(result).toHaveProperty('actions');
      const actions = result['actions'] as Array<{ name: string }>;
      expect(actions.length).toBeGreaterThan(0);
    });

    it('returns UNKNOWN_ACTION for unknown action', async () => {
      const result = (await tool.execute({ action: 'invalid_monitor_op' }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('error', 'UNKNOWN_ACTION');
      expect(result).toHaveProperty('composite', 'openlander_monitor');
    });

    it('routes dismiss_alert action (validates params)', async () => {
      const result = (await tool.execute(
        { action: 'dismiss_alert', params: {} },
        mockContext,
      )) as Record<string, unknown>;
      expect(result).toHaveProperty('error', 'INVALID_PARAMS');
      expect(result).toHaveProperty('action', 'dismiss_alert');
    });
  });

  describe('help action format consistency', () => {
    it('all composites return help with consistent structure', async () => {
      for (const composite of composites) {
        const result = (await composite.execute({ action: 'help' }, mockContext)) as Record<
          string,
          unknown
        >;
        expect(result).toHaveProperty('composite', composite.name);
        expect(result).toHaveProperty('description');
        expect(result).toHaveProperty('actions');
        expect(result).toHaveProperty('_agent_guidance');

        const guidance = result['_agent_guidance'] as Record<string, unknown>;
        expect(guidance).toHaveProperty('message');
      }
    });
  });

  describe('unknown action error structure', () => {
    it('all composites return consistent error for unknown actions', async () => {
      for (const composite of composites) {
        const result = (await composite.execute({ action: '__unknown__' }, mockContext)) as Record<
          string,
          unknown
        >;
        expect(result).toEqual(
          expect.objectContaining({
            error: 'UNKNOWN_ACTION',
            action: '__unknown__',
            composite: composite.name,
          }),
        );
        const actions = result['available_actions'] as string[];
        expect(Array.isArray(actions)).toBe(true);
        expect(actions.length).toBeGreaterThan(0);
        // available_actions should be sorted
        expect(actions).toEqual([...actions].sort());
      }
    });
  });

  describe('action registry completeness', () => {
    it('deploy composite covers all DEPLOY_ACTIONS that have tool defs', async () => {
      const result = (await findComposite('openlander_deploy').execute(
        { action: 'help' },
        mockContext,
      )) as Record<string, unknown>;
      const listed = (result['actions'] as Array<{ name: string }>).map((a) => a.name);
      const expected = DEPLOY_ACTIONS.filter((name) => allToolDefs.some((d) => d.name === name));
      expect(listed).toEqual(expected);
    });

    it('project composite covers all PROJECT_ACTIONS that have tool defs', async () => {
      const result = (await findComposite('openlander_project').execute(
        { action: 'help' },
        mockContext,
      )) as Record<string, unknown>;
      const listed = (result['actions'] as Array<{ name: string }>).map((a) => a.name);
      const expected = PROJECT_ACTIONS.filter((name) => allToolDefs.some((d) => d.name === name));
      expect(listed).toEqual(expected);
    });

    it('service composite covers all SERVICE_ACTIONS that have tool defs (rc.2: alias-resolved)', async () => {
      const result = (await findComposite('openlander_service').execute(
        { action: 'help' },
        mockContext,
      )) as Record<string, unknown>;
      const listed = (result['actions'] as Array<{ name: string }>).map((a) => a.name);
      // rc.2: openlander_service is the deployable-vocab composite; its
      // action names are aliases that resolve to underlying *_project
      // tool defs via PROJECT_TO_SERVICE_ALIASES. Both direct hits and
      // alias-resolved hits count as "has a tool def".
      const aliasReverse = new Map<string, string>(
        Object.entries(PROJECT_TO_SERVICE_ALIASES).map(([legacy, alias]) => [alias, legacy]),
      );
      const expected = SERVICE_ACTIONS.filter((name) => {
        if (allToolDefs.some((d) => d.name === name)) return true;
        const legacyName = aliasReverse.get(name);
        return legacyName !== undefined && allToolDefs.some((d) => d.name === legacyName);
      });
      expect(listed).toEqual(expected);
    });

    it('monitor composite covers all MONITOR_ACTIONS that have tool defs', async () => {
      const result = (await findComposite('openlander_monitor').execute(
        { action: 'help' },
        mockContext,
      )) as Record<string, unknown>;
      const listed = (result['actions'] as Array<{ name: string }>).map((a) => a.name);
      const expected = MONITOR_ACTIONS.filter((name) => allToolDefs.some((d) => d.name === name));
      expect(listed).toEqual(expected);
    });
  });
});
