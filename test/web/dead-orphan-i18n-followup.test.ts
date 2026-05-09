import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Broader orphan i18n stays pruned (PR-B+ follow-up)', () => {
  // PR #244 retired the legacy multi-tab `/settings` host (and its
  // SystemSettingsTab / TraefikSettingsTab consumers). PR #246 cleaned
  // up the Cloudflare-tied keys those orphaned. This file pins the
  // remaining non-Cloudflare orphan keys that those two PRs surfaced
  // but deferred for a strict-scope reason: they all also lost their
  // last consumer, but they aren't Cloudflare-specific.
  //
  //   - `settings.title`, `settings.description` — legacy /settings
  //     header strings.
  //   - `settings.tabs.{system,proxy,github}` — labels for the legacy
  //     3-tab strip on SettingsPage. The `github` tab body is still
  //     live (the GitHub-only narrowed SettingsPage), but its label
  //     comes from the live `settings.github.*` block instead.
  //   - `settings.system.*` — Global Secrets UI wired to
  //     SystemSettingsTab. UI cut for v0.1, backend retained.
  //   - `settings.proxySection.*` — section header above the Traefik
  //     tab content. Tab gone.
  //   - `settings.secrets.*` — Global Secrets description / empty
  //     state. Tab gone.
  //   - `settings.serverScan.*` — external-container scan UI. Surface
  //     replaced by the Web Server page external-containers card.
  //   - `settings.llm.*` — Google Gemini OAuth UI for the legacy
  //     /settings page. Cut surface (built-in AI ops disabled in v0.1).
  //   - `settings.nav.{source,env,domains}` — three sections of the
  //     project SettingsTab nav that PR #196 removed. The fourth nav
  //     entry, `settings.nav.general`, is the one live consumer left
  //     and is preserved.
  //   - top-level `domains:` block — pre-cut Cloudflare/sslip.io
  //     copy, distinct from the live `projectDetail.domains.*` block.
  //   - `command.configureGithubMcp` — string the CommandPalette
  //     `Settings` quick-link description used; PR #244 dropped that
  //     entry without removing the string.

  for (const locale of ['en', 'ko']) {
    const dict = readRepoFile(`web/src/i18n/${locale}.ts`);

    it(`drops the legacy /settings page header keys from ${locale}.ts`, () => {
      // Anchor on `^  settings:` so we are inside the top-level
      // `settings:` block, then assert the immediate scalar keys are
      // gone. (`settings.general.title` and `settings.general.description`
      // remain — they live one level deeper, behind a `general:` key,
      // and survive the regex.)
      const settingsBlock = dict.match(/\n {2}settings: \{\n([\s\S]*?)\n {2}\},\n/);
      expect(settingsBlock?.[1]).toBeDefined();
      const inner = settingsBlock![1];
      expect(inner).not.toMatch(/^ {4}title:/m);
      expect(inner).not.toMatch(/^ {4}description:/m);
    });

    it(`drops the legacy SettingsPage tab labels + tab bodies in ${locale}.ts`, () => {
      // `settings.tabs`, `settings.system`, etc. all sit at 4-space
      // indent — but so do live blocks like `projectDetail.tabs`
      // and `project.tabs`. Extract the top-level `settings:` block
      // first so the assertions only see what's inside it.
      const settingsBlock = dict.match(/\n {2}settings: \{\n([\s\S]*?)\n {2}\},\n/);
      expect(settingsBlock?.[1]).toBeDefined();
      const inner = settingsBlock![1];
      expect(inner).not.toMatch(/^ {4}tabs: \{/m);
      expect(inner).not.toMatch(/^ {4}system: \{/m);
      expect(inner).not.toMatch(/^ {4}proxySection: \{/m);
      expect(inner).not.toMatch(/^ {4}secrets: \{/m);
      expect(inner).not.toMatch(/^ {4}serverScan: \{/m);
      expect(inner).not.toMatch(/^ {4}llm: \{/m);
      // Specific leaf-key markers as a belt-and-suspenders check —
      // these are unique enough that they can run unscoped.
      expect(dict).not.toMatch(/globalSecrets:/);
      expect(dict).not.toMatch(/googleGemini:/);
    });

    it(`trims settings.nav to just the live "general" entry in ${locale}.ts`, () => {
      const navBlock = dict.match(/\n {4}nav: \{\n([\s\S]*?)\n {4}\},\n/);
      expect(navBlock?.[1]).toBeDefined();
      expect(navBlock![1]).toMatch(/general:/);
      expect(navBlock![1]).not.toMatch(/source:/);
      expect(navBlock![1]).not.toMatch(/env:/);
      expect(navBlock![1]).not.toMatch(/domains:/);
    });

    it(`drops the orphan top-level domains block in ${locale}.ts`, () => {
      // The live Domains tab uses `projectDetail.domains.*` (4-space
      // indent inside `projectDetail`). The pre-cut top-level
      // `domains:` block (2-space indent) is the one being removed.
      expect(dict).not.toMatch(/^ {2}domains: \{/m);
    });

    it(`drops the orphan command.configureGithubMcp key in ${locale}.ts`, () => {
      expect(dict).not.toMatch(/configureGithubMcp:/);
    });

    it(`keeps the live consumers (settings.nav.general / settings.general.* / settings.github.*) intact in ${locale}.ts`, () => {
      // Project SettingsTab.tsx reads these every render; protecting
      // them at the test layer prevents an over-aggressive future
      // sweep from collapsing the whole `settings:` namespace.
      expect(dict).toMatch(/^ {6}general:/m);
      expect(dict).toMatch(/^ {4}general: \{/m);
      expect(dict).toMatch(/^ {4}github: \{/m);
    });
  }
});
