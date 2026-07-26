import {
  ArrowLeft,
  Check,
  CircleAlert,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Link2,
  Loader2,
  MessageSquareText,
  PackageCheck,
  Rocket,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OuterCard } from '@/components/Shell/OuterCard';
import { ProjectTabs, TabPanel, type TabDef } from '@/components/Shell/ProjectTabs';
import {
  DeliveryWorkflowRail,
  type DeliveryDetailTab,
} from '@/components/delivery/DeliveryWorkflowRail';
import {
  attachDeliveryExternalRef,
  downloadReceipt,
  finalizeReceipt,
  generateReceiptPreview,
  getDelivery,
  getDeliveryReadiness,
  linkDeliveryDeploy,
  recordDeliveryApproval,
  recordDeliveryFeedback,
  recordDeliveryGate,
  setDeliveryArtifactStatus,
  transitionDelivery,
  unlinkDeliveryDeploy,
  updateDelivery,
  updateDeliveryGateTemplate,
  updateDeliveryWorkItem,
  uploadDeliveryArtifact,
  type Delivery,
  type DeliveryArtifact,
  type DeliveryDetail,
  type DeliveryGate,
  type DeliveryReadiness,
  type DeliveryReadinessCheck,
  type DeliveryStatus,
  type DeliveryType,
} from '@/lib/api/deliveries';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';
import { EngagementChip } from '@/components/engagement/EngagementChip';
import { localizeApiError } from '@/lib/localized-api-error';

type Translate = (key: string, params?: Record<string, string | number>) => string;

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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewSucceeded, setPreviewSucceeded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextDetail, nextReadiness] = await Promise.all([
        getDelivery(projectId, deliveryId),
        getDeliveryReadiness(projectId, deliveryId).catch(() => null),
      ]);
      setDetail(nextDetail);
      setReadiness(nextReadiness);
      setPreviewSucceeded(
        nextDetail.delivery.status === 'ready' &&
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
  }, [load]);

  const run = async (key: string, operation: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    setError(null);
    setMessage(null);
    if (key !== 'receipt:preview' && key !== 'receipt:finalize') {
      setPreviewSucceeded(false);
    }
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
      count: detail?.work_items.filter((item) => item.status === 'proposed').length,
    },
    { id: 'gates', label: t('delivery.tabs.gates'), icon: ShieldCheck },
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
          <span className="flex items-center gap-2">
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
              previewSucceeded={previewSucceeded}
              onPreviewSucceeded={() => setPreviewSucceeded(true)}
              onRun={run}
              projectId={projectId}
              deliveryId={deliveryId}
            />
          </TabPanel>
        </div>
      </OuterCard>
    </div>
  );
}

