import { Check, Circle, CircleAlert } from 'lucide-react';
import type { DeliveryDetail, DeliveryReadiness } from '@/lib/api/deliveries';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';

export type DeliveryDetailTab =
  'overview' | 'artifacts' | 'review' | 'gates' | 'deployments' | 'receipt';

interface WorkflowStage {
  id: DeliveryDetailTab;
  complete: boolean;
}

function getWorkflowStages(
  detail: DeliveryDetail,
  readiness: DeliveryReadiness | null,
): WorkflowStage[] {
  const approvedArtifacts = detail.artifacts.filter((artifact) => artifact.status === 'approved');
  const artifactsComplete =
    approvedArtifacts.length > 0 &&
    approvedArtifacts.every((artifact) => {
      if (artifact.kind !== 'review_html' || !artifact.include_in_receipt) return true;
      const companion = detail.artifacts.find(
        (candidate) => candidate.id === artifact.companion_pdf_artifact_id,
      );
      return Boolean(
        companion &&
        companion.kind === 'companion_pdf' &&
        companion.status === 'approved' &&
        companion.include_in_receipt &&
        companion.logical_key === artifact.logical_key &&
        companion.revision === artifact.revision,
      );
    });
  const reviewComplete =
    detail.approvals.some((approval) => !approval.invalidated_at) &&
    !detail.work_items.some(
      (item) =>
        item.status === 'confirmed' && (item.kind === 'change_request' || item.kind === 'question'),
    );
  const gatesComplete = detail.gates.every(
    (gate) =>
      !gate.required ||
      gate.status === 'passed' ||
      (gate.status === 'waived' && Boolean(gate.waiver_reason?.trim())),
  );
  const deploymentsComplete =
    detail.delivery.delivery_type === 'artifact_delivery' ||
    detail.deploy_links.some(
      ({ link, deploy, environment }) =>
        link.relation === 'released' &&
        deploy.status === 'success' &&
        environment?.type === 'production',
    );

  return [
    {
      id: 'overview',
      complete: Boolean(detail.delivery.summary.trim() && detail.delivery.limitations?.trim()),
    },
    { id: 'artifacts', complete: artifactsComplete },
    { id: 'review', complete: reviewComplete },
    { id: 'gates', complete: gatesComplete },
    { id: 'deployments', complete: deploymentsComplete },
    {
      id: 'receipt',
      complete: detail.delivery.status === 'delivered' || Boolean(readiness?.ready),
    },
  ];
}

export function DeliveryWorkflowRail({
  detail,
  readiness,
  activeTab,
  onChange,
}: {
  detail: DeliveryDetail;
  readiness: DeliveryReadiness | null;
  activeTab: DeliveryDetailTab;
  onChange: (tab: DeliveryDetailTab) => void;
}) {
  const { t } = useLanguage();
  const stages = getWorkflowStages(detail, readiness);
  const nextStage = stages.find((stage) => !stage.complete);
  const finalized = detail.delivery.status === 'delivered';

  return (
    <section
      aria-labelledby="delivery-workflow-title"
      className="rounded-lg border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] p-3"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2
            id="delivery-workflow-title"
            className="text-xs font-semibold text-[color:var(--ol-fg)]"
          >
            {t('delivery.workflow.title')}
          </h2>
          <p className="mt-0.5 text-[11px] text-[color:var(--ol-fg-muted)]">
            {finalized
              ? t('delivery.workflow.complete')
              : nextStage
                ? t('delivery.workflow.next', {
                    step: t(`delivery.workflow.steps.${nextStage.id}`),
                  })
                : t('delivery.workflow.ready')}
          </p>
        </div>
        {!finalized && readiness && (
          <span
            className={cn(
              'w-fit rounded-full border px-2 py-1 text-[10px] font-medium',
              readiness.ready
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-warning/30 bg-warning/10 text-warning',
            )}
          >
            {readiness.ready
              ? t('delivery.workflow.readinessReady')
              : t('delivery.workflow.blocked', { count: readiness.blockers.length })}
          </span>
        )}
      </div>

      <ol
        aria-label={t('delivery.workflow.title')}
        className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6"
      >
        {stages.map((stage, index) => {
          const active = activeTab === stage.id;
          const isNext = !finalized && nextStage?.id === stage.id;
          const Icon = stage.complete ? Check : isNext ? CircleAlert : Circle;
          return (
            <li key={stage.id}>
              <button
                type="button"
                onClick={() => onChange(stage.id)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[11px] transition-colors',
                  active
                    ? 'border-[color:var(--ol-primary)] bg-[color:var(--ol-primary-soft)] text-[color:var(--ol-fg)]'
                    : 'border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)] text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ol-primary)]',
                )}
              >
                <span className="ol-mono text-[9px] text-[color:var(--ol-fg-subtle)]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <Icon
                  aria-hidden="true"
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    stage.complete
                      ? 'text-success'
                      : isNext
                        ? 'text-warning'
                        : 'text-[color:var(--ol-fg-subtle)]',
                  )}
                />
                <span className="min-w-0 truncate font-medium">
                  {t(`delivery.workflow.steps.${stage.id}`)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
