import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Download,
  ExternalLink,
  FileText,
  FolderKanban,
  Loader2,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';

import { AgentGuideDialog } from '@/components/agent-guide';
import { OuterCard } from '@/components/Shell/OuterCard';
import { Button } from '@/components/ui/button';
import {
  getEngagement,
  engagementWeeklyReportUrl,
  listEngagementWeeklyReports,
  type EngagementActivity,
  type EngagementBlocker,
  type EngagementDetail,
  type EngagementRuntimeHealth,
  type EngagementWeeklyReport,
} from '@/lib/api/engagements';
import { formatRelativeTime } from '@/lib/time';
import { useLanguage } from '@/i18n/context';
import { localizeApiError } from '@/lib/localized-api-error';
import { cn } from '@/lib/utils';

type Translate = (key: string, params?: Record<string, string | number>) => string;

const ACTIVITY_TRANSLATION_KEYS: Readonly<Record<string, string>> = {
  'engagement:created': 'engagementCreated',
  'engagement:updated': 'engagementUpdated',
  'engagement:archived': 'engagementArchived',
  'engagement:unarchived': 'engagementUnarchived',
  'engagement:project_linked': 'projectLinked',
  'engagement:project_unlinked': 'projectUnlinked',
  'engagement.weekly_report_generated': 'weeklyReportGenerated',
  'engagement.weekly_report_published': 'weeklyReportPublished',
  'project.update_recorded': 'projectUpdateRecorded',
  'delivery.created': 'deliveryCreated',
  'delivery.updated': 'deliveryUpdated',
  'delivery.status_changed': 'deliveryStatusChanged',
  'delivery.artifact_uploaded': 'artifactUploaded',
  'delivery.artifact_attached': 'artifactAttached',
  'delivery.artifact_status_changed': 'artifactStatusChanged',
  'delivery.companion_pdf_linked': 'companionPdfLinked',
  'delivery.external_ref_added': 'externalRefAdded',
  'delivery.feedback_recorded': 'feedbackRecorded',
  'delivery.work_item_drafts_submitted': 'workItemDraftsSubmitted',
  'delivery.work_item_updated': 'workItemUpdated',
  'delivery.approval_recorded': 'approvalRecorded',
  'delivery.gate_template_updated': 'gateTemplateUpdated',
  'delivery.gate_recorded': 'gateRecorded',
  'delivery.review_accepted': 'reviewAccepted',
  'delivery.deploy_linked': 'deployLinked',
  'delivery.deploy_unlinked': 'deployUnlinked',
  'delivery.receipt_previewed': 'receiptPreviewed',
  'delivery.receipt_finalized': 'receiptFinalized',
  'delivery.settings_updated': 'settingsUpdated',
  'deploy:start': 'deployStarted',
  'deploy:clone': 'sourceCloneStarted',
  'deploy:build': 'imageBuildStarted',
  'deploy:run': 'applicationStartStarted',
  'deploy:success': 'deploySucceeded',
  'deploy:failed': 'deployFailed',
  'deploy:crash': 'deployCrashed',
  'deploy:rollback': 'rollbackStarted',
  'container:start': 'containerStarted',
  'container:stop': 'containerStopped',
  'container:remove': 'containerRemoved',
  'container:health': 'containerHealthChecked',
  'container:die': 'containerExited',
  'container:oom': 'containerOomKilled',
  'container:missing': 'containerMissing',
  'tunnel:start': 'tunnelStarted',
  'tunnel:stop': 'tunnelStopped',
  'tunnel:url': 'tunnelUrlReady',
  'env:set': 'environmentSet',
  'env:delete': 'environmentDeleted',
  'compose:start': 'composeStarted',
  'compose:up': 'composeReady',
  'compose:failed': 'composeFailed',
  'monitor:inactive': 'monitorInactive',
  'health:degraded': 'healthDegraded',
  'recovery:start': 'recoveryStarted',
  'recovery:success': 'recoverySucceeded',
  'recovery:failed': 'recoveryFailed',
  'recovery:exhausted': 'recoveryExhausted',
  'recovery:approval-needed': 'recoveryApprovalNeeded',
  'recovery:approval-auto-skipped': 'recoveryApprovalSkipped',
  'recovery:approval-resolved': 'recoveryApprovalResolved',
  'recovery:blocked': 'recoveryBlocked',
  'recovery:degraded': 'recoveryDegraded',
  'recovery:stopped': 'recoveryStopped',
  'recovery:started': 'automaticRecoveryStarted',
  'ai:invoked': 'aiDiagnosisStarted',
  'ai:completed': 'aiDiagnosisCompleted',
  'alert:new': 'alertCreated',
  'alert:resolved': 'alertResolved',
  'webhook:skipped': 'webhookSkipped',
};

