/**
 * Drift gate (M2): docs/wiki example MCP composite calls ⇄ ToolDef schema.
 *
 * PR #190's launch-gate dry-run found that the demo walkthrough's
 * `create_service` call in Deploy-Guide.md was missing the `target`
 * parameter that the actual ToolDef required at the time. The text and
 * the runtime schema had drifted, and the failure only surfaced when a
 * fresh agent followed the docs literally.
 *
 * M1 (test/mcp/composite-docs-sync.test.ts) catches *name-level* drift —
 * action exists in composite but not in docs, or vice versa. M2 catches
 * *schema-level* drift — action is documented as called with params X,
 * but the underlying ToolDef.inputSchema requires Y.
 *
 * Scope (test-only, no production code change):
 *
 *   1. Parse every `openlander_<composite>.<action>(...)` call example
 *      in scanned docs/wiki files.
 *   2. For each, look up the corresponding `ToolDef` by name.
 *   3. Verify the composite routes that action (catches the M1-style
 *      "demoed under the wrong composite" case from a different angle).
 *   4. Verify every required key from `ToolDef.inputSchema` appears as
 *      a param key in the example.
 *
 * Allowlist (`PARTIAL_PARAM_ALLOWLIST`): example call sites that
 * intentionally show partial params (teaching one parameter at a time
 * etc.) — each entry needs a rationale comment.
 *
 * M3 extends the same gate to backticked shorthand calls — the
 * `deploy_app(...)`, `get_deploy_status(...)`, etc. forms that drop the
 * `openlander_<composite>.` prefix for brevity. The shorthand surface
 * doesn't carry composite information, so M3 only enforces ToolDef
 * existence + required-param presence. Action scope is gated by
 * `SCANNED_SHORTHAND_ACTIONS` to prevent the regex from matching
 * unrelated function-call-shaped prose; opt actions in deliberately.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { COMPOSITE_REGISTRY } from '../../src/mcp/composite-tools.js';
import type { ToolDef } from '../../src/tools/defs/types.js';
import {
  composeToolDefs,
  debugToolDefs,
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

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Docs files we scan for `openlander_X.Y(...)` example calls. Add a path
 * here when a new agent-facing guide gains structured call examples.
 */
const SCANNED_DOCS: readonly string[] = [
  'docs/wiki/Deploy-Guide.md',
  'docs/wiki/Integration-Guide.md',
] as const;

