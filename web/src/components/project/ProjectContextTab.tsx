import { AlertTriangle, Bot, CheckCircle2, Clock3, Link2, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { AgentGuideDialog } from '@/components/agent-guide';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/context';
import {
  getProjectContext,
  type ProjectContext,
  type ProjectContextItem,
  type ProjectUpdateKind,
} from '@/lib/api/project-context';
import { localizeApiError } from '@/lib/localized-api-error';

const OPEN_KINDS: ProjectUpdateKind[] = ['question', 'dependency', 'risk', 'action'];

function ContextItem({ item, projectId }: { item: ProjectContextItem; projectId: string }) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  return (
    <li className="rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
            {t(`projectContext.kind.${item.kind}`)}
          </span>
          <h4 className="mt-1 text-sm font-medium text-[color:var(--ol-fg)]">{item.title}</h4>
        </div>
        <span className="rounded-full border border-[color:var(--ol-border)] px-2 py-0.5 text-[10px] text-[color:var(--ol-fg-muted)]">
          {t(`projectContext.status.${item.status}`)}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[color:var(--ol-fg-muted)]">
        {item.detail_excerpt}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[color:var(--ol-fg-subtle)]">
        <time dateTime={item.occurred_at}>
          {new Date(item.occurred_at).toLocaleString(language)}
        </time>
        {item.related_delivery_ids.map((deliveryId) => (
          <button
            key={deliveryId}
            type="button"
            onClick={() => navigate(`/projects/${projectId}/deliveries/${deliveryId}`)}
            className="inline-flex items-center gap-1 rounded border border-[color:var(--ol-border)] px-1.5 py-0.5 hover:text-[color:var(--ol-primary)]"
          >
            <Link2 className="h-3 w-3" />
            {deliveryId}
          </button>
        ))}
        {item.related_delivery_ids_truncated && (
          <span>
            {t('projectContext.more', {
              count: item.related_delivery_count - item.related_delivery_ids.length,
            })}
          </span>
        )}
      </div>
    </li>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="text-sm font-semibold text-[color:var(--ol-fg)]">
        {title}
      </h3>
      <p className="mt-1 text-xs leading-5 text-[color:var(--ol-fg-muted)]">{description}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ProjectContextTab({ projectId }: { projectId: string }) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentGuideOpen, setAgentGuideOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setContext(await getProjectContext(projectId));
    } catch (err) {
      setError(localizeApiError(err, t, 'projectContext.loadError', 'projectContext.errors.codes'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!context || !window.location.hash) return;
    const target = document.getElementById(window.location.hash.slice(1));
    target?.scrollIntoView({ block: 'center' });
  }, [context]);

  const decisions = useMemo(
    () => context?.current_items.filter((item) => item.kind === 'decision') ?? [],
    [context],
  );
  const openItems = useMemo(
    () => context?.current_items.filter((item) => OPEN_KINDS.includes(item.kind)) ?? [],
    [context],
  );

  if (loading && !context) {
    return (
      <div className="flex justify-center px-5 py-16">
        <Loader2
          aria-label={t('projectContext.loading')}
          className="h-5 w-5 animate-spin text-[color:var(--ol-primary)]"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 px-5 py-5">
      <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[color:var(--ol-fg)]">
            {t('projectContext.title')}
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[color:var(--ol-fg-muted)]">
            {t('projectContext.description')}
          </p>
        </div>
        <Button size="sm" onClick={() => setAgentGuideOpen(true)}>
          <Bot className="h-3.5 w-3.5" />
          {t('projectContext.askAgent')}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-error/30 bg-error/5 p-3 text-xs text-error"
        >
          {error}
        </div>
      )}

      {context?.changed_delivery_context.length ? (
        <section
          className="rounded-lg border border-warning/30 bg-warning/5 p-4"
          aria-live="polite"
        >
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <h3 className="text-sm font-semibold text-[color:var(--ol-fg)]">
                {t('projectContext.changedDelivery.title')}
              </h3>
              <p className="mt-1 text-xs text-[color:var(--ol-fg-muted)]">
                {t('projectContext.changedDelivery.description', {
                  count: context.changed_delivery_context.length,
                })}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {[...new Set(context.changed_delivery_context.map((item) => item.delivery_id))].map(
                  (deliveryId) => (
                    <button
                      key={deliveryId}
                      type="button"
                      onClick={() => navigate(`/projects/${projectId}/deliveries/${deliveryId}`)}
                      className="rounded border border-warning/30 px-2 py-1 text-[10px] hover:bg-warning/10"
                    >
                      {deliveryId}
                    </button>
                  ),
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <Section
        id="project-context-open"
        title={t('projectContext.open.title')}
        description={t('projectContext.open.description')}
      >
        {openItems.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {openItems.map((item) => (
              <ContextItem key={item.item_id} item={item} projectId={projectId} />
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-[color:var(--ol-border)] p-5 text-center text-xs text-[color:var(--ol-fg-muted)]">
            {t('projectContext.open.empty')}
          </p>
        )}
      </Section>

      <Section
        id="project-context-decisions"
        title={t('projectContext.decisions.title')}
        description={t('projectContext.decisions.description')}
      >
        {decisions.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {decisions.map((item) => (
              <ContextItem key={item.item_id} item={item} projectId={projectId} />
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-[color:var(--ol-border)] p-5 text-center text-xs text-[color:var(--ol-fg-muted)]">
            {t('projectContext.decisions.empty')}
          </p>
        )}
      </Section>

      <Section
        id="project-context-recent"
        title={t('projectContext.recent.title')}
        description={t('projectContext.recent.description')}
      >
        {context?.recent_updates.length ? (
          <ol className="space-y-3">
            {context.recent_updates.map((update) => (
              <li
                key={update.update_id}
                id={`update-${update.update_id}`}
                className="rounded-md border border-[color:var(--ol-border-subtle)] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-[color:var(--ol-fg-muted)]">
                    <Clock3 className="h-3.5 w-3.5" />
                    <time dateTime={update.occurred_at}>
                      {new Date(update.occurred_at).toLocaleString(language)}
                    </time>
                  </div>
                  <span className="text-[10px] text-[color:var(--ol-fg-subtle)]">
                    {t('projectContext.recent.itemCount', { count: update.item_count })}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[color:var(--ol-fg)]">
                  {update.summary_excerpt}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-[color:var(--ol-fg-subtle)]">
                  <CheckCircle2 className="h-3 w-3" />
                  {update.source_labels.map((label, index) => (
                    <span
                      key={`${label}:${String(index)}`}
                      className="rounded bg-[color:var(--ol-panel-2)] px-1.5 py-0.5"
                    >
                      {label}
                    </span>
                  ))}
                  {update.sources_truncated && (
                    <span>
                      {t('projectContext.more', {
                        count: update.source_count - update.source_labels.length,
                      })}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-md border border-dashed border-[color:var(--ol-border)] p-6 text-center text-xs text-[color:var(--ol-fg-muted)]">
            {t('projectContext.recent.empty')}
          </p>
        )}
      </Section>

      {(context?.truncated.current_items || context?.truncated.recent_updates) && (
        <p className="text-xs text-[color:var(--ol-fg-subtle)]">{t('projectContext.truncated')}</p>
      )}

      <AgentGuideDialog
        open={agentGuideOpen}
        onOpenChange={setAgentGuideOpen}
        kind="record-project-update"
        projectName={projectId}
      />
    </div>
  );
}