function formatDefaultGateLabel(gateKey: string, label: string, t: Translate): string {
  if (gateKey === 'review' && label === 'Review') return t('delivery.gates.defaultLabel.review');
  if (gateKey === 'qa' && label === 'QA') return t('delivery.gates.defaultLabel.qa');
  if (gateKey === 'data' && label === 'Data') return t('delivery.gates.defaultLabel.data');
  return label;
}

function blockerContext(blocker: EngagementBlocker, t: Translate): string {
  const parts = [blocker.project_name, blocker.delivery_title];
  if (blocker.kind === 'required_gate_failed' || blocker.kind === 'warning_unacknowledged') {
    parts.push(formatDefaultGateLabel(blocker.metadata.gate_key, blocker.metadata.gate_label, t));
  } else if (blocker.kind === 'work_item_unresolved') {
    parts.push(blocker.metadata.work_item_title);
  }
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

function blockerDetail(blocker: EngagementBlocker, t: Translate): string {
  switch (blocker.kind) {
    case 'project_error':
      return t('engagements.blockerDetail.project_error', {
        count: blocker.metadata.error_service_count,
      });
    case 'revision_requested':
      return t('engagements.blockerDetail.revision_requested');
    case 'required_gate_failed':
      return (
        blocker.metadata.gate_summary?.trim() || t('engagements.blockerDetail.required_gate_failed')
      );
    case 'warning_unacknowledged':
      return (
        blocker.metadata.gate_summary?.trim() ||
        t('engagements.blockerDetail.warning_unacknowledged')
      );
    case 'work_item_unresolved':
      return (
        blocker.metadata.work_item_detail.trim() ||
        t(`engagements.blockerDetail.${blocker.metadata.work_item_kind}`)
      );
  }
}

function activityTitle(activity: EngagementActivity, t: Translate): string {
  const key = ACTIVITY_TRANSLATION_KEYS[activity.event_type];
  return key ? t(`engagements.activityEvent.${key}`) : t('engagements.activityEvent.unknown');
}

function healthClass(health: EngagementRuntimeHealth): string {
  if (health === 'healthy') return 'border-success/30 bg-success/10 text-success';
  if (health === 'degraded') return 'border-error/30 bg-error/10 text-error';
  return 'border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]';
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] p-4">
      <h2 className="text-sm font-semibold text-[color:var(--ol-fg)]">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-[color:var(--ol-fg-muted)]">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function blockerLabel(blocker: EngagementBlocker, t: (key: string) => string): string {
  return t(`engagements.blocker.${blocker.kind}`);
}

