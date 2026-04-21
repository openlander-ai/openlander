import { useState, useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useParams, useNavigate } from 'react-router-dom';
import { getDeploymentDetail } from '@/lib/api';
import {
  formatDeploymentDuration,
  getDeploymentStatusMeta,
  getDeploymentTriggerMetaLabel,
  getShortCommitSha,
} from '@/lib/deployments';
import { formatDateTime, formatRelativeTime } from '@/lib/time';
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

  if (!deployment) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-sm font-body text-secondary-ol">{t('deploy.notFound')}</p>
        <button
          onClick={() => navigate(-1)}
          className="text-sm font-body text-agent hover:underline"
        >
          {t('deploy.detail.goBack')}
        </button>
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
    <div className="flex flex-col h-full bg-bg-app max-w-8xl mx-auto w-full">
      <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel px-6 py-4">
        <div className="flex flex-col gap-3">
          <button
            onClick={() => navigate(`/projects/${id}`)}
            className="flex items-center gap-1.5 text-xs font-body text-secondary-ol hover:text-primary-ol transition-colors w-fit"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('deploy.backToDeployments')}
          </button>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn('h-3 w-3 rounded-full shrink-0', statusMeta.dotClass)} />
              <div className="min-w-0">
                <h1 className="font-display font-bold text-lg text-primary-ol tracking-tight truncate flex items-center gap-2">
                  {t('deploy.detail.deployment')}
                  {shortCommitSha && (
                    <span className="flex items-center gap-1 text-sm font-mono font-normal text-muted-ol bg-bg-subtle px-1.5 py-0.5 rounded">
                      <GitCommit className="h-3.5 w-3.5" />
                      {shortCommitSha}
                    </span>
                  )}
                </h1>
                <div className="flex items-center gap-3 mt-0.5 text-xs font-body text-secondary-ol">
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

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-3">
              <div className="text-xs font-body uppercase tracking-wide text-muted-ol">
                {t('deploy.detail.status')}
              </div>
              <div className={cn('mt-1 text-sm font-display font-medium', statusMeta.textClass)}>
                {statusMeta.label}
              </div>
            </div>
            <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-3">
              <div className="text-xs font-body uppercase tracking-wide text-muted-ol">
                {t('deploy.detail.trigger')}
              </div>
              <div className="mt-1 text-sm font-body text-primary-ol capitalize">
                {getDeploymentTriggerMetaLabel(deployment.trigger)}
              </div>
            </div>
            <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-3">
              <div className="text-xs font-body uppercase tracking-wide text-muted-ol">
                {t('deploy.detail.started')}
              </div>
              <div className="mt-1 text-sm font-body text-primary-ol">
                {formatDateTime(deployment.createdAt) || 'Unknown'}
              </div>
            </div>
            <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-3">
              <div className="text-xs font-body uppercase tracking-wide text-muted-ol">
                {t('deploy.detail.duration')}
              </div>
              <div className="mt-1 text-sm font-body text-primary-ol">
                {formatDeploymentDuration(deployment.durationMs)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 space-y-6 min-w-0">
            <div className="space-y-2">
              <h3 className="text-sm font-display font-medium text-secondary-ol">
                {t('deploy.detail.buildLogs')}
              </h3>
              <div className="flex flex-col h-full min-h-[400px] rounded-lg border border-[hsl(var(--border))] overflow-hidden">
                <StaticLogViewer content={deployment.buildLog} />
              </div>
            </div>

            {deployment.runtimeLog && (
              <div className="space-y-2">
                <h3 className="text-sm font-display font-medium text-secondary-ol flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  {t('deploy.detail.runtimeLogs')}
                  <span className="text-xs font-body text-muted-ol font-normal">
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
