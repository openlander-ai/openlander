import { describe, expect, it } from 'vitest';
import type { AppContext } from '../../src/app.js';
import { platformReadToolDefs } from '../../src/tools/defs/platform-read.js';
import { platformDebugToolDefs } from '../../src/tools/defs/platform-debug.js';
import { platformActionToolDefs } from '../../src/tools/defs/platform-actions.js';
import { deployableServiceToolDefs } from '../../src/tools/defs/deployable-service.js';
import { deployToolDefs } from '../../src/tools/defs/deploy.js';
import { deployPlanToolDefs } from '../../src/tools/defs/deploy-plan.js';
import { projectOpsToolDefs } from '../../src/tools/defs/project-ops.js';
import { envToolDefs } from '../../src/tools/defs/env.js';
import { serviceToolDefs } from '../../src/tools/defs/service.js';
import { volumeToolDefs } from '../../src/tools/defs/volume.js';
import { infraToolDefs } from '../../src/tools/defs/infra.js';
import { gitToolDefs } from '../../src/tools/defs/git.js';
import { monitoringToolDefs } from '../../src/tools/defs/monitoring.js';
import { debugToolDefs } from '../../src/tools/defs/debug.js';
import type { ToolDef } from '../../src/tools/defs/types.js';

function getMcpToolDefs(platformToolsEnabled: boolean): ToolDef[] {
  return [
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
    ...(platformToolsEnabled
      ? [...platformReadToolDefs, ...platformDebugToolDefs, ...platformActionToolDefs]
      : []),
  ];
}

describe('Platform Tool Registration', () => {
  const isPlatformTool = (name: string) =>
    name.startsWith('platform_') || name === 'recover_platform';

  it('excludes platform tools when platformTools is false', () => {
    const toolDefs = getMcpToolDefs(false);
    const platformToolNames = toolDefs.filter((t) => isPlatformTool(t.name)).map((t) => t.name);

    expect(platformToolNames).toHaveLength(0);
  });

  it('includes exactly 13 platform tools when platformTools is true', () => {
    const toolDefs = getMcpToolDefs(true);
    const platformToolNames = toolDefs.filter((t) => isPlatformTool(t.name)).map((t) => t.name);

    expect(platformToolNames).toHaveLength(13);
  });

  it('maintains consistent non-platform tool count regardless of platformTools setting', () => {
    const toolsWithoutPlatform = getMcpToolDefs(false);
    const toolsWithPlatform = getMcpToolDefs(true);

    const nonPlatformWithout = toolsWithoutPlatform.filter((t) => !isPlatformTool(t.name));
    const nonPlatformWith = toolsWithPlatform.filter((t) => !isPlatformTool(t.name));

    expect(nonPlatformWithout).toHaveLength(81);
    expect(nonPlatformWithout).toHaveLength(nonPlatformWith.length);
  });

  it('all platform tools have mcp target', () => {
    const toolDefs = getMcpToolDefs(true);
    const platformTools = toolDefs.filter((t) => isPlatformTool(t.name));

    for (const tool of platformTools) {
      expect(tool.targets).toBeDefined();
      expect(tool.targets).toContain('mcp');
    }
  });
});
