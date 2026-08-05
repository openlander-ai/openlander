import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, Globe2, Loader2, Unlink } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/i18n/context';
import {
  exposeProject,
  getProjectPublicAccess,
  type ProjectPublicAccess,
  unexposeProject,
} from '@/lib/api/projects';
import { ApiError } from '@/lib/api/client';
import { cn, copyToClipboard } from '@/lib/utils';

export function PublicAccessControl({
  projectId,
  disabled = false,
  publishDisabledReason,
}: {
  projectId: string;
  disabled?: boolean;
  publishDisabledReason?: string;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [access, setAccess] = useState<ProjectPublicAccess | null>(null);
  const [pending, setPending] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const resumeAttempted = useRef(false);

  const load = useCallback(async () => {
    try {
      setAccess(await getProjectPublicAccess(projectId));
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[PublicAccessControl] Failed to load public access', error);
      }
      setAccess(null);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (access?.status !== 'provisioning' && access?.status !== 'unpublishing') return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [access?.status, load]);

  const publish = useCallback(async () => {
    if (disabled || publishDisabledReason) {
      if (publishDisabledReason) toast.info(publishDisabledReason);
      return;
    }
    setPending(true);
    try {
      setAccess(await exposeProject(projectId));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CLOUDFLARE_NOT_CONNECTED') {
        toast.info(t('projectDetail.publicAccess.connectFirst'));
        const params = new URLSearchParams({
          returnTo: `/projects/${encodeURIComponent(projectId)}`,
          intent: 'publish',
        });
        navigate(`/settings/web-server?${params.toString()}#public-access`);
      } else if (error instanceof ApiError && error.code === 'PUBLIC_ACCESS_NOT_ELIGIBLE') {
        toast.info(t('projectDetail.publicAccess.notEligible'));
      } else {
        toast.error(t('projectDetail.publicAccess.publishFailed'));
      }
    } finally {
      setPending(false);
    }
  }, [disabled, navigate, projectId, publishDisabledReason, t]);

  useEffect(() => {
    const state = location.state as { resumePublicAccess?: unknown } | null;
    if (state?.resumePublicAccess !== true || resumeAttempted.current) return;
    resumeAttempted.current = true;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    void publish();
  }, [location.pathname, location.search, location.state, navigate, publish]);

  const unpublish = async () => {
    setPending(true);
    try {
      setAccess(await unexposeProject(projectId));
    } catch {
      toast.error(t('projectDetail.publicAccess.unpublishFailed'));
    } finally {
      setPending(false);
    }
  };

  const status = access?.status ?? 'private';
  const transitioning = pending || status === 'provisioning' || status === 'unpublishing';

  if (status === 'public' && access?.public_url) {
    return (
      <>
        <div className="inline-flex h-8 max-w-full items-center overflow-hidden rounded-md border border-[color:var(--ol-success)]/35 bg-[color:var(--ol-success-soft)] text-[12px]">
          <a
            href={access.public_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 items-center gap-1.5 px-2.5 font-medium text-[color:var(--ol-success)] hover:underline"
            title={t('projectDetail.publicAccess.open')}
          >
            <Globe2 className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[45vw] truncate sm:max-w-64 lg:max-w-96">{access.hostname}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
          <button
            type="button"
            onClick={() => {
              void copyToClipboard(access.public_url!)
                .then(() => toast.success(t('projectDetail.publicAccess.copied')))
                .catch(() => toast.error(t('projectDetail.publicAccess.copyFailed')));
            }}
            className="grid h-full w-8 place-items-center border-l border-[color:var(--ol-success)]/25 text-[color:var(--ol-success)] hover:bg-[color:var(--ol-success)]/10"
            title={t('projectDetail.publicAccess.copy')}
            aria-label={t('projectDetail.publicAccess.copy')}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={disabled || pending}
            onClick={() => setStopConfirmOpen(true)}
            className="inline-flex h-full items-center gap-1 border-l border-[color:var(--ol-success)]/25 px-2.5 text-[color:var(--ol-fg-muted)] hover:bg-[color:var(--ol-success)]/10 disabled:opacity-50"
          >
            <Unlink className="h-3.5 w-3.5" />
            {t('projectDetail.publicAccess.stop')}
          </button>
        </div>
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
    <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2.5">
      {publishDisabledReason && (
        <span className="text-[11.5px] text-[color:var(--ol-fg-subtle)]">
          {publishDisabledReason}
        </span>
      )}
      <button
        type="button"
        disabled={disabled || transitioning || Boolean(publishDisabledReason)}
        onClick={() => void publish()}
        title={publishDisabledReason}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-[color:var(--ol-border)] px-3 text-[12.5px] font-medium text-[color:var(--ol-fg-muted)] transition-colors hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]',
          (disabled || transitioning || publishDisabledReason) && 'cursor-not-allowed opacity-50',
        )}
      >
        {transitioning ? (
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
    </div>
  );
}
