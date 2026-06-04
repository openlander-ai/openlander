import { describe, expect, it } from 'vitest';
import { debugToolDefs } from '../../src/tools/defs/debug.js';
import { deployableServiceToolDefs } from '../../src/tools/defs/deployable-service.js';
import { deployToolDefs } from '../../src/tools/defs/deploy.js';
import { deployPlanToolDefs } from '../../src/tools/defs/deploy-plan.js';
import { envToolDefs } from '../../src/tools/defs/env.js';
import { gitToolDefs } from '../../src/tools/defs/git.js';
import { infraToolDefs } from '../../src/tools/defs/infra.js';
import { monitoringToolDefs } from '../../src/tools/defs/monitoring.js';
import { projectOpsToolDefs } from '../../src/tools/defs/project-ops.js';
import { serviceToolDefs } from '../../src/tools/defs/service.js';
import { volumeToolDefs } from '../../src/tools/defs/volume.js';
import type { ToolDef, ToolContext } from '../../src/tools/defs/types.js';
import {
  createCompositeTools,
  DEPLOY_ACTIONS,
  PROJECT_ACTIONS,
  SERVICE_ACTIONS,
  MONITOR_ACTIONS,
  type CompositeTool,
} from '../../src/mcp/composite-tools.js';
import type { AppContext } from '../../src/app.js';

