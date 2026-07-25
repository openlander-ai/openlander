/**
 * Drift gate: MCP composite-tools.ts ⇄ ToolDef registry ⇄ docs/wiki.
 *
 * Slice M1 of the post-v0.1.6 refactor direction (P2: MCP single source of
 * truth). Catches the failure mode that surfaced in PR #190's launch-gate
 * dry-run, where the docs and the actual MCP surface had silently drifted —
 * here the `target` parameter on `create_service` was missing from the demo
 * walkthrough.
 *
 * Two hard gates + one allowlist:
 *
 *   1. composite-tools.ts only refers to actions backed by a real ToolDef.
 *      Failure = composite routing breaks at runtime (typo / rename without
 *      registry update).
 *   2. Every composite action is mentioned at least once in
 *      docs/wiki/MCP-Tools-Reference.md. Failure = agents discover a tool
 *      via help action but get no human-readable reference for it.
 *   3. (Allowlist, informational) ToolDefs that are intentionally not
 *      exposed via any composite — agent-only, HUMAN_UI_ONLY, compose
 *      orchestration helpers, etc. The set is locked here so an *unexpected*
 *      new omission still trips the test.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ToolDef } from '../../src/tools/defs/types.js';
import {
  composeToolDefs,
  debugToolDefs,
  deliveryToolDefs,
  engagementToolDefs,
  deployToolDefs,
  deployableServiceToolDefs,
  deployPlanToolDefs,
  envToolDefs,
  gitToolDefs,
  infraToolDefs,
  monitoringToolDefs,
  projectOpsToolDefs,
  serviceToolDefs,
  volumeToolDefs,
} from '../../src/tools/defs/index.js';
import { platformActionToolDefs } from '../../src/tools/defs/platform-actions.js';
import { platformDebugToolDefs } from '../../src/tools/defs/platform-debug.js';
import { platformReadToolDefs } from '../../src/tools/defs/platform-read.js';
import {
  DEPLOY_ACTIONS,
  MANAGED_SERVICE_ACTIONS,
  MONITOR_ACTIONS,
  PLATFORM_ACTIONS,
  PROJECT_ACTIONS,
  SERVICE_ACTIONS,
} from '../../src/mcp/composite-tools.js';
import { APPROVAL_HOLD_TOOLS, HUMAN_UI_ONLY_TOOLS } from '../../src/mcp/mcp-restricted-actions.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC_PATH = path.join(REPO_ROOT, 'docs', 'wiki', 'MCP-Tools-Reference.md');

const ALL_TOOL_DEFS = [
  ...composeToolDefs,
  ...debugToolDefs,
  ...deliveryToolDefs,
  ...engagementToolDefs,
  ...deployToolDefs,
  ...deployableServiceToolDefs,
  ...deployPlanToolDefs,
  ...envToolDefs,
  ...gitToolDefs,
  ...infraToolDefs,
  ...monitoringToolDefs,
  ...projectOpsToolDefs,
  ...serviceToolDefs,
  ...volumeToolDefs,
  ...platformActionToolDefs,
  ...platformDebugToolDefs,
  ...platformReadToolDefs,
];

/**
 * Mirror of the private predicate in `src/mcp/composite-tools.ts` —
 * `buildCompositeToolDefs` filters its candidate ToolDefs through
 * `!def.targets || def.targets.includes('mcp')`, so a ToolDef declared
 * `targets: ['agent']` is invisible to the MCP composite at runtime no
 * matter what `composite-tools.ts` references. Mirror the predicate here
 * so the gate matches runtime semantics — otherwise a composite action
 * pointing at an agent-only ToolDef would slip through the test and
 * surface as `UNKNOWN_ACTION` only after deploy.
 */
function isMcpTargeted(def: ToolDef): boolean {
  return !def.targets || def.targets.includes('mcp');
}

const ALL_TOOL_DEF_NAMES: ReadonlySet<string> = new Set(ALL_TOOL_DEFS.map((t) => t.name));
const MCP_TOOL_DEF_NAMES: ReadonlySet<string> = new Set(
  ALL_TOOL_DEFS.filter(isMcpTargeted).map((t) => t.name),
);

const COMPOSITE_ACTION_NAMES: readonly string[] = [
  ...DEPLOY_ACTIONS,
  ...PROJECT_ACTIONS,
  ...SERVICE_ACTIONS,
  ...MANAGED_SERVICE_ACTIONS,
  ...MONITOR_ACTIONS,
  ...PLATFORM_ACTIONS,
];
const COMPOSITE_ACTION_SET: ReadonlySet<string> = new Set(COMPOSITE_ACTION_NAMES);

/**
 * MCP-targeted ToolDefs that intentionally have no composite-tools route.
 * Each entry must have a documented reason — adding to this list is the
 * explicit way to opt a tool out of the MCP composite surface. Surprise
 * omissions stay caught by the assertion below.
 *
 * `targets: ['agent']` ToolDefs (`deploy_compose`, `list_compose_services`) are auto-excluded by
 * `isMcpTargeted` and do NOT need to appear here.
 */
