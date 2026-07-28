import {
  ArrowLeft,
  Bot,
  Check,
  CircleAlert,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Loader2,
  MessageSquareText,
  PackageCheck,
  Rocket,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AgentGuideDialog } from '@/components/agent-guide/AgentGuideDialog';
import {
  DeliveryHumanActionCard,
  DeliveryWorkflowRail,
  type DeliveryDetailTab,
} from '@/components/delivery/DeliveryWorkflowRail';
import { EngagementChip } from '@/components/engagement/EngagementChip';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ProjectTabs, TabPanel, type TabDef } from '@/components/Shell/ProjectTabs';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/context';
import {
  acceptDeliveryReview,
  downloadReceipt,
  generateReceiptPreview,
  getDelivery,
  getDeliveryExecution,
  getDeliveryReadiness,
  recordDeliveryGate,
  setDeliveryArtifactStatus,
  transitionDelivery,
  updateDeliveryWorkItem,
  type DeliveryDetail,
  type DeliveryExecutionView,
  type DeliveryGate,
  type DeliveryReadiness,
  type DeliveryReadinessCheck,
  type DeliveryStatus,
  type DeliveryType,
} from '@/lib/api/deliveries';
import { localizeApiError } from '@/lib/localized-api-error';
import { cn } from '@/lib/utils';

type Translate = (key: string, params?: Record<string, string | number>) => string;

const DELIVERY_RUN_PHASE_KEYS: Record<string, string> = {
  planning: 'planning',
  implementation: 'implementation',
  implementation_fixed: 'implementationFixed',
  qa: 'qa',
  scenario_qa: 'scenarioQa',
  verification: 'verification',
  quality_gates_passed: 'qualityGatesPassed',
  completed: 'completed',
};

export function formatDeliveryRunPhase(phase: string, t: Translate): string {
  const translationKey = DELIVERY_RUN_PHASE_KEYS[phase];
  return translationKey
    ? t(`delivery.execution.phaseValue.${translationKey}`)
    : phase.replaceAll('_', ' ').replaceAll('-', ' ');
}

function formatArtifactRevision(revision: number, t: Translate): string {
  return t('delivery.artifacts.revisionValue', { revision });
}

function formatDefaultGateLabel(gate: DeliveryGate, t: Translate): string {
  if (gate.gate_key === 'review' && gate.label === 'Review') {
    return t('delivery.gates.defaultLabel.review');
  }
  if (gate.gate_key === 'qa' && gate.label === 'QA') {
    return t('delivery.gates.defaultLabel.qa');
  }
  if (gate.gate_key === 'data' && gate.label === 'Data') {
    return t('delivery.gates.defaultLabel.data');
  }
  return gate.label;
}

function hasReadinessParam(check: DeliveryReadinessCheck, key: string): boolean {
  return typeof check.params?.[key] === 'number';
}

export function formatReadinessCheck(
  check: DeliveryReadinessCheck,
  deliveryType: DeliveryType,
  t: Translate,
): string {
  if (
    check.key === 'production_deploy' &&
    (deliveryType === 'artifact_delivery' || check.params?.['not_required'] === 1)
  ) {
    return t('delivery.receipt.check.production_deploy.notRequired');
  }

  const result = check.passed ? 'passed' : 'blocked';
  const needsCount =
    (check.key === 'approved_artifact' && check.passed) ||
    (check.key === 'customer_approval' && check.passed) ||
    (check.key === 'work_items_resolved' && !check.passed) ||
    (check.key === 'required_gates' && !check.passed) ||
    (check.key === 'warnings_acknowledged' && !check.passed) ||
    (check.key === 'html_companion_pdf' && !check.passed);
  if (needsCount && !hasReadinessParam(check, 'count')) {
    return t(`delivery.receipt.check.${check.key}.${result}Generic`);
  }
  if (
    check.key === 'page_limit' &&
    (!hasReadinessParam(check, 'count') || (!check.passed && !hasReadinessParam(check, 'max')))
  ) {
    return t(`delivery.receipt.check.page_limit.${result}Generic`);
  }
  return t(`delivery.receipt.check.${check.key}.${result}`, check.params);
}

