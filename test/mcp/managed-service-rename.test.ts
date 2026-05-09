/**
 * MCP namespace split — managed infrastructure actions live only on
 * `openlander_managed_service`; deployable app/worker runtime actions live on
 * `openlander_service`.
 */
import { describe, expect, it, vi } from 'vitest';
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
  COMPOSITE_REGISTRY,
  createOpenLanderManagedServiceCompositeTool,
  createOpenLanderServiceCompositeTool,
  MANAGED_SERVICE_ACTIONS,
  SERVICE_ACTIONS,
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

const baseContext: ToolContext = { target: 'mcp', appCtx: {} as AppContext };

describe('MCP managed/deployable service namespace split', () => {
  it('COMPOSITE_REGISTRY exposes openlander_managed_service mapped to MANAGED_SERVICE_ACTIONS', () => {
    expect(COMPOSITE_REGISTRY.openlander_managed_service).toBe(MANAGED_SERVICE_ACTIONS);
    expect(COMPOSITE_REGISTRY.openlander_service).toBe(SERVICE_ACTIONS);
  });

  it('openlander_managed_service composite tool builds with the managed action set', () => {
    const tool = createOpenLanderManagedServiceCompositeTool(allToolDefs);
    expect(tool.name).toBe('openlander_managed_service');
    expect(tool.description).toContain('Postgres');
  });

  it('openlander_service.create_service is no longer a compatibility alias', async () => {
    const tool = createOpenLanderServiceCompositeTool(allToolDefs);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const ctx: ToolContext = {
      ...baseContext,
      sessionId: `rename-test-${Date.now().toString(36)}`,
    } as ToolContext & { sessionId: string };

    const result = (await tool.execute({ action: 'create_service', params: {} }, ctx)) as Record<
      string,
      unknown
    >;

    expect(result).toHaveProperty('error', 'UNKNOWN_ACTION');
    expect(result).toHaveProperty('composite', 'openlander_service');
    expect(warnSpy.mock.calls.join(' ')).not.toContain('[mcp:rename]');

    warnSpy.mockRestore();
  });

  it('openlander_managed_service.create_service validates through the managed-handler schema', async () => {
    const tool = createOpenLanderManagedServiceCompositeTool(allToolDefs);
    const result = (await tool.execute(
      { action: 'create_service', params: {} },
      baseContext,
    )) as Record<string, unknown>;

    expect(result).toHaveProperty('error', 'INVALID_PARAMS');
    expect(result).toHaveProperty('action', 'create_service');
    expect(result).toHaveProperty('composite', 'openlander_managed_service');
  });
});