const TOOLDEFS_NOT_IN_COMPOSITE: ReadonlySet<string> = new Set([
  // Compose orchestration is invoked through `execute_deploy_plan` flow,
  // not surfaced as standalone MCP actions in 0.1 — the deploy-plan
  // composite owns the compose lifecycle.
  'orchestrate_deploy',
  // Database-user provisioning is exposed under `create_service_user` /
  // `create_bucket` family for the managed-service composite; the generic
  // `create_database` / `list_databases` MCP entry points are reserved
  // for the v0.2 read-model rework.
  'create_database',
  'list_databases',
  // scan_project is an MCP-targeted repo intake helper retained for
  // legacy callers; the public MCP entry point is `scan_dockerfiles` +
  // `analyze_infrastructure` in the deploy composite.
  'scan_project',
]);

/**
 * Lazy-loaded doc text + the set of backticked tokens that appear in it.
 * The mention check is intentionally loose: a backticked occurrence anywhere
 * in the file counts, including header rows, body prose, and tables. The
 * goal is to catch the *strictly missing* case (PR #190 style), not to
 * police header structure.
 */
let docMentionedCache: Promise<ReadonlySet<string>> | null = null;
async function docMentionedTokens(): Promise<ReadonlySet<string>> {
  if (!docMentionedCache) {
    docMentionedCache = readFile(DOC_PATH, 'utf8').then((content) => {
      const tokens = new Set<string>();
      for (const match of content.matchAll(/`([a-z_][a-z0-9_]*)`/g)) {
        tokens.add(match[1]!);
      }
      return tokens;
    });
  }
  return docMentionedCache;
}

describe('MCP composite-tools ⇄ ToolDef registry', () => {
  it('every composite action is backed by an MCP-targeted ToolDef', () => {
    // MCP_TOOL_DEF_NAMES mirrors the runtime `isMcpTargeted` filter in
    // composite-tools.ts. A composite action that points at a
    // `targets: ['agent']` ToolDef would surface as `UNKNOWN_ACTION` at
    // runtime even though the ToolDef name exists — that's exactly the
    // failure we want this gate to catch before merge.
    const orphaned = COMPOSITE_ACTION_NAMES.filter((name) => !MCP_TOOL_DEF_NAMES.has(name));
    // Distinguish the two failure modes in the message so a reviewer
    // sees whether the ToolDef is missing entirely or just opted out of
    // the MCP target.
    const detail = orphaned.map((name) => {
      if (ALL_TOOL_DEF_NAMES.has(name)) {
        return `${name} (registered but targets: ['agent'] — composite cannot expose it)`;
      }
      return `${name} (no matching ToolDef.name in the registry)`;
    });
    expect(
      orphaned,
      `composite actions not backed by an MCP-targeted ToolDef: ${detail.join('; ')}`,
    ).toEqual([]);
  });

  it('every MCP-targeted ToolDef is either in a composite or in the documented opt-out list', () => {
    const unmapped = [...MCP_TOOL_DEF_NAMES]
      .filter((name) => !COMPOSITE_ACTION_SET.has(name))
      .filter((name) => !TOOLDEFS_NOT_IN_COMPOSITE.has(name))
      .sort();
    expect(
      unmapped,
      `MCP-targeted ToolDefs not in a composite and not allowlisted in TOOLDEFS_NOT_IN_COMPOSITE: ${unmapped.join(', ')}. Either wire into composite-tools.ts or add to the allowlist with a comment explaining why.`,
    ).toEqual([]);
  });
});

describe('MCP composite-tools ⇄ docs/wiki/MCP-Tools-Reference.md', () => {
  it('every composite action is mentioned somewhere in the reference doc', async () => {
    const mentioned = await docMentionedTokens();
    const undocumented = COMPOSITE_ACTION_NAMES.filter((name) => !mentioned.has(name)).sort();
    expect(
      undocumented,
      `composite actions not mentioned in MCP-Tools-Reference.md: ${undocumented.join(', ')}. Add at least a backticked reference (typically under the matching category section).`,
    ).toEqual([]);
  });

  it('every HUMAN_UI_ONLY_TOOLS entry is documented as gated', async () => {
    const mentioned = await docMentionedTokens();
    const undocumented = [...HUMAN_UI_ONLY_TOOLS].filter((name) => !mentioned.has(name)).sort();
    expect(
      undocumented,
      `HUMAN_UI_ONLY tools not mentioned in the reference doc: ${undocumented.join(', ')}. The "Destructive MCP operations are intentionally gated" paragraph in MCP-Tools-Reference.md must enumerate these so agents see the OPERATION_REQUIRES_HUMAN_UI failure path before they try.`,
    ).toEqual([]);
  });

  it('every APPROVAL_HOLD_TOOLS entry is documented', async () => {
    const mentioned = await docMentionedTokens();
    const undocumented = [...APPROVAL_HOLD_TOOLS].filter((name) => !mentioned.has(name)).sort();
    expect(
      undocumented,
      `APPROVAL_HOLD tools not mentioned in the reference doc: ${undocumented.join(', ')}. Surface the approval hold semantics so agents anticipate the pause.`,
    ).toEqual([]);
  });
});
