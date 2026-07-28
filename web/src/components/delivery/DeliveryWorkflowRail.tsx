import { Bot, Check, CheckCircle2, ChevronDown, Circle, CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  DeliveryDetail,
  DeliveryExecutionView,
  DeliveryReadiness,
} from '@/lib/api/deliveries';
import { deriveDeliveryHumanAction } from '@/lib/delivery-human-action';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';

export type DeliveryDetailTab = 'overview' | 'artifacts' | 'gates' | 'deployments' | 'receipt';

interface WorkflowStage {
  id: DeliveryDetailTab;
  complete: boolean;
}

export function DeliveryHumanActionCard({
  detail,
  execution,
  readiness,
  onOpenTab,
  onAskAgent,
}: {
  detail: DeliveryDetail;
  execution: DeliveryExecutionView | null;
  readiness: DeliveryReadiness | null;
  onOpenTab: (tab: DeliveryDetailTab) => void;
  onAskAgent: () => void;
}) {
  const { t } = useLanguage();
  const action = deriveDeliveryHumanAction(detail, execution, readiness);
  const requiresAttention =
    action.state === 'review_version' ||
    action.state === 'review_items' ||
    action.state === 'gate_warning';
  const finished = action.state === 'complete';
  const Icon = requiresAttention ? CircleAlert : finished ? CheckCircle2 : Bot;
  const hasAction = Boolean(action.targetTab || action.asksAgent);

  return (
    <section
      aria-labelledby="delivery-human-action-title"
      className={cn(
        'rounded-lg border p-4',
        requiresAttention && 'border-warning/30 bg-warning/10',
        finished && 'border-success/30 bg-success/10',
        !requiresAttention && !finished && 'border-agent/25 bg-agent/5',
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'mt-0.5 rounded-full p-2',
              requiresAttention && 'bg-warning/15 text-warning',
              finished && 'bg-success/15 text-success',
              !requiresAttention && !finished && 'bg-agent/10 text-agent',
            )}
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--ol-fg-muted)]">
              {t(`delivery.humanAction.${action.state}.eyebrow`)}
            </p>
            <h2 id="delivery-human-action-title" className="mt-1 text-sm font-semibold">
              {t(`delivery.humanAction.${action.state}.title`, { count: action.count })}
            </h2>
            <p className="mt-1 text-xs leading-5 text-[color:var(--ol-fg-muted)]">
              {t(`delivery.humanAction.${action.state}.description`)}
            </p>
          </div>
        </div>
        {hasAction && (
          <Button
            type="button"
            size="sm"
            variant={requiresAttention ? 'default' : 'outline'}
            className="shrink-0"
            onClick={() => {
              if (action.targetTab) onOpenTab(action.targetTab);
              else onAskAgent();
            }}
          >
            {t(`delivery.humanAction.${action.state}.action`)}
          </Button>
        )}
      </div>
    </section>
  );
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
    { id: 'gates', complete: reviewComplete && gatesComplete },
    { id: 'deployments', complete: deploymentsComplete },
    {
      id: 'receipt',
      complete: detail.delivery.status === 'delivered' || Boolean(readiness?.ready),
    },
  ];
}

export function getNextDeliveryWorkflowStage(
  detail: DeliveryDetail,
  readiness: DeliveryReadiness | null,
): DeliveryDetailTab | null {
  const pendingExactReview =
    detail.delivery.status === 'in_review' &&
    detail.gates.some(
      (gate) => gate.gate_type === 'review' && gate.status !== 'passed' && gate.status !== 'waived',
    );
  if (pendingExactReview) return 'gates';
  return getWorkflowStages(detail, readiness).find((stage) => !stage.complete)?.id ?? null;
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
  const nextStageId = getNextDeliveryWorkflowStage(detail, readiness);
  const nextStage = stages.find((stage) => stage.id === nextStageId);
  const finalized = detail.delivery.status === 'delivered';

  return (
    <details className="group rounded-lg border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ol-primary)] [&::-webkit-details-marker]:hidden">
        <div>
          <h2 className="text-xs font-semibold text-[color:var(--ol-fg)]">
            {t('delivery.workflow.detailsTitle')}
          </h2>
          <p className="mt-0.5 text-[11px] text-[color:var(--ol-fg-muted)]">
            {t('delivery.workflow.detailsDescription')}
          </p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-[color:var(--ol-fg-muted)] transition-transform group-open:rotate-180"
        />
      </summary>

      <div className="border-t border-[color:var(--ol-border-subtle)] px-3 pb-3 pt-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-[color:var(--ol-fg-muted)]">
            {finalized
              ? t('delivery.workflow.complete')
              : nextStage
                ? t('delivery.workflow.next', {
                    step: t(`delivery.workflow.steps.${nextStage.id}`),
                  })
                : t('delivery.workflow.ready')}
          </p>
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
          className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5"
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
      </div>
    </details>
  );
}
