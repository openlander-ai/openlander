import { useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, Save, ShieldCheck, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';

import { OuterCard } from '@/components/Shell/OuterCard';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  const [certificateSettingsOpen, setCertificateSettingsOpen] = useState(false);
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
        setCertificateSettingsOpen(!next.acmeEmail);
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
    if (!acmeEmail.trim()) {
      setCertificateSettingsOpen(true);
      toast.info(t('webServer.protectedShare.certificateSettingsRequired'));
      return;
    }
    setSaving(true);
    try {
      const next = await saveProtectedShareSettings({ publicHost, acmeEmail });
      setSettings(next);
      setPublicHost(next.publicHost);
      setAcmeEmail(next.acmeEmail);
      setCertificateSettingsOpen(false);
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
          <div className="grid gap-4">
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
          </div>

          <Collapsible
            open={certificateSettingsOpen}
            onOpenChange={setCertificateSettingsOpen}
            className="overflow-hidden rounded-lg border border-[color:var(--ol-border-subtle)]"
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--ol-panel-2)]"
              >
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-[color:var(--ol-fg)]">
                    {t('webServer.protectedShare.certificateSettings')}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-[color:var(--ol-fg-subtle)]">
                    {acmeEmail || t('webServer.protectedShare.certificateSettingsMissing')}
                  </span>
                </span>
                {certificateSettingsOpen ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-[color:var(--ol-fg-muted)]" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-[color:var(--ol-fg-muted)]" />
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-1.5 border-t border-[color:var(--ol-border-subtle)] px-3 py-3">
                <Label htmlFor="protected-share-email">
                  {t('webServer.protectedShare.acmeEmail')}
                </Label>
                <Input
                  id="protected-share-email"
                  type="email"
                  value={acmeEmail}
                  onChange={(event) => setAcmeEmail(event.target.value)}
                  placeholder="openlander.ops@gmail.com"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
                <p className="text-[11.5px] leading-relaxed text-[color:var(--ol-fg-subtle)]">
                  {t('webServer.protectedShare.acmeEmailHelp')}
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

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
