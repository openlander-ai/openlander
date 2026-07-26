/**
 * Notifications settings — generic outbound webhook only (1.0 scope).
 *
 * Per the trim direction: 1.0 ships ONE provider — a generic webhook
 * URL with event-toggle checkboxes. Discord/Slack/Email/Telegram
 * presets are v1.1+ that point at the same plumbing.
 *
 * PR6 wires this to the real backend:
 *   GET    /api/settings/notifications/webhook → 200 { url, events[] } | 404
 *   POST   /api/settings/notifications/webhook { url, events[] } → 200
 *   DELETE /api/settings/notifications/webhook → 200 (PR7)
 *
 * Save flow: GET on mount populates the form (404 keeps defaults).
 * POST on Save shows sonner toast (success / error). The Save button
 * has an explicit `isSaving` loading state per CCG review — slow
 * self-hosted networks see double-clicks otherwise.
 */
import { useEffect, useState } from 'react';
import { Bell, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { OuterCard } from '@/components/Shell/OuterCard';
import { useLanguage } from '@/i18n/context';
import { fetchNotificationWebhook, saveNotificationWebhook } from '@/lib/api/notifications';
import { localizeApiError } from '@/lib/localized-api-error';
import { cn } from '@/lib/utils';

const EVENTS = [
  { id: 'deploy.started', labelKey: 'notifications.settings.event.deployStarted' },
  { id: 'deploy.completed', labelKey: 'notifications.settings.event.deployCompleted' },
  { id: 'deploy.failed', labelKey: 'notifications.settings.event.deployFailed' },
  { id: 'service.crashed', labelKey: 'notifications.settings.event.serviceCrashed' },
  { id: 'service.recovered', labelKey: 'notifications.settings.event.serviceRecovered' },
] as const;

const DEFAULT_EVENTS = new Set(['deploy.completed', 'deploy.failed', 'service.crashed']);

export function NotificationsSettings() {
  const { t } = useLanguage();
  const [url, setUrl] = useState('');
  const [enabledEvents, setEnabledEvents] = useState<Set<string>>(new Set(DEFAULT_EVENTS));
  const [isLoadingExisting, setIsLoadingExisting] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // GET on mount — 404 falls through to defaults silently.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await fetchNotificationWebhook();
        if (cancelled) return;
        if (existing) {
          setUrl(existing.url);
          setEnabledEvents(new Set(existing.events));
        }
      } catch (err) {
        // Backend missing or transient — keep defaults; don't error-toast on
        // initial load (the user didn't try to do anything yet).
        if (!cancelled) {
          console.warn('Failed to load notification webhook', err);
        }
      } finally {
        if (!cancelled) setIsLoadingExisting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: string) => {
    setEnabledEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await saveNotificationWebhook({
        url: url.trim(),
        events: Array.from(enabledEvents),
      });
      toast.success(t('notifications.settings.saved'));
    } catch (err) {
      toast.error(
        localizeApiError(err, t, 'notifications.settings.saveFailed', 'common.errors.codes'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const canSave = url.trim().length > 0 && !isSaving && !isLoadingExisting;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
            {t('notifications.title')}
          </span>
        }
        subtitle={t('notifications.settings.subtitle')}
      >
        <p className="mb-4 text-[12px] text-[color:var(--ol-fg-muted)]">
          {t('notifications.settings.description')}
        </p>

        <label className="block">
          <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-[color:var(--ol-fg-subtle)]">
            {t('notifications.settings.webhookUrl')}
          </span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/openlander-webhook"
            disabled={isLoadingExisting}
            className="ol-mono mt-1.5 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 py-2 text-[12.5px] text-[color:var(--ol-fg)] placeholder:text-[color:var(--ol-fg-subtle)] focus-visible:border-[color:var(--ol-primary)] focus-visible:outline-none disabled:opacity-60"
          />
        </label>

        <fieldset className="mt-5" disabled={isLoadingExisting}>
          <legend className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-[color:var(--ol-fg-subtle)]">
            {t('notifications.settings.events')}
          </legend>
          <ul className="mt-2 flex flex-col gap-1.5">
            {EVENTS.map((e) => {
              const checked = enabledEvents.has(e.id);
              return (
                <li key={e.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-[12.5px] transition-colors',
                      checked
                        ? 'border-[color:var(--ol-primary)] bg-[color:var(--ol-primary-soft)] text-[color:var(--ol-fg)]'
                        : 'border-[color:var(--ol-border-subtle)] text-[color:var(--ol-fg-muted)] hover:border-[color:var(--ol-border)] hover:text-[color:var(--ol-fg)]',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-[color:var(--ol-border)] text-[color:var(--ol-primary)]"
                      checked={checked}
                      onChange={() => toggle(e.id)}
                    />
                    <span className="flex-1">{t(e.labelKey)}</span>
                    <code className="ol-mono text-[11px] text-[color:var(--ol-fg-subtle)]">
                      {e.id}
                    </code>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md bg-[color:var(--ol-primary)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--ol-primary-fg)] transition-opacity',
              canSave ? 'hover:opacity-90' : 'cursor-not-allowed opacity-50',
            )}
          >
            {isSaving && <Loader2 className="h-3 w-3 animate-spin" />}
            {isSaving ? t('notifications.settings.saving') : t('notifications.settings.save')}
          </button>
          {!url.trim() && !isLoadingExisting && (
            <span className="text-[11px] text-[color:var(--ol-fg-subtle)]">
              {t('notifications.settings.urlRequired')}
            </span>
          )}
        </div>
      </OuterCard>

      <OuterCard
        title={t('notifications.settings.futureTitle')}
        subtitle={t('notifications.settings.futureSubtitle')}
      >
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-2 text-[12px] text-[color:var(--ol-fg-subtle)] opacity-60"
        >
          <Plus className="h-3 w-3" />
          {t('notifications.settings.addPreset')}
        </button>
      </OuterCard>
    </div>
  );
}

export default NotificationsSettings;
