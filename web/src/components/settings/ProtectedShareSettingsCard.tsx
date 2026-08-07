import { useEffect, useState, type FormEvent } from 'react';
import { Save, ShieldCheck, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';

import { OuterCard } from '@/components/Shell/OuterCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/i18n/context';
import {
  getProtectedShareSettings,
  saveProtectedShareSettings,
  type ProtectedShareSettings,
} from '@/lib/api/web-server';

export function ProtectedShareSettingsCard() {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<ProtectedShareSettings | null>(null);
  const [publicHost, setPublicHost] = useState('');
  const [acmeEmail, setAcmeEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void getProtectedShareSettings()
      .then((next) => {
        if (!active) return;
        setSettings(next);
        setPublicHost(next.publicHost);
        setAcmeEmail(next.acmeEmail);
      })
      .catch(() => {
        if (active) toast.error(t('webServer.protectedShare.loadFailed'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await saveProtectedShareSettings({ publicHost, acmeEmail });
      setSettings(next);
      setPublicHost(next.publicHost);
      setAcmeEmail(next.acmeEmail);
      toast.success(
        next.proxyApplied
          ? t('webServer.protectedShare.saved')
          : t('webServer.protectedShare.savedRestartPending'),
      );
    } catch {
      toast.error(t('webServer.protectedShare.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <OuterCard
      title={
        <span id="public-access" className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[color:var(--ol-success)]" />
          {t('webServer.protectedShare.title')}
        </span>
      }
      subtitle={t('webServer.protectedShare.subtitle')}
      actions={
        <span className="rounded-full bg-[color:var(--ol-success-soft)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--ol-success)]">
          {t('webServer.protectedShare.recommended')}
        </span>
      }
    >
      {loading ? (
        <div className="h-24 animate-pulse rounded-lg bg-[color:var(--ol-panel-2)]" />
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="protected-share-host">
                {t('webServer.protectedShare.publicHost')}
              </Label>
              <Input
                id="protected-share-host"
                value={publicHost}
                onChange={(event) => setPublicHost(event.target.value)}
                placeholder={t('webServer.protectedShare.publicHostPlaceholder')}
                autoCapitalize="none"
                spellCheck={false}
                required
              />
              <p className="text-[11.5px] leading-relaxed text-[color:var(--ol-fg-subtle)]">
                {t('webServer.protectedShare.publicHostHelp')}
              </p>
              {settings?.detectedPublicIp && settings.detectedPublicIp !== publicHost && (
                <button
                  type="button"
                  onClick={() => setPublicHost(settings.detectedPublicIp ?? '')}
                  className="inline-flex w-fit items-center gap-1 text-[11.5px] font-medium text-[color:var(--ol-primary)] hover:underline"
                >
                  <WandSparkles className="h-3.5 w-3.5" />
                  {t('webServer.protectedShare.useDetectedIp', {
                    ip: settings.detectedPublicIp,
                  })}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="protected-share-email">
                {t('webServer.protectedShare.acmeEmail')}
              </Label>
              <Input
                id="protected-share-email"
                type="email"
                value={acmeEmail}
                onChange={(event) => setAcmeEmail(event.target.value)}
                placeholder="admin@example.com"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
              <p className="text-[11.5px] leading-relaxed text-[color:var(--ol-fg-subtle)]">
                {t('webServer.protectedShare.acmeEmailHelp')}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-[color:var(--ol-border-subtle)] pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-[11.5px] leading-relaxed text-[color:var(--ol-fg-muted)]">
              {settings?.traefikMode === 'external'
                ? t('webServer.protectedShare.managedRequired')
                : t('webServer.protectedShare.securityNote')}
            </p>
            <Button
              type="submit"
              size="sm"
              disabled={saving || settings?.traefikMode === 'external'}
              className="shrink-0"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {saving ? t('webServer.protectedShare.saving') : t('webServer.protectedShare.save')}
            </Button>
          </div>
        </form>
      )}
    </OuterCard>
  );
}
