/**
 * AccountPopover — sidebar footer admin popover for v0.1.
 *
 * Per docs/design/v0.1/source-notes/v0.1-decisions.md: replaces the direct Sign out button with a small
 * popover offering Change password + Sign out. Single-admin model — no
 * multi-user surfaces. Click trigger toggles the popover; outside click or
 * Escape closes it. Change password opens a separate modal.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronUp, KeyRound, LogOut } from 'lucide-react';
import { logout } from '@/lib/api/auth';
import { useLanguage } from '@/i18n/context';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { ChangePasswordModal } from './ChangePasswordModal';

interface AccountPopoverProps {
  collapsed?: boolean;
}

export function AccountPopover({ collapsed = false }: AccountPopoverProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSignOut = () => {
    setOpen(false);
    if (typeof window === 'undefined') return;
    void logout()
      .catch(() => {
        /* noop — fall through to redirect even on failure */
      })
      .finally(() => {
        window.location.assign('/login');
      });
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('account.popover.openLabel')}
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors',
          'hover:bg-[color:var(--ol-panel-2)]',
          open && 'bg-[color:var(--ol-panel-2)]',
        )}
      >
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[color:var(--ol-primary-soft)] text-[12px] font-semibold text-[color:var(--ol-primary)]"
        >
          {BRAND.glyph}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {t('account.popover.adminLabel')}
              </span>
              <span className="block truncate text-[11px] text-[color:var(--ol-fg-muted)]">
                {t('account.popover.subtitle')}
              </span>
            </span>
            <ChevronUp
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-[color:var(--ol-fg-subtle)] transition-transform',
                !open && 'rotate-180',
              )}
            />
          </>
        )}
      </button>

      {open && (
        <div
          ref={popRef}
          role="menu"
          aria-label={t('account.popover.menuLabel')}
          className={cn(
            'absolute bottom-full left-0 right-0 z-30 mb-2',
            'rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] shadow-lg',
          )}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setPwOpen(true);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-[color:var(--ol-fg)] transition-colors hover:bg-[color:var(--ol-panel-2)]"
          >
            <KeyRound className="h-3.5 w-3.5 text-[color:var(--ol-fg-muted)]" />
            <span className="flex-1 text-left">{t('account.popover.changePassword')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 border-t border-[color:var(--ol-border-subtle)] px-3 py-2 text-[13px] text-[color:var(--ol-fg)] transition-colors hover:bg-[color:var(--ol-panel-2)]"
          >
            <LogOut className="h-3.5 w-3.5 text-[color:var(--ol-fg-muted)]" />
            <span className="flex-1 text-left">{t('account.popover.signOut')}</span>
          </button>
        </div>
      )}

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
