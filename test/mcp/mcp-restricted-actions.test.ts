import { describe, expect, it } from 'vitest';

import {
  HUMAN_UI_ONLY_TOOLS,
  HUMAN_UI_ONLY_ALIASES,
  PROJECT_LIFECYCLE_ALIASES,
  APPROVAL_HOLD_TOOLS,
} from '../../src/mcp/mcp-restricted-actions.js';
import { isHumanUiOnlyAction } from '../../src/mcp/composite-tools.js';
import { isGroupBMcpHoldTool } from '../../src/mcp/destructive-safety.js';
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
import { networkOperationToolDefs } from '../../src/tools/defs/network-operations.js';
import { projectOpsToolDefs } from '../../src/tools/defs/project-ops.js';
import { serviceToolDefs } from '../../src/tools/defs/service.js';
import { volumeToolDefs } from '../../src/tools/defs/volume.js';
import { platformReadToolDefs } from '../../src/tools/defs/platform-read.js';
import { platformDebugToolDefs } from '../../src/tools/defs/platform-debug.js';
import { platformActionToolDefs } from '../../src/tools/defs/platform-actions.js';

// Every registered tool def name (non-platform + platform), so the policy lists
// can be checked against reality, not just for internal self-consistency.
const ALL_DEFS = [
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
  ...networkOperationToolDefs,
  ...debugToolDefs,
  ...deliveryToolDefs,
  ...engagementToolDefs,
  ...platformReadToolDefs,
  ...platformDebugToolDefs,
  ...platformActionToolDefs,
];

const ALL_TOOL_NAMES: ReadonlySet<string> = new Set(ALL_DEFS.map((def) => def.name));

// MCP-exposed = default targets, or targets explicitly include 'mcp' (same rule
// the registry uses). Some defs exist but are agent-only — those are
// legitimately aliased for MCP, so the alias check is "not MCP-exposed", not
// "does not exist".
const MCP_EXPOSED_TOOL_NAMES: ReadonlySet<string> = new Set(
  ALL_DEFS.filter((def) => !def.targets || def.targets.includes('mcp')).map((def) => def.name),
);

describe('MCP restricted-action policy (single source)', () => {
  it('keeps the three tiers disjoint — no action classified twice', () => {
    const tools = new Set<string>(HUMAN_UI_ONLY_TOOLS);
    const aliases = new Set<string>(HUMAN_UI_ONLY_ALIASES);
    const hold = new Set<string>(APPROVAL_HOLD_TOOLS);

    for (const alias of aliases) {
      expect(tools.has(alias), `${alias} is both a blocked tool and an alias`).toBe(false);
      expect(hold.has(alias), `${alias} is both an alias and approval-hold`).toBe(false);
    }
    for (const tool of tools) {
      expect(hold.has(tool), `${tool} is both a blocked tool and approval-hold`).toBe(false);
    }
  });

  it('pins tier sentinels (regression guard, incl. the delete_service dedupe)', () => {
    expect(HUMAN_UI_ONLY_TOOLS).not.toContain('remove_service');
    expect(HUMAN_UI_ONLY_TOOLS).not.toContain('cleanup_docker');
    expect(HUMAN_UI_ONLY_ALIASES).toContain('delete_app');
    expect(HUMAN_UI_ONLY_ALIASES).toContain('delete_project');
    expect(APPROVAL_HOLD_TOOLS).toContain('archive_project');
    expect(APPROVAL_HOLD_TOOLS).toContain('unarchive_project');
    expect(APPROVAL_HOLD_TOOLS).toContain('archive_service');
    expect(APPROVAL_HOLD_TOOLS).toContain('unarchive_service');
    expect(APPROVAL_HOLD_TOOLS).toContain('bulk_delete_env_vars');
    expect(APPROVAL_HOLD_TOOLS).toContain('remove_secret_file');
    expect(APPROVAL_HOLD_TOOLS).toContain('remove_unused_docker_network');
    expect(APPROVAL_HOLD_TOOLS).toContain('remove_service');
    expect(APPROVAL_HOLD_TOOLS).toContain('remove_volume');
    expect(APPROVAL_HOLD_TOOLS).toContain('delete_bucket');
    expect(APPROVAL_HOLD_TOOLS).toContain('cleanup_docker');
    // delete_service is a (non-tool) alias only — it used to be duplicated into
    // the blocked-tools group, where it was dead since it isn't a real tool def.
    expect(HUMAN_UI_ONLY_ALIASES).toContain('delete_service');
    expect([...HUMAN_UI_ONLY_TOOLS]).not.toContain('delete_service');
  });

  it('keeps project lifecycle guidance aliases explicit and within human-UI-only aliases', () => {
    expect(PROJECT_LIFECYCLE_ALIASES).toEqual(['archive_app', 'unarchive_app']);

    const aliases = new Set<string>(HUMAN_UI_ONLY_ALIASES);
    for (const alias of PROJECT_LIFECYCLE_ALIASES) {
      expect(aliases.has(alias), `${alias} should be intercepted as a human-UI-only alias`).toBe(
        true,
      );
    }
    expect(HUMAN_UI_ONLY_ALIASES).not.toContain('archive_project');
    expect(HUMAN_UI_ONLY_ALIASES).not.toContain('unarchive_project');
  });

  it('composite alias interception derives from the single source', () => {
    for (const alias of HUMAN_UI_ONLY_ALIASES) {
      expect(isHumanUiOnlyAction(alias), `${alias} should be intercepted as human-UI-only`).toBe(
        true,
      );
    }
    // A blocked real tool is handled by the enforcement layer, not the alias path.
    expect(isHumanUiOnlyAction('remove_service')).toBe(false);
  });

  it('destructive-safety approval-hold derives from the single source', () => {
    for (const tool of APPROVAL_HOLD_TOOLS) {
      expect(isGroupBMcpHoldTool(tool), `${tool} should be an approval-hold tool`).toBe(true);
    }
    expect(isGroupBMcpHoldTool('remove_service')).toBe(true);
  });
});

describe('restricted-action policy vs the real tool registry', () => {
  it('every blocked and approval-hold action is a real registered tool def', () => {
    for (const tool of HUMAN_UI_ONLY_TOOLS) {
      expect(ALL_TOOL_NAMES.has(tool), `${tool} is blocked but not a registered tool def`).toBe(
        true,
      );
    }
    for (const tool of APPROVAL_HOLD_TOOLS) {
      expect(
        ALL_TOOL_NAMES.has(tool),
        `${tool} is approval-hold but not a registered tool def`,
      ).toBe(true);
    }
  });

  it('no human-UI-only alias is an MCP-exposed tool (it would be callable, not aliased)', () => {
    for (const alias of HUMAN_UI_ONLY_ALIASES) {
      expect(
        MCP_EXPOSED_TOOL_NAMES.has(alias),
        `${alias} is an alias but also an MCP-exposed tool`,
      ).toBe(false);
    }
  });
});
