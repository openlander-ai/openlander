/**
 * Guardrails for the Project=group / Service=deployable MCP split.
 *
 * The old *_project runtime aliases are intentionally gone. Runtime actions are
 * exposed directly on openlander_service. Managed infrastructure lifecycle stays
 * on openlander_managed_service.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { debugToolDefs } from '../../src/tools/defs/debug.js';
import { deliveryToolDefs } from '../../src/tools/defs/delivery.js';
import { engagementToolDefs } from '../../src/tools/defs/engagement.js';
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
import type { ToolContext, ToolDef } from '../../src/tools/defs/types.js';
import {
  createOpenLanderManagedServiceCompositeTool,
  createOpenLanderProjectCompositeTool,
  createOpenLanderServiceCompositeTool,
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
  ...deliveryToolDefs,
  ...engagementToolDefs,
];

const mockContext: ToolContext = { target: 'mcp', appCtx: {} as AppContext };
// Actions removed from openlander_project that should still surface as
// UNKNOWN_ACTION. Project group archive/unarchive are exposed as real
// approval-gated actions; deployable archive_service/unarchive_service are
// exposed on openlander_service behind the same approval queue.
const removedProjectRuntimeActions = [
  'stop_project',
  'start_project',
  'restart_project',
  'redeploy_project',
  'rollback_project',
  'update_project_config',
] as const;
const projectLifecycleActions = ['archive_project', 'unarchive_project'] as const;

describe('openlander_project runtime aliases removed', () => {
  let tool: CompositeTool;

  beforeEach(() => {
    tool = createOpenLanderProjectCompositeTool(allToolDefs);
  });

  it('does not list project-level runtime actions in help', async () => {
    const result = (await tool.execute({ action: 'help' }, mockContext)) as {
      actions: Array<{ name: string }>;
    };
    const actionNames = result.actions.map((action) => action.name);
    for (const removed of removedProjectRuntimeActions) {
      expect(actionNames).not.toContain(removed);
    }
    for (const action of projectLifecycleActions) {
      expect(actionNames).toContain(action);
    }
  });

  it('returns UNKNOWN_ACTION for removed project-level runtime actions', async () => {
    for (const removed of removedProjectRuntimeActions) {
      const result = (await tool.execute({ action: removed, params: {} }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('error', 'UNKNOWN_ACTION');
      expect(result).toHaveProperty('action', removed);
      expect(result).toHaveProperty('composite', 'openlander_project');
    }
  });

  it('exposes project group archive/restore as real approval-gated actions', async () => {
    for (const action of projectLifecycleActions) {
      const result = (await tool.execute({ action, params: {} }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('error', 'INVALID_PARAMS');
      expect(result).toHaveProperty('action', action);
      expect(result).toHaveProperty('composite', 'openlander_project');
    }
  });

  it('routes legacy app lifecycle aliases to the explicit project/service lifecycle tools', async () => {
    const result = (await tool.execute(
      { action: 'archive_app', params: {} },
      mockContext,
    )) as Record<string, unknown>;
    const guidance = result['_agent_guidance'] as Record<string, unknown>;

    expect(result).toHaveProperty('error', 'HUMAN_UI_ONLY');
    expect(String(guidance['message'])).toContain('archive_project');
    expect(String(guidance['message'])).toContain('service_id');
  });

  it('does not attach lifecycle-tool guidance to hard-delete aliases', async () => {
    const result = (await tool.execute(
      { action: 'delete_app', params: {} },
      mockContext,
    )) as Record<string, unknown>;
    const guidance = result['_agent_guidance'] as Record<string, unknown>;

    expect(result).toHaveProperty('error', 'HUMAN_UI_ONLY');
    expect(String(guidance['message'])).not.toContain('archive_project');
    expect(String(guidance['message'])).toContain('Settings → Danger zone');
    expect(result).toMatchObject({
      web_ui: {
        surface: 'project_settings_danger',
        requires_human: true,
      },
      safe_alternatives: [
        {
          tool: 'openlander_project',
          action: 'archive_project',
          approval_required: true,
          effect: 'reversible_cleanup',
        },
      ],
      do_not_substitute: ['remove_service', 'cleanup_docker'],
    });
  });

  it('removed aliases do not emit deprecation warnings because compatibility is gone', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await tool.execute({ action: 'stop_project', params: {} }, mockContext);
    expect(warnSpy.mock.calls.join(' ')).not.toContain('since=1.0-rc.1');
    warnSpy.mockRestore();
  });
});

describe('openlander_service direct deployable runtime actions', () => {
  let tool: CompositeTool;

  beforeEach(() => {
    tool = createOpenLanderServiceCompositeTool(allToolDefs);
  });

  it('help uses Application/Compose vocabulary', async () => {
    const result = (await tool.execute({ action: 'help' }, mockContext)) as {
      actions: Array<{ name: string; description: string }>;
    };
    const byName = new Map(result.actions.map((action) => [action.name, action.description]));

    expect(byName.get('restart_service')).toContain('Application/worker');
    expect(byName.get('update_app')).toContain('Application/worker');
    expect(byName.get('redeploy_app')).toContain('Application/worker');
    expect(byName.get('rollback_service')).toContain('Application/worker');
    expect(byName.get('update_service_config')).toContain('Application/Compose build config');
    expect(byName.get('update_application_source')).toContain(
      'Application/Compose source settings',
    );
  });

  it('help advertises stable Connected Publish semantics', async () => {
    const result = (await tool.execute({ action: 'help' }, mockContext)) as {
      actions: Array<{ name: string; description: string }>;
    };
    const exposeDescription = result.actions.find(
      (action) => action.name === 'expose_public',
    )?.description;

    expect(exposeDescription).toContain('stable Connected Publish URL');
    expect(exposeDescription).toContain('get_public_access');
    expect(exposeDescription).not.toContain('temporary public share URL');
  });

  it('routes deployable service actions directly and validates service target params', async () => {
    for (const action of [
      'update_app',
      'redeploy_app',
      'restart_service',
      'rollback_service',
    ] as const) {
      const result = (await tool.execute({ action, params: {} }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('error', 'INVALID_PARAMS');
      expect(result).toHaveProperty('action', action);
      expect(result).toHaveProperty('composite', 'openlander_service');
    }
  });

  it('does not expose managed start/stop actions on openlander_service', async () => {
    for (const action of ['start_service', 'stop_service', 'remove_service'] as const) {
      const result = (await tool.execute({ action, params: {} }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('error', 'UNKNOWN_ACTION');
      expect(result).toHaveProperty('composite', 'openlander_service');
    }
  });

  it('exposes deployable service archive/restore as real approval-gated actions', async () => {
    const help = (await tool.execute({ action: 'help' }, mockContext)) as {
      actions: Array<{ name: string }>;
    };
    const actions = help.actions.map((action) => action.name);
    expect(actions).toContain('archive_service');
    expect(actions).toContain('unarchive_service');

    for (const action of ['archive_service', 'unarchive_service'] as const) {
      const invalid = (await tool.execute({ action, params: {} }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(invalid).toHaveProperty('error', 'INVALID_PARAMS');
      expect(invalid).toHaveProperty('action', action);
      expect(invalid).toHaveProperty('composite', 'openlander_service');
    }
  });

  it('returns HUMAN_UI_ONLY for delete/remove/purge aliases agents commonly reach for', async () => {
    for (const action of [
      'delete_project',
      'delete_app',
      'delete_service',
      'remove_app',
      'remove_project',
      'purge_project',
      'destroy_app',
    ] as const) {
      const result = (await tool.execute({ action, params: {} }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('error', 'HUMAN_UI_ONLY');
      expect(result).toHaveProperty('action', action);
    }
  });

  it('routes Receipt finalization aliases to the human Delivery UI', async () => {
    const result = (await tool.execute(
      { action: 'finalize_delivery_receipt', params: { delivery_id: 'delivery-1' } },
      mockContext,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      error: 'HUMAN_UI_ONLY',
      web_ui: { surface: 'delivery_receipt', requires_human: true },
      safe_alternatives: [
        {
          tool: 'openlander_project',
          action: 'generate_delivery_receipt_preview',
        },
      ],
    });
  });
});

describe('openlander_managed_service owns managed lifecycle actions', () => {
  it('keeps managed start/stop/remove on the managed composite', async () => {
    const tool = createOpenLanderManagedServiceCompositeTool(allToolDefs);
    for (const action of ['start_service', 'stop_service', 'remove_service'] as const) {
      const result = (await tool.execute({ action, params: {} }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('error', 'INVALID_PARAMS');
      expect(result).toHaveProperty('action', action);
      expect(result).toHaveProperty('composite', 'openlander_managed_service');
    }
  });
});
