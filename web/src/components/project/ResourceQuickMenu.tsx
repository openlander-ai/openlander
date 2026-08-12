import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Cloud,
  Code2,
  Copy,
  ExternalLink,
  Globe2,
  Info,
  Loader2,
  MoreHorizontal,
  Rocket,
  ScrollText,
  ShieldCheck,
  Unlink,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/i18n/context';
import { ApiError } from '@/lib/api/client';
import {
  exposeService,
  getServicePublicAccess,
  type ProjectPublicAccess,
  type PublicAccessProvider,
  unexposeService,
} from '@/lib/api/projects';
import type { ServiceNode } from '@/lib/projectTopology';
import { cn, copyToClipboard } from '@/lib/utils';

export type ResourceQuickTab =
  'overview' | 'logs' | 'deployments' | 'monitoring' | 'environment' | 'domains' | 'connections';

interface ResourceQuickMenuProps {
  projectId: string;
  service: ServiceNode;
  managed: boolean;
  onOpenTab: (tab: ResourceQuickTab) => void;
  onAccessChanged?: () => void;
}

function activeAccessForService(
  serviceId: string,
  protectedAccess: ProjectPublicAccess | null,
  cloudflareAccess: ProjectPublicAccess | null,
): ProjectPublicAccess | null {
  if (protectedAccess?.status !== 'private' && protectedAccess?.service_id === serviceId) {
    return { ...protectedAccess, provider: 'protected_share' };
  }
  if (cloudflareAccess?.status !== 'private' && cloudflareAccess?.service_id === serviceId) {
    return { ...cloudflareAccess, provider: 'cloudflare' };
  }
  return null;
}