export function EngagementDetailPage() {
  const { engagementId = '' } = useParams<{ engagementId: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [engagement, setEngagement] = useState<EngagementDetail | null>(null);
  const [reports, setReports] = useState<EngagementWeeklyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentGuideOpen, setAgentGuideOpen] = useState(false);

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      try {
        const [nextEngagement, nextReports] = await Promise.all([
          getEngagement(engagementId),
          listEngagementWeeklyReports(engagementId),
        ]);
        setEngagement(nextEngagement);
        setReports(nextReports);
        setError(null);
      } catch (loadError) {
        setError(
          localizeApiError(
            loadError,
            t,
            'engagements.errors.loadDetail',
            'engagements.errors.codes',
          ),
        );
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [engagementId, t],
  );

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(false), 10_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const deliveriesByProject = useMemo(() => {
    const grouped = new Map<string, EngagementDetail['deliveries']>();
    for (const delivery of engagement?.deliveries ?? []) {
      const rows = grouped.get(delivery.project_id);
      if (rows) rows.push(delivery);
      else grouped.set(delivery.project_id, [delivery]);
    }
    return grouped;
  }, [engagement]);

  if (loading && !engagement) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 aria-label={t('engagements.loading')} className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!engagement) {
    return (
      <OuterCard title={t('engagements.notFound')} subtitle={error ?? ''}>
        <Button variant="outline" onClick={() => navigate('/engagements')}>
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('engagements.actions.back')}
        </Button>
      </OuterCard>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate('/engagements')}>
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('engagements.actions.back')}
      </Button>
      <OuterCard
        title={engagement.title}
        subtitle={`${engagement.customer_name}${engagement.summary ? ` · ${engagement.summary}` : ''}`}
        actions={
          <Button size="sm" onClick={() => setAgentGuideOpen(true)}>
            <Bot className="h-3.5 w-3.5" />
            {t('engagements.actions.askAgent')}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[color:var(--ol-border)] px-2 py-0.5 text-[10px]">
            {t(`engagements.status.${engagement.status}`)}
          </span>
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px]',
              healthClass(engagement.runtime_health),
            )}
          >
            {t(`engagements.health.${engagement.runtime_health}`)}
          </span>
          <span className="text-xs text-[color:var(--ol-fg-muted)]">
            {t('engagements.metrics.projects')}: {engagement.project_count} ·{' '}
            {t('engagements.metrics.deliveries')}: {engagement.delivery_summary.total} ·{' '}
            {t('engagements.metrics.blockers')}: {engagement.blocker_count}
          </span>
        </div>
      </OuterCard>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-error/30 bg-error/10 p-3 text-xs text-error"
        >
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title={t('engagements.sections.projects.title')}
          description={t('engagements.sections.projects.description')}
        >
          {engagement.projects.length === 0 ? (
            <p className="text-xs text-[color:var(--ol-fg-muted)]">
              {t('engagements.sections.projects.empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {engagement.projects.map((project) => (
                <li key={project.id}>
                  <Link
                    to={`/projects/${project.id}`}
                    className="flex items-center gap-3 rounded-md border border-[color:var(--ol-border-subtle)] p-3 hover:bg-[color:var(--ol-panel-2)]"
                  >
                    <FolderKanban className="h-4 w-4 text-[color:var(--ol-primary)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {project.display_name}
                      </span>
                      <span className="text-[11px] text-[color:var(--ol-fg-muted)]">
                        {t(`engagements.runtime.${project.runtime_status}`)} ·{' '}
                        {project.delivery_count} {t('engagements.metrics.deliveries')}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={t('engagements.sections.deliveries.title')}
          description={t('engagements.sections.deliveries.description')}
        >
          {engagement.deliveries.length === 0 ? (
            <p className="text-xs text-[color:var(--ol-fg-muted)]">
              {t('engagements.sections.deliveries.empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {engagement.projects.flatMap((project) =>
                (deliveriesByProject.get(project.id) ?? []).map((delivery) => (
                  <li key={delivery.id}>
                    <Link
                      to={`/projects/${delivery.project_id}/deliveries/${delivery.id}`}
                      className="flex justify-between rounded-md border border-[color:var(--ol-border-subtle)] p-3 hover:bg-[color:var(--ol-panel-2)]"
                    >
                      <span className="text-sm font-medium">{delivery.title}</span>
                      <span className="text-[11px] text-[color:var(--ol-fg-muted)]">
                        {t(`delivery.status.${delivery.status}`)}
                      </span>
                    </Link>
                  </li>
                )),
              )}
            </ul>
          )}
        </Section>

        <Section
          title={t('engagements.sections.blockers.title')}
          description={t('engagements.sections.blockers.description')}
        >
          {engagement.blockers.length === 0 ? (
            <p className="text-xs text-success">{t('engagements.sections.blockers.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {engagement.blockers.map((blocker) => (
                <li key={`${blocker.kind}-${blocker.resource_id}`}>
                  <Link
                    to={blocker.deep_link}
                    className="flex gap-3 rounded-md border border-error/20 bg-error/5 p-3 hover:bg-error/10"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-error">
                        {blockerLabel(blocker, t)}
                      </span>
                      <span className="mt-1 block text-[11px] text-[color:var(--ol-fg-muted)]">
                        {blockerContext(blocker, t)}
                      </span>
                      <span className="mt-1 block text-[11px] text-[color:var(--ol-fg-muted)]">
                        {blockerDetail(blocker, t)}
                      </span>
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[color:var(--ol-fg-muted)]" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={t('engagements.sections.activity.title')}
          description={t('engagements.sections.activity.description')}
        >
          {engagement.recent_activity.length === 0 ? (
            <p className="text-xs text-[color:var(--ol-fg-muted)]">
              {t('engagements.sections.activity.empty')}
            </p>
          ) : (
            <ol className="space-y-3">
              {engagement.recent_activity.map((activity) => {
                const content = (
                  <>
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--ol-primary)]" />
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-xs text-[color:var(--ol-fg)]">
                        {activityTitle(activity, t)}
                      </strong>
                      <span className="block text-[10px] text-[color:var(--ol-fg-muted)]">
                        {formatRelativeTime(activity.created_at, t)}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={activity.id}>
                    {activity.deep_link ? (
                      <Link
                        to={activity.deep_link}
                        className="flex gap-2 rounded-md p-1.5 hover:bg-[color:var(--ol-panel-2)]"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="flex gap-2 p-1.5">{content}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <div className="mt-4 border-t border-[color:var(--ol-border-subtle)] pt-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-[color:var(--ol-primary)]" />
              <h3 className="text-xs font-semibold">{t('engagements.reports.title')}</h3>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-[color:var(--ol-fg-muted)]">
              {t('engagements.reports.description')}
            </p>
            {reports.length === 0 ? (
              <p className="mt-3 text-xs text-[color:var(--ol-fg-muted)]">
                {t('engagements.reports.empty')}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {reports.map((report) => (
                  <li
                    key={report.id}
                    className="rounded-md border border-[color:var(--ol-border-subtle)] p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium">
                          {report.period_start} – {report.period_end} ·{' '}
                          {t('engagements.reports.revision', { revision: report.revision })}
                        </p>
                        <p className="ol-mono mt-1 break-all text-[9px] text-[color:var(--ol-fg-subtle)]">
                          evidence sha256:{report.evidence_sha256}
                        </p>
                      </div>
                      <span className="rounded-full border border-[color:var(--ol-border)] px-2 py-0.5 text-[10px]">
                        {t(`engagements.reports.status.${report.status}`)}
                      </span>
                    </div>
                    {report.status === 'published' && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(['internal', 'customer'] as const).map((audience) => (
                          <span key={audience} className="flex gap-1">
                            <Button asChild variant="outline" size="sm">
                              <a
                                href={engagementWeeklyReportUrl(engagement.id, report.id, audience)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                {t(`engagements.reports.audience.${audience}`)}
                              </a>
                            </Button>
                            <Button asChild variant="ghost" size="icon">
                              <a
                                href={engagementWeeklyReportUrl(
                                  engagement.id,
                                  report.id,
                                  audience,
                                  { download: true },
                                )}
                                aria-label={t('engagements.reports.download', {
                                  audience: t(`engagements.reports.audience.${audience}`),
                                })}
                              >
                                <Download className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      </div>

      <AgentGuideDialog
        open={agentGuideOpen}
        onOpenChange={setAgentGuideOpen}
        kind="manage-engagement"
        engagementName={engagement.title}
      />
    </div>
  );
}