function OverviewPanel({ detail, immutable, busy, onRun, projectId, deliveryId }: PanelProps) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(detail.delivery.title);
  const [summary, setSummary] = useState(detail.delivery.summary);
  const [limitations, setLimitations] = useState(detail.delivery.limitations ?? '');
  const [maturity, setMaturity] = useState(detail.delivery.maturity);

  useEffect(() => {
    setTitle(detail.delivery.title);
    setSummary(detail.delivery.summary);
    setLimitations(detail.delivery.limitations ?? '');
    setMaturity(detail.delivery.maturity);
  }, [detail.delivery]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    void onRun(
      'overview',
      () =>
        updateDelivery(projectId, deliveryId, {
          title,
          summary,
          limitations,
          maturity,
        }),
      t('delivery.messages.saved'),
    );
  };

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
  if (
    detail.delivery.status === 'draft' ||
    detail.delivery.status === 'in_review' ||
    detail.delivery.status === 'revision_requested' ||
    detail.delivery.status === 'approved'
  ) {
    transitions.push({ status: 'cancelled', label: t('delivery.actions.cancelDelivery') });
  }

  return (
    <SectionCard
      title={t('delivery.overview.title')}
      description={t('delivery.overview.description')}
    >
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        {detail.delivery.predecessor_delivery_id && (
          <div className="sm:col-span-2">
            <Label>{t('delivery.fields.predecessor')}</Label>
            <p className="ol-mono mt-1.5 rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] px-3 py-2 text-xs">
              {detail.delivery.predecessor_delivery_id}
            </p>
          </div>
        )}
        <div className="sm:col-span-2">
          <Label htmlFor="detail-title">{t('delivery.fields.title')}</Label>
          <Input
            id="detail-title"
            className="mt-1.5"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={immutable}
            required
          />
        </div>
        <div>
          <Label htmlFor="detail-type">{t('delivery.fields.type')}</Label>
          <Input
            id="detail-type"
            className="mt-1.5"
            value={t(`delivery.type.${detail.delivery.delivery_type}`)}
            disabled
          />
        </div>
        <div>
          <Label htmlFor="detail-maturity">{t('delivery.fields.maturity')}</Label>
          <select
            id="detail-maturity"
            className="mt-1.5 h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 text-xs"
            value={maturity}
            onChange={(event) => setMaturity(event.target.value as Delivery['maturity'])}
            disabled={immutable}
          >
            {(
              [
                'concept',
                'functional_preview',
                'customer_review',
                'release_candidate',
                'production',
              ] as Delivery['maturity'][]
            ).map((value) => (
              <option key={value} value={value}>
                {t(`delivery.maturity.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="detail-summary">{t('delivery.fields.summary')}</Label>
          <textarea
            id="detail-summary"
            rows={4}
            className="mt-1.5 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 py-2 text-xs"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            disabled={immutable}
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="detail-limitations">{t('delivery.fields.limitations')}</Label>
          <textarea
            id="detail-limitations"
            rows={3}
            className="mt-1.5 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 py-2 text-xs"
            value={limitations}
            onChange={(event) => setLimitations(event.target.value)}
            disabled={immutable}
          />
        </div>
        {!immutable && (
          <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
            <Button type="submit" variant="outline" size="sm" disabled={busy === 'overview'}>
              {t('delivery.actions.save')}
            </Button>
            {transitions.map((transition) => (
              <Button
                key={transition.status}
                type="button"
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
      </form>
    </SectionCard>
  );
}

interface PanelProps {
  detail: DeliveryDetail;
  immutable: boolean;
  busy: string | null;
  onRun: (key: string, operation: () => Promise<unknown>, success?: string) => Promise<void>;
  projectId: string;
  deliveryId: string;
}

function ArtifactsPanel(props: PanelProps) {
  const { detail, immutable, busy, onRun, projectId, deliveryId } = props;
  const { t } = useLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [logicalKey, setLogicalKey] = useState('review');
  const [revision, setRevision] = useState(1);
  const [kind, setKind] = useState<DeliveryArtifact['kind']>('review_html');
  const [receiptOrder, setReceiptOrder] = useState(0);
  const [companionFor, setCompanionFor] = useState('');

  const upload = (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    void onRun(
      'artifact:upload',
      () =>
        uploadDeliveryArtifact(projectId, deliveryId, {
          file,
          logicalKey,
          revision,
          kind,
          includeInReceipt: true,
          receiptOrder,
          companionForArtifactId: companionFor || undefined,
        }),
      t('delivery.messages.uploaded'),
    ).then(() => setFile(null));
  };

  const htmlArtifacts = detail.artifacts.filter(
    (artifact) => artifact.kind === 'review_html' && artifact.status !== 'superseded',
  );

  return (
    <div className="space-y-4">
      {!immutable && (
        <SectionCard
          title={t('delivery.artifacts.uploadTitle')}
          description={t('delivery.artifacts.uploadDescription')}
        >
          <form onSubmit={upload} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="artifact-file">{t('delivery.artifacts.file')}</Label>
              <Input
                id="artifact-file"
                type="file"
                className="mt-1.5"
                accept=".html,.htm,.pdf,.md,.json,.xml,.png,.jpg,.jpeg,.webp"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                required
              />
            </div>
            <div>
              <Label htmlFor="artifact-key">{t('delivery.artifacts.logicalKey')}</Label>
              <Input
                id="artifact-key"
                className="mt-1.5"
                value={logicalKey}
                onChange={(event) => setLogicalKey(event.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="artifact-revision">{t('delivery.artifacts.revision')}</Label>
              <Input
                id="artifact-revision"
                type="number"
                min={1}
                className="mt-1.5"
                value={revision}
                onChange={(event) => setRevision(Number(event.target.value))}
                required
              />
            </div>
            <div>
              <Label htmlFor="artifact-kind">{t('delivery.artifacts.kind')}</Label>
              <select
                id="artifact-kind"
                className="mt-1.5 h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 text-xs"
                value={kind}
                onChange={(event) => setKind(event.target.value as DeliveryArtifact['kind'])}
              >
                {(
                  [
                    'review_html',
                    'companion_pdf',
                    'markdown',
                    'qa_report',
                    'data_report',
                    'image',
                    'other',
                  ] as DeliveryArtifact['kind'][]
                ).map((value) => (
                  <option key={value} value={value}>
                    {t(`delivery.artifacts.kindValue.${value}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="artifact-order">{t('delivery.artifacts.order')}</Label>
              <Input
                id="artifact-order"
                type="number"
                min={0}
                className="mt-1.5"
                value={receiptOrder}
                onChange={(event) => setReceiptOrder(Number(event.target.value))}
              />
            </div>
            {kind === 'companion_pdf' && (
              <div className="sm:col-span-2">
                <Label htmlFor="artifact-companion">{t('delivery.artifacts.companionFor')}</Label>
                <select
                  id="artifact-companion"
                  className="mt-1.5 h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 text-xs"
                  value={companionFor}
                  onChange={(event) => {
                    const id = event.target.value;
                    setCompanionFor(id);
                    const html = htmlArtifacts.find((artifact) => artifact.id === id);
                    if (html) {
                      setLogicalKey(html.logical_key);
                      setRevision(html.revision);
                    }
                  }}
                >
                  <option value="">{t('delivery.artifacts.noCompanion')}</option>
                  {htmlArtifacts.map((artifact) => (
                    <option key={artifact.id} value={artifact.id}>
                      {artifact.original_filename} · {formatArtifactRevision(artifact.revision, t)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" size="sm" disabled={!file || busy === 'artifact:upload'}>
                <Upload className="h-3.5 w-3.5" />
                {t('delivery.actions.upload')}
              </Button>
            </div>
          </form>
        </SectionCard>
      )}

      <SectionCard title={t('delivery.artifacts.listTitle')}>
        {detail.artifacts.length === 0 ? (
          <p className="text-xs text-[color:var(--ol-fg-muted)]">{t('delivery.artifacts.empty')}</p>
        ) : (
          <div className="divide-y divide-[color:var(--ol-border-subtle)]">
            {detail.artifacts.map((artifact) => (
              <div key={artifact.id} className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{artifact.original_filename}</p>
                  <p className="mt-1 text-[10px] text-[color:var(--ol-fg-muted)]">
                    {artifact.logical_key} · {formatArtifactRevision(artifact.revision, t)} ·{' '}
                    {t(`delivery.artifacts.kindValue.${artifact.kind}`)} ·{' '}
                    {t(`delivery.artifacts.statusValue.${artifact.status}`)}
                  </p>
                  <p className="ol-mono mt-1 truncate text-[9px] text-[color:var(--ol-fg-subtle)]">
                    {artifact.blob.sha256}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`/api/projects/${encodeURIComponent(projectId)}/deliveries/${encodeURIComponent(
                        deliveryId,
                      )}/artifacts/${encodeURIComponent(artifact.id)}/download`}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t('delivery.actions.download')}
                    </a>
                  </Button>
                  {!immutable && artifact.status === 'draft' && (
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
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function ReviewPanel(props: PanelProps) {
  const { detail, immutable, busy, onRun, projectId, deliveryId } = props;
  const { t } = useLanguage();
  const [sourceType, setSourceType] =
    useState<DeliveryDetail['feedback_sources'][number]['source_type']>('slack');
  const [sourceUrl, setSourceUrl] = useState('');
  const [author, setAuthor] = useState('');
  const [rawText, setRawText] = useState('');
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [selectedArtifacts, setSelectedArtifacts] = useState<string[]>([]);
  const [approver, setApprover] = useState('');
  const [approvalExcerpt, setApprovalExcerpt] = useState('');
  const [approvalSourceUrl, setApprovalSourceUrl] = useState('');
  const [refLabel, setRefLabel] = useState('');
  const [refUrl, setRefUrl] = useState('');
  const [refProvider, setRefProvider] =
    useState<DeliveryDetail['external_refs'][number]['provider']>('slack');

  const submitFeedback = (event: FormEvent) => {
    event.preventDefault();
    void onRun(
      'feedback',
      () =>
        recordDeliveryFeedback(projectId, deliveryId, {
          source_type: sourceType,
          source_url: sourceUrl || null,
          author_display_name: author || null,
          raw_text: rawText,
          occurred_at: new Date().toISOString(),
        }),
      t('delivery.messages.feedbackRecorded'),
    ).then(() => setRawText(''));
  };

  const submitApproval = (event: FormEvent) => {
    event.preventDefault();
    void onRun(
      'approval',
      () =>
        recordDeliveryApproval(projectId, deliveryId, {
          artifact_ids: selectedArtifacts,
          approver_display_name: approver,
          approval_excerpt: approvalExcerpt,
          source_type: sourceType,
          source_url: approvalSourceUrl || null,
          approved_at: new Date().toISOString(),
        }),
      t('delivery.messages.approvalRecorded'),
    );
  };

  const approvedArtifacts = detail.artifacts.filter((artifact) => artifact.status === 'approved');

  return (
    <div className="space-y-4">
      {!immutable && (
        <SectionCard
          title={t('delivery.review.feedbackTitle')}
          description={t('delivery.review.feedbackDescription')}
        >
          <form onSubmit={submitFeedback} className="grid gap-3 sm:grid-cols-2">
            <select
              value={sourceType}
              onChange={(event) =>
                setSourceType(
                  event.target.value as DeliveryDetail['feedback_sources'][number]['source_type'],
                )
              }
              className="h-9 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 text-xs"
            >
              {['slack', 'teams', 'email', 'meeting', 'other'].map((value) => (
                <option key={value} value={value}>
                  {t(`delivery.review.sourceType.${value}`)}
                </option>
              ))}
            </select>
            <Input
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
              placeholder={t('delivery.review.authorPlaceholder')}
            />
            <Input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder={t('delivery.review.sourceUrlPlaceholder')}
              className="sm:col-span-2"
            />
            <textarea
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder={t('delivery.review.rawTextPlaceholder')}
              rows={5}
              required
              className="rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 py-2 text-xs sm:col-span-2"
            />
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" size="sm" disabled={!rawText.trim() || busy === 'feedback'}>
                {t('delivery.actions.recordFeedback')}
              </Button>
            </div>
          </form>
        </SectionCard>
      )}

      <SectionCard title={t('delivery.review.sourcesTitle')}>
        <div className="space-y-3">
          {detail.feedback_sources.length === 0 ? (
            <p className="text-xs text-[color:var(--ol-fg-muted)]">
              {t('delivery.review.noFeedback')}
            </p>
          ) : (
            detail.feedback_sources.map((source) => (
              <article
                key={source.id}
                className="rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] p-3"
              >
                <p className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--ol-fg-muted)]">
                  {t(`delivery.review.sourceType.${source.source_type}`)} ·{' '}
                  {source.author_display_name || t('delivery.review.unknown')}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5">{source.raw_text}</p>
                {source.source_url && (
                  <a
                    href={source.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[10px] text-[color:var(--ol-primary)]"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t('delivery.review.openSource')}
                  </a>
                )}
              </article>
            ))
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={t('delivery.review.itemsTitle')}
        description={t('delivery.review.itemsDescription')}
      >
        {detail.work_items.length === 0 ? (
          <p className="text-xs text-[color:var(--ol-fg-muted)]">{t('delivery.review.noItems')}</p>
        ) : (
          <div className="space-y-3">
            {detail.work_items.map((item) => (
              <div
                key={item.id}
                className="rounded-md border border-[color:var(--ol-border-subtle)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase text-[color:var(--ol-primary)]">
                    {t(`delivery.review.kind.${item.kind}`)}
                  </span>
                  <span className="text-[10px] text-[color:var(--ol-fg-muted)]">
                    {t(`delivery.review.status.${item.status}`)}
                  </span>
                  {item.is_ai_draft && (
                    <span className="rounded bg-[color:var(--ol-primary-soft)] px-1.5 py-0.5 text-[9px] text-[color:var(--ol-primary)]">
                      {t('delivery.review.aiDraft')}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs font-medium">{item.title}</p>
                {item.detail && <p className="mt-1 text-xs leading-5">{item.detail}</p>}
                {!immutable && item.status === 'proposed' && (
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void onRun(`work:${item.id}`, () =>
                          updateDeliveryWorkItem(projectId, deliveryId, item.id, {
                            status: 'confirmed',
                          }),
                        )
                      }
                    >
                      {t('delivery.actions.confirm')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void onRun(`work:${item.id}`, () =>
                          updateDeliveryWorkItem(projectId, deliveryId, item.id, {
                            status: 'rejected',
                          }),
                        )
                      }
                    >
                      {t('delivery.actions.reject')}
                    </Button>
                  </div>
                )}
                {!immutable &&
                  item.status === 'confirmed' &&
                  (item.kind === 'change_request' || item.kind === 'question') && (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={resolutions[item.id] ?? ''}
                        onChange={(event) =>
                          setResolutions((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        placeholder={t('delivery.review.resolutionPlaceholder')}
                      />
                      <Button
                        size="sm"
                        disabled={!resolutions[item.id]?.trim() || busy !== null}
                        onClick={() =>
                          void onRun(`work:${item.id}`, () =>
                            updateDeliveryWorkItem(projectId, deliveryId, item.id, {
                              status: 'resolved',
                              resolution: resolutions[item.id],
                            }),
                          )
                        }
                      >
                        {t('delivery.actions.resolve')}
                      </Button>
                    </div>
                  )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {!immutable && (
        <SectionCard
          title={t('delivery.review.approvalTitle')}
          description={t('delivery.review.approvalDescription')}
        >
          <form onSubmit={submitApproval} className="grid gap-3 sm:grid-cols-2">
            <Input
              value={approver}
              onChange={(event) => setApprover(event.target.value)}
              placeholder={t('delivery.review.approverPlaceholder')}
              required
            />
            <Input
              value={approvalSourceUrl}
              onChange={(event) => setApprovalSourceUrl(event.target.value)}
              placeholder={t('delivery.review.sourceUrlPlaceholder')}
            />
            <textarea
              value={approvalExcerpt}
              onChange={(event) => setApprovalExcerpt(event.target.value)}
              placeholder={t('delivery.review.approvalExcerptPlaceholder')}
              rows={3}
              required
              className="rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 py-2 text-xs sm:col-span-2"
            />
            <div className="space-y-2 sm:col-span-2">
              {approvedArtifacts.map((artifact) => (
                <label key={artifact.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedArtifacts.includes(artifact.id)}
                    onChange={(event) =>
                      setSelectedArtifacts((current) =>
                        event.target.checked
                          ? [...current, artifact.id]
                          : current.filter((id) => id !== artifact.id),
                      )
                    }
                  />
                  {artifact.original_filename} · {formatArtifactRevision(artifact.revision, t)}
                </label>
              ))}
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button
                type="submit"
                size="sm"
                disabled={
                  selectedArtifacts.length === 0 ||
                  !approver.trim() ||
                  !approvalExcerpt.trim() ||
                  busy === 'approval'
                }
              >
                {t('delivery.actions.recordApproval')}
              </Button>
            </div>
          </form>
        </SectionCard>
      )}

      <SectionCard title={t('delivery.review.externalRefTitle')}>
        {!immutable && (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void onRun(
                'external-ref',
                () =>
                  attachDeliveryExternalRef(projectId, deliveryId, {
                    provider: refProvider,
                    label: refLabel,
                    url: refUrl,
                  }),
                t('delivery.messages.referenceAdded'),
              ).then(() => {
                setRefLabel('');
                setRefUrl('');
              });
            }}
          >
            <select
              value={refProvider}
              onChange={(event) =>
                setRefProvider(
                  event.target.value as DeliveryDetail['external_refs'][number]['provider'],
                )
              }
              className="h-9 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 text-xs"
            >
              {['slack', 'teams', 'email', 'drive', 'github', 'other'].map((provider) => (
                <option key={provider} value={provider}>
                  {t(`delivery.review.externalProvider.${provider}`)}
                </option>
              ))}
            </select>
            <Input
              value={refLabel}
              onChange={(event) => setRefLabel(event.target.value)}
              placeholder={t('delivery.review.refLabelPlaceholder')}
              required
            />
            <Input
              value={refUrl}
              onChange={(event) => setRefUrl(event.target.value)}
              placeholder="https://"
              required
            />
            <Button type="submit" size="sm" disabled={busy === 'external-ref'}>
              <Link2 className="h-3.5 w-3.5" />
              {t('delivery.actions.add')}
            </Button>
          </form>
        )}
        <div className={cn('space-y-2', !immutable && 'mt-3')}>
          {detail.external_refs.length === 0 ? (
            <p className="text-xs text-[color:var(--ol-fg-muted)]">
              {t('delivery.review.noExternalRefs')}
            </p>
          ) : (
            detail.external_refs.map((reference) => (
              <a
                key={reference.id}
                href={reference.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md border border-[color:var(--ol-border-subtle)] px-3 py-2 text-xs text-[color:var(--ol-primary)]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="text-[color:var(--ol-fg-muted)]">
                  {t(`delivery.review.externalProvider.${reference.provider}`)}
                </span>
                <span className="truncate">{reference.label}</span>
              </a>
            ))
          )}
        </div>
      </SectionCard>
    </div>
  );
}

function GatesPanel(props: PanelProps) {
  const { detail, immutable, busy, onRun, projectId, deliveryId } = props;
  const { t } = useLanguage();
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        status: DeliveryGate['status'];
        summary: string;
        waiver: string;
        warning: boolean;
        reportArtifactId: string;
      }
    >
  >({});

  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        detail.gates.map((gate) => [
          gate.gate_key,
          {
            status: gate.status,
            summary: gate.summary ?? '',
            waiver: gate.waiver_reason ?? '',
            warning: gate.warning_accepted,
            reportArtifactId: gate.report_artifact_id ?? '',
          },
        ]),
      ),
    );
  }, [detail.gates]);

  return (
    <SectionCard title={t('delivery.gates.title')} description={t('delivery.gates.description')}>
      <div className="space-y-4">
        {detail.gates.map((gate) => {
          const draft = drafts[gate.gate_key] ?? {
            status: gate.status,
            summary: '',
            waiver: '',
            warning: false,
            reportArtifactId: '',
          };
          return (
            <div
              key={gate.id}
              className="grid gap-3 rounded-md border border-[color:var(--ol-border-subtle)] p-3 sm:grid-cols-[160px_1fr]"
            >
              <div>
                <p className="text-xs font-semibold">{formatDefaultGateLabel(gate, t)}</p>
                <p className="mt-1 text-[10px] text-[color:var(--ol-fg-muted)]">
                  {t(`delivery.gates.type.${gate.gate_type}`)} ·{' '}
                  {gate.required ? t('delivery.gates.required') : t('delivery.gates.optional')}
                </p>
                {!immutable && detail.delivery.status === 'draft' && (
                  <label className="mt-3 flex items-center gap-2 text-[10px] text-[color:var(--ol-fg-muted)]">
                    <input
                      type="checkbox"
                      checked={gate.required}
                      disabled={busy !== null}
                      onChange={(event) =>
                        void onRun(
                          `gate-template:${gate.gate_key}`,
                          () =>
                            updateDeliveryGateTemplate(projectId, deliveryId, gate.gate_key, {
                              required: event.target.checked,
                            }),
                          t('delivery.messages.gateTemplateSaved'),
                        )
                      }
                    />
                    {t('delivery.gates.requiredToggle')}
                  </label>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={draft.status}
                  disabled={immutable}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [gate.gate_key]: {
                        ...draft,
                        status: event.target.value as DeliveryGate['status'],
                      },
                    }))
                  }
                  className="h-9 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 text-xs"
                >
                  {['pending', 'passed', 'warning', 'failed', 'waived'].map((value) => (
                    <option key={value} value={value}>
                      {t(`delivery.gates.status.${value}`)}
                    </option>
                  ))}
                </select>
                <Input
                  value={draft.summary}
                  disabled={immutable}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [gate.gate_key]: { ...draft, summary: event.target.value },
                    }))
                  }
                  placeholder={t('delivery.gates.summaryPlaceholder')}
                />
                <select
                  value={draft.reportArtifactId}
                  disabled={immutable}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [gate.gate_key]: {
                        ...draft,
                        reportArtifactId: event.target.value,
                      },
                    }))
                  }
                  className="h-9 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 text-xs sm:col-span-2"
                  aria-label={t('delivery.gates.reportArtifact')}
                >
                  <option value="">{t('delivery.gates.noReport')}</option>
                  {detail.artifacts
                    .filter(
                      (artifact) =>
                        artifact.kind === 'qa_report' ||
                        artifact.kind === 'data_report' ||
                        artifact.kind === 'other',
                    )
                    .map((artifact) => (
                      <option key={artifact.id} value={artifact.id}>
                        {artifact.original_filename} ·{' '}
                        {formatArtifactRevision(artifact.revision, t)}
                      </option>
                    ))}
                </select>
                {draft.status === 'waived' && (
                  <Input
                    value={draft.waiver}
                    disabled={immutable}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [gate.gate_key]: { ...draft, waiver: event.target.value },
                      }))
                    }
                    placeholder={t('delivery.gates.waiverPlaceholder')}
                    className="sm:col-span-2"
                  />
                )}
                {draft.status === 'warning' && (
                  <label className="flex items-center gap-2 text-xs sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={draft.warning}
                      disabled={immutable}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [gate.gate_key]: { ...draft, warning: event.target.checked },
                        }))
                      }
                    />
                    {t('delivery.gates.acceptWarning')}
                  </label>
                )}
                {!immutable && (
                  <div className="flex justify-end sm:col-span-2">
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void onRun(
                          `gate:${gate.gate_key}`,
                          () =>
                            recordDeliveryGate(projectId, deliveryId, gate.gate_key, {
                              status: draft.status,
                              summary: draft.summary || null,
                              waiver_reason: draft.waiver || null,
                              warning_accepted: draft.warning,
                              report_artifact_id: draft.reportArtifactId || null,
                            }),
                          t('delivery.messages.gateRecorded'),
                        )
                      }
                    >
                      {t('delivery.actions.save')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function DeploymentsPanel(props: PanelProps) {
  const { detail, immutable, busy, onRun, projectId, deliveryId } = props;
  const { t } = useLanguage();
  const [deployId, setDeployId] = useState('');
  const [relation, setRelation] = useState<'candidate' | 'released' | 'rollback'>('released');

  return (
    <div className="space-y-4">
      {!immutable && (
        <SectionCard
          title={t('delivery.deployments.linkTitle')}
          description={t('delivery.deployments.linkDescription')}
        >
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void onRun(
                'deploy',
                () => linkDeliveryDeploy(projectId, deliveryId, deployId, relation),
                t('delivery.messages.deployLinked'),
              );
            }}
          >
            <Input
              value={deployId}
              onChange={(event) => setDeployId(event.target.value)}
              placeholder={t('delivery.deployments.deployIdPlaceholder')}
              required
            />
            <select
              value={relation}
              onChange={(event) =>
                setRelation(event.target.value as 'candidate' | 'released' | 'rollback')
              }
              className="h-9 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 text-xs"
            >
              <option value="candidate">{t('delivery.deployments.relation.candidate')}</option>
              <option value="released">{t('delivery.deployments.relation.released')}</option>
              <option value="rollback">{t('delivery.deployments.relation.rollback')}</option>
            </select>
            <Button type="submit" size="sm" disabled={!deployId.trim() || busy === 'deploy'}>
              <Link2 className="h-3.5 w-3.5" />
              {t('delivery.actions.link')}
            </Button>
          </form>
        </SectionCard>
      )}
      <SectionCard title={t('delivery.deployments.listTitle')}>
        {detail.deploy_links.length === 0 ? (
          <p className="text-xs text-[color:var(--ol-fg-muted)]">
            {t('delivery.deployments.empty')}
          </p>
        ) : (
          <div className="space-y-2">
            {detail.deploy_links.map((evidence) => (
              <div
                key={evidence.link.id}
                className="rounded-md border border-[color:var(--ol-border-subtle)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">{evidence.service.name}</span>
                    <span>
                      {evidence.environment
                        ? t(`delivery.deployments.environment.${evidence.environment.type}`)
                        : t('delivery.deployments.environment.unknown')}
                    </span>
                    <span>{t(`delivery.deployments.relation.${evidence.link.relation}`)}</span>
                    <span>{t(`delivery.deployments.status.${evidence.deploy.status}`)}</span>
                  </div>
                  {!immutable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void onRun(
                          `deploy-unlink:${evidence.deploy.id}`,
                          () => unlinkDeliveryDeploy(projectId, deliveryId, evidence.deploy.id),
                          t('delivery.messages.deployUnlinked'),
                        )
                      }
                    >
                      {t('delivery.actions.unlink')}
                    </Button>
                  )}
                </div>
                <p className="ol-mono mt-2 text-[10px] text-[color:var(--ol-fg-muted)]">
                  {evidence.deploy.id} ·{' '}
                  {evidence.deploy.commit_sha ?? t('delivery.deployments.noCommit')}
                </p>
              </div>
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
  previewSucceeded,
  onPreviewSucceeded,
  onRun,
  projectId,
  deliveryId,
}: {
  detail: DeliveryDetail;
  readiness: DeliveryReadiness | null;
  busy: string | null;
  previewSucceeded: boolean;
  onPreviewSucceeded: () => void;
  onRun: PanelProps['onRun'];
  projectId: string;
  deliveryId: string;
}) {
  const { t } = useLanguage();

  const preview = async () => {
    await onRun(
      'receipt:preview',
      async () => {
        const blob = await generateReceiptPreview(projectId, deliveryId);
        downloadBlob(blob, `${deliveryId}-receipt-preview.pdf`, true);
        onPreviewSucceeded();
      },
      t('delivery.messages.previewGenerated'),
    );
  };

  const finalized = detail.receipt !== null || detail.delivery.status === 'delivered';

  return (
    <div className="space-y-4">
      <SectionCard
        title={t('delivery.receipt.readinessTitle')}
        description={t('delivery.receipt.readinessDescription')}
      >
        {!readiness ? (
          <p className="text-xs text-[color:var(--ol-fg-muted)]">{t('delivery.loading')}</p>
        ) : (
          <div className="space-y-2">
            {readiness.checks.map((check) => (
              <div
                key={check.key}
                className="flex items-start gap-2 rounded-md border border-[color:var(--ol-border-subtle)] px-3 py-2"
              >
                {check.passed ? (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                ) : (
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                )}
                <span className="text-xs leading-5">
                  {formatReadinessCheck(check, detail.delivery.delivery_type, t)}
                </span>
              </div>
            ))}
            <p className="pt-1 text-[10px] text-[color:var(--ol-fg-muted)]">
              {t('delivery.receipt.pageEstimate', { count: readiness.estimated_pages })}
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard title={t('delivery.receipt.actionsTitle')}>
        <div className="flex flex-wrap gap-2">
          {!finalized && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={!readiness?.ready || busy !== null}
                onClick={() => void preview()}
              >
                <FileText className="h-3.5 w-3.5" />
                {t('delivery.actions.preview')}
              </Button>
              <Button
                size="sm"
                disabled={!readiness?.ready || !previewSucceeded || busy !== null}
                onClick={() =>
                  void onRun(
                    'receipt:finalize',
                    () => finalizeReceipt(projectId, deliveryId),
                    t('delivery.messages.finalized'),
                  )
                }
              >
                <PackageCheck className="h-3.5 w-3.5" />
                {t('delivery.actions.finalize')}
              </Button>
            </>
          )}
          {finalized && (
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void onRun('receipt:download', async () => {
                  const blob = await downloadReceipt(projectId, deliveryId);
                  downloadBlob(blob, `${deliveryId}-receipt.pdf`);
                })
              }
            >
              <Download className="h-3.5 w-3.5" />
              {t('delivery.actions.downloadReceipt')}
            </Button>
          )}
        </div>
        {!finalized && (
          <p className="mt-3 text-[10px] leading-4 text-[color:var(--ol-fg-muted)]">
            {t('delivery.receipt.finalizeWarning')}
          </p>
        )}
        {detail.receipt && (
          <div className="mt-4 rounded-md border border-success/30 bg-success/10 p-3 text-xs">
            <p className="font-medium">{t('delivery.receipt.finalizedTitle')}</p>
            <p className="ol-mono mt-1 text-[10px]">{detail.receipt.pdf_sha256}</p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