const allToolDefs: ToolDef[] = [
  ...deployToolDefs,
  ...deployableServiceToolDefs,
  ...deployPlanToolDefs,
  ...projectOpsToolDefs,
  ...envToolDefs,
  ...serviceToolDefs,
  ...volumeToolDefs,
  ...infraToolDefs,
  ...gitToolDefs,
  ...monitoringToolDefs,
  ...debugToolDefs,
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
      const actions = result['actions'] as Array<{ name: string; description: string }>;
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(action).toHaveProperty('name');
        expect(action).toHaveProperty('description');
        expect(action).toHaveProperty('input_schema');
        expect(action).toHaveProperty('allowed_params');
        expect(action).toHaveProperty('required_params');
        expect(action).toHaveProperty('optional_params');
      }
    });

    it('returns one action contract when help is scoped by action_name', async () => {
      const result = (await tool.execute(
        { action: 'help', params: { action_name: 'create_deploy_plan' } },
        mockContext,
      )) as Record<string, unknown>;

      expect(result).toHaveProperty('composite', 'openlander_deploy');
      expect(result).not.toHaveProperty('actions');
      const action = result['action'] as Record<string, unknown>;
      expect(action).toMatchObject({
        name: 'create_deploy_plan',
        allowed_params: expect.arrayContaining(['name', 'repo_url', 'source', 'image']),
        optional_params: expect.arrayContaining(['name']),
        required_one_of: [['repo_url'], ['source', 'image']],
      });
      expect(action['allowed_params']).not.toEqual(expect.arrayContaining(['project_name']));
      const inputSchema = action['input_schema'] as Record<string, unknown>;
      expect(inputSchema).not.toHaveProperty('$schema');
      expect(inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
    });

    it('rejects unknown top-level params with machine-readable contract details', async () => {
      const result = (await tool.execute(
        {
          action: 'create_deploy_plan',
          params: {
            source: 'image',
            image: 'httpd:latest',
            project_name: 'qa-final-check',
          },
        },
        mockContext,
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        error: 'INVALID_PARAMS',
        action: 'create_deploy_plan',
        composite: 'openlander_deploy',
        unknown_params: ['project_name'],
        allowed_params: expect.arrayContaining(['name', 'image', 'source']),
        required_params: [],
        optional_params: expect.arrayContaining(['name', 'image', 'source']),
        suggested_call: {
          tool: 'openlander_deploy',
          arguments: {
            action: 'create_deploy_plan',
            params: {
              source: 'image',
              image: 'httpd:latest',
            },
          },
        },
      });
      expect(result['allowed_params']).not.toEqual(expect.arrayContaining(['project_name']));
      const inputSchema = result['input_schema'] as Record<string, unknown>;
      expect(inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
      const guidance = result['_agent_guidance'] as Record<string, unknown>;
      expect(guidance['message']).toContain('project_name');
    });

    it('rejects deploy_app new app naming through project_name', async () => {
      const result = (await tool.execute(
        {
          action: 'deploy_app',
          params: {
            source: 'image',
            image: 'httpd:latest',
            project_name: 'qa-final-check',
          },
        },
        mockContext,
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        error: 'INVALID_PARAMS',
        action: 'deploy_app',
        composite: 'openlander_deploy',
        allowed_params: expect.arrayContaining(['name', 'project_name', 'image']),
        suggested_call: {
          tool: 'openlander_deploy',
          arguments: {
            action: 'help',
            params: { action_name: 'deploy_app' },
          },
        },
      });
      expect(String(result['details'])).toContain('new app deploys');
      const inputSchema = result['input_schema'] as Record<string, unknown>;
      expect(inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
      const guidance = result['_agent_guidance'] as Record<string, unknown>;
      expect(guidance['message']).toContain('Invalid parameter combination');
    });

    it('rejects deploy_app domain shortcut so agents use add_domain_route', async () => {
      const result = (await tool.execute(
        {
          action: 'deploy_app',
          params: {
            source: 'image',
            image: 'httpd:latest',
            name: 'qa-final-check',
            domain: 'api.example.com',
          },
        },
        mockContext,
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        error: 'INVALID_PARAMS',
        action: 'deploy_app',
        composite: 'openlander_deploy',
        unknown_params: ['domain'],
        allowed_params: expect.not.arrayContaining(['domain']),
        suggested_call: {
          tool: 'openlander_deploy',
          arguments: {
            action: 'deploy_app',
            params: {
              source: 'image',
              image: 'httpd:latest',
              name: 'qa-final-check',
            },
          },
        },
      });
      const guidance = result['_agent_guidance'] as Record<string, unknown>;
      expect(guidance['message']).toContain('domain');
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
      expect(result).toMatchObject({
        suggested_call: {
          tool: 'openlander_deploy',
          arguments: { action: 'help' },
        },
      });
    });

    it('routes rollback_service action (validates params)', async () => {
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
      expect(actions.map((action) => action.name)).toContain('create_project');
    });

    it('returns UNKNOWN_ACTION for unknown action', async () => {
      const result = (await tool.execute({ action: 'does_not_exist' }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('error', 'UNKNOWN_ACTION');
      expect(result).toHaveProperty('composite', 'openlander_project');
    });

    it('rejects removed project runtime actions', async () => {
      const result = (await tool.execute(
        { action: 'redeploy_project', params: {} },
        mockContext,
      )) as Record<string, unknown>;
      expect(result).toHaveProperty('error', 'UNKNOWN_ACTION');
      expect(result).toHaveProperty('action', 'redeploy_project');
      expect(result).toHaveProperty('composite', 'openlander_project');
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
      expect(actions.map((action) => action.name)).toContain('update_application_source');
    });

    it('returns UNKNOWN_ACTION for unknown action', async () => {
      const result = (await tool.execute({ action: 'fake_service_action' }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('error', 'UNKNOWN_ACTION');
      expect(result).toHaveProperty('composite', 'openlander_service');
    });

    it('does not expose managed create_service action', async () => {
      const result = (await tool.execute(
        { action: 'create_service', params: {} },
        mockContext,
      )) as Record<string, unknown>;
      expect(result).toHaveProperty('error', 'UNKNOWN_ACTION');
      expect(result).toHaveProperty('action', 'create_service');
    });

    it('rejects branch as an unknown redeploy_app action param', async () => {
      const result = (await tool.execute(
        {
          action: 'redeploy_app',
          params: { service_id: 'app__svc', branch: 'staging' },
        },
        mockContext,
      )) as Record<string, unknown>;

      expect(result).toMatchObject({
        error: 'INVALID_PARAMS',
        action: 'redeploy_app',
        composite: 'openlander_service',
        unknown_params: ['branch'],
        allowed_params: expect.not.arrayContaining(['branch']),
      });
      const guidance = result['_agent_guidance'] as Record<string, unknown>;
      expect(String(guidance['message'])).toContain('branch');
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
        expect(result).toMatchObject({
          suggested_call: {
            tool: composite.name,
            arguments: { action: 'help' },
          },
        });
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

    it('service composite covers all SERVICE_ACTIONS that have tool defs', async () => {
      const result = (await findComposite('openlander_service').execute(
        { action: 'help' },
        mockContext,
      )) as Record<string, unknown>;
      const listed = (result['actions'] as Array<{ name: string }>).map((a) => a.name);
      const expected = SERVICE_ACTIONS.filter((name) => allToolDefs.some((d) => d.name === name));
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