export function countPendingReviewGates(detail: DeliveryDetail): number {
  return detail.gates.filter(
    (gate) => gate.gate_type === 'review' && gate.status !== 'passed' && gate.status !== 'waived',
  ).length;
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] p-4">
      <h3 className="text-sm font-semibold text-[color:var(--ol-fg)]">{title}</h3>
      {description && (
        <p className="mt-1 text-xs leading-5 text-[color:var(--ol-fg-muted)]">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyEvidence({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-[color:var(--ol-border)] px-3 py-6 text-center text-xs text-[color:var(--ol-fg-muted)]">
      {children}
    </p>
  );
}

function downloadBlob(blob: Blob, filename: string, openInline = false): void {
  const url = URL.createObjectURL(blob);
  if (openInline) {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function statusClass(status: DeliveryStatus): string {
  if (status === 'delivered' || status === 'ready') {
    return 'border-success/30 bg-success/10 text-success';
  }
  if (status === 'revision_requested' || status === 'cancelled') {
    return 'border-warning/30 bg-warning/10 text-warning';
  }
  return 'border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]';
}

interface PanelProps {
  detail: DeliveryDetail;
  immutable: boolean;
  busy: string | null;
  onRun: (key: string, operation: () => Promise<unknown>, success?: string) => Promise<void>;
  projectId: string;
  deliveryId: string;
  execution: DeliveryExecutionView | null;
}

export function DeliveryDetailPage() {
  const { projectId = '', deliveryId = '' } = useParams<{
    projectId: string;
    deliveryId: string;
  }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<DeliveryDetailTab>('overview');
  const [detail, setDetail] = useState<DeliveryDetail | null>(null);
  const [readiness, setReadiness] = useState<DeliveryReadiness | null>(null);
  const [execution, setExecution] = useState<DeliveryExecutionView | null>(null);
  const [receiptPreviewCurrent, setReceiptPreviewCurrent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [agentGuideOpen, setAgentGuideOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextDetail, nextReadiness, nextExecution] = await Promise.all([
        getDelivery(projectId, deliveryId),
        getDeliveryReadiness(projectId, deliveryId).catch(() => null),
        getDeliveryExecution(projectId, deliveryId).catch(() => null),
      ]);
      setDetail(nextDetail);
      setReadiness(nextReadiness);
      setExecution(nextExecution);
      setReceiptPreviewCurrent(
        nextDetail.delivery.previewed_evidence_version === nextDetail.delivery.evidence_version,
      );
    } catch (err) {
      setError(localizeApiError(err, t, 'delivery.errors.load', 'delivery.errors.codes'));
    } finally {
      setLoading(false);
    }
  }, [deliveryId, projectId, t]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const run = async (key: string, operation: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    setError(null);
    setMessage(null);
    if (key !== 'receipt:preview') setReceiptPreviewCurrent(false);
    try {
      await operation();
      if (success) setMessage(success);
      await load();
    } catch (err) {
      setError(localizeApiError(err, t, 'delivery.errors.action', 'delivery.errors.codes'));
    } finally {
      setBusy(null);
    }
  };

  const proposedReviewItemCount =
    detail?.work_items.filter((item) => item.status === 'proposed').length ?? 0;
  const pendingReviewGateCount = detail ? countPendingReviewGates(detail) : 0;
  const tabs: TabDef<DeliveryDetailTab>[] = [
    { id: 'overview', label: t('delivery.tabs.overview'), icon: FileCheck2 },
    {
      id: 'artifacts',
      label: t('delivery.tabs.artifacts'),
      icon: FileText,
      count: detail?.artifacts.length,
    },
    {
      id: 'review',
      label: t('delivery.tabs.review'),
      icon: MessageSquareText,
      count: proposedReviewItemCount > 0 ? proposedReviewItemCount : undefined,
    },
    {
      id: 'gates',
      label: t('delivery.tabs.gates'),
      icon: ShieldCheck,
      count: pendingReviewGateCount > 0 ? pendingReviewGateCount : undefined,
    },
    { id: 'deployments', label: t('delivery.tabs.deployments'), icon: Rocket },
    { id: 'receipt', label: t('delivery.tabs.receipt'), icon: PackageCheck },
  ];

  if (loading && !detail) {
    return (
      <div className="mx-auto flex w-full max-w-5xl items-center justify-center py-24">
        <Loader2
          aria-label={t('delivery.loading')}
          className="h-6 w-6 animate-spin text-[color:var(--ol-primary)]"
        />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <OuterCard title={t('delivery.errors.notFound')} subtitle={error ?? ''}>
          <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${projectId}`)}>
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('delivery.actions.back')}
          </Button>
        </OuterCard>
      </div>
    );
  }

  const immutable =
    detail.delivery.status === 'delivered' || detail.delivery.status === 'cancelled';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <button
        type="button"
        onClick={() => navigate(`/projects/${projectId}?tab=deliveries`)}
        className="flex w-fit items-center gap-1.5 text-xs text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('delivery.actions.back')}
      </button>

      <OuterCard
        title={
          <span className="flex flex-wrap items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-[color:var(--ol-primary)]" />
            <span>{detail.delivery.title}</span>
            <EngagementChip projectId={projectId} />
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                statusClass(detail.delivery.status),
              )}
            >
              {t(`delivery.status.${detail.delivery.status}`)}
            </span>
          </span>
        }
        subtitle={`${t(`delivery.type.${detail.delivery.delivery_type}`)} · ${t(
          `delivery.maturity.${detail.delivery.maturity}`,
        )} · ${detail.delivery.id}`}
        actions={
          <Button size="sm" onClick={() => setAgentGuideOpen(true)}>
            <Bot className="h-3.5 w-3.5" />
            {t('delivery.actions.askAgent')}
          </Button>
        }
        bodyClassName="p-0"
      >
        <ProjectTabs
          tabs={tabs}
          active={activeTab}
          onChange={setActiveTab}
          idPrefix="delivery"
          ariaLabel={t('delivery.title')}
        />

        <div className="space-y-4 p-4">
          <DeliveryHumanActionCard
            detail={detail}
            execution={execution}
            readiness={readiness}
            onOpenTab={setActiveTab}
            onAskAgent={() => setAgentGuideOpen(true)}
          />

          <DeliveryWorkflowRail
            detail={detail}
            readiness={readiness}
            activeTab={activeTab}
            onChange={setActiveTab}
          />
          {error && (
            <div
              role="alert"
              className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
            >
              {error}
            </div>
          )}
          {message && (
            <div
              role="status"
              className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success"
            >
              {message}
            </div>
          )}
          {immutable && (
            <div className="rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-3 py-2 text-xs text-[color:var(--ol-fg-muted)]">
              {t('delivery.immutable')}
            </div>
          )}

          <TabPanel
            active={activeTab === 'overview'}
            panelId="deliverypanel-overview"
            labelledBy="delivery-overview"
          >
            <OverviewPanel
              detail={detail}
              immutable={immutable}
              busy={busy}
              onRun={run}
              projectId={projectId}
              deliveryId={deliveryId}
              execution={execution}
            />
          </TabPanel>
          <TabPanel
            active={activeTab === 'artifacts'}
            panelId="deliverypanel-artifacts"
            labelledBy="delivery-artifacts"
          >
            <ArtifactsPanel
              detail={detail}
              immutable={immutable}
              busy={busy}
              onRun={run}
              projectId={projectId}
              deliveryId={deliveryId}
              execution={execution}
            />
          </TabPanel>
          <TabPanel
            active={activeTab === 'review'}
            panelId="deliverypanel-review"
            labelledBy="delivery-review"
          >
            <ReviewPanel
              detail={detail}
              immutable={immutable}
              busy={busy}
              onRun={run}
              projectId={projectId}
              deliveryId={deliveryId}
              execution={execution}
            />
          </TabPanel>
          <TabPanel
            active={activeTab === 'gates'}
            panelId="deliverypanel-gates"
            labelledBy="delivery-gates"
          >
            <GatesPanel
              detail={detail}
              immutable={immutable}
              busy={busy}
              onRun={run}
              projectId={projectId}
              deliveryId={deliveryId}
              execution={execution}
            />
          </TabPanel>
          <TabPanel
            active={activeTab === 'deployments'}
            panelId="deliverypanel-deployments"
            labelledBy="delivery-deployments"
          >
            <DeploymentsPanel
              detail={detail}
              immutable={immutable}
              busy={busy}
              onRun={run}
              projectId={projectId}
              deliveryId={deliveryId}
              execution={execution}
            />
          </TabPanel>
          <TabPanel
            active={activeTab === 'receipt'}
            panelId="deliverypanel-receipt"
            labelledBy="delivery-receipt"
          >
            <ReceiptPanel
              detail={detail}
              readiness={readiness}
              busy={busy}
              projectId={projectId}
              deliveryId={deliveryId}
              previewCurrent={receiptPreviewCurrent}
              onPreviewed={load}
            />
          </TabPanel>
        </div>
      </OuterCard>

      <AgentGuideDialog
        open={agentGuideOpen}
        onOpenChange={setAgentGuideOpen}
        kind="manage-delivery"
        projectName={projectId}
        deliveryId={deliveryId}
      />
    </div>
  );
}

function OverviewPanel({
  detail,
  immutable,
  busy,
  onRun,
  projectId,
  deliveryId,
  execution,
}: PanelProps) {
  const { t } = useLanguage();
  const transitions: Array<{ status: DeliveryStatus; label: string }> = [];
  if (detail.delivery.status === 'draft') {
    transitions.push({ status: 'in_review', label: t('delivery.actions.startReview') });
  } else if (detail.delivery.status === 'in_review') {
    transitions.push({
      status: 'revision_requested',
      label: t('delivery.actions.requestRevision'),
    });
    transitions.push({ status: 'approved', label: t('delivery.actions.approve') });
  } else if (detail.delivery.status === 'revision_requested') {
    transitions.push({ status: 'in_review', label: t('delivery.actions.resumeReview') });
  } else if (detail.delivery.status === 'approved') {
    transitions.push({ status: 'in_review', label: t('delivery.actions.reopenReview') });
  }
  if (!immutable && detail.delivery.status !== 'ready') {
    transitions.push({ status: 'cancelled', label: t('delivery.actions.cancelDelivery') });
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title={t('delivery.overview.title')}
        description={t('delivery.formless.agentManaged')}
      >
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
              {t('delivery.fields.summary')}
            </dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[color:var(--ol-fg)]">
              {detail.delivery.summary || t('delivery.formless.noSummary')}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
              {t('delivery.fields.limitations')}
            </dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[color:var(--ol-fg)]">
              {detail.delivery.limitations || t('delivery.formless.noLimitations')}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
              {t('delivery.fields.type')}
            </dt>
            <dd className="mt-1 text-xs">{t(`delivery.type.${detail.delivery.delivery_type}`)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
              {t('delivery.fields.maturity')}
            </dt>
            <dd className="mt-1 text-xs">{t(`delivery.maturity.${detail.delivery.maturity}`)}</dd>
          </div>
          {detail.delivery.predecessor_delivery_id && (
            <div className="sm:col-span-2">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
                {t('delivery.fields.predecessor')}
              </dt>
              <dd className="ol-mono mt-1 text-xs">{detail.delivery.predecessor_delivery_id}</dd>
            </div>
          )}
        </dl>
        {transitions.length > 0 && (
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[color:var(--ol-border-subtle)] pt-4">
            {transitions.map((transition) => (
              <Button
                key={transition.status}
                variant={transition.status === 'cancelled' ? 'outline' : 'default'}
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  void onRun(
                    `transition:${transition.status}`,
                    () => transitionDelivery(projectId, deliveryId, transition.status),
                    t('delivery.messages.statusChanged'),
                  )
                }
              >
                {transition.label}
              </Button>
            ))}
          </div>
        )}
      </SectionCard>
      <ExecutionPanel execution={execution} />
    </div>
  );
}

function ProjectManifestPanel({ execution }: { execution: DeliveryExecutionView | null }) {
  const { t, language } = useLanguage();
  const comparison = execution?.project_manifest;
  return (
    <SectionCard
      title={t('delivery.execution.projectManifest.title')}
      description={t('delivery.execution.projectManifest.description')}
    >
      {!comparison || comparison.status === 'not_applied' || !comparison.state ? (
        <EmptyEvidence>{t('delivery.execution.projectManifest.notApplied')}</EmptyEvidence>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-[color:var(--ol-border-subtle)] p-3">
            <div className="min-w-0">
              <p className="ol-mono break-all text-xs">{comparison.state.manifest_path}</p>
              <p className="ol-mono mt-1 break-all text-[9px] text-[color:var(--ol-fg-muted)]">
                sha256:{comparison.state.manifest_sha256}
              </p>
              <p className="mt-1 text-[10px] text-[color:var(--ol-fg-subtle)]">
                {t('delivery.execution.projectManifest.applied', {
                  actor: comparison.state.applied_by,
                  date: new Date(comparison.state.applied_at).toLocaleString(language),
                })}
              </p>
            </div>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                comparison.status === 'in_sync'
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-warning/30 bg-warning/10 text-warning',
              )}
            >
              {t(`delivery.execution.projectManifest.status.${comparison.status}`)}
            </span>
          </div>
          {comparison.drift.length > 0 && (
            <ul className="space-y-2" aria-label={t('delivery.execution.projectManifest.drift')}>
              {comparison.drift.map((item) => (
                <li
                  key={`${item.scope}:${item.kind}:${item.key}`}
                  className="rounded-md border border-warning/25 bg-warning/5 px-3 py-2 text-xs"
                >
                  <span className="font-medium">
                    {t(`delivery.execution.projectManifest.scope.${item.scope}`)} · {item.key}
                  </span>
                  <span className="ml-2 text-warning">
                    {t(`delivery.execution.projectManifest.kind.${item.kind}`)}
                  </span>
                  {item.fields.length > 0 && (
                    <p className="ol-mono mt-1 text-[10px] text-[color:var(--ol-fg-muted)]">
                      {item.fields.join(', ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function ExecutionPanel({ execution }: { execution: DeliveryExecutionView | null }) {
  const { t, language } = useLanguage();
  const run = execution?.agent_runs[0];
  if (!execution || !run) {
    return (
      <div className="space-y-4">
        <ProjectManifestPanel execution={execution} />
        <SectionCard
          title={t('delivery.execution.title')}
          description={t('delivery.execution.description')}
        >
          <EmptyEvidence>{t('delivery.execution.empty')}</EmptyEvidence>
        </SectionCard>
      </div>
    );
  }

  const latestChecks = new Map<string, DeliveryExecutionView['run_checks'][number]>();
  for (const check of execution.run_checks) {
    if (check.run_id === run.id && !latestChecks.has(check.check_key)) {
      latestChecks.set(check.check_key, check);
    }
  }
  const events = execution.run_events.filter((event) => event.run_id === run.id).slice(0, 5);

  return (
    <div className="space-y-4">
      <ProjectManifestPanel execution={execution} />
      <SectionCard
        title={t('delivery.execution.title')}
        description={t('delivery.execution.description')}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-[color:var(--ol-border-subtle)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-xs">{t('delivery.execution.latestRun')}</strong>
              <span className="rounded-full border border-[color:var(--ol-border)] px-2 py-0.5 text-[10px]">
                {t(`delivery.execution.runStatus.${run.status}`)}
              </span>
            </div>
            <dl className="mt-3 space-y-2 text-[10px]">
              <div>
                <dt className="text-[color:var(--ol-fg-subtle)]">
                  {t('delivery.execution.phase')}
                </dt>
                <dd className="mt-0.5 text-xs">{formatDeliveryRunPhase(run.current_phase, t)}</dd>
              </div>
              <div>
                <dt className="text-[color:var(--ol-fg-subtle)]">
                  {t('delivery.execution.commit')}
                </dt>
                <dd className="ol-mono mt-0.5 break-all">{run.commit_sha}</dd>
              </div>
              <div>
                <dt className="text-[color:var(--ol-fg-subtle)]">
                  {t('delivery.execution.manifest')}
                </dt>
                <dd className="ol-mono mt-0.5 break-all">
                  {run.manifest_path} · sha256:{run.manifest_sha256}
                </dd>
              </div>
              <div>
                <dt className="text-[color:var(--ol-fg-subtle)]">
                  {t('delivery.execution.runner')}
                </dt>
                <dd className="ol-mono mt-0.5 break-all">
                  {run.runner_image_digest ?? run.runner_image}
                </dd>
              </div>
              <div>
                <dt className="text-[color:var(--ol-fg-subtle)]">
                  {t('delivery.execution.started')}
                </dt>
                <dd className="mt-0.5">{new Date(run.started_at).toLocaleString(language)}</dd>
              </div>
            </dl>
            {run.handoff_summary && (
              <p className="mt-3 rounded bg-[color:var(--ol-panel-2)] px-2 py-1.5 text-xs leading-5">
                <span className="font-medium">{t('delivery.execution.handoff')}: </span>
                {run.handoff_summary}
              </p>
            )}
          </div>

          <div className="rounded-md border border-[color:var(--ol-border-subtle)] p-3">
            <strong className="text-xs">{t('delivery.execution.checks')}</strong>
            {latestChecks.size === 0 ? (
              <p className="mt-3 text-xs text-[color:var(--ol-fg-muted)]">
                {t('delivery.execution.noChecks')}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {[...latestChecks.values()].map((check) => (
                  <li
                    key={check.id}
                    className="rounded border border-[color:var(--ol-border-subtle)] px-2 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-medium">{check.check_key}</span>
                      <span>{t(`delivery.execution.checkStatus.${check.status}`)}</span>
                    </div>
                    <p className="ol-mono mt-1 break-all text-[10px] text-[color:var(--ol-fg-muted)]">
                      {check.command}
                    </p>
                    <p className="mt-1 text-[10px] text-[color:var(--ol-fg-subtle)]">
                      {t('delivery.execution.attempt', { attempt: check.attempt })}
                      {check.duration_ms !== null
                        ? ` · ${t('delivery.execution.duration', { duration: check.duration_ms })}`
                        : ''}
                      {check.exit_code !== null ? ` · exit ${check.exit_code}` : ''}
                    </p>
                    {(check.log_sha256 || check.report_artifact_id) && (
                      <p className="ol-mono mt-1 break-all text-[9px] text-[color:var(--ol-fg-subtle)]">
                        {check.log_sha256 ? `log sha256:${check.log_sha256}` : ''}
                        {check.log_sha256 && check.report_artifact_id ? ' · ' : ''}
                        {check.report_artifact_id ? `report:${check.report_artifact_id}` : ''}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-4 border-t border-[color:var(--ol-border-subtle)] pt-4">
          <strong className="text-xs">{t('delivery.execution.recentEvents')}</strong>
          {events.length === 0 ? (
            <p className="mt-2 text-xs text-[color:var(--ol-fg-muted)]">
              {t('delivery.execution.noEvents')}
            </p>
          ) : (
            <ol className="mt-2 space-y-2">
              {events.map((event) => (
                <li key={event.id} className="flex gap-3 text-xs">
                  <time className="shrink-0 text-[10px] text-[color:var(--ol-fg-subtle)]">
                    {new Date(event.created_at).toLocaleString(language)}
                  </time>
                  <span>
                    {event.phase && (
                      <span className="font-medium">
                        [{formatDeliveryRunPhase(event.phase, t)}]{' '}
                      </span>
                    )}
                    {event.summary}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function ArtifactsPanel({ detail, immutable, busy, onRun, projectId, deliveryId }: PanelProps) {
  const { t } = useLanguage();
  const reviewArtifactIds = new Set(
    detail.gates
      .filter((gate) => gate.gate_type === 'review' && gate.report_artifact_id)
      .map((gate) => gate.report_artifact_id as string),
  );
  return (
    <SectionCard
      title={t('delivery.artifacts.listTitle')}
      description={t('delivery.formless.artifactsDescription')}
    >
      {detail.artifacts.length === 0 ? (
        <EmptyEvidence>{t('delivery.artifacts.empty')}</EmptyEvidence>
      ) : (
        <div className="divide-y divide-[color:var(--ol-border-subtle)]">
          {detail.artifacts.map((artifact) => {
            const reviewTarget = reviewArtifactIds.has(artifact.id);
            return (
              <div key={artifact.id} className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-xs font-medium">{artifact.original_filename}</p>
                    {reviewTarget && (
                      <span className="rounded-full border border-[color:var(--ol-primary)]/30 bg-[color:var(--ol-primary-soft)] px-2 py-0.5 text-[9px] font-medium text-[color:var(--ol-primary)]">
                        {t('delivery.reviewCheckpoint.targetBadge')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-[color:var(--ol-fg-muted)]">
                    {artifact.logical_key} · {formatArtifactRevision(artifact.revision, t)} ·{' '}
                    {t(`delivery.artifacts.kindValue.${artifact.kind}`)} ·{' '}
                    {t(`delivery.artifacts.statusValue.${artifact.status}`)}
                  </p>
                  <p className="ol-mono mt-1 truncate text-[9px] text-[color:var(--ol-fg-subtle)]">
                    sha256:{artifact.blob.sha256}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`/api/projects/${encodeURIComponent(projectId)}/deliveries/${encodeURIComponent(deliveryId)}/artifacts/${encodeURIComponent(artifact.id)}/download`}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t('delivery.actions.download')}
                    </a>
                  </Button>
                  {!immutable && artifact.status === 'draft' && !reviewTarget && (
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void onRun(
                          `artifact:${artifact.id}`,
                          () =>
                            setDeliveryArtifactStatus(
                              projectId,
                              deliveryId,
                              artifact.id,
                              'approved',
                            ),
                          t('delivery.messages.artifactApproved'),
                        )
                      }
                    >
                      <Check className="h-3.5 w-3.5" />
                      {t('delivery.actions.approveArtifact')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function ReviewPanel({ detail, immutable, busy, onRun, projectId, deliveryId }: PanelProps) {
  const { t, language } = useLanguage();
  return (
    <div className="space-y-4">
      <SectionCard
        title={t('delivery.review.sourcesTitle')}
        description={t('delivery.formless.reviewDescription')}
      >
        {detail.feedback_sources.length === 0 ? (
          <EmptyEvidence>{t('delivery.review.noFeedback')}</EmptyEvidence>
        ) : (
          <div className="space-y-3">
            {detail.feedback_sources.map((source) => (
              <article
                key={source.id}
                className="rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-[color:var(--ol-fg-muted)]">
                  <span>{t(`delivery.review.sourceType.${source.source_type}`)}</span>
                  <span>·</span>
                  <span>{source.author_display_name || t('delivery.review.unknown')}</span>
                  <span>·</span>
                  <time>
                    {new Date(source.occurred_at ?? source.created_at).toLocaleString(language)}
                  </time>
                  {source.source_url && (
                    <a
                      className="ml-auto inline-flex items-center gap-1 text-[color:var(--ol-primary)]"
                      href={source.source_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('delivery.review.openSource')} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5">{source.raw_text}</p>
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={t('delivery.review.itemsTitle')}
        description={t('delivery.review.itemsDescription')}
      >
        {detail.work_items.length === 0 ? (
          <EmptyEvidence>{t('delivery.review.noItems')}</EmptyEvidence>
        ) : (
          <div className="space-y-3">
            {detail.work_items.map((item) => (
              <article
                key={item.id}
                className="rounded-md border border-[color:var(--ol-border-subtle)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-medium text-[color:var(--ol-primary)]">
                    {t(`delivery.review.kind.${item.kind}`)}
                  </span>
                  <span className="rounded-full bg-[color:var(--ol-panel-2)] px-2 py-0.5 text-[10px] text-[color:var(--ol-fg-muted)]">
                    {t(`delivery.review.status.${item.status}`)}
                  </span>
                  {item.is_ai_draft && (
                    <span className="text-[10px] text-[color:var(--ol-fg-subtle)]">
                      {t('delivery.review.aiDraft')}
                    </span>
                  )}
                </div>
                <h4 className="mt-2 text-xs font-semibold">{item.title}</h4>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[color:var(--ol-fg-muted)]">
                  {item.detail}
                </p>
                {item.resolution && (
                  <p className="mt-2 rounded bg-[color:var(--ol-panel-2)] px-2 py-1.5 text-xs">
                    {item.resolution}
                  </p>
                )}
                {!immutable && (item.status === 'proposed' || item.status === 'confirmed') && (
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    {item.status === 'proposed' && (
                      <>
                        <Button
                          size="sm"
                          disabled={busy !== null}
                          onClick={() =>
                            void onRun(
                              `work:${item.id}:confirmed`,
                              () =>
                                updateDeliveryWorkItem(projectId, deliveryId, item.id, {
                                  status: 'confirmed',
                                }),
                              t('delivery.messages.workItemUpdated'),
                            )
                          }
                        >
                          <Check className="h-3.5 w-3.5" /> {t('delivery.actions.confirm')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() =>
                            void onRun(
                              `work:${item.id}:rejected`,
                              () =>
                                updateDeliveryWorkItem(projectId, deliveryId, item.id, {
                                  status: 'rejected',
                                }),
                              t('delivery.messages.workItemUpdated'),
                            )
                          }
                        >
                          <X className="h-3.5 w-3.5" /> {t('delivery.actions.reject')}
                        </Button>
                      </>
                    )}
                    {item.status === 'confirmed' &&
                      (item.kind === 'question' || item.kind === 'change_request') && (
                        <Button
                          size="sm"
                          disabled={busy !== null}
                          onClick={() =>
                            void onRun(
                              `work:${item.id}:resolved`,
                              () =>
                                updateDeliveryWorkItem(projectId, deliveryId, item.id, {
                                  status: 'resolved',
                                }),
                              t('delivery.messages.workItemUpdated'),
                            )
                          }
                        >
                          <Check className="h-3.5 w-3.5" /> {t('delivery.actions.resolve')}
                        </Button>
                      )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={t('delivery.formless.approvalsTitle')}>
        {detail.approvals.filter((approval) => !approval.invalidated_at).length === 0 ? (
          <EmptyEvidence>{t('delivery.formless.noApprovals')}</EmptyEvidence>
        ) : (
          <div className="space-y-3">
            {detail.approvals
              .filter((approval) => !approval.invalidated_at)
              .map((approval) => (
                <article
                  key={approval.id}
                  className="rounded-md border border-success/25 bg-success/5 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <strong>{approval.approver_display_name}</strong>
                    <time className="text-[10px] text-[color:var(--ol-fg-muted)]">
                      {new Date(approval.approved_at).toLocaleString(language)}
                    </time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-5">
                    {approval.approval_excerpt}
                  </p>
                </article>
              ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={t('delivery.review.externalRefTitle')}>
        {detail.external_refs.length === 0 ? (
          <EmptyEvidence>{t('delivery.review.noExternalRefs')}</EmptyEvidence>
        ) : (
          <ul className="space-y-2">
            {detail.external_refs.map((reference) => (
              <li key={reference.id}>
                <a
                  className="flex items-center justify-between rounded-md border border-[color:var(--ol-border-subtle)] px-3 py-2 text-xs hover:bg-[color:var(--ol-panel-2)]"
                  href={reference.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>
                    {reference.label} ·{' '}
                    {t(`delivery.review.externalProvider.${reference.provider}`)}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function ReviewCheckpointCard({
  detail,
  gate,
  immutable,
  busy,
  onRun,
  projectId,
  deliveryId,
}: Omit<PanelProps, 'execution'> & { gate: DeliveryGate }) {
  const { t } = useLanguage();
  const artifact = gate.report_artifact_id
    ? detail.artifacts.find((candidate) => candidate.id === gate.report_artifact_id)
    : undefined;
  const latestRevision = artifact
    ? Math.max(
        ...detail.artifacts
          .filter(
            (candidate) =>
              candidate.logical_key === artifact.logical_key && candidate.kind === artifact.kind,
          )
          .map((candidate) => candidate.revision),
      )
    : null;
  const isLatest = Boolean(
    artifact && artifact.status !== 'superseded' && artifact.revision === latestRevision,
  );
  const accepted = Boolean(
    artifact && isLatest && artifact.status === 'approved' && gate.status === 'passed',
  );
  const state = !gate.report_artifact_id
    ? 'notRequested'
    : !artifact || !isLatest
      ? 'stale'
      : detail.delivery.status === 'revision_requested' || gate.status === 'failed'
        ? 'changesRequested'
        : accepted
          ? 'accepted'
          : gate.status === 'waived'
            ? 'waived'
            : 'pending';
  const canAccept = Boolean(
    !immutable &&
    artifact &&
    isLatest &&
    gate.status === 'pending' &&
    detail.delivery.status === 'in_review',
  );
  const canRequestChanges = Boolean(
    !immutable && gate.status === 'pending' && detail.delivery.status === 'in_review',
  );

  return (
    <article className="rounded-lg border border-[color:var(--ol-primary)]/30 bg-[color:var(--ol-primary-soft)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--ol-primary)]">
            {t('delivery.reviewCheckpoint.eyebrow')}
          </p>
          <h4 className="mt-1 text-sm font-semibold">{formatDefaultGateLabel(gate, t)}</h4>
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-medium',
            accepted
              ? 'border-success/30 bg-success/10 text-success'
              : state === 'changesRequested' || state === 'stale'
                ? 'border-warning/30 bg-warning/10 text-warning'
                : 'border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] text-[color:var(--ol-fg-muted)]',
          )}
        >
          {t(`delivery.reviewCheckpoint.status.${state}`)}
        </span>
      </div>

      <p className="mt-2 text-xs leading-5 text-[color:var(--ol-fg-muted)]">
        {t('delivery.reviewCheckpoint.description')}
      </p>
      {gate.summary && (
        <p className="mt-3 whitespace-pre-wrap rounded-md bg-[color:var(--ol-panel)] px-3 py-2 text-xs leading-5">
          {gate.summary}
        </p>
      )}

      {!gate.report_artifact_id ? (
        <p className="mt-3 text-xs text-[color:var(--ol-fg-muted)]">
          {t('delivery.reviewCheckpoint.notRequested')}
        </p>
      ) : !artifact ? (
        <p className="mt-3 text-xs text-error">{t('delivery.reviewCheckpoint.targetMissing')}</p>
      ) : (
        <div className="mt-3 rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)] p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">{artifact.original_filename}</p>
              <p className="mt-1 text-[10px] text-[color:var(--ol-fg-muted)]">
                {artifact.logical_key} · {formatArtifactRevision(artifact.revision, t)} ·{' '}
                {t(`delivery.artifacts.statusValue.${artifact.status}`)}
              </p>
            </div>
            {!isLatest && (
              <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[9px] font-medium text-warning">
                {t('delivery.reviewCheckpoint.newerVersionAvailable')}
              </span>
            )}
          </div>
          <p
            className="ol-mono mt-2 break-all text-[9px] text-[color:var(--ol-fg-subtle)]"
            aria-label={t('delivery.reviewCheckpoint.shaLabel')}
          >
            sha256:{artifact.blob.sha256}
          </p>
          <p className="mt-2 text-[10px] leading-4 text-[color:var(--ol-fg-muted)]">
            {t('delivery.reviewCheckpoint.exactVersionHint')}
          </p>

          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button asChild variant="outline" size="sm">
              <a
                href={`/api/projects/${encodeURIComponent(projectId)}/deliveries/${encodeURIComponent(deliveryId)}/artifacts/${encodeURIComponent(artifact.id)}/download`}
              >
                <Download className="h-3.5 w-3.5" />
                {t('delivery.reviewCheckpoint.openFile')}
              </a>
            </Button>
            {canRequestChanges && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  void onRun(
                    `review:${gate.id}:revision`,
                    () => transitionDelivery(projectId, deliveryId, 'revision_requested'),
                    t('delivery.messages.reviewChangesRequested'),
                  )
                }
              >
                <X className="h-3.5 w-3.5" />
                {t('delivery.reviewCheckpoint.requestChanges')}
              </Button>
            )}
            {canAccept && (
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  void onRun(
                    `review:${gate.id}:accept`,
                    () =>
                      acceptDeliveryReview(deliveryId, {
                        gate_key: gate.gate_key,
                        artifact_id: artifact.id,
                        expected_sha256: artifact.blob.sha256,
                      }),
                    t('delivery.messages.reviewAccepted'),
                  )
                }
              >
                <Check className="h-3.5 w-3.5" />
                {t('delivery.reviewCheckpoint.acceptExactVersion')}
              </Button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function GatesPanel({ detail, immutable, busy, onRun, projectId, deliveryId }: PanelProps) {
  const { t } = useLanguage();
  const reviewGates = detail.gates.filter((gate) => gate.gate_type === 'review');
  const automatedGates = detail.gates.filter((gate) => gate.gate_type !== 'review');
  return (
    <SectionCard
      title={t('delivery.gates.title')}
      description={t('delivery.formless.gatesDescription')}
    >
      <div className="space-y-3">
        {reviewGates.map((gate) => (
          <ReviewCheckpointCard
            key={gate.id}
            detail={detail}
            gate={gate}
            immutable={immutable}
            busy={busy}
            onRun={onRun}
            projectId={projectId}
            deliveryId={deliveryId}
          />
        ))}
        {automatedGates.map((gate) => (
          <article
            key={gate.id}
            className="rounded-md border border-[color:var(--ol-border-subtle)] p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-xs font-semibold">{formatDefaultGateLabel(gate, t)}</h4>
                  <span className="text-[10px] text-[color:var(--ol-fg-muted)]">
                    {gate.required ? t('delivery.gates.required') : t('delivery.gates.optional')}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-[color:var(--ol-fg-subtle)]">
                  {t(`delivery.gates.type.${gate.gate_type}`)} · {gate.gate_key}
                </p>
              </div>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                  gate.status === 'passed'
                    ? 'border-success/30 bg-success/10 text-success'
                    : gate.status === 'failed'
                      ? 'border-error/30 bg-error/10 text-error'
                      : gate.status === 'warning'
                        ? 'border-warning/30 bg-warning/10 text-warning'
                        : 'border-[color:var(--ol-border)] text-[color:var(--ol-fg-muted)]',
                )}
              >
                {t(`delivery.gates.status.${gate.status}`)}
              </span>
            </div>
            {gate.summary && (
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[color:var(--ol-fg-muted)]">
                {gate.summary}
              </p>
            )}
            {gate.waiver_reason && (
              <p className="mt-2 rounded bg-warning/10 px-2 py-1.5 text-xs text-warning">
                {gate.waiver_reason}
              </p>
            )}
            {!immutable && gate.status === 'warning' && !gate.warning_accepted && (
              <div className="mt-3 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void onRun(
                      `gate:${gate.id}:warning`,
                      () =>
                        recordDeliveryGate(projectId, deliveryId, gate.gate_key, {
                          status: gate.status,
                          summary: gate.summary,
                          warning_accepted: true,
                          report_artifact_id: gate.report_artifact_id,
                        }),
                      t('delivery.messages.gateRecorded'),
                    )
                  }
                >
                  <Check className="h-3.5 w-3.5" /> {t('delivery.gates.acceptWarning')}
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>
    </SectionCard>
  );
}

function DeploymentsPanel({ detail, execution }: PanelProps) {
  const { t, language } = useLanguage();
  const environments = [...(execution?.project_environments ?? [])].sort(
    (left, right) => left.promotion_order - right.promotion_order,
  );
  const releases = new Map((execution?.releases ?? []).map((release) => [release.id, release]));
  const latestPromotion = new Map<string, DeliveryExecutionView['release_promotions'][number]>();
  for (const promotion of execution?.release_promotions ?? []) {
    if (!latestPromotion.has(promotion.project_environment_id)) {
      latestPromotion.set(promotion.project_environment_id, promotion);
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title={t('delivery.promotion.title')}
        description={t('delivery.promotion.description')}
      >
        {environments.length === 0 ? (
          <EmptyEvidence>{t('delivery.promotion.empty')}</EmptyEvidence>
        ) : (
          <ol className="grid gap-3 lg:grid-cols-3" aria-label={t('delivery.promotion.graphLabel')}>
            {environments.map((environment) => {
              const promotion = latestPromotion.get(environment.id);
              const release = promotion ? releases.get(promotion.release_id) : undefined;
              const artifacts = promotion
                ? (execution?.release_artifacts ?? []).filter(
                    (artifact) => artifact.release_id === promotion.release_id,
                  )
                : [];
              return (
                <li
                  key={environment.id}
                  className="relative rounded-md border border-[color:var(--ol-border-subtle)] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold">{environment.display_name}</p>
                      <p className="mt-1 text-[10px] text-[color:var(--ol-fg-muted)]">
                        {environment.promotion_order + 1}.{' '}
                        {t(`delivery.promotion.tier.${environment.tier}`)}
                      </p>
                    </div>
                    <span className="rounded-full border border-[color:var(--ol-border)] px-2 py-0.5 text-[10px]">
                      {promotion
                        ? t(`delivery.promotion.status.${promotion.status}`)
                        : t('delivery.promotion.notPromoted')}
                    </span>
                  </div>
                  {promotion && release && (
                    <div className="mt-3 space-y-2 text-[10px]">
                      <p>
                        <span className="font-medium">{release.version}</span>
                        <span className="ol-mono ml-2 text-[color:var(--ol-fg-muted)]">
                          {release.commit_sha}
                        </span>
                      </p>
                      <p className="text-[color:var(--ol-fg-muted)]">
                        {t('delivery.promotion.health')}:{' '}
                        {t(`delivery.promotion.healthStatus.${promotion.health_status}`)} ·{' '}
                        {t('delivery.promotion.soak')}:{' '}
                        {t(`delivery.promotion.soakStatus.${promotion.soak_status}`)}
                      </p>
                      <p className="text-[color:var(--ol-fg-subtle)]">
                        {environment.smoke_path
                          ? t('delivery.promotion.smokeConfigured', {
                              path: environment.smoke_path,
                            })
                          : t('delivery.promotion.smokeSkipped')}{' '}
                        ·{' '}
                        {t('delivery.promotion.soakSeconds', { seconds: environment.soak_seconds })}
                      </p>
                      {artifacts.map((artifact) => (
                        <p
                          key={artifact.id}
                          className="ol-mono break-all rounded bg-[color:var(--ol-panel-2)] px-2 py-1.5 text-[9px]"
                        >
                          {artifact.service_id}: {artifact.image_reference}
                          <br />
                          {artifact.image_digest}
                        </p>
                      ))}
                      {(promotion.error_code || promotion.error_message) && (
                        <p className="rounded bg-error/10 px-2 py-1.5 text-error">
                          {promotion.error_code ?? t('delivery.promotion.failed')}:{' '}
                          {promotion.error_message ?? t('delivery.promotion.noErrorDetail')}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </SectionCard>

      <SectionCard
        title={t('delivery.deployments.listTitle')}
        description={t('delivery.formless.deploymentsDescription')}
      >
        {detail.deploy_links.length === 0 ? (
          <EmptyEvidence>{t('delivery.deployments.empty')}</EmptyEvidence>
        ) : (
          <div className="space-y-3">
            {detail.deploy_links.map((evidence) => (
              <article
                key={evidence.link.id}
                className="rounded-md border border-[color:var(--ol-border-subtle)] p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold">{evidence.service.name}</p>
                    <p className="ol-mono mt-1 text-[10px] text-[color:var(--ol-fg-muted)]">
                      {evidence.deploy.commit_sha || t('delivery.deployments.noCommit')}
                    </p>
                  </div>
                  <span className="rounded-full border border-[color:var(--ol-border)] px-2 py-0.5 text-[10px]">
                    {t(`delivery.deployments.relation.${evidence.link.relation}`)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[color:var(--ol-fg-muted)]">
                  <span>
                    {t(
                      `delivery.deployments.environment.${evidence.environment?.type ?? 'unknown'}`,
                    )}
                  </span>
                  {evidence.deploy.status && (
                    <span>{t(`delivery.deployments.status.${evidence.deploy.status}`)}</span>
                  )}
                  {evidence.deploy.created_at && (
                    <time>{new Date(evidence.deploy.created_at).toLocaleString(language)}</time>
                  )}
                  <span className="ol-mono">{evidence.deploy.id}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function ReceiptPanel({
  detail,
  readiness,
  busy,
  projectId,
  deliveryId,
  previewCurrent,
  onPreviewed,
}: {
  detail: DeliveryDetail;
  readiness: DeliveryReadiness | null;
  busy: string | null;
  projectId: string;
  deliveryId: string;
  previewCurrent: boolean;
  onPreviewed: () => Promise<void>;
}) {
  const { t, language } = useLanguage();
  const [localBusy, setLocalBusy] = useState<string | null>(null);
  const actionBusy = busy !== null || localBusy !== null;

  const preview = async () => {
    setLocalBusy('preview');
    try {
      const blob = await generateReceiptPreview(projectId, deliveryId);
      await onPreviewed();
      downloadBlob(blob, `${deliveryId}-receipt-preview.pdf`, true);
    } finally {
      setLocalBusy(null);
    }
  };

  const download = async () => {
    setLocalBusy('download');
    try {
      const blob = await downloadReceipt(projectId, deliveryId);
      downloadBlob(blob, `${deliveryId}-receipt.pdf`);
    } finally {
      setLocalBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <SectionCard
        title={t('delivery.receipt.readinessTitle')}
        description={t('delivery.formless.receiptDescription')}
      >
        {!readiness ? (
          <EmptyEvidence>{t('delivery.loading')}</EmptyEvidence>
        ) : (
          <>
            <ul className="space-y-2">
              {readiness.checks.map((check) => (
                <li
                  key={check.key}
                  className="flex gap-2 rounded-md border border-[color:var(--ol-border-subtle)] px-3 py-2 text-xs"
                >
                  {check.passed ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  )}
                  <span>{formatReadinessCheck(check, detail.delivery.delivery_type, t)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[10px] text-[color:var(--ol-fg-muted)]">
              {t('delivery.receipt.pageEstimate', { count: readiness.estimated_pages })}
            </p>
          </>
        )}
      </SectionCard>

      <SectionCard title={t('delivery.receipt.actionsTitle')}>
        {detail.receipt ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-success">
                {t('delivery.receipt.finalizedTitle')}
              </p>
              <p className="ol-mono mt-1 text-[10px] text-[color:var(--ol-fg-muted)]">
                sha256:{detail.receipt.pdf_sha256}
              </p>
              <p className="mt-1 text-[10px] text-[color:var(--ol-fg-subtle)]">
                {new Date(detail.receipt.finalized_at).toLocaleString(language)}
              </p>
            </div>
            <Button size="sm" disabled={actionBusy} onClick={() => void download()}>
              {localBusy === 'download' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {t('delivery.actions.downloadReceipt')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-xs leading-5 text-[color:var(--ol-fg-muted)]">
              {t('delivery.formless.completionHint')}
              {previewCurrent && (
                <span className="mt-1 block text-success">
                  {t('delivery.receipt.previewCurrent')}
                </span>
              )}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={actionBusy || !readiness?.ready}
              onClick={() => void preview()}
            >
              {localBusy === 'preview' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileText className="h-3.5 w-3.5" />
              )}
              {t('delivery.actions.preview')}
            </Button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
