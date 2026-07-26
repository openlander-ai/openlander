import { useCallback, useEffect, useState } from 'react';
import { Bot, ChevronRight, FileCheck2 } from 'lucide-react';
import { useNavigate } from 'react-router';

import { AgentGuideDialog } from '@/components/agent-guide';
import { Button } from '@/components/ui/button';
import { listDeliveries, type Delivery } from '@/lib/api/deliveries';
import { useLanguage } from '@/i18n/context';
import { localizeApiError } from '@/lib/localized-api-error';
import { cn } from '@/lib/utils';

function statusClass(status: Delivery['status']): string {
  if (status === 'delivered' || status === 'ready') {
    return 'border-success/30 bg-success/10 text-success';
  }
  if (status === 'revision_requested' || status === 'cancelled') {
    return 'border-warning/30 bg-warning/10 text-warning';
  }
  return 'border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]';
}

export function DeliveriesTab({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentGuideOpen, setAgentGuideOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDeliveries(await listDeliveries(projectId));
    } catch (loadError) {
      setError(localizeApiError(loadError, t, 'delivery.errors.load', 'delivery.errors.codes'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[color:var(--ol-fg)]">
              {t('delivery.title')}
            </h3>
            <span className="rounded-full border border-[color:var(--ol-primary)]/30 bg-[color:var(--ol-primary-soft)] px-2 py-0.5 text-[9px] font-semibold uppercase text-[color:var(--ol-primary)]">
              {t('delivery.beta')}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[color:var(--ol-fg-muted)]">
            {t('delivery.formlessDescription')}
          </p>
        </div>
        <Button size="sm" onClick={() => setAgentGuideOpen(true)}>
          <Bot className="h-3.5 w-3.5" />
          {t('delivery.actions.askAgent')}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
        >
          {error}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-[color:var(--ol-border)]">
        {loading ? (
          <div className="p-8 text-center text-xs text-[color:var(--ol-fg-muted)]">
            {t('delivery.loading')}
          </div>
        ) : deliveries.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <FileCheck2 className="h-8 w-8 text-[color:var(--ol-fg-subtle)]" />
            <h4 className="mt-3 text-sm font-medium">{t('delivery.empty.formlessTitle')}</h4>
            <p className="mt-1 max-w-md text-xs text-[color:var(--ol-fg-muted)]">
              {t('delivery.empty.formlessDescription')}
            </p>
            <Button className="mt-4" size="sm" onClick={() => setAgentGuideOpen(true)}>
              <Bot className="h-3.5 w-3.5" />
              {t('delivery.actions.askAgent')}
            </Button>
          </div>
        ) : (
          deliveries.map((delivery, index) => (
            <button
              key={delivery.id}
              type="button"
              onClick={() => navigate(`/projects/${projectId}/deliveries/${delivery.id}`)}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:var(--ol-panel-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ol-primary)]',
                index > 0 && 'border-t border-[color:var(--ol-border-subtle)]',
              )}
            >
              <FileCheck2 className="h-4 w-4 shrink-0 text-[color:var(--ol-primary)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{delivery.title}</span>
                <span className="mt-0.5 block truncate text-[11px] text-[color:var(--ol-fg-muted)]">
                  {t(`delivery.type.${delivery.delivery_type}`)} ·{' '}
                  {t(`delivery.maturity.${delivery.maturity}`)}
                </span>
              </span>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                  statusClass(delivery.status),
                )}
              >
                {t(`delivery.status.${delivery.status}`)}
              </span>
              <ChevronRight className="h-4 w-4 text-[color:var(--ol-fg-subtle)]" />
            </button>
          ))
        )}
      </div>

      <AgentGuideDialog
        open={agentGuideOpen}
        onOpenChange={setAgentGuideOpen}
        kind="plan-delivery"
        projectName={projectId}
      />
    </div>
  );
}
