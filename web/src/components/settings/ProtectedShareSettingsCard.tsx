import { useEffect, useState, type FormEvent } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Unlink,
  WandSparkles,
} from 'lucide-react';
import { toast } from 'sonner';

import { OuterCard } from '@/components/Shell/OuterCard';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/i18n/context';
import { exposeService, unexposeService } from '@/lib/api/projects';
import {
  getProtectedShareSettings,
  saveProtectedShareSettings,
  type ProtectedShareSettings,
  type WebServerRoute,
} from '@/lib/api/web-server';
import { cn, copyToClipboard } from '@/lib/utils';

type ShareAction = 'rotate' | 'stop';

interface ShareActionTarget {
  action: ShareAction;
  route: WebServerRoute;
}

interface ProtectedShareSettingsCardProps {
  shares: WebServerRoute[];
  sharesLoading: boolean;
  onSharesChanged: () => void;
}

export function ProtectedShareSettingsCard({
  shares,
  sharesLoading,
  onSharesChanged,
}: ProtectedShareSettingsCardProps) {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<ProtectedShareSettings | null>(null);
  const [publicHost, setPublicHost] = useState('');
  const [acmeEmail, setAcmeEmail] = useState('');
  const [certificateSettingsOpen, setCertificateSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<ShareActionTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ShareActionTarget | null>(null);
  const [revealedCode, setRevealedCode] = useState<{
    projectName: string;
    serviceName: string;
    code: string;
  } | null>(null);

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
      toast.success(t('webServer.protectedShare.saved'));
    } catch {
      toast.error(t('webServer.protectedShare.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const copy = async (value: string, successKey: string) => {
    try {
      await copyToClipboard(value);
      toast.success(t(successKey));
    } catch {
      toast.error(t('webServer.protectedShare.copyFailed'));
    }
  };

  const rotateCode = async (route: WebServerRoute) => {
    setPending({ action: 'rotate', route });
    try {
      const result = await exposeService(route.projectId, route.serviceId, {
        provider: 'protected_share',
        rotateAccessCode: true,
      });
      if (result.access_code) {
        setRevealedCode({
          projectName: route.projectName,
          serviceName: route.serviceName,
          code: result.access_code,
        });
        toast.success(t('webServer.protectedShare.codeRotated'));
      } else {
        toast.error(t('webServer.protectedShare.rotateFailed'));
      }
      onSharesChanged();
    } catch {
      toast.error(t('webServer.protectedShare.rotateFailed'));
    } finally {
      setPending(null);
    }
  };

  const stopShare = async (route: WebServerRoute) => {
    setPending({ action: 'stop', route });
    try {
      await unexposeService(route.projectId, route.serviceId, 'protected_share');
      toast.success(t('webServer.protectedShare.shareStopped'));
      onSharesChanged();
    } catch {
      toast.error(t('webServer.protectedShare.stopFailed'));
    } finally {
      setPending(null);
    }
  };

  const runConfirmedAction = () => {
    if (!confirmTarget) return;
    if (confirmTarget.action === 'rotate') void rotateCode(confirmTarget.route);
    else void stopShare(confirmTarget.route);
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
      <>
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
              <div className="max-w-2xl space-y-1 text-[11.5px] leading-relaxed text-[color:var(--ol-fg-muted)]">
                <p>
                  {settings?.traefikMode === 'external'
                    ? t('webServer.protectedShare.managedRequired')
                    : t('webServer.protectedShare.securityNote')}
                </p>
                {settings?.security && (
                  <p>
                    {t('webServer.protectedShare.securityPolicy', {
                      attempts: settings.security.verifyMaxAttempts,
                      minutes: Math.ceil(settings.security.verifyWindowSeconds / 60),
                      days: Math.ceil(settings.security.sessionTtlSeconds / 86_400),
                    })}
                  </p>
                )}
              </div>
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

        <section className="mt-5 border-t border-[color:var(--ol-border-subtle)] pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-semibold text-[color:var(--ol-fg)]">
                {t('webServer.protectedShare.activeShares')}
              </h3>
              <p className="mt-0.5 text-[11.5px] text-[color:var(--ol-fg-subtle)]">
                {t('webServer.protectedShare.activeSharesDescription')}
              </p>
            </div>
            {!sharesLoading && shares.length > 0 && (
              <span className="rounded-full bg-[color:var(--ol-success-soft)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--ol-success)]">
                {shares.length}
              </span>
            )}
          </div>

          {sharesLoading ? (
            <div className="h-16 animate-pulse rounded-lg bg-[color:var(--ol-panel-2)]" />
          ) : shares.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[color:var(--ol-border)] px-4 py-5 text-center text-[12px] text-[color:var(--ol-fg-subtle)]">
              {t('webServer.protectedShare.noActiveShares')}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-[color:var(--ol-border-subtle)]">
              {shares.map((route, index) => {
                const actionPending = pending?.route.id === route.id;
                const publicUrl = `https://${route.host}`;
                return (
                  <div
                    key={route.id}
                    className={cn(
                      'flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between',
                      index > 0 && 'border-t border-[color:var(--ol-border-subtle)]',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--ol-success)]" />
                        <span className="truncate text-[12.5px] font-medium text-[color:var(--ol-fg)]">
                          {route.projectName} · {route.serviceName.replace(/__svc$/, '')}
                        </span>
                      </div>
                      <a
                        href={publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-3.5 mt-1 flex min-w-0 items-center gap-1 text-[11.5px] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-primary)]"
                      >
                        <span className="truncate ol-mono">{route.host}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        disabled={actionPending}
                        onClick={() => void copy(publicUrl, 'webServer.protectedShare.urlCopied')}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[color:var(--ol-border)] px-2.5 text-[11.5px] text-[color:var(--ol-fg-muted)] hover:border-[color:var(--ol-border-strong)] disabled:opacity-50"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t('webServer.protectedShare.copyUrl')}
                      </button>
                      <button
                        type="button"
                        disabled={actionPending}
                        onClick={() => setConfirmTarget({ action: 'rotate', route })}
                        className="grid h-8 w-8 place-items-center rounded-md border border-[color:var(--ol-border)] text-[color:var(--ol-fg-muted)] hover:border-[color:var(--ol-border-strong)] disabled:opacity-50"
                        aria-label={t('webServer.protectedShare.rotateCode')}
                        title={t('webServer.protectedShare.rotateCode')}
                      >
                        {actionPending && pending.action === 'rotate' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={actionPending}
                        onClick={() => setConfirmTarget({ action: 'stop', route })}
                        className="grid h-8 w-8 place-items-center rounded-md border border-[color:var(--ol-border)] text-[color:var(--ol-fg-muted)] hover:border-[color:var(--ol-error)] hover:text-[color:var(--ol-error)] disabled:opacity-50"
                        aria-label={t('webServer.protectedShare.stopShare')}
                        title={t('webServer.protectedShare.stopShare')}
                      >
                        {actionPending && pending.action === 'stop' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Unlink className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <ConfirmDialog
          open={confirmTarget !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmTarget(null);
          }}
          title={
            confirmTarget?.action === 'stop'
              ? t('webServer.protectedShare.stopTitle')
              : t('webServer.protectedShare.rotateTitle')
          }
          description={
            confirmTarget?.action === 'stop'
              ? t('webServer.protectedShare.stopDescription', {
                  hostname: confirmTarget.route.host,
                })
              : t('webServer.protectedShare.rotateDescription')
          }
          confirmLabel={
            confirmTarget?.action === 'stop'
              ? t('webServer.protectedShare.stopConfirm')
              : t('webServer.protectedShare.rotateConfirm')
          }
          variant={confirmTarget?.action === 'stop' ? 'destructive' : 'default'}
          onConfirm={runConfirmedAction}
        />

        <Dialog open={revealedCode !== null} onOpenChange={() => setRevealedCode(null)}>
          <DialogContent className="max-w-sm border-[color:var(--ol-border)] bg-[color:var(--ol-panel)]">
            <DialogHeader>
              <DialogTitle>{t('webServer.protectedShare.newCodeTitle')}</DialogTitle>
              <DialogDescription>
                {t('webServer.protectedShare.newCodeDescription', {
                  application: revealedCode
                    ? `${revealedCode.projectName} · ${revealedCode.serviceName.replace(/__svc$/, '')}`
                    : '',
                })}
              </DialogDescription>
            </DialogHeader>
            {revealedCode && (
              <button
                type="button"
                onClick={() => void copy(revealedCode.code, 'webServer.protectedShare.codeCopied')}
                className="mt-3 flex w-full items-center justify-between rounded-lg border border-[color:var(--ol-success)]/35 bg-[color:var(--ol-success-soft)] px-3 py-3 text-left"
              >
                <span className="inline-flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-[color:var(--ol-success)]" />
                  <span className="ol-mono text-[15px] font-semibold tracking-[0.08em] text-[color:var(--ol-fg)]">
                    {revealedCode.code}
                  </span>
                </span>
                <Copy className="h-4 w-4 text-[color:var(--ol-success)]" />
              </button>
            )}
          </DialogContent>
        </Dialog>
      </>
    </OuterCard>
  );
}
