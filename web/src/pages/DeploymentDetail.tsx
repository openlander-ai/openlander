import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useParams, useNavigate } from 'react-router-dom';
import { getDeploymentDetail } from '@/lib/api';
import {
  formatDeploymentDuration,
  getDeploymentStatusMeta,
  getDeploymentTriggerMetaLabel,
  getShortCommitSha,
} from '@/lib/deployments';
import { formatRelativeTime } from '@/lib/time';
import type { DeployLogDetail } from '@/types';
import {
  ArrowLeft,
  GitCommit,
  Clock,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';
import { StaticLogViewer } from '@/components/logs/StaticLogViewer';
import { LogViewer } from '@/components/Shell/LogViewer';
import { DiagnosisPanel } from '@/components/deploy/DiagnosisPanel';

export function DeploymentDetail() {
  const { id, deployId } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [deployment, setDeployment] = useState<DeployLogDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !deployId) return;
    const fetchDetail = async () => {
      try {
        // `getDeploymentDetail` now returns `null` (not throws) on 404
        // — the only expected failure for in-flight deploys whose
        // `deploy_logs` row hasn't been written yet. Other errors
        // (5xx / network) still surface so we don't silently fall
        // through to the live-log surface for a real outage.
        const data = await getDeploymentDetail(id, deployId);
        setDeployment(data);
      } catch (err) {
        console.error('Failed to fetch deployment detail:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [id, deployId]);

  // Download wire-up — PR #259 says "Download은 기존 deployment detail
  // buildLog 사용". Hook is declared before the early returns so the
  // hook order is stable across loading / not-found / loaded renders.
  const handleDownload = useCallback(() => {
    if (!deployment?.buildLog || !deployId) return;
    const blob = new Blob([deployment.buildLog], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `deployment-${deployId}.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [deployment, deployId]);

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-bg-app">
        <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel px-6 py-4">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-32" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="h-3 w-3 rounded-full" />
                <div>
                  <Skeleton className="h-6 w-48 mb-2" />
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1 p-6 space-y-6">
          <Skeleton className="h-[400px] w-full rounded-lg" />
        </div>
      </div>
    );
  }

  // In-flight deploy fast-path. The metadata fetch 404s while the
  // deploy is still running (deploy_logs row hasn't been written yet),
  // so we render a minimal chrome with the LogViewer mounted directly
  // on `deployId`. The SSE/cancel route can resolve service/project
  // ids that the metadata route can't, so the Kill button stays
  // reachable for the case operators actually need it.
  if (!deployment) {
    if (!deployId) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <p className="text-sm font-body text-foreground/80">{t('deploy.notFound')}</p>
          <button
            onClick={() => navigate(-1)}
            className="text-sm font-body text-agent hover:underline"
          >
            {t('deploy.detail.goBack')}
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col h-full bg-bg-app w-full">
        <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel px-6 py-4">
          <div className="flex flex-col gap-3">
            <button
              onClick={() => navigate(`/projects/${id}`)}
              className="flex items-center gap-1.5 text-xs font-body text-foreground/80 hover:text-foreground transition-colors w-fit"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t('deploy.backToDeployments')}
            </button>
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-3 w-3 rounded-full shrink-0 bg-agent animate-pulse" />
              <h1 className="font-display font-bold text-lg text-foreground tracking-tight truncate">
                {t('deploy.detail.deployment')}
              </h1>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <div className="flex flex-col h-[640px] min-h-[400px] rounded-lg border border-[hsl(var(--border))] overflow-hidden">
            <LogViewer
              deploymentId={deployId}
              confirmKillCopy={{
                title: t('deploy.killConfirm.title'),
                description: t('deploy.killConfirm.description'),
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  const statusMeta = getDeploymentStatusMeta(deployment.status);
  const shortCommitSha = getShortCommitSha(deployment.commitSha);

  const StatusIcon =
    deployment.status === 'success'
      ? CheckCircle2
      : deployment.status === 'failed'
        ? XCircle
        : MinusCircle;

  return (
    <div className="flex flex-col h-full bg-bg-app w-full">
      <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel px-6 py-4">
        <div className="flex flex-col gap-3">
          <button
            onClick={() => navigate(`/projects/${id}`)}
            className="flex items-center gap-1.5 text-xs font-body text-foreground/80 hover:text-foreground transition-colors w-fit"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('deploy.backToDeployments')}
          </button>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn('h-3 w-3 rounded-full shrink-0', statusMeta.dotClass)} />
              <div className="min-w-0">
                <h1 className="font-display font-bold text-lg text-foreground tracking-tight truncate flex items-center gap-2">
                  {t('deploy.detail.deployment')}
                  {shortCommitSha && (
                    <span className="flex items-center gap-1 text-sm font-mono font-normal text-muted-foreground bg-bg-subtle px-1.5 py-0.5 rounded">
                      <GitCommit className="h-3.5 w-3.5" />
                      {shortCommitSha}
                    </span>
                  )}
                </h1>
                <div className="flex items-center gap-3 mt-0.5 text-xs font-body text-foreground/80">
                  <span className={cn('flex items-center gap-1', statusMeta.textClass)}>
                    <StatusIcon className="h-3 w-3" />
                    {statusMeta.label}
                  </span>
                  <span className="capitalize">
                    {getDeploymentTriggerMetaLabel(deployment.trigger)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(deployment.createdAt)}
                  </span>
                  {deployment.durationMs && (
                    <span className="flex items-center gap-1">
                      <Activity className="h-3 w-3" />
                      {formatDeploymentDuration(deployment.durationMs)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/*
        Page chrome dedup — the previous layout stacked the same status
        + duration + trigger + started info three times: the meta row
        in the page title (line ~186), a 4-card grid here, AND the
        LogViewer's own connection-state pill. The grid was the most
        redundant of the three (verbatim copies of the meta row), so
        it's gone. The LogViewer pill still surfaces live duration
        while a deploy is in flight; the meta row covers the persisted
        record once it lands. Build-log section heading is also gone
        because the LogViewer's internal header carries the same label.
      */}
      <div className="flex-1 overflow-auto p-6">
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-0 space-y-6">
            <div className="flex flex-col h-[640px] min-h-[400px] rounded-lg border border-[hsl(var(--border))] overflow-hidden">
              {deployId ? (
                <LogViewer
                  deploymentId={deployId}
                  onDownload={deployment.buildLog ? handleDownload : undefined}
                  confirmKillCopy={{
                    title: t('deploy.killConfirm.title'),
                    description: t('deploy.killConfirm.description'),
                  }}
                />
              ) : (
                <StaticLogViewer content={deployment.buildLog} />
              )}
            </div>

            {deployment.runtimeLog && (
              <div className="space-y-2">
                <h3 className="text-sm font-display font-medium text-foreground/80 flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  {t('deploy.detail.runtimeLogs')}
                  <span className="text-xs font-body text-muted-foreground font-normal">
                    {t('deploy.detail.runtimeLogsHint')}
                  </span>
                </h3>
                <div className="flex flex-col h-full min-h-[300px] rounded-lg border border-[hsl(var(--border))] overflow-hidden">
                  <StaticLogViewer content={deployment.runtimeLog} />
                </div>
              </div>
            )}
          </div>

          <div className="lg:w-80 xl:w-96 shrink-0">
            <DiagnosisPanel deployment={deployment} />
          </div>
        </div>
      </div>
    </div>
  );
}