const ALL_TOOL_DEFS: readonly ToolDef[] = [
  ...composeToolDefs,
  ...debugToolDefs,
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

const TOOL_DEFS_BY_NAME = new Map(ALL_TOOL_DEFS.map((t) => [t.name, t]));

interface ExampleCall {
  source: string; // `file:line`
  composite: string; // e.g. 'openlander_deploy'
  action: string; // e.g. 'create_service'
  paramKeys: string[];
}

/**
 * Allowlist of example calls where the omitted required params are
 * intentional (teaching narrative, prose context). Key shape:
 *   `<file>:<composite>.<action>` → string[] of missing required keys
 * that are okay to omit at this site. Each entry must include a
 * rationale comment.
 */
const PARTIAL_PARAM_ALLOWLIST: ReadonlyMap<string, readonly string[]> = new Map();

/**
 * Shorthand example surface: backticked `<action>(...)` snippets in
 * Deploy-Guide.md / Integration-Guide.md that drop the
 * `openlander_<composite>.` prefix for brevity. The composite is
 * ambiguous from context so M3 only enforces ToolDef existence and
 * required-param presence — composite routing is deferred to a future
 * slice that can derive ownership from the surrounding section header.
 *
 * To avoid false positives, the gate only scans actions listed here.
 * Add an action to opt in; never to opt out.
 */
const SCANNED_SHORTHAND_ACTIONS: ReadonlySet<string> = new Set([
  'deploy_app',
  'get_deploy_status',
  'get_build_log',
  'create_service',
]);

/**
 * Per-site allowlist for shorthand calls — same shape as
 * PARTIAL_PARAM_ALLOWLIST but keyed by `<file>:<action>` (no composite
 * prefix since the shorthand surface doesn't carry one).
 */
const SHORTHAND_PARTIAL_PARAM_ALLOWLIST: ReadonlyMap<string, readonly string[]> = new Map([
  // Integration-Guide.md narrative shorthand: `create_service(project_id |
  // project_name, template)` illustrates HOW project association works at
  // the call site, not a literal invocation. The `name` parameter is named
  // in the prose around the chain. Treat the missing-`name` failure as a
  // documentation convention, not a drift signal.
  ['docs/wiki/Integration-Guide.md:create_service', ['name']],
]);

/**
 * Walk top-level `key:` tokens out of an args string, ignoring keys
 * inside nested `{...}` objects (which represent values, not args).
 */
function extractTopLevelParamKeys(argsStr: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let buffer = '';
  const flush = (): void => {
    const head = buffer.split(':')[0]?.trim() ?? '';
    if (/^[a-z_][a-z0-9_]*$/i.test(head)) keys.push(head);
    buffer = '';
  };
  for (const ch of argsStr) {
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (depth === 0 && ch === ',') {
      flush();
    } else {
      buffer += ch;
    }
  }
  if (buffer.trim()) flush();
  return keys;
}

interface ShorthandCall {
  source: string;
  action: string;
  paramKeys: string[];
}

/**
 * Find backticked `<action>(...)` shorthand calls — `deploy_app(...)`,
 * `get_deploy_status(...)`, etc. — restricted to actions listed in
 * `SCANNED_SHORTHAND_ACTIONS`. The leading-backtick anchor keeps the
 * regex from matching ordinary function-call prose (Hono handlers,
 * TypeScript snippets) that happen to be word-shaped.
 */
function parseShorthandCalls(text: string, filePath: string): ShorthandCall[] {
  const out: ShorthandCall[] = [];
  // Backtick anchors keep the match scoped to inline code spans; `[^`)]*`
  // stops at either the closing paren or any stray backtick so adjacent
  // code spans don't chain into one capture.
  const re = /`([a-z_][a-z0-9_]*)\(([^`)]*)\)`/g;
  for (const match of text.matchAll(re)) {
    const [, action, argsStr] = match;
    if (!action || argsStr === undefined) continue;
    if (!SCANNED_SHORTHAND_ACTIONS.has(action)) continue;
    const offset = match.index ?? 0;
    const line = text.slice(0, offset).split('\n').length;
    out.push({
      source: `${filePath}:${line}`,
      action,
      paramKeys: extractTopLevelParamKeys(argsStr),
    });
  }
  return out;
}

/**
 * Find all `openlander_X.Y(...)` example call patterns inside a markdown
 * document. Top-level only — nested braces (e.g. `variables: {DATABASE_URL: ...}`)
 * are skipped by the argument splitter.
 */
function parseExampleCalls(text: string, filePath: string): ExampleCall[] {
  const out: ExampleCall[] = [];
  // openlander_<composite>.<action>(<args>)
  // Allow line breaks inside args via [^)]*.
  const re = /openlander_([a-z_]+)\.([a-z_][a-z0-9_]*)\(([\s\S]*?)\)/g;
  for (const match of text.matchAll(re)) {
    const [, compositeSuffix, action, argsStr] = match;
    if (!compositeSuffix || !action || argsStr === undefined) continue;
    const offset = match.index ?? 0;
    const line = text.slice(0, offset).split('\n').length;
    out.push({
      source: `${filePath}:${line}`,
      composite: `openlander_${compositeSuffix}`,
      action,
      paramKeys: extractTopLevelParamKeys(argsStr),
    });
  }
  return out;
}

/**
 * Required keys of a Zod object schema. Zod v4 uses `safeParse(undefined)
 * .success === false` as the "this key really must be supplied" probe
 * (it stays `true` for `.optional()`, `.nullish()`, and default-having
 * schemas). Non-object roots return an empty list — those ToolDefs
 * accept no params and have nothing to verify.
 */
function requiredKeysOf(schema: ToolDef['inputSchema']): string[] {
  if (!(schema instanceof z.ZodObject)) return [];
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  return Object.entries(shape)
    .filter(([, leaf]) => leaf.safeParse(undefined).success === false)
    .map(([key]) => key);
}

describe('MCP composite-tools ⇄ docs/wiki example calls (schema-level)', () => {
  it('every example call references an action backed by a registered ToolDef', async () => {
    const failures: string[] = [];
    for (const docPath of SCANNED_DOCS) {
      const text = await readFile(path.join(REPO_ROOT, docPath), 'utf8');
      for (const call of parseExampleCalls(text, docPath)) {
        if (!TOOL_DEFS_BY_NAME.has(call.action)) {
          failures.push(
            `${call.source}: \`${call.composite}.${call.action}(...)\` — action not in ToolDef registry`,
          );
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('every example call routes through the matching composite', async () => {
    const failures: string[] = [];
    for (const docPath of SCANNED_DOCS) {
      const text = await readFile(path.join(REPO_ROOT, docPath), 'utf8');
      for (const call of parseExampleCalls(text, docPath)) {
        const compositeActions = (
          COMPOSITE_REGISTRY as Record<string, readonly string[] | undefined>
        )[call.composite];
        if (!compositeActions) {
          failures.push(`${call.source}: composite "${call.composite}" not in COMPOSITE_REGISTRY`);
          continue;
        }
        if (!compositeActions.includes(call.action)) {
          failures.push(
            `${call.source}: action "${call.action}" not routed by composite "${call.composite}". Either fix the doc to use the owning composite or wire it into composite-tools.ts.`,
          );
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('every example call provides all required params for its action', async () => {
    const failures: string[] = [];
    for (const docPath of SCANNED_DOCS) {
      const text = await readFile(path.join(REPO_ROOT, docPath), 'utf8');
      for (const call of parseExampleCalls(text, docPath)) {
        const tool = TOOL_DEFS_BY_NAME.get(call.action);
        if (!tool) continue; // caught by the first assertion
        const required = requiredKeysOf(tool.inputSchema);
        const missing = required.filter((k) => !call.paramKeys.includes(k));
        if (missing.length === 0) continue;
        const allowKey = `${docPath}:${call.composite}.${call.action}`;
        const allowed = PARTIAL_PARAM_ALLOWLIST.get(allowKey) ?? [];
        const unexpected = missing.filter((k) => !allowed.includes(k));
        if (unexpected.length === 0) continue;
        failures.push(
          `${call.source}: \`${call.composite}.${call.action}(...)\` missing required params: [${unexpected.join(
            ', ',
          )}] (declared: [${call.paramKeys.join(', ')}], schema requires: [${required.join(', ')}]). ` +
            `Add the param to the example, or — if the omission is intentional — register the action under PARTIAL_PARAM_ALLOWLIST with key "${allowKey}".`,
        );
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});

describe('MCP docs/wiki shorthand example calls (schema-level)', () => {
  it('every scanned shorthand example resolves to a registered ToolDef', async () => {
    const failures: string[] = [];
    for (const docPath of SCANNED_DOCS) {
      const text = await readFile(path.join(REPO_ROOT, docPath), 'utf8');
      for (const call of parseShorthandCalls(text, docPath)) {
        if (!TOOL_DEFS_BY_NAME.has(call.action)) {
          // Defensive: SCANNED_SHORTHAND_ACTIONS gating already enforces
          // that the action is known at the test boundary, but a future
          // ToolDef rename without updating the set would surface here
          // with a clear file:line pointer.
          failures.push(
            `${call.source}: shorthand \`${call.action}(...)\` — action not in ToolDef registry`,
          );
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('every scanned shorthand example provides all required params for its action', async () => {
    const failures: string[] = [];
    for (const docPath of SCANNED_DOCS) {
      const text = await readFile(path.join(REPO_ROOT, docPath), 'utf8');
      for (const call of parseShorthandCalls(text, docPath)) {
        const tool = TOOL_DEFS_BY_NAME.get(call.action);
        if (!tool) continue; // caught by the previous assertion
        const required = requiredKeysOf(tool.inputSchema);
        const missing = required.filter((k) => !call.paramKeys.includes(k));
        if (missing.length === 0) continue;
        const allowKey = `${docPath}:${call.action}`;
        const allowed = SHORTHAND_PARTIAL_PARAM_ALLOWLIST.get(allowKey) ?? [];
        const unexpected = missing.filter((k) => !allowed.includes(k));
        if (unexpected.length === 0) continue;
        failures.push(
          `${call.source}: shorthand \`${call.action}(...)\` missing required params: [${unexpected.join(
            ', ',
          )}] (declared: [${call.paramKeys.join(', ')}], schema requires: [${required.join(', ')}]). ` +
            `Add the param to the example, or — if the omission is intentional — register the action under SHORTHAND_PARTIAL_PARAM_ALLOWLIST with key "${allowKey}".`,
        );
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
