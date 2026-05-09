#!/usr/bin/env node
/**
 * audit-tokens.mjs — Phase A foundation gate.
 *
 * Asserts that every CSS variable declared in v4's `:root { ... }`
 * block is also declared in `web/src/styles/tokens.css`. Variable
 * NAME parity is the gate; values may diverge (we may keep additional
 * tokens for ANSI / log palette / legacy --ol-* aliases).
 *
 * Exit 0 if our tokens contain every v4 name. Exit 1 if any v4 name
 * is missing — the script prints the list of missing tokens.
 *
 * Usage: `node tools/qa/audit-tokens.mjs`
 */
import fs from 'node:fs';

const V4_TOKENS_PATH = '/tmp/ol-design-v4-backup/test/project/styles.css';
const OUR_TOKENS_PATH = 'web/src/styles/tokens.css';

function tokensFrom(path) {
  if (!fs.existsSync(path)) {
    console.error(`audit-tokens: file not found: ${path}`);
    process.exit(1);
  }
  const text = fs.readFileSync(path, 'utf8');
  return Array.from(text.matchAll(/--[\w-]+(?=\s*:)/g)).map((m) => m[0]);
}

const v4 = new Set(tokensFrom(V4_TOKENS_PATH));
const ours = new Set(tokensFrom(OUR_TOKENS_PATH));

const missing = [...v4].filter((t) => !ours.has(t)).sort();
const extra = [...ours].filter((t) => !v4.has(t)).sort();

if (missing.length > 0) {
  console.error(`audit-tokens: MISSING ${missing.length} v4 token(s) from ${OUR_TOKENS_PATH}:`);
  for (const t of missing) console.error(`  ${t}`);
  process.exit(1);
}

console.log(`audit-tokens: PASS — all ${v4.size} v4 tokens present in ${OUR_TOKENS_PATH}`);
if (extra.length > 0) {
  console.log(`audit-tokens: ${extra.length} extra token(s) present (allowed — usually --ol-* aliases or ANSI):`);
  for (const t of extra) console.log(`  ${t}`);
}
