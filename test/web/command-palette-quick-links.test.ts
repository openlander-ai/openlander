import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('CommandPalette quick-links (post-#244 v0.1 IA)', () => {
  // PR #244 retired the legacy `Settings` quick-link because
  // `/settings` is now a narrow GitHub-only handoff rather than a
  // user-facing surface. Gemini's CCG round-1 review of #244
  // suggested adding `Web Server` and `Git Providers` quick-links
  // back so keyboard-first users can still reach those v0.1 settings
  // surfaces via Cmd+K. This file pins that contract.

  const source = readRepoFile('web/src/components/command/CommandPalette.tsx');

  it('still does not offer the retired generic /settings entry', () => {
    // Belt-and-suspenders with `dead-settings-routes-cleanup.test.ts`
    // — keep the absence pinned here too so a future revert that
    // resurrects the Settings quick-link can't slip past.
    expect(source).not.toMatch(/navigate\(['"]\/settings['"]\)/);
    expect(source).not.toMatch(/id:\s*['"]settings['"]/);
  });

  it('exposes a Web Server quick-link wired to /settings/web-server', () => {
    expect(source).toMatch(/id:\s*['"]nav-web-server['"]/);
    expect(source).toContain("label: t('command.webServer')");
    expect(source).toMatch(/navigate\(['"]\/settings\/web-server['"]\)/);
    // Keyword breadth — the user might type any of `proxy`,
    // `traefik`, `routes`, `ports`, `entrypoints`, `settings`, or
    // `web server` to find this entry.
    expect(source).toMatch(/keywords:\s*['"][^'"]*proxy/);
    expect(source).toMatch(/keywords:\s*['"][^'"]*traefik/);
  });

  it('exposes a Git Providers quick-link wired to /settings/git-providers', () => {
    expect(source).toMatch(/id:\s*['"]nav-git-providers['"]/);
    expect(source).toContain("label: t('command.gitProviders')");
    expect(source).toMatch(/navigate\(['"]\/settings\/git-providers['"]\)/);
    // Users typing `github`, `oauth`, or `git` should also reach it.
    expect(source).toMatch(/keywords:\s*['"][^'"]*github/);
    expect(source).toMatch(/keywords:\s*['"][^'"]*git providers/);
  });

  it('imports Server and Code2 icons from lucide-react for the new entries', () => {
    // The icon imports live at the top of the file. We don't pin
    // exact import-list ordering (prettier owns that), just the
    // presence of the two icons we just started using.
    expect(source).toMatch(/from 'lucide-react'/);
    expect(source).toMatch(/\bServer\b/);
    expect(source).toMatch(/\bCode2\b/);
  });
});
