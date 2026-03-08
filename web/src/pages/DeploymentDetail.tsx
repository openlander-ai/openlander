import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDeploymentDetail } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import type { DeployLogDetail } from '@/types';
import {
  ArrowLeft,
  Loader2,
  GitCommit,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function DeploymentDetail() {
  const { id, deployId } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [deployment, setDeployment] = useState<DeployLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (deployment?.buildLog) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [deployment?.buildLog]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-agent" />
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
          {t('deploy.goBack')}
        </button>
      </div>
    );
  }

  const statusColor =
    deployment.status === 'success'
      ? 'text-success'
      : deployment.status === 'failed'
        ? 'text-error'
        : 'text-muted-ol';

  const statusBg =
    deployment.status === 'success'
      ? 'bg-success'
      : deployment.status === 'failed'
        ? 'bg-error'
        : 'bg-[var(--text-muted)]';

  const StatusIcon =
    deployment.status === 'success'
      ? CheckCircle2
      : deployment.status === 'failed'
        ? XCircle
        : MinusCircle;

  return (
    <div className="flex flex-col h-full bg-bg-app">
      <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel/50 px-6 py-4">
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
              <div className={cn('h-3 w-3 rounded-full shrink-0', statusBg)} />
              <div className="min-w-0">
                <h1 className="font-display font-bold text-lg text-primary-ol tracking-tight truncate flex items-center gap-2">
                  {t('deploy.deployment')}
                  {deployment.commitSha && (
                    <span className="flex items-center gap-1 text-sm font-mono font-normal text-muted-ol bg-bg-subtle px-1.5 py-0.5 rounded">
                      <GitCommit className="h-3.5 w-3.5" />
                      {deployment.commitSha.substring(0, 7)}
                    </span>
                  )}
                </h1>
                <div className="flex items-center gap-3 mt-0.5 text-[11px] font-body text-secondary-ol">
                  <span className={cn('flex items-center gap-1', statusColor)}>
                    <StatusIcon className="h-3 w-3" />
                    {deployment.status === 'success'
                      ? t('deploy.status.production')
                      : deployment.status === 'failed'
                        ? t('deploy.status.failed')
                        : t('deploy.status.cancelled')}
                  </span>
                  <span className="capitalize">
                    {deployment.trigger} {t('deploy.trigger')}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(deployment.createdAt)}
                  </span>
                  {deployment.durationMs && (
                    <span className="flex items-center gap-1">
                      <Activity className="h-3 w-3" />
                      {formatDuration(deployment.durationMs)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {deployment.status === 'failed' && deployment.buildLog && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 border-l-4 border-l-warning p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="text-sm font-display font-medium text-primary-ol">
                  {t('deploy.aiAnalysis')}
                </h3>
                <p className="text-sm font-body text-secondary-ol">
                  {t('deploy.buildFailureDetected')}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col h-full min-h-[400px] rounded-lg border border-[hsl(var(--border))] bg-gray-900 overflow-hidden">
          <div className="flex items-center px-4 py-2 border-b border-gray-800 bg-gray-950">
            <span className="text-xs font-mono text-gray-400">{t('deploy.buildLog')}</span>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {deployment.buildLog ? (
              <pre className="text-[13px] font-mono text-gray-300 whitespace-pre-wrap break-all">
                {deployment.buildLog}
                <div ref={logEndRef} />
              </pre>
            ) : (
              <div className="flex items-center justify-center h-full text-sm font-mono text-gray-500">
                {t('deploy.noBuildLog')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
