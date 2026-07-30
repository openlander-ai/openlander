import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('platform update sidebar and dialog contract', () => {
  const sidebar = source('web/src/components/Shell/Sidebar.tsx');
  const button = source('web/src/components/Shell/PlatformUpdateButton.tsx');
  const dialog = source('web/src/components/Shell/PlatformUpdateDialog.tsx');
  const hook = source('web/src/hooks/use-platform-update.ts');
  const appShell = source('web/src/components/Shell/AppShell.tsx');
  const en = source('web/src/i18n/en.ts');
  const ko = source('web/src/i18n/ko.ts');

  it('places the update affordance immediately above the account card', () => {
    expect(sidebar.indexOf('<PlatformUpdateButton')).toBeGreaterThan(-1);
    expect(sidebar.indexOf('<PlatformUpdateButton')).toBeLessThan(
      sidebar.indexOf('<AccountPopover'),
    );
    expect(button).toContain('!status.updateAvailable && !active');
    expect(button).toContain('&& !rolledBack && !failed');
    expect(button).toContain("t('platformUpdate.button.available'");
  });

  it('supports expanded, collapsed, and mobile sidebars from one shared state', () => {
    expect(button).toContain('collapsed');
    expect(button).toContain('<Tooltip');
    expect(button).toContain('side="right"');
    expect(button).toContain("'absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full'");
    expect(appShell).toContain('<Sidebar collapsed={collapsed} />');
    expect(appShell).toContain('<Sidebar collapsed={false} />');
    expect(appShell.match(/<PlatformUpdateDialog/g)).toHaveLength(1);
  });

  it('keeps progress across a restart and retries status every two seconds', () => {
    expect(hook).toContain('const ACTIVE_POLL_MS = 2_000');
    expect(hook).toContain('const IDLE_POLL_MS = 6 * 60 * 60 * 1000');
    expect(hook).toContain('Keep the last successful status visible');
    expect(hook).not.toContain('setStatus(null)');
    expect(dialog).toContain('aria-live="polite"');
    expect(dialog).toContain("t('platformUpdate.dialog.reconnecting')");
  });

  it('renders confirmation, five release notes, preflight checks, and manual guidance', () => {
    expect(dialog).toContain('<DialogTitle>');
    expect(dialog).toContain('<DialogDescription>');
    expect(dialog).toContain('status.release.notes.slice(0, 5)');
    expect(dialog).toContain('status.checks.map');
    expect(dialog).toContain("status.support.mode === 'manual'");
    expect(dialog).toContain('status.release?.oneClickBlockReason');
    expect(dialog).toContain('manualUpdateUrl');
    expect(dialog).toContain("t('platformUpdate.dialog.updateNow')");
  });

  it('reserves the error color for rollback failure and keeps rollback as warning', () => {
    expect(button).toContain("operation?.phase === 'rolled_back'");
    expect(button).toContain("operation?.phase === 'failed'");
    expect(dialog).toContain("toast.warning(t('platformUpdate.toast.rolledBack'))");
    expect(dialog).toContain("toast.error(t('platformUpdate.toast.failed'))");
    expect(dialog).toContain('var(--ol-warning)');
    expect(dialog).toContain('var(--ol-error)');
  });

  it('ships matching English and Korean copy for every update state', () => {
    for (const key of [
      'platformUpdate',
      'backing_up',
      'rolling_back',
      'rolled_back',
      'official_compose',
      'release_manifest',
      'active_operations',
      'disk_space',
    ]) {
      expect(en).toContain(key);
      expect(ko).toContain(key);
    }
    expect(en).toContain("available: 'New version v{version}'");
    expect(ko).toContain("available: '새 버전 v{version}'");
  });
});
