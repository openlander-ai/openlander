/**
 * Guardrails for the Project=group / Service=deployable MCP split.
 *
 * The old *_project runtime aliases are intentionally gone. Runtime actions are
 * exposed directly on openlander_service. Managed infrastructure lifecycle stays
 * on openlander_managed_service.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
];

const mockContext: ToolContext = { target: 'mcp', appCtx: {} as AppContext };
// Actions removed from openlander_project that should still surface as
// UNKNOWN_ACTION. Archive/unarchive are intentionally excluded — they route to
// the HUMAN_UI_ONLY sentinel (see HUMAN_UI_ONLY_ACTIONS in
// src/mcp/composite-tools.ts). Deployable archive_service/unarchive_service are
// different: they are exposed on openlander_service behind the approval queue.
const removedProjectRuntimeActions = [
  'stop_project',
  'start_project',
  'restart_project',
  'redeploy_project',
  'rollback_project',
  'update_project_config',
] as const;
const humanUiOnlyProjectActions = ['archive_project', 'unarchive_project'] as const;

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
    for (const removed of [...removedProjectRuntimeActions, ...humanUiOnlyProjectActions]) {
      expect(actionNames).not.toContain(removed);
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

  it('returns HUMAN_UI_ONLY for project archive/unarchive', async () => {
    for (const action of humanUiOnlyProjectActions) {
      const result = (await tool.execute({ action, params: {} }, mockContext)) as Record<
        string,
        unknown
      >;
      expect(result).toHaveProperty('error', 'HUMAN_UI_ONLY');
      expect(result).toHaveProperty('action', action);
      expect(result).toHaveProperty('composite', 'openlander_project');
      const guidance = result['_agent_guidance'] as Record<string, unknown>;
      expect(String(guidance['message'])).toMatch(/Settings → Danger zone/);
      expect(String(guidance['message'])).toMatch(/multiple deployable services|service_id/);
    }
  });

  it('does not attach group lifecycle rationale to hard-delete aliases', async () => {
    const result = (await tool.execute(
      { action: 'delete_app', params: {} },
      mockContext,
    )) as Record<string, unknown>;
    const guidance = result['_agent_guidance'] as Record<string, unknown>;

    expect(result).toHaveProperty('error', 'HUMAN_UI_ONLY');
    expect(String(guidance['message'])).not.toContain('multiple deployable services');
    expect(String(guidance['message'])).toContain('service_id');
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

  it('help uses deployable service vocabulary', async () => {
    const result = (await tool.execute({ action: 'help' }, mockContext)) as {
      actions: Array<{ name: string; description: string }>;
    };
    const byName = new Map(result.actions.map((action) => [action.name, action.description]));

    expect(byName.get('restart_service')).toContain('deployable app/worker service');
    expect(byName.get('redeploy_app')).toContain('deployable app/worker service');
    expect(byName.get('rollback_service')).toContain('deployable app/worker service');
    expect(byName.get('update_service_config')).toContain('deployable service build config');
  });

  it('help does not advertise TryCloudflare-specific public access wording', async () => {
    const result = (await tool.execute({ action: 'help' }, mockContext)) as {
      actions: Array<{ name: string; description: string }>;
    };
    const exposeDescription = result.actions.find(
      (action) => action.name === 'expose_public',
    )?.description;

    expect(exposeDescription).toContain('temporary public share URL');
    expect(exposeDescription).toContain('configured tunnel backend');
    expect(exposeDescription).not.toMatch(/TryCloudflare|Cloudflare/i);
  });

  it('routes deployable service actions directly and validates service target params', async () => {
    for (const action of ['redeploy_app', 'restart_service', 'rollback_service'] as const) {
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
