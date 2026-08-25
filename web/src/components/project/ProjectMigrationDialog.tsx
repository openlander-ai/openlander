import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Loader2,
  PackageOpen,
  Play,
  XCircle,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/i18n/context';
import {
  getProjectMigration,
  getProjectMigrationPreflight,
  getProjectMigrationRehearsal,
  getProjectMigrationRunbook,
  startProjectMigrationRehearsal,
  type PostgresMigrationPreflight,
  type PostgresMigrationRehearsal,
  type PostgresMigrationRunbookBundle,
  type PostgresMigrationTarget,
  type ProjectMigrationBundle,
  type ProjectMigrationReadinessCheck,
} from '@/lib/api/projects';
import { localizeApiError } from '@/lib/localized-api-error';
import { cn } from '@/lib/utils';

interface ProjectMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
}

function safeFilenamePart(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  );
}

function timestampForFilename(value: string): string {
  return value.replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

function downloadText(filename: string, content: string, type: string): void {
  const href = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function readinessIcon(status: ProjectMigrationBundle['snapshot']['readiness']['status']) {
  if (status === 'ready') return CheckCircle2;
  if (status === 'blocked') return XCircle;
  return AlertTriangle;
}

function checkTone(level: ProjectMigrationReadinessCheck['level']): string {
  if (level === 'blocker') return 'text-[color:var(--ol-error)]';
  if (level === 'warning') return 'text-[color:var(--ol-warning)]';
  return 'text-[color:var(--ol-success)]';
}

function targetTone(status: 'compatible' | 'review_required' | 'blocked'): string {
  if (status === 'compatible') return 'text-[color:var(--ol-success)]';
  if (status === 'blocked') return 'text-[color:var(--ol-error)]';
  return 'text-[color:var(--ol-warning)]';
}

function formatBytes(value: number): string {
  if (value < 1024) return `${String(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let index = -1;
  do {
    amount /= 1024;
    index += 1;
  } while (amount >= 1024 && index < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[index]}`;
}

export function ProjectMigrationDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: ProjectMigrationDialogProps) {
  const { t } = useLanguage();
  const [bundle, setBundle] = useState<ProjectMigrationBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const [runbookTarget, setRunbookTarget] = useState<PostgresMigrationTarget>('aws_rds_postgresql');
  const [runbookServiceId, setRunbookServiceId] = useState('');
  const [runbookBundle, setRunbookBundle] = useState<PostgresMigrationRunbookBundle | null>(null);
  const [runbookLoading, setRunbookLoading] = useState(false);
  const [runbookError, setRunbookError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<PostgresMigrationPreflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [targetHost, setTargetHost] = useState('');
  const [targetPort, setTargetPort] = useState('5432');
  const [targetDatabase, setTargetDatabase] = useState('');
  const [targetUser, setTargetUser] = useState('');
  const [targetPassword, setTargetPassword] = useState('');
  const [confirmEmptyTarget, setConfirmEmptyTarget] = useState(false);
  const [rehearsal, setRehearsal] = useState<PostgresMigrationRehearsal | null>(null);
  const [rehearsalStarting, setRehearsalStarting] = useState(false);
  const [rehearsalError, setRehearsalError] = useState<string | null>(null);
  const [rehearsalPollVersion, setRehearsalPollVersion] = useState(0);

  useEffect(() => {
    setPreflight(null);
    setPreflightError(null);
    setRunbookBundle(null);
    setRunbookError(null);
    setRehearsal(null);
    setRehearsalError(null);
    setTargetHost('');
    setTargetPort('5432');
    setTargetDatabase('');
    setTargetUser('');
    setTargetPassword('');
    setConfirmEmptyTarget(false);
  }, [projectId]);

  useEffect(() => {
    if (!open || !projectId) return;
    let active = true;
    setLoading(true);
    setError(null);
    setBundle(null);
    setRunbookBundle(null);
    setRunbookError(null);
    setPreflightError(null);
    setRehearsalError(null);
    setTargetPassword('');
    setConfirmEmptyTarget(false);
    getProjectMigration(projectId)
      .then((result) => {
        if (active) setBundle(result);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(
          localizeApiError(reason, t, 'projectDetail.migration.loadError', 'common.apiError.codes'),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, projectId, requestVersion, t]);

  useEffect(() => {
    if (!open || !rehearsal || !['queued', 'running'].includes(rehearsal.status)) return;
    let active = true;
    const timer = window.setTimeout(() => {
      getProjectMigrationRehearsal(projectId, rehearsal.run_id)
        .then((next) => {
          if (active) {
            setRehearsalError(null);
            setRehearsal(next);
          }
        })
        .catch((reason: unknown) => {
          if (!active) return;
          setRehearsalError(
            localizeApiError(
              reason,
              t,
              'projectDetail.migration.rehearsal.statusError',
              'common.apiError.codes',
            ),
          );
        });
    }, 2_000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, projectId, rehearsal, rehearsalPollVersion, t]);

  const counts = useMemo(() => {
    const services = bundle?.snapshot.services ?? [];
    return {
      workloads: services.filter((service) =>
        ['git', 'image', 'compose', 'compose-child'].includes(service.kind),
      ).length,
      data: services.filter((service) =>
        ['postgres', 'mysql', 'redis', 'mongo', 'neo4j', 'minio'].includes(service.kind),
      ).length,
      volumes: bundle?.snapshot.volumes.length ?? 0,
      blockers:
        bundle?.snapshot.readiness.checks.filter((check) => check.level === 'blocker').length ?? 0,
      warnings:
        bundle?.snapshot.readiness.checks.filter((check) => check.level === 'warning').length ?? 0,
    };
  }, [bundle]);

  const serviceNames = useMemo(
    () => new Map(bundle?.snapshot.services.map((service) => [service.id, service.name]) ?? []),
    [bundle],
  );
  const postgresServices = useMemo(
    () =>
      (bundle?.snapshot.services ?? []).filter(
        (service) =>
          service.kind === 'postgres' &&
          service.ownership === 'project' &&
          service.archived_at === null,
      ),
    [bundle],
  );

  useEffect(() => {
    if (postgresServices.length === 1 && postgresServices[0]) {
      setRunbookServiceId(postgresServices[0].id);
      return;
    }
    setRunbookServiceId('');
  }, [postgresServices]);

  const generateRunbook = async () => {
    if (!runbookServiceId) return;
    setRunbookLoading(true);
    setRunbookError(null);
    setRunbookBundle(null);
    try {
      setRunbookBundle(
        await getProjectMigrationRunbook(projectId, runbookTarget, runbookServiceId),
      );
    } catch (reason: unknown) {
      setRunbookError(
        localizeApiError(
          reason,
          t,
          'projectDetail.migration.runbook.loadError',
          'common.apiError.codes',
        ),
      );
    } finally {
      setRunbookLoading(false);
    }
  };

  const inspectPostgres = async () => {
    if (!runbookServiceId) return;
    setPreflightLoading(true);
    setPreflightError(null);
    setPreflight(null);
    setRehearsal(null);
    setRehearsalError(null);
    try {
      setPreflight(await getProjectMigrationPreflight(projectId, runbookServiceId));
    } catch (reason: unknown) {
      setPreflightError(
        localizeApiError(
          reason,
          t,
          'projectDetail.migration.preflight.loadError',
          'common.apiError.codes',
        ),
      );
    } finally {
      setPreflightLoading(false);
    }
  };

  const startRehearsal = async () => {
    const port = Number(targetPort);
    if (
      !runbookServiceId ||
      !preflight ||
      !targetHost.trim() ||
      !Number.isInteger(port) ||
      !targetDatabase.trim() ||
      !targetUser.trim() ||
      !targetPassword ||
      !confirmEmptyTarget
    ) {
      return;
    }
    setRehearsalStarting(true);
    setRehearsalError(null);
    try {
      const next = await startProjectMigrationRehearsal(projectId, {
        service_id: runbookServiceId,
        target: {
          provider: runbookTarget,
          host: targetHost.trim(),
          port,
          database: targetDatabase.trim(),
          user: targetUser.trim(),
          password: targetPassword,
          ssl_mode: 'require',
          confirm_empty_target: true,
        },
      });
      setRehearsal(next);
      setTargetPassword('');
      setConfirmEmptyTarget(false);
    } catch (reason: unknown) {
      setRehearsalError(
        localizeApiError(
          reason,
          t,
          'projectDetail.migration.rehearsal.startError',
          'common.apiError.codes',
        ),
      );
    } finally {
      setRehearsalStarting(false);
    }
  };

  const downloadJson = () => {
    if (!bundle) return;
    const project = safeFilenamePart(projectName);
    const timestamp = timestampForFilename(bundle.snapshot.generated_at);
    downloadText(
      `${project}-migration-${timestamp}.json`,
      `${JSON.stringify(bundle.snapshot, null, 2)}\n`,
      'application/json;charset=utf-8',
    );
  };
  const downloadMarkdown = () => {
    if (!bundle) return;
    const project = safeFilenamePart(projectName);
    const timestamp = timestampForFilename(bundle.snapshot.generated_at);
    downloadText(
      `${project}-MIGRATION-${timestamp}.md`,
      bundle.document_markdown,
      'text/markdown;charset=utf-8',
    );
  };
  const downloadTargets = () => {
    if (!bundle) return;
    const project = safeFilenamePart(projectName);
    const timestamp = timestampForFilename(bundle.snapshot.generated_at);
    downloadText(
      `${project}-TARGETS-${timestamp}.md`,
      bundle.target_document_markdown,
      'text/markdown;charset=utf-8',
    );
  };
  const downloadRunbookJson = () => {
    if (!runbookBundle) return;
    const project = safeFilenamePart(projectName);
    const timestamp = timestampForFilename(runbookBundle.runbook.generated_at);
    downloadText(
      `${project}-postgres-migration-runbook-${timestamp}.json`,
      `${JSON.stringify(runbookBundle.runbook, null, 2)}\n`,
      'application/json;charset=utf-8',
    );
  };
  const downloadRunbookMarkdown = () => {
    if (!runbookBundle) return;
    const project = safeFilenamePart(projectName);
    const timestamp = timestampForFilename(runbookBundle.runbook.generated_at);
    downloadText(
      `${project}-RUNBOOK-${timestamp}.md`,
      runbookBundle.document_markdown,
      'text/markdown;charset=utf-8',
    );
  };

  const ReadinessIcon = bundle ? readinessIcon(bundle.snapshot.readiness.status) : PackageOpen;
  const issues = bundle?.snapshot.readiness.checks.filter((check) => check.level !== 'pass') ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="h-4 w-4" />
            {t('projectDetail.migration.title')}
          </DialogTitle>
          <DialogDescription>{t('projectDetail.migration.description')}</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-[color:var(--ol-fg-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('projectDetail.migration.loading')}
          </div>
        )}

        {!loading && error && (
          <div className="rounded-md border border-[color:var(--ol-error)]/30 bg-[color:var(--ol-error-soft)] p-4 text-sm">
            <p className="text-[color:var(--ol-error)]">{error}</p>
            <button
              type="button"
              onClick={() => setRequestVersion((version) => version + 1)}
              className="mt-3 rounded-md border border-[color:var(--ol-border)] px-3 py-1.5 text-xs font-medium hover:border-[color:var(--ol-border-strong)]"
            >
              {t('projectDetail.migration.retry')}
            </button>
          </div>
        )}

        {!loading && bundle && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] p-3">
              <div className="flex items-center gap-2">
                <ReadinessIcon
                  className={cn(
                    'h-5 w-5',
                    bundle.snapshot.readiness.status === 'ready'
                      ? 'text-[color:var(--ol-success)]'
                      : bundle.snapshot.readiness.status === 'blocked'
                        ? 'text-[color:var(--ol-error)]'
                        : 'text-[color:var(--ol-warning)]',
                  )}
                />
                <div>
                  <p className="text-sm font-semibold text-[color:var(--ol-fg)]">
                    {t(`projectDetail.migration.status.${bundle.snapshot.readiness.status}`)}
                  </p>
                  <p className="text-xs text-[color:var(--ol-fg-subtle)]">
                    {t('projectDetail.migration.runtime', {
                      status: t(
                        `projectDetail.migration.runtimeStatus.${bundle.snapshot.runtime_inspection.status}`,
                      ),
                    })}
                  </p>
                  <p className="text-xs text-[color:var(--ol-fg-subtle)]">
                    {t('projectDetail.migration.runtimeObserved', {
                      count: bundle.snapshot.runtime_inspection.container_count,
                    })}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-5">
                {(['workloads', 'data', 'volumes', 'blockers', 'warnings'] as const).map((key) => (
                  <div key={key}>
                    <p className="text-sm font-semibold tabular-nums">{counts[key]}</p>
                    <p className="text-[10px] text-[color:var(--ol-fg-subtle)]">
                      {t(`projectDetail.migration.counts.${key}`)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {bundle.snapshot.services.length === 0 && (
              <p className="rounded-md border border-[color:var(--ol-warning)]/30 bg-[color:var(--ol-warning-soft)] p-3 text-xs text-[color:var(--ol-warning)]">
                {t('projectDetail.migration.empty')}
              </p>
            )}

            {issues.length > 0 && (
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-[color:var(--ol-border)] p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
                  {t('projectDetail.migration.findings')}
                </p>
                {issues.map((check, index) => (
                  <div
                    key={`${check.code}:${check.service_id ?? ''}:${String(index)}`}
                    className="text-xs"
                  >
                    <p className="text-[color:var(--ol-fg-muted)]">
                      {(() => {
                        const key = `projectDetail.migration.checks.${check.code}`;
                        const localized = t(key);
                        return localized === key ? check.message : localized;
                      })()}
                    </p>
                    <p className={cn('mt-0.5 font-mono text-[10px]', checkTone(check.level))}>
                      {check.code}
                      {check.service_id
                        ? ` · ${serviceNames.get(check.service_id) ?? check.service_id}`
                        : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
                {t('projectDetail.migration.targets.title')}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {bundle.target_comparison.targets.map((target) => (
                  <div
                    key={target.id}
                    className="rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[color:var(--ol-fg)]">
                        {target.display_name}
                      </p>
                      <span className={cn('text-[10px] font-semibold', targetTone(target.status))}>
                        {t(`projectDetail.migration.targets.status.${target.status}`)}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] text-[color:var(--ol-fg-subtle)]">
                      {t('projectDetail.migration.targets.summary', {
                        services: target.summary.mapped_service_count,
                        reviews: target.summary.manual_review_count,
                        blockers: target.summary.blocker_count,
                      })}
                    </p>
                    <div className="mt-2 space-y-1">
                      {target.resource_mappings.slice(0, 4).map((mapping) => (
                        <p
                          key={mapping.source_service_id}
                          className="truncate text-[10px] text-[color:var(--ol-fg-muted)]"
                          title={`${mapping.source_service_name} → ${mapping.target_resource_name}`}
                        >
                          {mapping.source_service_name} → {mapping.target_resource_name}
                        </p>
                      ))}
                      {target.resource_mappings.length > 4 && (
                        <p className="text-[10px] text-[color:var(--ol-fg-subtle)]">
                          {t('projectDetail.migration.targets.more', {
                            count: target.resource_mappings.length - 4,
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[color:var(--ol-fg-subtle)]">
                {t('projectDetail.migration.targets.disclaimer')}
              </p>
            </div>

            <div className="space-y-3 rounded-md border border-[color:var(--ol-border)] p-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--ol-fg-subtle)]">
                    {t('projectDetail.migration.runbook.title')}
                  </p>
                  <p className="text-[10px] text-[color:var(--ol-fg-muted)]">
                    {t('projectDetail.migration.runbook.description')}
                  </p>
                </div>
              </div>

              {postgresServices.length === 0 ? (
                <p className="rounded-md bg-[color:var(--ol-panel-2)] p-3 text-xs text-[color:var(--ol-fg-muted)]">
                  {t('projectDetail.migration.runbook.empty')}
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
                  <label className="space-y-1 text-[10px] text-[color:var(--ol-fg-subtle)]">
                    <span>{t('projectDetail.migration.runbook.database')}</span>
                    <select
                      value={runbookServiceId}
                      onChange={(event) => {
                        setRunbookServiceId(event.target.value);
                        setRunbookBundle(null);
                        setPreflight(null);
                        setPreflightError(null);
                        setRehearsal(null);
                        setRehearsalError(null);
                      }}
                      className="h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-2 text-xs text-[color:var(--ol-fg)]"
                    >
                      {postgresServices.length > 1 && (
                        <option value="">
                          {t('projectDetail.migration.runbook.selectDatabase')}
                        </option>
                      )}
                      {postgresServices.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-[10px] text-[color:var(--ol-fg-subtle)]">
                    <span>{t('projectDetail.migration.runbook.target')}</span>
                    <select
                      value={runbookTarget}
                      onChange={(event) => {
                        setRunbookTarget(event.target.value as PostgresMigrationTarget);
                        setRunbookBundle(null);
                        setRehearsal(null);
                        setRehearsalError(null);
                      }}
                      className="h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-2 text-xs text-[color:var(--ol-fg)]"
                    >
                      <option value="aws_rds_postgresql">
                        {t('projectDetail.migration.runbook.targets.aws_rds_postgresql')}
                      </option>
                      <option value="gcp_cloud_sql_postgresql">
                        {t('projectDetail.migration.runbook.targets.gcp_cloud_sql_postgresql')}
                      </option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void generateRunbook()}
                    disabled={!runbookServiceId || runbookLoading}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[color:var(--ol-primary)] px-3 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {runbookLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {runbookLoading
                      ? t('projectDetail.migration.runbook.generating')
                      : t('projectDetail.migration.runbook.generate')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void inspectPostgres()}
                    disabled={!runbookServiceId || preflightLoading}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[color:var(--ol-border)] px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {preflightLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {preflightLoading
                      ? t('projectDetail.migration.preflight.inspecting')
                      : t('projectDetail.migration.preflight.inspect')}
                  </button>
                </div>
              )}

              {runbookError && (
                <p className="text-xs text-[color:var(--ol-error)]">{runbookError}</p>
              )}
              {preflightError && (
                <p className="text-xs text-[color:var(--ol-error)]">{preflightError}</p>
              )}

              {runbookBundle && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-[color:var(--ol-panel-2)] p-3">
                  <div>
                    <p
                      className={cn(
                        'text-xs font-semibold',
                        runbookBundle.runbook.readiness.status === 'blocked'
                          ? 'text-[color:var(--ol-error)]'
                          : 'text-[color:var(--ol-warning)]',
                      )}
                    >
                      {t(
                        `projectDetail.migration.runbook.status.${runbookBundle.runbook.readiness.status}`,
                      )}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[color:var(--ol-fg-muted)]">
                      {t('projectDetail.migration.runbook.summary', {
                        phases: runbookBundle.runbook.phases.length,
                        inputs: runbookBundle.runbook.required_inputs.length,
                      })}
                    </p>
                    <p className="text-[10px] text-[color:var(--ol-warning)]">
                      {t('projectDetail.migration.runbook.writeFreeze')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={downloadRunbookJson}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--ol-border)] px-2.5 py-1.5 text-[10px] font-medium"
                    >
                      <Download className="h-3 w-3" />
                      {t('projectDetail.migration.runbook.downloadJson')}
                    </button>
                    <button
                      type="button"
                      onClick={downloadRunbookMarkdown}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--ol-border)] px-2.5 py-1.5 text-[10px] font-medium"
                    >
                      <Download className="h-3 w-3" />
                      {t('projectDetail.migration.runbook.downloadMarkdown')}
                    </button>
                  </div>
                </div>
              )}

              {preflight && (
                <div className="space-y-2 rounded-md border border-[color:var(--ol-success)]/30 bg-[color:var(--ol-success-soft)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[color:var(--ol-success)]">
                      {t('projectDetail.migration.preflight.ready')}
                    </p>
                    <span className="font-mono text-[10px] text-[color:var(--ol-fg-subtle)]">
                      PostgreSQL {preflight.metadata.server_major_version}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
                    <div>
                      <p className="text-[color:var(--ol-fg-subtle)]">
                        {t('projectDetail.migration.preflight.size')}
                      </p>
                      <p className="font-semibold text-[color:var(--ol-fg)]">
                        {formatBytes(preflight.metadata.database_size_bytes)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[color:var(--ol-fg-subtle)]">
                        {t('projectDetail.migration.preflight.tables')}
                      </p>
                      <p className="font-semibold text-[color:var(--ol-fg)]">
                        {preflight.metadata.table_count}
                      </p>
                    </div>
                    <div>
                      <p className="text-[color:var(--ol-fg-subtle)]">
                        {t('projectDetail.migration.preflight.sequences')}
                      </p>
                      <p className="font-semibold text-[color:var(--ol-fg)]">
                        {preflight.metadata.sequence_count}
                      </p>
                    </div>
                    <div>
                      <p className="text-[color:var(--ol-fg-subtle)]">
                        {t('projectDetail.migration.preflight.extensions')}
                      </p>
                      <p className="font-semibold text-[color:var(--ol-fg)]">
                        {preflight.metadata.extensions.length}
                      </p>
                    </div>
                  </div>
                  <p className="text-[10px] text-[color:var(--ol-fg-muted)]">
                    {t('projectDetail.migration.preflight.readOnly')}
                  </p>
                </div>
              )}

              {preflight && (
                <div className="space-y-3 rounded-md border border-[color:var(--ol-warning)]/30 p-3">
                  <div>
                    <p className="text-xs font-semibold text-[color:var(--ol-fg)]">
                      {t('projectDetail.migration.rehearsal.title')}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[color:var(--ol-fg-muted)]">
                      {t('projectDetail.migration.rehearsal.description')}
                    </p>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1 text-[10px] text-[color:var(--ol-fg-subtle)]">
                      <span>{t('projectDetail.migration.rehearsal.host')}</span>
                      <input
                        value={targetHost}
                        onChange={(event) => setTargetHost(event.target.value)}
                        placeholder={t('projectDetail.migration.rehearsal.hostPlaceholder')}
                        autoComplete="off"
                        className="h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-2 text-xs text-[color:var(--ol-fg)]"
                      />
                    </label>
                    <label className="space-y-1 text-[10px] text-[color:var(--ol-fg-subtle)]">
                      <span>{t('projectDetail.migration.rehearsal.port')}</span>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        value={targetPort}
                        onChange={(event) => setTargetPort(event.target.value)}
                        className="h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-2 text-xs text-[color:var(--ol-fg)]"
                      />
                    </label>
                    <label className="space-y-1 text-[10px] text-[color:var(--ol-fg-subtle)]">
                      <span>{t('projectDetail.migration.rehearsal.database')}</span>
                      <input
                        value={targetDatabase}
                        onChange={(event) => setTargetDatabase(event.target.value)}
                        autoComplete="off"
                        className="h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-2 text-xs text-[color:var(--ol-fg)]"
                      />
                    </label>
                    <label className="space-y-1 text-[10px] text-[color:var(--ol-fg-subtle)]">
                      <span>{t('projectDetail.migration.rehearsal.user')}</span>
                      <input
                        value={targetUser}
                        onChange={(event) => setTargetUser(event.target.value)}
                        autoComplete="off"
                        className="h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-2 text-xs text-[color:var(--ol-fg)]"
                      />
                    </label>
                    <label className="space-y-1 text-[10px] text-[color:var(--ol-fg-subtle)] sm:col-span-2">
                      <span>{t('projectDetail.migration.rehearsal.password')}</span>
                      <input
                        type="password"
                        value={targetPassword}
                        onChange={(event) => setTargetPassword(event.target.value)}
                        autoComplete="new-password"
                        className="h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-2 text-xs text-[color:var(--ol-fg)]"
                      />
                    </label>
                  </div>

                  <label className="flex items-start gap-2 text-[10px] text-[color:var(--ol-warning)]">
                    <input
                      type="checkbox"
                      checked={confirmEmptyTarget}
                      onChange={(event) => setConfirmEmptyTarget(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>{t('projectDetail.migration.rehearsal.confirmEmpty')}</span>
                  </label>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] text-[color:var(--ol-fg-subtle)]">
                      {t('projectDetail.migration.rehearsal.credentialPolicy')}
                    </p>
                    <button
                      type="button"
                      onClick={() => void startRehearsal()}
                      disabled={
                        rehearsalStarting ||
                        ['queued', 'running'].includes(rehearsal?.status ?? '') ||
                        !targetHost.trim() ||
                        !targetDatabase.trim() ||
                        !targetUser.trim() ||
                        !targetPassword ||
                        !confirmEmptyTarget
                      }
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[color:var(--ol-warning)] px-3 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {rehearsalStarting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {rehearsalStarting
                        ? t('projectDetail.migration.rehearsal.starting')
                        : t('projectDetail.migration.rehearsal.start')}
                    </button>
                  </div>

                  {rehearsalError && (
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-[color:var(--ol-error)]">{rehearsalError}</p>
                      {rehearsal && ['queued', 'running'].includes(rehearsal.status) && (
                        <button
                          type="button"
                          onClick={() => {
                            setRehearsalError(null);
                            setRehearsalPollVersion((version) => version + 1);
                          }}
                          className="rounded-md border border-[color:var(--ol-border)] px-2 py-1 text-[10px] font-medium"
                        >
                          {t('projectDetail.migration.rehearsal.retryStatus')}
                        </button>
                      )}
                    </div>
                  )}
                  {rehearsal && (
                    <div className="rounded-md bg-[color:var(--ol-panel-2)] p-3">
                      <div className="flex items-center gap-2">
                        {['queued', 'running'].includes(rehearsal.status) && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        )}
                        <p
                          className={cn(
                            'text-xs font-semibold',
                            rehearsal.status === 'succeeded'
                              ? 'text-[color:var(--ol-success)]'
                              : rehearsal.status === 'failed'
                                ? 'text-[color:var(--ol-error)]'
                                : 'text-[color:var(--ol-warning)]',
                          )}
                        >
                          {t(`projectDetail.migration.rehearsal.status.${rehearsal.status}`)}
                        </p>
                      </div>
                      <p className="mt-1 text-[10px] text-[color:var(--ol-fg-muted)]">
                        {t('projectDetail.migration.rehearsal.phaseLabel', {
                          phase: t(`projectDetail.migration.rehearsal.phase.${rehearsal.phase}`),
                        })}
                      </p>
                      {rehearsal.result && (
                        <p className="text-[10px] text-[color:var(--ol-fg-muted)]">
                          {t('projectDetail.migration.rehearsal.result', {
                            size: formatBytes(rehearsal.result.dump_size_bytes),
                            seconds: Math.ceil(rehearsal.result.duration_ms / 1000),
                          })}
                        </p>
                      )}
                      {rehearsal.error && (
                        <p className="mt-1 text-[10px] text-[color:var(--ol-error)]">
                          {t('projectDetail.migration.rehearsal.failedDetail', {
                            code: rehearsal.error.code,
                          })}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-[color:var(--ol-fg-subtle)]">
                        {t('projectDetail.migration.rehearsal.ephemeral')}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-md border border-[color:var(--ol-border)] p-3 text-xs text-[color:var(--ol-fg-muted)]">
              <p>{t('projectDetail.migration.noCloudChanges')}</p>
              <p className="mt-1">{t('projectDetail.migration.secretsExcluded')}</p>
            </div>
          </div>
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={downloadJson}
            disabled={!bundle || loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--ol-border)] px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {t('projectDetail.migration.downloadJson')}
          </button>
          <button
            type="button"
            onClick={downloadMarkdown}
            disabled={!bundle || loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--ol-primary)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {t('projectDetail.migration.downloadMarkdown')}
          </button>
          <button
            type="button"
            onClick={downloadTargets}
            disabled={!bundle || loading}
            className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--ol-primary)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {t('projectDetail.migration.downloadTargets')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
