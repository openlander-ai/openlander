/**
 * Vocabulary audit — guardrail tests that catch new debt during the
 * 1.0 → 1.1 → 1.2 data-model alignment window.
 *
 * 1.0 ships only the frontend routing fix (see
 * `.omc/plans/ralplan-data-model-alignment.md` Phase 1). This file
 * locks in the surfaces touched by that fix so a future PR can't
 * silently grow `*_project` MCP actions, drop the routing
 * disambiguation, or remove the i18n hook the back-button copy needs.
 *
 * Each assertion runs as a real check (no `expect(true).toBe(true)`).
 * Drift here means the executor must update both the code and this
 * baseline together — i.e. write a `data-model-debt.md` ledger entry.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_ACTIONS, PROJECT_TO_SERVICE_ALIASES } from '../../src/mcp/composite-tools.js';

const REPO_ROOT = resolve(__dirname, '..', '..');

/**
 * 21-action baseline extracted verbatim from
 * `src/mcp/composite-tools.ts:60-82` at the time 1.0 RC froze. Adding
 * a new `*_project` action means consciously growing the
 * design-vocab debt; the rule below makes that growth visible.
 */
const FROZEN_PROJECT_ACTIONS_1_0_RC = [
  'list_projects',
  'stop_project',
  'start_project',
  'restart_project',
  'redeploy_project',
  'archive_project',
  'unarchive_project',
  'update_project_config',
  'list_env_vars',
  'get_env_var',
  'set_env_vars',
  'set_global_secret',
  'list_global_secrets',
  'upload_secret_file',
  'list_secret_files',
  'remove_secret_file',
  'expose_public',
  'unexpose_public',
  'enable_webhook',
  'disable_webhook',
  'get_webhook_config',
] as const;

describe('vocabulary-audit (data-model-alignment guardrail)', () => {
  it('PROJECT_ACTIONS in composite-tools.ts matches the 1.0 RC frozen baseline', () => {
    // Runtime import (not regex source-scan): a syntax-aware comparison
    // catches refactors / spreads / commented-out entries that a regex
    // would miss. Codex CCG flagged the original regex as brittle on
    // PR #77 review.
    const actions = PROJECT_ACTIONS as readonly string[];

    // No silent removals
    for (const expected of FROZEN_PROJECT_ACTIONS_1_0_RC) {
      expect(
        actions,
        `${expected} disappeared from PROJECT_ACTIONS without a debt-ledger update — see .omc/plans/data-model-debt.md`,
      ).toContain(expected);
    }
    // No silent additions either — adding a new *_project action means
    // consciously growing the vocabulary-debt surface, which deserves
    // a ledger update + PR review.
    expect(
      actions.length,
      'PROJECT_ACTIONS grew or shrank since 1.0 RC. Update the FROZEN_PROJECT_ACTIONS_1_0_RC array in this test AND add a ledger entry to .omc/plans/data-model-debt.md.',
    ).toBe(FROZEN_PROJECT_ACTIONS_1_0_RC.length);
  });

  it('App.tsx exposes both /services/:id (deployable) and /managed-services/:id (managed) routes', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'web', 'src', 'App.tsx'), 'utf8');
    // Multi-line tolerant: matches even when the <Route ...> spans several lines.
    expect(
      /<Route\s+path="\/services\/:id"/.test(source),
      'Deployable detail route /services/:id missing — would re-introduce the routing collision (managed-service IDs landing on the deployable view).',
    ).toBe(true);
    expect(
      /<Route\s+path="\/managed-services\/:id"/.test(source),
      'Managed-service detail route /managed-services/:id missing — required by the 1.0 routing fix.',
    ).toBe(true);
    // The list redirect MUST be present so /services bookmarks survive.
    expect(
      /path="\/services"\s+element=\{<Navigate\s+to="\/managed-services"/.test(source),
      '/services → /managed-services bookmark redirect missing.',
    ).toBe(true);
  });

  it('i18n key services.detail.header.backToServices still exists', () => {
    // The string is rendered by ServiceHeader.tsx (currently dead code).
    // 1.1 component-rewire will revive it under ManagedServiceDetail; we
    // keep the key so that revival doesn't get blocked on i18n review.
    const en = readFileSync(resolve(REPO_ROOT, 'web', 'src', 'i18n', 'en.ts'), 'utf8');
    expect(
      /backToServices\s*:/.test(en),
      'backToServices key removed from web/src/i18n/en.ts — required by 1.1 ServiceHeader revival.',
    ).toBe(true);
  });

  it('PROJECT_TO_SERVICE_ALIASES exists, has exactly 21 entries, every value is a non-empty string', () => {
    // Runtime import (not regex scan) — structural check is syntax-aware.
    // 21 entries must match PROJECT_ACTIONS.length (frozen at 21 for 1.0-rc.1).
    const aliasMap = PROJECT_TO_SERVICE_ALIASES as Record<string, string>;

    expect(
      typeof aliasMap,
      'PROJECT_TO_SERVICE_ALIASES must be exported from src/mcp/composite-tools.ts',
    ).toBe('object');

    const entries = Object.entries(aliasMap);

    expect(
      entries.length,
      `PROJECT_TO_SERVICE_ALIASES must have exactly 21 entries (one per PROJECT_ACTION). Found ${String(entries.length)}.`,
    ).toBe(21);

    // Every key must be a PROJECT_ACTION
    const projectActionSet = new Set<string>(PROJECT_ACTIONS);
    for (const [key] of entries) {
      expect(
        projectActionSet.has(key),
        `PROJECT_TO_SERVICE_ALIASES key "${key}" is not a PROJECT_ACTION — remove it or update PROJECT_ACTIONS.`,
      ).toBe(true);
    }

    // Every value must be a non-empty string
    for (const [key, value] of entries) {
      expect(
        typeof value === 'string' && value.length > 0,
        `PROJECT_TO_SERVICE_ALIASES["${key}"] must be a non-empty string, got: ${String(value)}`,
      ).toBe(true);
    }
  });
});
