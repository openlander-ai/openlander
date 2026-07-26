import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Bot, BriefcaseBusiness, Search } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  listEngagements,
  type EngagementRuntimeHealth,
  type EngagementStatus,
  type EngagementSummary,
} from '@/lib/api/engagements';
import { formatRelativeTime } from '@/lib/time';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';
import { localizeApiError } from '@/lib/localized-api-error';
import { AgentGuideDialog } from '@/components/agent-guide';

function healthClass(health: EngagementRuntimeHealth): string {
  if (health === 'healthy') return 'bg-success/10 text-[color:var(--ol-fg)]';
  if (health === 'degraded') return 'bg-error/10 text-error';
  return 'bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]';
}

function statusClass(status: EngagementStatus): string {
  if (status === 'active') return 'border-success/40 bg-success/10 text-[color:var(--ol-fg)]';
  if (status === 'on_hold') return 'border-warning/50 bg-warning/15 text-[color:var(--ol-fg)]';
  return 'border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]';
}

export function Engagements() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [engagements, setEngagements] = useState<EngagementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | EngagementStatus>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [agentGuideOpen, setAgentGuideOpen] = useState(false);

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      try {
        setEngagements(
          await listEngagements({
            includeArchived: showArchived,
            ...(status !== 'all' ? { status } : {}),
          }),
        );
        setError(null);
      } catch (loadError) {
        setError(
          localizeApiError(loadError, t, 'engagements.errors.load', 'engagements.errors.codes'),
        );
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [showArchived, status, t],
  );

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      void load(false);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return engagements;
    return engagements.filter(
      (engagement) =>
        engagement.title.toLowerCase().includes(needle) ||
        engagement.customer_name.toLowerCase().includes(needle) ||
        engagement.summary.toLowerCase().includes(needle),
    );
  }, [engagements, query]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <OuterCard
        title={t('engagements.title')}
        subtitle={t('engagements.subtitle')}
        actions={
          <Button size="sm" onClick={() => setAgentGuideOpen(true)}>
            <Bot className="mr-1.5 h-3.5 w-3.5" />
            {t('engagements.actions.askAgent')}
          </Button>
        }
      >
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t('engagements.search')}</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-[color:var(--ol-fg-subtle)]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('engagements.search')}
              className="pl-9"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-[color:var(--ol-fg-muted)]">
            <span>{t('engagements.filterStatus')}</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as 'all' | EngagementStatus)}
              className="rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-2 py-2 text-xs text-[color:var(--ol-fg)]"
            >
              <option value="all">{t('engagements.status.all')}</option>
              <option value="active">{t('engagements.status.active')}</option>
              <option value="on_hold">{t('engagements.status.on_hold')}</option>
              <option value="completed">{t('engagements.status.completed')}</option>
              <option value="archived">{t('engagements.status.archived')}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-[color:var(--ol-fg-muted)]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
              className="h-4 w-4 rounded border-[color:var(--ol-border)]"
            />
            {t('engagements.showArchived')}
          </label>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
          >
            {error}
          </div>
        )}

        {loading && engagements.length === 0 ? (
          <div className="space-y-2" aria-label={t('engagements.loading')}>
            {[1, 2, 3].map((key) => (
              <div
                key={key}
                className="h-24 animate-pulse rounded-lg bg-[color:var(--ol-panel-2)]"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[color:var(--ol-panel-2)]">
              <BriefcaseBusiness className="h-5 w-5 text-[color:var(--ol-fg-subtle)]" />
            </span>
            <h2 className="mt-3 text-sm font-semibold text-[color:var(--ol-fg)]">
              {t(
                query || status !== 'all'
                  ? 'engagements.emptySearchTitle'
                  : 'engagements.emptyTitle',
              )}
            </h2>
            <p className="mt-1 max-w-md text-xs leading-5 text-[color:var(--ol-fg-muted)]">
              {t(
                query || status !== 'all'
                  ? 'engagements.emptySearchDescription'
                  : 'engagements.emptyDescription',
              )}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[color:var(--ol-border-subtle)]">
            {filtered.map((engagement) => (
              <li key={engagement.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/engagements/${engagement.id}`)}
                  className="group w-full px-2 py-4 text-left transition-colors hover:bg-[color:var(--ol-panel-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ol-primary)]"
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-[color:var(--ol-fg)]">
                          {engagement.title}
                        </h2>
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                            statusClass(engagement.status),
                          )}
                        >
                          {t(`engagements.status.${engagement.status}`)}
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-medium',
                            healthClass(engagement.runtime_health),
                          )}
                        >
                          {t(`engagements.health.${engagement.runtime_health}`)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[color:var(--ol-fg-muted)]">
                        {engagement.customer_name}
                      </p>
                      {engagement.summary && (
                        <p className="mt-1 line-clamp-1 text-xs text-[color:var(--ol-fg-muted)]">
                          {engagement.summary}
                        </p>
                      )}
                    </div>
                    <div className="grid shrink-0 grid-cols-3 gap-4 text-right text-xs">
                      <span>
                        <strong className="block text-sm text-[color:var(--ol-fg)]">
                          {engagement.project_count}
                        </strong>
                        <span className="text-[color:var(--ol-fg-muted)]">
                          {t('engagements.metrics.projects')}
                        </span>
                      </span>
                      <span>
                        <strong className="block text-sm text-[color:var(--ol-fg)]">
                          {engagement.delivery_summary.total}
                        </strong>
                        <span className="text-[color:var(--ol-fg-muted)]">
                          {t('engagements.metrics.deliveries')}
                        </span>
                      </span>
                      <span>
                        <strong
                          className={cn(
                            'flex items-center justify-end gap-1 text-sm',
                            engagement.blocker_count > 0
                              ? 'text-error'
                              : 'text-[color:var(--ol-fg)]',
                          )}
                        >
                          {engagement.blocker_count > 0 && (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          )}
                          {engagement.blocker_count}
                        </strong>
                        <span className="text-[color:var(--ol-fg-muted)]">
                          {t('engagements.metrics.blockers')}
                        </span>
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 text-[10px] text-[color:var(--ol-fg-muted)]">
                    {t('engagements.recentActivity', {
                      time: formatRelativeTime(engagement.recent_activity_at, t),
                    })}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </OuterCard>

      <AgentGuideDialog
        open={agentGuideOpen}
        onOpenChange={setAgentGuideOpen}
        kind="bootstrap-engagement"
      />
    </div>
  );
}
