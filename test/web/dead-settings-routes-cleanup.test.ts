import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function repoFileExists(relativePath: string): boolean {
  return existsSync(path.join(process.cwd(), relativePath));
}

describe('Dead Settings tab components stay pruned (v0.1 IA)', () => {
  // The v0.1 sidebar (web/src/components/Shell/Sidebar.tsx) hides the
  // legacy /settings tabbed surface. Two of the three host tabs
  // (`system` Global Secrets, `proxy` Traefik) have no v0.1 surface at
  // all — Global Secrets are backend-only and Traefik moved to the
  // dedicated `/settings/web-server` page. Their tab components and
  // the StatCard helper that only `SystemSettingsTab` consumed are
  // deleted here. The `github` tab is kept: GitProviders.tsx still
  // points its `Re-authorize` and `Connect GitHub` CTAs at
  // `/settings?tab=github` to land users in the device-flow handoff,
  // so `SettingsPage.tsx` and `GithubSettingsTab.tsx` stay live.

  it('the orphan system / proxy tab components are gone from disk', () => {
    expect(repoFileExists('web/src/components/settings/SystemSettingsTab.tsx')).toBe(false);
    expect(repoFileExists('web/src/components/settings/TraefikSettingsTab.tsx')).toBe(false);
    // Only `SystemSettingsTab` consumed `shared.tsx`, so it goes too.
    expect(repoFileExists('web/src/components/settings/shared.tsx')).toBe(false);
  });

  it('the GitHub tab + its host SettingsPage stay live for the device-flow handoff', () => {
    // GitProviders.tsx (lines 257 + 422) calls
    // window.location.assign('/settings?tab=github&reauth=1') /
    // window.location.assign('/settings?tab=github'). Removing this
    // file would land both live CTAs on the catch-all → /home redirect.
    expect(repoFileExists('web/src/components/settings/GithubSettingsTab.tsx')).toBe(true);
    expect(repoFileExists('web/src/pages/SettingsPage.tsx')).toBe(true);
  });

  it('SettingsPage no longer mounts the deleted tab components', () => {
    const settings = readRepoFile('web/src/pages/SettingsPage.tsx');
    expect(settings).not.toMatch(/from '@\/components\/settings\/SystemSettingsTab'/);
    expect(settings).not.toMatch(/from '@\/components\/settings\/TraefikSettingsTab'/);
    expect(settings).not.toMatch(/<SystemSettingsTab\b/);
    expect(settings).not.toMatch(/<TraefikSettingsTab\b/);
    // Multi-tab Tabs UI is gone — the page is now a single-card
    // GitHub-only host. The `?tab=` query param is no longer the
    // selector, only a vestigial query string we silently ignore.
    expect(settings).not.toMatch(/<TabsTrigger\b/);
  });

  it('GitProviders re-auth + connect CTAs still land on a live route', () => {
    const gitProviders = readRepoFile('web/src/pages/settings/GitProviders.tsx');
    const app = readRepoFile('web/src/App.tsx');
    const hasReauthCta = /window\.location\.assign\(['"]\/settings\?tab=github&reauth=1['"]\)/.test(
      gitProviders,
    );
    const hasConnectCta = /window\.location\.assign\(['"]\/settings\?tab=github['"]\)/.test(
      gitProviders,
    );
    // If either CTA URL ever changes (or is inlined into GitProviders
    // directly), this test will fail and the SettingsPage / GithubTab
    // existence guards above can be revisited at the same time.
    expect(hasReauthCta).toBe(true);
    expect(hasConnectCta).toBe(true);
    // Also pin App.tsx route mount + import — the file-existence guard
    // is not enough to keep the round-1 P0 from coming back if a
    // future cleanup deletes only the route line. (Codex round-2 P2.)
    expect(app).toMatch(/path="\/settings"\s+element=\{<SettingsPage\s*\/>\}/);
    expect(app).toMatch(/from\s+'@\/pages\/SettingsPage'/);
  });

  it('CommandPalette no longer offers a generic /settings entry', () => {
    const palette = readRepoFile('web/src/components/command/CommandPalette.tsx');
    // The `Settings` quick-link pointed at /settings root, which is now
    // a narrow GitHub-only handoff rather than a user-facing surface.
    // Drop the entry so palette suggestions match the live IA (Web
    // Server / Git Providers / etc. via their own dedicated paths).
    expect(palette).not.toMatch(/navigate\(['"]\/settings['"]\)/);
    expect(palette).not.toMatch(/id:\s*['"]settings['"]/);
  });
});
