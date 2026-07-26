import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ChevronRight, FileCheck2, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createDelivery,
  listDeliveries,
  type Delivery,
  type DeliveryMaturity,
  type DeliveryType,
} from '@/lib/api/deliveries';
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

export function DeliveriesTab({
  projectId,
  onConfigure,
}: {
  projectId: string;
  onConfigure: () => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('software_release');
  const [maturity, setMaturity] = useState<DeliveryMaturity>('customer_review');
  const [limitations, setLimitations] = useState('');
  const [predecessorDeliveryId, setPredecessorDeliveryId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDeliveries(await listDeliveries(projectId));
    } catch (err) {
      setError(localizeApiError(err, t, 'delivery.errors.load', 'delivery.errors.codes'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const delivery = await createDelivery(projectId, {
        title,
        summary,
        delivery_type: deliveryType,
        maturity,
        limitations: limitations.trim() || t('delivery.none'),
        predecessor_delivery_id: predecessorDeliveryId || null,
      });
      navigate(`/projects/${projectId}/deliveries/${delivery.id}`);
    } catch (err) {
      setError(localizeApiError(err, t, 'delivery.errors.create', 'delivery.errors.codes'));
    } finally {
      setSubmitting(false);
    }
  };

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
            {t('delivery.description')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onConfigure}>
            {t('delivery.settings.action')}
          </Button>
          <Button size="sm" onClick={() => setShowCreate((value) => !value)}>
            <Plus className="h-3.5 w-3.5" />
            {t('delivery.actions.create')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
          {error}
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={(event) => void submit(event)}
          className="mt-4 grid gap-4 rounded-lg border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] p-4 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <Label htmlFor="delivery-title">{t('delivery.fields.title')}</Label>
            <Input
              id="delivery-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={300}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="delivery-type">{t('delivery.fields.type')}</Label>
            <select
              id="delivery-type"
              value={deliveryType}
              onChange={(event) => setDeliveryType(event.target.value as DeliveryType)}
              className="mt-1.5 h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 text-xs"
            >
              <option value="software_release">{t('delivery.type.software_release')}</option>
              <option value="artifact_delivery">{t('delivery.type.artifact_delivery')}</option>
            </select>
          </div>
          <div>
            <Label htmlFor="delivery-maturity">{t('delivery.fields.maturity')}</Label>
            <select
              id="delivery-maturity"
              value={maturity}
              onChange={(event) => setMaturity(event.target.value as DeliveryMaturity)}
              className="mt-1.5 h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 text-xs"
            >
              {(
                [
                  'concept',
                  'functional_preview',
                  'customer_review',
                  'release_candidate',
                  'production',
                ] as DeliveryMaturity[]
              ).map((value) => (
                <option key={value} value={value}>
                  {t(`delivery.maturity.${value}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="delivery-summary">{t('delivery.fields.summary')}</Label>
            <textarea
              id="delivery-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={3}
              className="mt-1.5 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 py-2 text-xs"
            />
          </div>
          {deliveries.length > 0 && (
            <div className="sm:col-span-2">
              <Label htmlFor="delivery-predecessor">{t('delivery.fields.predecessor')}</Label>
              <select
                id="delivery-predecessor"
                value={predecessorDeliveryId}
                onChange={(event) => setPredecessorDeliveryId(event.target.value)}
                className="mt-1.5 h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 text-xs"
              >
                <option value="">{t('delivery.fields.noPredecessor')}</option>
                {deliveries.map((delivery) => (
                  <option key={delivery.id} value={delivery.id}>
                    {delivery.title} · {t(`delivery.status.${delivery.status}`)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="sm:col-span-2">
            <Label htmlFor="delivery-limitations">{t('delivery.fields.limitations')}</Label>
            <textarea
              id="delivery-limitations"
              value={limitations}
              onChange={(event) => setLimitations(event.target.value)}
              rows={2}
              placeholder={t('delivery.fields.limitationsPlaceholder')}
              className="mt-1.5 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 py-2 text-xs"
            />
          </div>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
              {t('delivery.actions.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={submitting || !title.trim()}>
              {submitting ? t('delivery.actions.creating') : t('delivery.actions.create')}
            </Button>
          </div>
        </form>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-[color:var(--ol-border)]">
        {loading ? (
          <div className="p-8 text-center text-xs text-[color:var(--ol-fg-muted)]">
            {t('delivery.loading')}
          </div>
        ) : deliveries.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <FileCheck2 className="h-8 w-8 text-[color:var(--ol-fg-subtle)]" />
            <h4 className="mt-3 text-sm font-medium">{t('delivery.empty.title')}</h4>
            <p className="mt-1 max-w-md text-xs text-[color:var(--ol-fg-muted)]">
              {t('delivery.empty.description')}
            </p>
          </div>
        ) : (
          deliveries.map((delivery, index) => (
            <button
              key={delivery.id}
              type="button"
              onClick={() => navigate(`/projects/${projectId}/deliveries/${delivery.id}`)}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[color:var(--ol-panel-2)]',
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
    </div>
  );
}
