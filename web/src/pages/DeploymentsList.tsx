import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, CheckCircle, XCircle, Loader2, Clock, Filter } from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import { listProjects, getProjectDeployments } from '@/lib/api/projects';
import { parseTimestamp } from '@/lib/time';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { DeployLogSummary, Project } from '@/types/index';

interface DeploymentRow extends DeployLogSummary {
  projectName: string;
  projectId: string;
}

type StatusFilter = 'all' | 'success' | 'failed' | 'building';

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function timeAgo(dateStr: string): string {
  const ts = parseTimestamp(dateStr);
  if (!ts) return '—';
  const diff = Date.now() - ts.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
        <CheckCircle className="h-3.5 w-3.5" />
        {t('deploymentsList.success')}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-error">
        <XCircle className="h-3.5 w-3.5" />
        {t('deploymentsList.failed')}
      </span>
    );
  }
  if (status === 'building') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('deploymentsList.building')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <Clock className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

export function DeploymentsList() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [deployments, setDeployments] = useState<DeploymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [projects, setProjects] = useState<Project[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const projs = await listProjects();
      setProjects(projs);
      const rows: DeploymentRow[] = [];
      await Promise.all(
        projs.map(async (p: Project) => {
          try {
            const deps = await getProjectDeployments(p.id, 20);
            for (const d of deps) {
              rows.push({ ...d, projectName: p.name, projectId: p.id });
            }
          } catch {
            // skip project if deployments fetch fails
          }
        }),
      );
      rows.sort((a, b) => {
        const ta = parseTimestamp(a.createdAt)?.getTime() ?? 0;
        const tb = parseTimestamp(b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      });
      setDeployments(rows);
    } catch {
      setDeployments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const filtered = deployments.filter((d) => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    if (projectFilter !== 'all' && d.projectId !== projectFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-app">
      <div className="flex-1 overflow-auto px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <div className="w-full space-y-6">
          <div className="flex items-center gap-3">
            <Rocket className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl lg:text-2xl font-display font-semibold tracking-tight text-foreground">
              {t('deploymentsList.title')}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex items-center bg-bg-subtle rounded-lg p-1 border border-[hsl(var(--border))]">
              {(['all', 'success', 'failed', 'building'] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize',
                    statusFilter === s
                      ? 'bg-bg-panel text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground/80',
                  )}
                >
                  {s === 'all' ? t('deploymentsList.all') : t(`deploymentsList.${s}`)}
                </button>
              ))}
            </div>
            {projects.length > 1 && (
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="text-xs rounded-md border border-[hsl(var(--border))] bg-bg-panel px-2 py-1.5 text-foreground"
              >
                <option value="all">{t('deploymentsList.allProjects')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel overflow-hidden">
            {loading ? (
              <div className="divide-y divide-[hsl(var(--border))]">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-16 ml-auto" />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Rocket className="h-10 w-10 text-muted-foreground mb-3 opacity-40" />
                <p className="text-sm font-medium text-foreground">
                  {deployments.length === 0
                    ? t('deploymentsList.noDeployments')
                    : t('deploymentsList.noDeploymentsFilter')}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {deployments.length === 0
                    ? t('deploymentsList.emptyHint')
                    : t('deploymentsList.changeFilterHint')}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[hsl(var(--border))]">
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-2 text-xs font-medium text-muted-foreground bg-bg-subtle">
                  <span>{t('deploymentsList.projectCommit')}</span>
                  <span>{t('deploymentsList.status')}</span>
                  <span>{t('deploymentsList.trigger')}</span>
                  <span>{t('deploymentsList.duration')}</span>
                  <span>{t('deploymentsList.time')}</span>
                </div>
                {filtered.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => navigate(`/deployments/${d.id}`)}
                    className="w-full grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-4 py-3 text-left hover:bg-bg-subtle transition-colors items-center"
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-foreground truncate block">
                        {d.projectName}
                      </span>
                      {d.commitSha && (
                        <span className="text-xs text-muted-foreground font-mono">
                          {d.commitSha.slice(0, 7)}
                          {d.commitMessage && (
                            <span className="ml-2 not-italic text-muted-foreground">
                              {d.commitMessage.slice(0, 50)}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    <StatusBadge status={d.status} t={t} />
                    <span className="text-xs text-muted-foreground capitalize">
                      {d.trigger ?? t('deploymentsList.manual')}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {formatDuration(d.durationMs)}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {timeAgo(d.createdAt)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
