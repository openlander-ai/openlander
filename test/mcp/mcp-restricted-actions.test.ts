import { describe, expect, it } from 'vitest';

import {
  HUMAN_UI_ONLY_TOOLS,
  HUMAN_UI_ONLY_ALIASES,
  APPROVAL_HOLD_TOOLS,
} from '../../src/mcp/mcp-restricted-actions.js';
import { isHumanUiOnlyAction } from '../../src/mcp/composite-tools.js';
import { isGroupBMcpHoldTool } from '../../src/mcp/destructive-safety.js';

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
    expect(HUMAN_UI_ONLY_TOOLS).toContain('remove_service');
    expect(HUMAN_UI_ONLY_TOOLS).toContain('cleanup_docker');
    expect(HUMAN_UI_ONLY_ALIASES).toContain('delete_app');
    expect(HUMAN_UI_ONLY_ALIASES).toContain('delete_project');
    expect(APPROVAL_HOLD_TOOLS).toContain('bulk_delete_env_vars');
    expect(APPROVAL_HOLD_TOOLS).toContain('remove_secret_file');
    // delete_service is a (non-tool) alias only — it used to be duplicated into
    // the blocked-tools group, where it was dead since it isn't a real tool def.
    expect(HUMAN_UI_ONLY_ALIASES).toContain('delete_service');
    expect([...HUMAN_UI_ONLY_TOOLS]).not.toContain('delete_service');
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
    expect(isGroupBMcpHoldTool('remove_service')).toBe(false);
  });
});
