import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Cloud,
  Copy,
  ExternalLink,
  Globe2,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unlink,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/i18n/context';
import {
  exposeService,
  getServicePublicAccess,
  type ProjectPublicAccess,
  type PublicAccessProvider,
  type PublicAccessStatus,
  unexposeService,
} from '@/lib/api/projects';
import { ApiError } from '@/lib/api/client';
import { getCloudflareConnection, type CloudflareConnection } from '@/lib/api/cloudflare';
import {
  getProtectedShareSettings,
  saveProtectedShareSettings,
  type ProtectedShareSettings,
} from '@/lib/api/web-server';
import { cn, copyToClipboard } from '@/lib/utils';

export function PublicAccessControl({
  projectId,
  serviceId,
  runtimeUrl,
  disabled = false,
  publishDisabledReason,
  onAccessSettled,
}: {
  projectId: string;
  serviceId: string;
  runtimeUrl?: string;
  disabled?: boolean;
  publishDisabledReason?: string;
  onAccessSettled?: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [access, setAccess] = useState<ProjectPublicAccess | null>(null);
  const [cloudflareAccess, setCloudflareAccess] = useState<ProjectPublicAccess | null>(null);
  const [cloudflareConnection, setCloudflareConnection] = useState<CloudflareConnection | null>(
    null,
  );
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [methodDialogOpen, setMethodDialogOpen] = useState(false);
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [setupSettings, setSetupSettings] = useState<ProtectedShareSettings | null>(null);
  const [setupPublicHost, setSetupPublicHost] = useState('');
  const [setupAcmeEmail, setSetupAcmeEmail] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupSaving, setSetupSaving] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [rotateConfirmOpen, setRotateConfirmOpen] = useState(false);
  const lastStatus = useRef<`${PublicAccessProvider}:${PublicAccessStatus}` | null>(null);

  const load = useCallback(async () => {
    const [protectedResult, cloudflareResult, connectionResult] = await Promise.allSettled([
      getServicePublicAccess(projectId, serviceId, 'protected_share'),
      getServicePublicAccess(projectId, serviceId, 'cloudflare'),
      getCloudflareConnection(),
    ]);
    if (connectionResult.status === 'fulfilled') {
      setCloudflareConnection(connectionResult.value);
    }
    const protectedAccess = protectedResult.status === 'fulfilled' ? protectedResult.value : null;
    const nextCloudflareAccess =
      cloudflareResult.status === 'fulfilled' ? cloudflareResult.value : null;
    setCloudflareAccess(nextCloudflareAccess);
    const cloudflareActiveForService =
      nextCloudflareAccess?.status !== 'private' && nextCloudflareAccess?.service_id === serviceId;
    const nextAccess =
      protectedAccess?.status !== 'private'
        ? protectedAccess
        : cloudflareActiveForService
          ? nextCloudflareAccess
          : protectedAccess;
    if (nextAccess) {
      const provider = nextAccess.provider ?? 'protected_share';
      const nextStatus = `${provider}:${nextAccess.status}` as const;
      const previousStatus = lastStatus.current;
      lastStatus.current = nextStatus;
      setAccess({ ...nextAccess, provider });
      if (
        previousStatus !== null &&
        previousStatus !== nextStatus &&
        (nextAccess.status === 'private' || nextAccess.status === 'public')
      ) {
        onAccessSettled?.();
      }
      return;
    }
    if (protectedResult.status === 'rejected' && import.meta.env.DEV) {
      console.warn('[PublicAccessControl] Failed to load public access', protectedResult.reason);
    }
    if (cloudflareResult.status === 'rejected' && import.meta.env.DEV) {
      console.warn(
        '[PublicAccessControl] Failed to load Cloudflare public access',
        cloudflareResult.reason,
      );
    }
    if (protectedResult.status === 'rejected' && cloudflareResult.status === 'rejected') {
      if (import.meta.env.DEV) {
        console.warn('[PublicAccessControl] No public access provider could be loaded');
      }
      setAccess(null);
    }
  }, [onAccessSettled, projectId, serviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (access?.status !== 'provisioning' && access?.status !== 'unpublishing') return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [access?.status, load]);

  const showProtectedShareSetup = useCallback(async () => {
    setMethodDialogOpen(false);
    setSetupDialogOpen(true);
    setSetupLoading(true);
    try {
      const next = await getProtectedShareSettings();
      setSetupSettings(next);
      setSetupPublicHost(next.publicHost || next.detectedPublicIp || '');
      setSetupAcmeEmail(next.acmeEmail);
    } catch {
      setSetupDialogOpen(false);
      toast.error(t('projectDetail.publicAccess.setupLoadFailed'));
    } finally {
      setSetupLoading(false);
    }
  }, [t]);

  const publish = useCallback(
    async (provider: PublicAccessProvider = 'protected_share', rotateAccessCode = false) => {
      if (disabled || publishDisabledReason) {
        if (publishDisabledReason) toast.info(publishDisabledReason);
        return;
      }
      setMethodDialogOpen(false);
      setPending(true);
      try {
        const nextAccess = await exposeService(projectId, serviceId, {
          provider,
          rotateAccessCode,
        });
        lastStatus.current = `${provider}:${nextAccess.status}`;
        setAccess({ ...nextAccess, provider });
        setAccessCode(nextAccess.access_code ?? null);
        toast.success(
          provider === 'cloudflare'
            ? t('projectDetail.publicAccess.cloudflareStarted')
            : rotateAccessCode
              ? t('projectDetail.publicAccess.codeRotated')
              : t('projectDetail.publicAccess.publishReady'),
        );
        onAccessSettled?.();
      } catch (error) {
        if (error instanceof ApiError && error.code === 'PROTECTED_SHARE_SETUP_REQUIRED') {
          await showProtectedShareSetup();
        } else if (error instanceof ApiError && error.code === 'CLOUDFLARE_NOT_CONNECTED') {
          toast.info(t('projectDetail.publicAccess.connectCloudflareFirst'));
          navigate('/settings/web-server#connected-publish');
        } else if (error instanceof ApiError && error.code === 'PUBLIC_ACCESS_NOT_ELIGIBLE') {
          toast.info(
            provider === 'cloudflare'
              ? t('projectDetail.publicAccess.cloudflareNotEligible')
              : t('projectDetail.publicAccess.notEligible'),
          );
        } else if (
          error instanceof ApiError &&
          error.code === 'PROTECTED_SHARE_HTTPS_PORT_UNAVAILABLE'
        ) {
          toast.error(t('projectDetail.publicAccess.httpsPortUnavailable'));
        } else {
          toast.error(t('projectDetail.publicAccess.publishFailed'));
        }
      } finally {
        setPending(false);
      }
    },
    [
      disabled,
      navigate,
      onAccessSettled,
      projectId,
      publishDisabledReason,
      serviceId,
      showProtectedShareSetup,
      t,
    ],
  );

  const saveSetupAndPublish = async () => {
    setSetupSaving(true);
    try {
      await saveProtectedShareSettings({
        publicHost: setupPublicHost,
        acmeEmail: setupAcmeEmail,
      });
      setSetupDialogOpen(false);
      await publish('protected_share');
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'PROTECTED_SHARE_SETUP_REQUIRED')) {
        toast.error(t('projectDetail.publicAccess.setupSaveFailed'));
      }
    } finally {
      setSetupSaving(false);
    }
  };

  const unpublish = async () => {
    const provider = access?.provider ?? 'protected_share';
    setPending(true);
    try {
      const nextAccess = await unexposeService(projectId, serviceId, provider);
      lastStatus.current = `${provider}:${nextAccess.status}`;
      setAccess({ ...nextAccess, provider });
      setAccessCode(null);
      onAccessSettled?.();
    } catch {
      toast.error(t('projectDetail.publicAccess.unpublishFailed'));
    } finally {
      setPending(false);
    }
  };

  const copy = (value: string, successKey: string) => {
    void copyToClipboard(value)
      .then(() => toast.success(t(successKey)))
      .catch(() => toast.error(t('projectDetail.publicAccess.copyFailed')));
  };

  const status = access?.status ?? 'private';
  const provider = access?.provider ?? 'protected_share';
  const cloudflareConfigured = cloudflareConnection?.configured === true;
  const cloudflareHealthy =
    cloudflareConfigured &&
    cloudflareConnection.status === 'connected' &&
    cloudflareConnection.connector?.status === 'running';
  const cloudflareBusyElsewhere =
    cloudflareAccess?.status !== 'private' &&
    Boolean(cloudflareAccess?.service_id) &&
    cloudflareAccess?.service_id !== serviceId;
  const transitioning = status === 'provisioning' || status === 'unpublishing';
  const statusMessage =
    status === 'provisioning' && provider === 'cloudflare'
      ? t('projectDetail.publicAccess.cloudflareVerifying')
      : status === 'error'
        ? access?.error?.code === 'PUBLIC_ACCESS_ROUTE_UNREACHABLE'
          ? t('projectDetail.publicAccess.routeUnreachable')
          : access?.error?.code === 'PUBLIC_ACCESS_APPLICATION_UNHEALTHY'
            ? t('projectDetail.publicAccess.applicationUnhealthy')
            : t('projectDetail.publicAccess.publishErrorGeneric')
        : null;

  if (status === 'public' && access?.public_url) {
    return (
      <>
        <div className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-2.5 text-[11.5px] font-medium text-[color:var(--ol-fg-muted)]">
            {provider === 'cloudflare' ? (
              <Cloud className="h-3.5 w-3.5" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 text-[color:var(--ol-success)]" />
            )}
            {provider === 'cloudflare'
              ? t('projectDetail.publicAccess.methodCloudflareShort')
              : t('projectDetail.publicAccess.methodProtectedShort')}
          </span>

          <div className="inline-flex h-8 max-w-full items-center overflow-hidden rounded-md border border-[color:var(--ol-success)]/35 bg-[color:var(--ol-success-soft)] text-[12px]">
            <a
              href={access.public_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1.5 px-2.5 font-medium text-[color:var(--ol-success)] hover:underline"
              title={t('projectDetail.publicAccess.open')}
            >
              <Globe2 className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-56 truncate">{access.hostname}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
            <button
              type="button"
              onClick={() => copy(access.public_url!, 'projectDetail.publicAccess.copied')}
              className="grid h-full w-8 place-items-center border-l border-[color:var(--ol-success)]/25 text-[color:var(--ol-success)] hover:bg-[color:var(--ol-success)]/10"
              title={t('projectDetail.publicAccess.copy')}
              aria-label={t('projectDetail.publicAccess.copy')}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>

          {provider === 'protected_share' && (
            <div className="inline-flex h-8 items-center overflow-hidden rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] text-[12px]">
              <span className="inline-flex items-center gap-1.5 px-2.5 text-[color:var(--ol-fg-muted)]">
                <KeyRound className="h-3.5 w-3.5" />
                <span className="ol-mono font-semibold text-[color:var(--ol-fg)]">
                  {accessCode ?? t('projectDetail.publicAccess.codeSet')}
                </span>
              </span>
              {accessCode && (
                <button
                  type="button"
                  onClick={() => copy(accessCode, 'projectDetail.publicAccess.codeCopied')}
                  className="grid h-full w-8 place-items-center border-l border-[color:var(--ol-border)] hover:bg-[color:var(--ol-panel-3)]"
                  aria-label={t('projectDetail.publicAccess.copyCode')}
                  title={t('projectDetail.publicAccess.copyCode')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                disabled={disabled || pending}
                onClick={() => setRotateConfirmOpen(true)}
                className="grid h-full w-8 place-items-center border-l border-[color:var(--ol-border)] hover:bg-[color:var(--ol-panel-3)]"
                aria-label={t('projectDetail.publicAccess.rotateCode')}
                title={t('projectDetail.publicAccess.rotateCode')}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', pending && 'animate-spin')} />
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={disabled || pending}
            onClick={() => setStopConfirmOpen(true)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[color:var(--ol-border)] px-2.5 text-[12px] text-[color:var(--ol-fg-muted)] hover:border-[color:var(--ol-border-strong)] disabled:opacity-50"
          >
            <Unlink className="h-3.5 w-3.5" />
            {t('projectDetail.publicAccess.stop')}
          </button>
        </div>

        <ConfirmDialog
          open={rotateConfirmOpen}
          onOpenChange={setRotateConfirmOpen}
          title={t('projectDetail.publicAccess.rotateTitle')}
          description={t('projectDetail.publicAccess.rotateDescription')}
          confirmLabel={t('projectDetail.publicAccess.rotateConfirm')}
          onConfirm={() => void publish('protected_share', true)}
        />
        <ConfirmDialog
          open={stopConfirmOpen}
          onOpenChange={setStopConfirmOpen}
          title={t('projectDetail.publicAccess.stopTitle')}
          description={t('projectDetail.publicAccess.stopDescription', {
            hostname: access.hostname ?? '',
          })}
          confirmLabel={t('projectDetail.publicAccess.stopConfirm')}
          variant="destructive"
          onConfirm={() => void unpublish()}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2.5">
        {statusMessage && (
          <span
            role={status === 'error' ? 'alert' : 'status'}
            className={cn(
              'max-w-sm text-right text-[11.5px] leading-relaxed',
              status === 'error'
                ? 'text-[color:var(--ol-error)]'
                : 'text-[color:var(--ol-fg-subtle)]',
            )}
          >
            {statusMessage}
          </span>
        )}
        {publishDisabledReason && (
          <span className="text-[11.5px] text-[color:var(--ol-fg-subtle)]">
            {publishDisabledReason}
          </span>
        )}
        <button
          type="button"
          disabled={disabled || pending || transitioning || Boolean(publishDisabledReason)}
          onClick={() => {
            if (cloudflareConfigured) setMethodDialogOpen(true);
            else void publish('protected_share');
          }}
          title={publishDisabledReason}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-[color:var(--ol-border)] px-3 text-[12.5px] font-medium text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]',
            (disabled || pending || transitioning || publishDisabledReason) &&
              'cursor-not-allowed opacity-50',
          )}
        >
          {pending || status === 'provisioning' || status === 'unpublishing' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Globe2 className="h-3.5 w-3.5" />
          )}
          {status === 'provisioning'
            ? t('projectDetail.publicAccess.publishing')
            : status === 'unpublishing'
              ? t('projectDetail.publicAccess.stopping')
              : status === 'error'
                ? t('projectDetail.publicAccess.retry')
                : t('projectDetail.publicAccess.publish')}
        </button>
        {runtimeUrl && (
          <a
            href={runtimeUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-[color:var(--ol-border)] px-2.5 text-[12px] text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
          >
            <ExternalLink className="h-3 w-3" />
            {t('services.detail.runtime.openInNewTab')}
          </a>
        )}
      </div>

      <Dialog open={methodDialogOpen} onOpenChange={setMethodDialogOpen}>
        <DialogContent className="max-w-md border-[color:var(--ol-border)] bg-[color:var(--ol-panel)]">
          <DialogHeader>
            <DialogTitle>{t('projectDetail.publicAccess.methodTitle')}</DialogTitle>
            <DialogDescription>
              {t('projectDetail.publicAccess.methodDescription')}
            </DialogDescription>
          </DialogHeader>
          <p className="text-[11.5px] leading-relaxed text-[color:var(--ol-fg-subtle)]">
            {t('projectDetail.publicAccess.entrypointNote')}
          </p>
          <div
            className="mt-3 grid gap-2"
            role="group"
            aria-label={t('projectDetail.publicAccess.methodTitle')}
          >
            <button
              type="button"
              onClick={() => void publish('protected_share')}
              className="flex items-start gap-3 rounded-lg border border-[color:var(--ol-success)]/35 bg-[color:var(--ol-success-soft)] p-3 text-left transition-colors hover:border-[color:var(--ol-success)]"
            >
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--ol-success)]" />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-[color:var(--ol-fg)]">
                  {t('projectDetail.publicAccess.methodProtected')}
                  <span className="rounded-full bg-[color:var(--ol-success)]/10 px-2 py-0.5 text-[10.5px] font-medium text-[color:var(--ol-success)]">
                    {t('projectDetail.publicAccess.recommended')}
                  </span>
                </span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-[color:var(--ol-fg-muted)]">
                  {t('projectDetail.publicAccess.methodProtectedDescription')}
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={!cloudflareHealthy || cloudflareBusyElsewhere}
              onClick={() => void publish('cloudflare')}
              className="flex items-start gap-3 rounded-lg border border-[color:var(--ol-border)] p-3 text-left transition-colors hover:border-[color:var(--ol-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--ol-fg-muted)]" />
              <span className="min-w-0">
                <span className="text-[13px] font-semibold text-[color:var(--ol-fg)]">
                  {t('projectDetail.publicAccess.methodCloudflare')}
                </span>
                <span className="mt-1 block text-[11.5px] leading-relaxed text-[color:var(--ol-fg-muted)]">
                  {cloudflareBusyElsewhere
                    ? t('projectDetail.publicAccess.cloudflareBusyElsewhere')
                    : cloudflareHealthy
                      ? t('projectDetail.publicAccess.methodCloudflareDescription')
                      : t('projectDetail.publicAccess.cloudflareNeedsAttention')}
                </span>
              </span>
            </button>
          </div>
          {!cloudflareHealthy && (
            <button
              type="button"
              onClick={() => navigate('/settings/web-server#connected-publish')}
              className="mt-1 w-fit text-[11.5px] font-medium text-[color:var(--ol-primary)] hover:underline"
            >
              {t('projectDetail.publicAccess.openCloudflareSettings')}
            </button>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={setupDialogOpen} onOpenChange={setSetupDialogOpen}>
        <DialogContent className="max-w-md border-[color:var(--ol-border)] bg-[color:var(--ol-panel)]">
          <DialogHeader>
            <DialogTitle>{t('projectDetail.publicAccess.setupTitle')}</DialogTitle>
            <DialogDescription>
              {t('projectDetail.publicAccess.setupDescription')}
            </DialogDescription>
          </DialogHeader>

          {setupLoading ? (
            <div className="mt-3 grid gap-3" aria-busy="true">
              <div className="h-14 animate-pulse rounded-md bg-[color:var(--ol-panel-2)]" />
              <div className="h-14 animate-pulse rounded-md bg-[color:var(--ol-panel-2)]" />
            </div>
          ) : (
            <form
              className="mt-3 grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void saveSetupAndPublish();
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="public-share-setup-host">
                  {t('projectDetail.publicAccess.setupPublicHost')}
                </Label>
                <Input
                  id="public-share-setup-host"
                  value={setupPublicHost}
                  onChange={(event) => setSetupPublicHost(event.target.value)}
                  placeholder={t('webServer.protectedShare.publicHostPlaceholder')}
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
                <p className="text-[11.5px] leading-relaxed text-[color:var(--ol-fg-subtle)]">
                  {setupSettings?.detectedPublicIp
                    ? t('projectDetail.publicAccess.setupDetectedHost', {
                        ip: setupSettings.detectedPublicIp,
                      })
                    : t('projectDetail.publicAccess.setupPublicHostHelp')}
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="public-share-setup-email">
                  {t('projectDetail.publicAccess.setupAcmeEmail')}
                </Label>
                <Input
                  id="public-share-setup-email"
                  type="email"
                  value={setupAcmeEmail}
                  onChange={(event) => setSetupAcmeEmail(event.target.value)}
                  placeholder="openlander.ops@gmail.com"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
                <p className="text-[11.5px] leading-relaxed text-[color:var(--ol-fg-subtle)]">
                  {t('projectDetail.publicAccess.setupAcmeEmailHelp')}
                </p>
              </div>

              {setupSettings?.traefikMode === 'external' && (
                <p className="rounded-md border border-[color:var(--ol-warning)]/30 bg-[color:var(--ol-warning-soft)] px-3 py-2 text-[11.5px] text-[color:var(--ol-warning)]">
                  {t('webServer.protectedShare.managedRequired')}
                </p>
              )}

              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={setupSaving}>
                    {t('common.cancel')}
                  </Button>
                </DialogClose>
                <Button
                  type="submit"
                  disabled={setupSaving || setupSettings?.traefikMode === 'external'}
                >
                  {setupSaving
                    ? t('projectDetail.publicAccess.setupSaving')
                    : t('projectDetail.publicAccess.setupConfirm')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
