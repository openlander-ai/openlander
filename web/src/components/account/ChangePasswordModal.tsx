/**
 * ChangePasswordModal — single-admin password rotation surface for v0.1.
 *
 * Per design docs/design/v0.1/source-notes/v0.1-decisions.md: password change is a 1-2 lifetime action,
 * surfaced from the sidebar Account popover (not a Settings page). Modal
 * stays scoped to current/new/confirm with client-side length + match
 * validation. Backend endpoint already exists at POST /api/auth/change-password
 * (see web/src/lib/api/auth.ts).
 */
import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { changePassword } from '@/lib/api/auth';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

const MIN_LENGTH = 12;

export function ChangePasswordModal({ open, onClose }: ChangePasswordModalProps) {
  const { t } = useLanguage();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (next.length < MIN_LENGTH) {
      setError(t('account.changePassword.tooShort', { count: String(MIN_LENGTH) }));
      return;
    }
    if (next !== confirm) {
      setError(t('account.changePassword.mismatch'));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await changePassword(current, next);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('account.changePassword.failed'));
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-password-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full max-w-md rounded-[var(--ol-radius)] border border-[color:var(--ol-border)]',
          'bg-[color:var(--ol-panel)] shadow-2xl',
        )}
      >
        <div className="flex items-center justify-between border-b border-[color:var(--ol-border-subtle)] px-5 py-3">
          <h2
            id="change-password-title"
            className="text-[14px] font-semibold text-[color:var(--ol-fg)]"
          >
            {t('account.changePassword.title')}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            aria-label={t('account.changePassword.close')}
            className="grid h-7 w-7 place-items-center rounded-md text-[color:var(--ol-fg-muted)] transition-colors hover:bg-[color:var(--ol-panel-2)] hover:text-[color:var(--ol-fg)] disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          noValidate
          className="flex flex-col gap-4 px-5 py-4"
        >
          <label className="flex flex-col gap-1 text-[12px] text-[color:var(--ol-fg-muted)]">
            {t('account.changePassword.currentLabel')}
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
              className="rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-2 text-[13px] text-[color:var(--ol-fg)] outline-none focus:border-[color:var(--ol-primary)]"
            />
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-[color:var(--ol-fg-muted)]">
            {t('account.changePassword.newLabel')}
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              required
              className="rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-2 text-[13px] text-[color:var(--ol-fg)] outline-none focus:border-[color:var(--ol-primary)]"
            />
            <span className="text-[10.5px] text-[color:var(--ol-fg-subtle)]">
              {t('account.changePassword.minHint', { count: String(MIN_LENGTH) })}
            </span>
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-[color:var(--ol-fg-muted)]">
            {t('account.changePassword.confirmLabel')}
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              className="rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-2 text-[13px] text-[color:var(--ol-fg)] outline-none focus:border-[color:var(--ol-primary)]"
            />
          </label>

          {error && (
            <div className="rounded-md border border-[color:var(--ol-error)] bg-[color-mix(in_oklch,var(--ol-error)_8%,transparent)] px-3 py-2 text-[12px] text-[color:var(--ol-error)]">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="rounded-md border border-[color:var(--ol-border)] px-3 py-1.5 text-[12px] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)] disabled:opacity-50"
            >
              {t('account.changePassword.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting || !current || !next || !confirm}
              className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--ol-primary)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--ol-primary-fg)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
              {submitting ? t('account.changePassword.saving') : t('account.changePassword.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
