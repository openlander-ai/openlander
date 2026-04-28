/**
 * MCP rc.2 namespace rename — `openlander_service.create_service` is
 * routed to the new `openlander_managed_service.create_service` handler
 * with a `[mcp:rename]` deprecation warning emitted once per session.
 *
 * Plan §6.7 lines 868-869.
 */
import { describe, expect, it, vi } from 'vitest';
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
import type { ToolContext, ToolDef } from '../../src/tools/defs/types.js';
import {
  COMPOSITE_REGISTRY,
  createOpenLanderManagedServiceCompositeTool,
  createOpenLanderServiceCompositeTool,
  MANAGED_SERVICE_ACTIONS,
  SERVICE_ACTIONS,
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

const baseContext: ToolContext = { target: 'mcp', appCtx: {} as AppContext };

describe('rc.2 MCP namespace rename — openlander_managed_service composite', () => {
  it('COMPOSITE_REGISTRY exposes openlander_managed_service mapped to MANAGED_SERVICE_ACTIONS', () => {
    expect(COMPOSITE_REGISTRY.openlander_managed_service).toBe(MANAGED_SERVICE_ACTIONS);
    expect(COMPOSITE_REGISTRY.openlander_service).toBe(SERVICE_ACTIONS);
  });

  it('openlander_managed_service composite tool builds with the managed action set', () => {
    const tool = createOpenLanderManagedServiceCompositeTool(allToolDefs);
    expect(tool.name).toBe('openlander_managed_service');
    expect(tool.description).toContain('Postgres');
  });

  it('openlander_service.create_service routes to managed handler and emits the [mcp:rename] warning once per session', async () => {
    const tool = createOpenLanderServiceCompositeTool(allToolDefs);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const ctx: ToolContext = {
      ...baseContext,
      sessionId: `rename-test-${Date.now().toString(36)}`,
    } as ToolContext & { sessionId: string };

    // First invocation — empty params trigger INVALID_PARAMS at the
    // managed handler's zod step, but the rename warning must still fire.
    await tool.execute({ action: 'create_service', params: {} }, ctx);

    const renameCalls = warnSpy.mock.calls.filter((args) =>
      args.join(' ').includes('[mcp:rename]'),
    );
    expect(renameCalls.length).toBe(1);
    const message = renameCalls[0]!.join(' ');
    expect(message).toMatch('tool=openlander_service');
    expect(message).toMatch('action=create_service');
    expect(message).toMatch('redirected_to=openlander_managed_service');
    expect(message).toMatch('since=1.0-rc.2');
    expect(message).toMatch('removed_in=2.0');

    // Second invocation in same session — must NOT re-warn.
    await tool.execute({ action: 'create_service', params: {} }, ctx);
    const renameCallsAfter = warnSpy.mock.calls.filter((args) =>
      args.join(' ').includes('[mcp:rename]'),
    );
    expect(renameCallsAfter.length).toBe(1);

    warnSpy.mockRestore();
  });

  it('openlander_service.create_service routes through the managed-handler params schema (validates via managed shape)', async () => {
    const tool = createOpenLanderServiceCompositeTool(allToolDefs);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const ctx: ToolContext = {
      ...baseContext,
      sessionId: `rename-shape-${Date.now().toString(36)}`,
    } as ToolContext & { sessionId: string };

    // Empty params → INVALID_PARAMS at the managed handler's zod check,
    // confirming we landed on the managed handler (not the deployable one,
    // which doesn't expose create_service at all).
    const result = (await tool.execute(
      { action: 'create_service', params: {} },
      ctx,
    )) as Record<string, unknown>;

    expect(result).toHaveProperty('error', 'INVALID_PARAMS');
    expect(result).toHaveProperty('action', 'create_service');
    expect(result).toHaveProperty('composite', 'openlander_service');

    warnSpy.mockRestore();
  });
});
