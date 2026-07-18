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
  // deleted here. The GitHub connection component remains live, but it
  // is now rendered inline by the canonical Git Providers page.

  it('the orphan system / proxy tab components are gone from disk', () => {
    expect(repoFileExists('web/src/components/settings/SystemSettingsTab.tsx')).toBe(false);
    expect(repoFileExists('web/src/components/settings/TraefikSettingsTab.tsx')).toBe(false);
    // Only `SystemSettingsTab` consumed `shared.tsx`, so it goes too.
    expect(repoFileExists('web/src/components/settings/shared.tsx')).toBe(false);
  });

  it('keeps the GitHub connection component and removes its legacy SettingsPage host', () => {
    expect(repoFileExists('web/src/components/settings/GithubSettingsTab.tsx')).toBe(true);
    expect(repoFileExists('web/src/pages/SettingsPage.tsx')).toBe(false);
  });

  it('renders connect and re-authorize inline on the canonical Git Providers route', () => {
    const gitProviders = readRepoFile('web/src/pages/settings/GitProviders.tsx');
    const app = readRepoFile('web/src/App.tsx');
    expect(gitProviders).toContain('<GithubSettingsTab');
    expect(gitProviders).toContain("setConnectionMode('connect')");
    expect(gitProviders).toContain("setConnectionMode('reauthorize')");
    expect(gitProviders).not.toContain('/settings?tab=github');
    expect(app).toMatch(/path="\/settings\/git-providers"/);
    expect(app).toMatch(/<Navigate to="\/settings\/git-providers" replace \/>/);
    expect(app).not.toMatch(/from\s+'@\/pages\/SettingsPage'/);
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
