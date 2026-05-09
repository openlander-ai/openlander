import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Settings → Security tab retired (v0.1)', () => {
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  // The legacy assertions that pinned `SettingsPage.tsx` to drop the
  // SecuritySettingsTab import / `value="security"` tab + reduce
  // VALID_TABS to ['system','proxy','github'] are now subsumed by
  // `dead-settings-routes-cleanup.test.ts`, which deletes
  // `SettingsPage.tsx` entirely. The component file assertion stays
  // here because SecuritySettingsTab.tsx was retired separately in
  // PR #205 and predates the dead-settings sweep.

  it('removes the SecuritySettingsTab component file entirely', () => {
    expect(existsSync(path.join(process.cwd(), 'web/src/components/settings/SecuritySettingsTab.tsx'))).toBe(false);
  });

  it('drops the orphan settings.security.* block from both languages', () => {
    for (const dict of [enSource, koSource]) {
      // Scope to the top-level `settings:` block — `settings.security`
      // sat at 4-space indent inside it, but other live blocks
      // (e.g. `projectDetail.tabs`) also use 4-space indent and would
      // false-match an unscoped regex (Codex CCG round-1 P2 on #250).
      const settingsBlock = dict.match(/\n {2}settings: \{\n([\s\S]*?)\n {2}\},\n/);
      expect(settingsBlock?.[1]).toBeDefined();
      expect(settingsBlock![1]).not.toMatch(/^ {4}security: \{/m);
      // The legacy `settings.tabs.security` label assertion was
      // subsumed when PR #250 removed the entire `settings.tabs:`
      // sub-block; that absence is now pinned by
      // `dead-orphan-i18n-followup.test.ts` instead of an ad-hoc
      // tabs-block extraction here.
    }
  });
});