export function ResourceQuickMenu({
  projectId,
  service,
  managed,
  onOpenTab,
  onAccessChanged,
}: ResourceQuickMenuProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [accessLoaded, setAccessLoaded] = useState(false);
  const [accessLoadFailed, setAccessLoadFailed] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [protectedAccess, setProtectedAccess] = useState<ProjectPublicAccess | null>(null);
  const [cloudflareAccess, setCloudflareAccess] = useState<ProjectPublicAccess | null>(null);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [shareResult, setShareResult] = useState<ProjectPublicAccess | null>(null);
  const lastObservedStatus = useRef<string | null>(null);

  const supportsHttpRuntime = !service.runtimeRole || service.runtimeRole === 'application';
  const canManagePublicAccess =
    !managed &&
    supportsHttpRuntime &&
    !service.archivedAt &&
    (!service.isComposeChild || service.isTrafficTarget === true || Boolean(service.url));
  const activeAccess = useMemo(
    () => activeAccessForService(service.id, protectedAccess, cloudflareAccess),
    [cloudflareAccess, protectedAccess, service.id],
  );
  const cloudflareBusyElsewhere =
    cloudflareAccess?.status !== 'private' &&
    Boolean(cloudflareAccess?.service_id) &&
    cloudflareAccess?.service_id !== service.id;

  const loadAccess = useCallback(async () => {
    if (!canManagePublicAccess) return;
    setLoadingAccess(true);
    try {
      const [protectedResult, cloudflareResult] = await Promise.allSettled([
        getServicePublicAccess(projectId, service.id, 'protected_share'),
        getServicePublicAccess(projectId, service.id, 'cloudflare'),
      ]);
      setAccessLoadFailed(
        protectedResult.status === 'rejected' && cloudflareResult.status === 'rejected',
      );
      const nextProtected =
        protectedResult.status === 'fulfilled' ? protectedResult.value : protectedAccess;
      const nextCloudflare =
        cloudflareResult.status === 'fulfilled' ? cloudflareResult.value : cloudflareAccess;
      setProtectedAccess(nextProtected);
      setCloudflareAccess(nextCloudflare);

      const nextActive = activeAccessForService(service.id, nextProtected, nextCloudflare);
      const nextStatus = nextActive ? `${nextActive.provider}:${nextActive.status}` : 'private';
      const previousStatus = lastObservedStatus.current;
      lastObservedStatus.current = nextStatus;
      if (previousStatus?.endsWith(':provisioning') && nextActive?.status === 'public') {
        toast.success(t('projectDetail.servicesGuide.quickActions.shareReady'));
        onAccessChanged?.();
      }
      if (previousStatus?.endsWith(':unpublishing') && !nextActive) {
        toast.success(t('projectDetail.servicesGuide.quickActions.shareStopped'));
        onAccessChanged?.();
      }
    } finally {
      setAccessLoaded(true);
      setLoadingAccess(false);
    }
  }, [
    canManagePublicAccess,
    cloudflareAccess,
    onAccessChanged,
    projectId,
    protectedAccess,
    service.id,
    t,
  ]);

  useEffect(() => {
    if (activeAccess?.status !== 'provisioning' && activeAccess?.status !== 'unpublishing') {
      return;
    }
    const timer = window.setInterval(() => void loadAccess(), 2_500);
    return () => window.clearInterval(timer);
  }, [activeAccess?.status, loadAccess]);

  const publish = async (provider: PublicAccessProvider) => {
    setActionPending(true);
    try {
      const result = await exposeService(projectId, service.id, { provider });
      const withProvider = { ...result, provider };
      lastObservedStatus.current = `${provider}:${result.status}`;
      if (provider === 'protected_share') {
        setProtectedAccess(withProvider);
        setShareResult(withProvider);
        toast.success(t('projectDetail.servicesGuide.quickActions.shareReady'));
      } else {
        setCloudflareAccess(withProvider);
        toast.info(t('projectDetail.servicesGuide.quickActions.shareProvisioning'));
      }
      onAccessChanged?.();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PROTECTED_SHARE_SETUP_REQUIRED') {
        toast.info(t('projectDetail.servicesGuide.quickActions.setupRequired'));
        navigate('/settings/web-server#public-access');
      } else if (error instanceof ApiError && error.code === 'CLOUDFLARE_NOT_CONNECTED') {
        toast.info(t('projectDetail.publicAccess.connectCloudflareFirst'));
        navigate('/settings/web-server#connected-publish');
      } else if (error instanceof ApiError && error.code === 'PUBLIC_ACCESS_NOT_ELIGIBLE') {
        toast.info(t('projectDetail.publicAccess.notEligible'));
      } else {
        toast.error(t('projectDetail.publicAccess.publishFailed'));
      }
    } finally {
      setActionPending(false);
    }
  };

  const unpublish = async () => {
    if (!activeAccess) return;
    const provider = activeAccess.provider ?? 'protected_share';
    setActionPending(true);
    try {
      const result = await unexposeService(projectId, service.id, provider);
      lastObservedStatus.current = `${provider}:${result.status}`;
      if (provider === 'protected_share') setProtectedAccess({ ...result, provider });
      else setCloudflareAccess({ ...result, provider });
      if (result.status === 'private') {
        toast.success(t('projectDetail.servicesGuide.quickActions.shareStopped'));
        onAccessChanged?.();
      }
    } catch {
      toast.error(t('projectDetail.publicAccess.unpublishFailed'));
    } finally {
      setActionPending(false);
    }
  };

  const quickTabs: Array<{
    id: ResourceQuickTab;
    label: string;
    icon: typeof Info;
  }> = managed
    ? [
        {
          id: 'overview',
          label: t('projectDetail.servicesGuide.quickActions.overview'),
          icon: Info,
        },
        {
          id: 'logs',
          label: t('projectDetail.servicesGuide.quickActions.logs'),
          icon: ScrollText,
        },
        {
          id: 'connections',
          label: t('projectDetail.servicesGuide.quickActions.connections'),
          icon: Globe2,
        },
      ]
    : [
        {
          id: 'overview',
          label: t('projectDetail.servicesGuide.quickActions.overview'),
          icon: Info,
        },
        {
          id: 'logs',
          label: t('projectDetail.servicesGuide.quickActions.logs'),
          icon: ScrollText,
        },
        {
          id: 'deployments',
          label: t('projectDetail.servicesGuide.quickActions.deployments'),
          icon: Rocket,
        },
        {
          id: 'monitoring',
          label: t('projectDetail.servicesGuide.quickActions.monitoring'),
          icon: Activity,
        },
        ...(service.isComposeChild
          ? []
          : [
              {
                id: 'environment' as const,
                label: t('projectDetail.servicesGuide.quickActions.environment'),
                icon: Code2,
              },
            ]),
      ];

  const transitioning =
    activeAccess?.status === 'provisioning' || activeAccess?.status === 'unpublishing';

  return (
    <div
      className="shrink-0"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void loadAccess();
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('projectDetail.servicesGuide.quickActions.more', {
              name: service.name,
            })}
            className="grid h-8 w-8 place-items-center rounded-md text-[color:var(--ol-fg-subtle)] transition-colors hover:bg-[color:var(--ol-panel)] hover:text-[color:var(--ol-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--ol-primary)]"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {quickTabs.map((item) => {
            const ItemIcon = item.icon;
            return (
              <DropdownMenuItem key={item.id} onSelect={() => onOpenTab(item.id)}>
                <ItemIcon className="mr-2 h-3.5 w-3.5" />
                {item.label}
              </DropdownMenuItem>
            );
          })}

          {service.url && (
            <DropdownMenuItem asChild>
              <a href={service.url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                {t('projectDetail.servicesGuide.quickActions.openUrl')}
              </a>
            </DropdownMenuItem>
          )}

          {canManagePublicAccess && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                {t('projectDetail.servicesGuide.quickActions.publicAccess')}
              </DropdownMenuLabel>

              {(!accessLoaded || loadingAccess) && !activeAccess ? (
                <DropdownMenuItem disabled>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  {t('projectDetail.servicesGuide.quickActions.checkingShare')}
                </DropdownMenuItem>
              ) : accessLoadFailed && !activeAccess ? (
                <DropdownMenuItem onSelect={() => void loadAccess()}>
                  <Loader2 className="mr-2 h-3.5 w-3.5" />
                  {t('projectDetail.servicesGuide.quickActions.retryShareStatus')}
                </DropdownMenuItem>
              ) : activeAccess?.status === 'public' && activeAccess.public_url ? (
                <>
                  <DropdownMenuItem asChild>
                    <a href={activeAccess.public_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      {t('projectDetail.servicesGuide.quickActions.openPublicUrl')}
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={actionPending}
                    className="text-[color:var(--ol-error)] focus:text-[color:var(--ol-error)]"
                    onSelect={() => setStopConfirmOpen(true)}
                  >
                    <Unlink className="mr-2 h-3.5 w-3.5" />
                    {t('projectDetail.servicesGuide.quickActions.stopShare')}
                  </DropdownMenuItem>
                </>
              ) : transitioning ? (
                <DropdownMenuItem disabled>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  {activeAccess?.status === 'unpublishing'
                    ? t('projectDetail.servicesGuide.quickActions.shareStopping')
                    : t('projectDetail.servicesGuide.quickActions.shareProvisioning')}
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem
                    disabled={actionPending}
                    onSelect={() => void publish('protected_share')}
                  >
                    <ShieldCheck className="mr-2 h-3.5 w-3.5 text-[color:var(--ol-success)]" />
                    {t('projectDetail.servicesGuide.quickActions.shareProtected')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={actionPending || cloudflareBusyElsewhere}
                    onSelect={() => void publish('cloudflare')}
                  >
                    <Cloud className="mr-2 h-3.5 w-3.5" />
                    {cloudflareBusyElsewhere
                      ? t('projectDetail.servicesGuide.quickActions.cloudflareBusy')
                      : t('projectDetail.servicesGuide.quickActions.shareCloudflare')}
                  </DropdownMenuItem>
                </>
              )}

              {!service.isComposeChild && (
                <DropdownMenuItem onSelect={() => onOpenTab('domains')}>
                  <Globe2 className="mr-2 h-3.5 w-3.5" />
                  {t('projectDetail.servicesGuide.quickActions.domains')}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={stopConfirmOpen}
        onOpenChange={setStopConfirmOpen}
        title={t('projectDetail.publicAccess.stopTitle')}
        description={t('projectDetail.publicAccess.stopDescription', {
          hostname: activeAccess?.hostname ?? '',
        })}
        confirmLabel={t('projectDetail.publicAccess.stopConfirm')}
        variant="destructive"
        onConfirm={() => void unpublish()}
      />

      <Dialog
        open={shareResult !== null}
        onOpenChange={(open) => {
          if (!open) setShareResult(null);
        }}
      >
        <DialogContent className="max-w-md border-[color:var(--ol-border)] bg-[color:var(--ol-panel)]">
          <DialogHeader>
            <DialogTitle>
              {t('projectDetail.servicesGuide.quickActions.shareResultTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('projectDetail.servicesGuide.quickActions.shareResultDescription', {
                name: service.name,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 grid gap-3">
            {shareResult?.public_url && (
              <CopyRow
                label={t('projectDetail.servicesGuide.quickActions.publicUrl')}
                value={shareResult.public_url}
                copiedMessage={t('projectDetail.publicAccess.copied')}
              />
            )}
            {shareResult?.access_code && (
              <CopyRow
                label={t('projectDetail.servicesGuide.quickActions.accessCode')}
                value={shareResult.access_code}
                copiedMessage={t('projectDetail.publicAccess.codeCopied')}
                emphasized
              />
            )}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setShareResult(null)}
              className="rounded-md bg-[color:var(--ol-primary)] px-3 py-2 text-[12.5px] font-medium text-[color:var(--ol-primary-fg)] hover:opacity-90"
            >
              {t('common.confirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CopyRow({
  label,
  value,
  copiedMessage,
  emphasized = false,
}: {
  label: string;
  value: string;
  copiedMessage: string;
  emphasized?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-[color:var(--ol-fg-muted)]">{label}</div>
      <div
        className={cn(
          'flex items-center overflow-hidden rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)]',
          emphasized && 'border-[color:var(--ol-success)]/40',
        )}
      >
        <span className="ol-mono min-w-0 flex-1 truncate px-3 py-2.5 text-[12px] text-[color:var(--ol-fg)]">
          {value}
        </span>
        <button
          type="button"
          onClick={() => {
            void copyToClipboard(value)
              .then(() => toast.success(copiedMessage))
              .catch(() => toast.error(t('projectDetail.publicAccess.copyFailed')));
          }}
          className="grid h-10 w-10 shrink-0 place-items-center border-l border-[color:var(--ol-border)] text-[color:var(--ol-fg-muted)] hover:bg-[color:var(--ol-panel-3)]"
          aria-label={t('common.copy')}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
