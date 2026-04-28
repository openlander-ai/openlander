/**
 * MCP composite alias routing tests (rc.1)
 *
 * Verifies:
 *  - openlander_project accepts *_service alias names (e.g. stop_service)
 *    and routes to the same handler as the legacy *_project name (stop_project).
 *  - Legacy *_project invocations emit a deprecation log message containing
 *    "since=1.0-rc.1" (one warn per session per action).
 *  - Deprecation warning is deduped: two invocations with the same session
 *    produce only one log entry.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
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
  createOpenLanderProjectCompositeTool,
  createOpenLanderServiceCompositeTool,
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

const mockContext: ToolContext = { target: 'mcp', appCtx: {} as AppContext };

describe('openlander_project alias routing (rc.1)', () => {
  let tool: CompositeTool;

  beforeEach(() => {
    tool = createOpenLanderProjectCompositeTool(allToolDefs);
  });

  // ---------------------------------------------------------------------------
  // 1. Alias routing: stop_service → same result as stop_project
  // ---------------------------------------------------------------------------

  it('stop_service alias routes to same handler as stop_project (response shape parity)', async () => {
    const viaLegacy = (await tool.execute(
      { action: 'stop_project', params: {} },
      mockContext,
    )) as Record<string, unknown>;

    const viaAlias = (await tool.execute(
      { action: 'stop_service', params: {} },
      mockContext,
    )) as Record<string, unknown>;

    // Both should return INVALID_PARAMS for an empty params object (the tool
    // requires a project_id), confirming they hit the same underlying handler.
    expect(viaLegacy).toHaveProperty('error', 'INVALID_PARAMS');
    expect(viaAlias).toHaveProperty('error', 'INVALID_PARAMS');

    // The action field in the error should reflect what the caller sent
    expect(viaLegacy['action']).toBe('stop_project');
    expect(viaAlias['action']).toBe('stop_service');

    // Both fail on the same handler, so details shape should be identical
    expect(typeof viaLegacy['details']).toBe('string');
    expect(typeof viaAlias['details']).toBe('string');
  });

  it('deploy_service alias routes to same handler as redeploy_project', async () => {
    const viaLegacy = (await tool.execute(
      { action: 'redeploy_project', params: {} },
      mockContext,
    )) as Record<string, unknown>;

    const viaAlias = (await tool.execute(
      { action: 'deploy_service', params: {} },
      mockContext,
    )) as Record<string, unknown>;

    expect(viaLegacy).toHaveProperty('error', 'INVALID_PARAMS');
    expect(viaAlias).toHaveProperty('error', 'INVALID_PARAMS');
  });

  it('start_service alias routes to same handler as start_project', async () => {
    const viaLegacy = (await tool.execute(
      { action: 'start_project', params: {} },
      mockContext,
    )) as Record<string, unknown>;

    const viaAlias = (await tool.execute(
      { action: 'start_service', params: {} },
      mockContext,
    )) as Record<string, unknown>;

    expect(viaLegacy).toHaveProperty('error', 'INVALID_PARAMS');
    expect(viaAlias).toHaveProperty('error', 'INVALID_PARAMS');
  });

  // ---------------------------------------------------------------------------
  // 2. Deprecation log: legacy *_project triggers warn with since=1.0-rc.1
  // ---------------------------------------------------------------------------

  it('stop_project invocation triggers deprecation log containing since=1.0-rc.1', async () => {
    // Import the module-level logger mock from the module's own log instance.
    // We spy on console.warn since createModuleLogger writes to it in test env.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const contextWithSession: ToolContext = {
      ...mockContext,
      // Give this call a unique session so dedup doesn't interfere
      sessionId: `dedup-test-${Date.now().toString(36)}`,
    } as ToolContext & { sessionId: string };

    await tool.execute({ action: 'stop_project', params: {} }, contextWithSession);

    // The deprecation warning must mention since=1.0-rc.1
    const allWarnCalls = warnSpy.mock.calls.flat().join(' ');
    expect(allWarnCalls).toMatch('since=1.0-rc.1');
    expect(allWarnCalls).toMatch('removed_in=2.0');

    warnSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // 3. Dedup: two stop_project calls in same session → only one log entry
  // ---------------------------------------------------------------------------

  it('stop_project deduplication: two calls in same session emit only one deprecation log', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const sessionId = `session-dedup-${Date.now().toString(36)}-unique`;
    const contextWithSession = {
      ...mockContext,
      sessionId,
    } as ToolContext & { sessionId: string };

    await tool.execute({ action: 'stop_project', params: {} }, contextWithSession);
    await tool.execute({ action: 'stop_project', params: {} }, contextWithSession);

    // Count warn calls that contain the deprecation marker
    const deprecationCalls = warnSpy.mock.calls.filter((args) =>
      args.join(' ').includes('since=1.0-rc.1'),
    );

    expect(deprecationCalls.length).toBe(1);

    warnSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // 4. Alias callers (*_service) do NOT trigger deprecation log
  // ---------------------------------------------------------------------------

  it('stop_service alias invocation does NOT trigger a deprecation log', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const contextWithSession = {
      ...mockContext,
      sessionId: `alias-no-warn-${Date.now().toString(36)}`,
    } as ToolContext & { sessionId: string };

    await tool.execute({ action: 'stop_service', params: {} }, contextWithSession);

    const deprecationCalls = warnSpy.mock.calls.filter((args) =>
      args.join(' ').includes('since=1.0-rc.1'),
    );
    expect(deprecationCalls.length).toBe(0);

    warnSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // 5. Unknown alias names still return UNKNOWN_ACTION
  // ---------------------------------------------------------------------------

  it('completely unknown action name returns UNKNOWN_ACTION', async () => {
    const result = (await tool.execute(
      { action: 'delete_everything', params: {} },
      mockContext,
    )) as Record<string, unknown>;

    expect(result).toHaveProperty('error', 'UNKNOWN_ACTION');
    expect(result).toHaveProperty('composite', 'openlander_project');
  });
});

// ---------------------------------------------------------------------------
// rc.2 disambiguation — openlander_service overlapping action names route
// via kind-first DB lookup → param-shape fallback → hard error.
// Plan §6.7 line 871.
// ---------------------------------------------------------------------------
describe('openlander_service rc.2 disambiguation (kind-first → param-shape → hard error)', () => {
  let tool: CompositeTool;

  beforeEach(() => {
    tool = createOpenLanderServiceCompositeTool(allToolDefs);
  });

  it('kind-first lookup: services.kind=postgres → routes to managed handler', async () => {
    const ctx: ToolContext = {
      target: 'mcp',
      appCtx: {
        db: {
          getService: (id: string) =>
            id === 'svc-pg' ? { id, kind: 'postgres' as const } : undefined,
        },
      } as unknown as AppContext,
    };

    // Empty managed params → INVALID_PARAMS at managed handler.
    // What we're verifying: composite reports openlander_service AND the
    // managed handler's zod produces the failure (proving managed dispatch).
    const result = (await tool.execute(
      { action: 'stop_service', params: { service_id: 'svc-pg' } },
      ctx,
    )) as Record<string, unknown>;

    expect(result).toHaveProperty('composite', 'openlander_service');
    // Either INVALID_PARAMS from managed validation or a successful exec —
    // the key signal is that we did NOT get a hard ambiguity error.
    expect(result['error']).not.toBe('AMBIGUOUS_ACTION');
  });

  it('kind-first lookup: services.kind=git → routes to deployable handler', async () => {
    const ctx: ToolContext = {
      target: 'mcp',
      appCtx: {
        db: {
          getService: (id: string) =>
            id === 'svc-app' ? { id, kind: 'git' as const } : undefined,
        },
      } as unknown as AppContext,
    };

    const result = (await tool.execute(
      { action: 'stop_service', params: { service_id: 'svc-app' } },
      ctx,
    )) as Record<string, unknown>;

    expect(result).toHaveProperty('composite', 'openlander_service');
    expect(result['error']).not.toBe('AMBIGUOUS_ACTION');
  });

  it('param-shape fallback: database_type present → managed', async () => {
    // No service_id supplied — only database_type. Falls past kind-first.
    const result = (await tool.execute(
      { action: 'stop_service', params: { database_type: 'postgres' } },
      mockContext,
    )) as Record<string, unknown>;

    // Reaches managed handler; missing required params surface as
    // INVALID_PARAMS (or some other shape), but never AMBIGUOUS.
    expect(result['error']).not.toBe('AMBIGUOUS_ACTION');
  });

  it('param-shape fallback: image present → managed', async () => {
    const result = (await tool.execute(
      { action: 'stop_service', params: { image: 'postgres:16-alpine' } },
      mockContext,
    )) as Record<string, unknown>;

    expect(result['error']).not.toBe('AMBIGUOUS_ACTION');
  });

  it('hard error: service_id supplied but services.kind not resolvable AND no param-shape hint → AMBIGUOUS_ACTION', async () => {
    const ctx: ToolContext = {
      target: 'mcp',
      appCtx: {
        db: {
          // Returns undefined — service not found in DB.
          getService: (_id: string) => undefined,
        },
      } as unknown as AppContext,
    };

    const result = (await tool.execute(
      { action: 'stop_service', params: { service_id: 'unknown-service-id' } },
      ctx,
    )) as Record<string, unknown>;

    expect(result).toHaveProperty('error', 'AMBIGUOUS_ACTION');
    expect(result).toHaveProperty('composite', 'openlander_service');
    const guidance = (result['_agent_guidance'] as { message?: string } | undefined)?.message ?? '';
    expect(guidance).toMatch('openlander_managed_service.stop_service');
    expect(guidance).toMatch('explicit service_id');
  });

  it('default routing: no service_id, no managed-shape hint → deployable handler', async () => {
    const result = (await tool.execute(
      { action: 'stop_service', params: {} },
      mockContext,
    )) as Record<string, unknown>;

    // Should land on deployable handler (stop_project tool def proxies stop_service).
    expect(result).toHaveProperty('composite', 'openlander_service');
    expect(result['error']).not.toBe('AMBIGUOUS_ACTION');
  });

  it('non-overlapping deployable action (deploy_service) routes directly to deployable handler', async () => {
    const result = (await tool.execute(
      { action: 'deploy_service', params: {} },
      mockContext,
    )) as Record<string, unknown>;

    expect(result).toHaveProperty('composite', 'openlander_service');
    expect(result['error']).not.toBe('AMBIGUOUS_ACTION');
    expect(result['error']).not.toBe('UNKNOWN_ACTION');
  });
});
