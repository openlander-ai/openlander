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
import { platformReadToolDefs } from '../../src/tools/defs/platform-read.js';
import { platformDebugToolDefs } from '../../src/tools/defs/platform-debug.js';
import { platformActionToolDefs } from '../../src/tools/defs/platform-actions.js';
import type { ToolDef } from '../../src/tools/defs/types.js';
import { createCompositeTools } from '../../src/mcp/composite-tools.js';

/** Mirrors src/mcp/server.ts getMcpToolDefs() */
function getMcpToolDefs(platformToolsEnabled: boolean): ToolDef[] {
  return [
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
    ...(platformToolsEnabled
      ? [...platformReadToolDefs, ...platformDebugToolDefs, ...platformActionToolDefs]
      : []),
  ];
}

function isMcpTargeted(def: ToolDef): boolean {
  return !def.targets || def.targets.includes('mcp');
}

describe('MCP Composite Tools', () => {
  it('returns 4 composite tools from 69 underlying tool defs', () => {
    const defs = getMcpToolDefs(false);
    const mcpDefs = defs.filter(isMcpTargeted);
    expect(mcpDefs).toHaveLength(69);

    const composites = createCompositeTools(defs);
    expect(composites).toHaveLength(4);
    expect(composites.map((c) => c.name)).toEqual([
      'openlander_deploy',
      'openlander_project',
      'openlander_service',
      'openlander_monitor',
    ]);
  });

  it('platformTools=true adds platform tools separately', () => {
    const withPlatform = getMcpToolDefs(true).filter(isMcpTargeted);
    const withoutPlatform = getMcpToolDefs(false).filter(isMcpTargeted);
    const platformCount = withPlatform.length - withoutPlatform.length;

    const totalPlatformDefs = [
      ...platformReadToolDefs,
      ...platformDebugToolDefs,
      ...platformActionToolDefs,
    ].filter(isMcpTargeted).length;
    expect(platformCount).toBe(totalPlatformDefs);
    expect(platformCount).toBeGreaterThan(0);
  });

  it('composite tool count stays the same regardless of platform flag', () => {
    const withPlatform = createCompositeTools(getMcpToolDefs(true));
    const withoutPlatform = createCompositeTools(getMcpToolDefs(false));
    expect(withPlatform).toHaveLength(4);
    expect(withoutPlatform).toHaveLength(4);
  });

  it('all composite tools have required interface fields', () => {
    const composites = createCompositeTools(getMcpToolDefs(false));
    for (const composite of composites) {
      expect(composite.name).toBeTruthy();
      expect(composite.description).toBeTruthy();
      expect(composite.inputSchema).toBeDefined();
      expect(typeof composite.execute).toBe('function');
    }
  });
});
