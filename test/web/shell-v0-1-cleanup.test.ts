import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Shell v0.1 cleanup (PR #196)', () => {
  const sidebarSource = readRepoFile('web/src/components/Shell/Sidebar.tsx');
  const topBarSource = readRepoFile('web/src/components/Shell/TopBar.tsx');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('drops the active scope dropdown (McpScopeSelector) from TopBar', () => {
    expect(topBarSource).not.toContain('McpScopeSelector');
    expect(topBarSource).not.toContain('./McpScopeSelector');
    expect(
      existsSync(path.join(process.cwd(), 'web/src/components/Shell/McpScopeSelector.tsx')),
    ).toBe(false);
  });

  it('updates sidebar IA to v0.1: Workspace 6 + Settings 1, Account popover footer', () => {
    expect(sidebarSource).toContain("id: 'workspace'");
    expect(sidebarSource).toContain("id: 'settings'");
    // Workspace items — post-IA-cleanup the saved-filter "Deployments" slot
    // was folded into the Activity page's tab strip, so the workspace
    // section is six items instead of seven.
    expect(sidebarSource).toContain("id: 'home'");
    expect(sidebarSource).toContain("id: 'your-agent'");
    expect(sidebarSource).toContain("id: 'projects'");
    expect(sidebarSource).toContain("id: 'activity'");
    expect(sidebarSource).toContain("id: 'monitoring'");
    expect(sidebarSource).toContain("id: 'web-server'");
    // Settings items
    expect(sidebarSource).toContain("id: 'git'");
    // Removed in v0.1
    expect(sidebarSource).not.toMatch(/id:\s*'ssh'/);
    expect(sidebarSource).not.toMatch(/id:\s*'notifications'/);
    expect(sidebarSource).not.toContain("id: 'infrastructure'");
    // Removed by IA cleanup — Deployments is now an Activity tab, not a
    // top-level nav entry, and no longer needs its dedicated deep-link.
    expect(sidebarSource).not.toMatch(/id:\s*'deployments'/);
    expect(sidebarSource).not.toContain("'/activity?type=deploy'");
    // Account popover replaces direct sign-out button
    expect(sidebarSource).toContain('<AccountPopover');
    expect(sidebarSource).not.toContain("window.confirm('Sign out?')");
  });

  it('shows the v0.1 brand chip in the sidebar header', () => {
    expect(sidebarSource).toMatch(/v0\.1/);
    expect(sidebarSource).not.toContain('BRAND.versionStamp');
  });

  it('mounts AccountPopover with ChangePasswordModal', () => {
    const popoverSource = readRepoFile('web/src/components/account/AccountPopover.tsx');
    const modalSource = readRepoFile('web/src/components/account/ChangePasswordModal.tsx');
    expect(popoverSource).toContain('ChangePasswordModal');
    expect(popoverSource).toContain('logout()');
    expect(modalSource).toContain('changePassword(');
    expect(modalSource).toContain("aria-modal=\"true\"");
  });

  it('adds account.* i18n keys to both locales (en + ko parity)', () => {
    for (const source of [enSource, koSource]) {
      expect(source).toMatch(/account:\s*\{/);
      expect(source).toMatch(/popover:\s*\{/);
      expect(source).toMatch(/changePassword:\s*\{/);
      expect(source).toMatch(/changePassword: ['"`]/);
      expect(source).toMatch(/signOut: ['"`]/);
      expect(source).toMatch(/currentLabel: ['"`]/);
      expect(source).toMatch(/newLabel: ['"`]/);
    }
  });

  it('drops the dead shell.mcpScope i18n keys from both locales', () => {
    expect(enSource).not.toMatch(/mcpScope:/);
    expect(koSource).not.toMatch(/mcpScope:/);
  });
});
