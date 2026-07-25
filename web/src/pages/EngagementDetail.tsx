import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BriefcaseBusiness,
  ExternalLink,
  Folder,
  Link2,
  Pencil,
  RotateCcw,
  Unlink,
} from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  archiveEngagement,
  getEngagement,
  linkEngagementProject,
  listUnassignedEngagementProjects,
  unarchiveEngagement,
  unlinkEngagementProject,
  updateEngagement,
  type EngagementDetail,
  type EngagementStatus,
  type UnassignedEngagementProject,
} from '@/lib/api/engagements';
import { formatRelativeTime } from '@/lib/time';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] p-4">
      <h2 className="text-sm font-semibold text-[color:var(--ol-fg)]">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-[color:var(--ol-fg-muted)]">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function EngagementDetailPage() {
  const { engagementId = '' } = useParams<{ engagementId: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [engagement, setEngagement] = useState<EngagementDetail | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedEngagementProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [editCustomer, setEditCustomer] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const [editStatus, setEditStatus] = useState<Exclude<EngagementStatus, 'archived'>>('active');
  const [selectedProject, setSelectedProject] = useState('');
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const linkButtonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      try {
        const [detail, projects] = await Promise.all([
          getEngagement(engagementId),
          listUnassignedEngagementProjects(),
        ]);
        setEngagement(detail);
        setUnassigned(projects);
        setError(null);
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : t('engagements.errors.loadDetail'),
        );
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [engagementId, t],
  );

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      void load(false);
    }, 10_000);
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

  function openEdit() {
    if (!engagement || engagement.status === 'archived') return;
    setEditCustomer(engagement.customer_name);
    setEditTitle(engagement.title);
    setEditSummary(engagement.summary);
    setEditStatus(engagement.status);
    setEditError(null);
    setEditOpen(true);
  }

  async function handleEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setEditError(null);
    try {
      setEngagement(
        await updateEngagement(engagementId, {
          customer_name: editCustomer,
          title: editTitle,
          summary: editSummary,
          status: editStatus,
        }),
      );
      setEditOpen(false);
    } catch (updateError) {
      setEditError(
        updateError instanceof Error ? updateError.message : t('engagements.errors.update'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleArchiveToggle() {
    if (!engagement) return;
    setBusy(true);
    setError(null);
    try {
      setEngagement(
        engagement.status === 'archived'
          ? await unarchiveEngagement(engagementId)
          : await archiveEngagement(engagementId),
      );
    } catch (archiveError) {
      setError(
        archiveError instanceof Error ? archiveError.message : t('engagements.errors.archive'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProject) return;
    setBusy(true);
    setLinkError(null);
    try {
      setEngagement(await linkEngagementProject(engagementId, selectedProject));
      setUnassigned((projects) => projects.filter((project) => project.id !== selectedProject));
      setSelectedProject('');
      setLinkOpen(false);
    } catch (linkError) {
      setLinkError(linkError instanceof Error ? linkError.message : t('engagements.errors.link'));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink(projectId: string) {
    setBusy(true);
    setError(null);
    try {
      await unlinkEngagementProject(engagementId, projectId);
      await load();
    } catch (unlinkError) {
      setError(unlinkError instanceof Error ? unlinkError.message : t('engagements.errors.unlink'));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !engagement) {
    return (
      <div
        className="mx-auto h-64 w-full max-w-6xl animate-pulse rounded-lg bg-[color:var(--ol-panel-2)]"
        aria-label={t('engagements.loading')}
      />
    );
  }

  if (!engagement) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <OuterCard
          title={t('engagements.notFound')}
          subtitle={error ?? t('engagements.errors.loadDetail')}
        >
          <Button variant="outline" onClick={() => navigate('/engagements')}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            {t('engagements.actions.back')}
          </Button>
        </OuterCard>
      </div>
    );
  }

  const archived = engagement.status === 'archived';

  return (
    <div className="mx-auto flex min-w-0 w-full max-w-6xl flex-col gap-4">
      <button
        type="button"
        onClick={() => navigate('/engagements')}
        className="flex w-fit items-center gap-1.5 text-xs text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('engagements.actions.back')}
      </button>

      <OuterCard
        title={
          <span className="flex flex-wrap items-center gap-2">
            <BriefcaseBusiness className="h-5 w-5 text-[color:var(--ol-primary)]" />
            <span>{engagement.title}</span>
            <span className="rounded-full border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--ol-fg-muted)]">
              {t(`engagements.status.${engagement.status}`)}
            </span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                engagement.runtime_health === 'healthy' &&
                  'bg-success/10 text-[color:var(--ol-fg)]',
                engagement.runtime_health === 'degraded' && 'bg-error/10 text-error',
                engagement.runtime_health === 'unknown' &&
                  'bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]',
              )}
            >
              {t(`engagements.health.${engagement.runtime_health}`)}
            </span>
          </span>
        }
        subtitle={`${engagement.customer_name}${engagement.summary ? ` · ${engagement.summary}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              ref={editButtonRef}
              size="sm"
              variant="outline"
              onClick={openEdit}
              disabled={archived || busy}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              {t('engagements.actions.edit')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleArchiveToggle()}
              disabled={busy}
            >
              {archived ? (
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Archive className="mr-1.5 h-3.5 w-3.5" />
              )}
              {t(archived ? 'engagements.actions.unarchive' : 'engagements.actions.archive')}
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['projects', engagement.project_count],
            ['deliveries', engagement.delivery_summary.total],
            ['blockerDeliveries', engagement.delivery_summary.blocker_count],
            ['blockers', engagement.blocker_count],
          ].map(([key, value]) => (
            <div key={String(key)} className="rounded-md bg-[color:var(--ol-panel-2)] px-3 py-2">
              <strong className="block text-lg text-[color:var(--ol-fg)]">{value}</strong>
              <span className="text-[10px] text-[color:var(--ol-fg-muted)]">
                {t(`engagements.metrics.${String(key)}`)}
              </span>
            </div>
          ))}
        </div>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
          >
            {error}
          </p>
        )}
      </OuterCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title={t('engagements.sections.projects.title')}
          description={t('engagements.sections.projects.description')}
        >
          <div className="mb-3 flex justify-end">
            <Button
              ref={linkButtonRef}
              size="sm"
              variant="outline"
              disabled={archived || unassigned.length === 0}
              onClick={() => {
                setLinkError(null);
                setLinkOpen(true);
              }}
            >
              <Link2 className="mr-1.5 h-3.5 w-3.5" />
              {t('engagements.actions.linkProject')}
            </Button>
          </div>
          {!archived && unassigned.length === 0 && (
            <p className="mb-3 text-right text-xs text-[color:var(--ol-fg-muted)]">
              {t('engagements.link.noUnassigned')}
            </p>
          )}
          {engagement.projects.length === 0 ? (
            <p className="py-6 text-center text-xs text-[color:var(--ol-fg-muted)]">
              {t('engagements.sections.projects.empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {engagement.projects.map((project) => (
                <li
                  key={project.id}
                  className="flex items-center gap-3 rounded-md border border-[color:var(--ol-border-subtle)] p-3"
                >
                  <Folder className="h-4 w-4 shrink-0 text-[color:var(--ol-primary)]" />
                  <Link to={`/projects/${project.id}`} className="min-w-0 flex-1 hover:underline">
                    <strong className="block truncate text-xs text-[color:var(--ol-fg)]">
                      {project.display_name}
                    </strong>
                    <span className="text-[10px] text-[color:var(--ol-fg-muted)]">
                      {t(`engagements.runtime.${project.runtime_status}`)} ·{' '}
                      {t('engagements.projectDeliveryCount', {
                        count: project.delivery_count,
                      })}
                    </span>
                  </Link>
                  {project.blocker_count > 0 && (
                    <span className="text-[10px] font-medium text-error">
                      {t('engagements.blockerCount', { count: project.blocker_count })}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={archived || busy}
                    onClick={() => void handleUnlink(project.id)}
                    aria-label={t('engagements.actions.unlinkProjectAria', {
                      project: project.display_name,
                    })}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded text-[color:var(--ol-fg-muted)] hover:bg-[color:var(--ol-panel-2)] hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ol-primary)] disabled:opacity-40"
                  >
                    <Unlink className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={t('engagements.sections.deliveries.title')}
          description={t('engagements.sections.deliveries.description')}
        >
          {engagement.projects.length === 0 ? (
            <p className="py-6 text-center text-xs text-[color:var(--ol-fg-muted)]">
              {t('engagements.sections.deliveries.empty')}
            </p>
          ) : (
            <div className="space-y-4">
              {engagement.projects.map((project) => {
                const deliveries = deliveriesByProject.get(project.id) ?? [];
                return (
                  <div key={project.id}>
                    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--ol-fg-muted)]">
                      {project.display_name}
                    </h3>
                    {deliveries.length === 0 ? (
                      <p className="text-xs text-[color:var(--ol-fg-muted)]">
                        {t('engagements.sections.deliveries.noneForProject')}
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {deliveries.map((delivery) => (
                          <li key={delivery.id}>
                            <Link
                              to={`/projects/${delivery.project_id}/deliveries/${delivery.id}`}
                              className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--ol-border-subtle)] px-3 py-2 hover:bg-[color:var(--ol-panel-2)]"
                            >
                              <span className="min-w-0">
                                <strong className="block truncate text-xs text-[color:var(--ol-fg)]">
                                  {delivery.title}
                                </strong>
                                <span className="text-[10px] text-[color:var(--ol-fg-muted)]">
                                  {t(`delivery.maturity.${delivery.maturity}`)} ·{' '}
                                  {t(`delivery.status.${delivery.status}`)}
                                </span>
                              </span>
                              {delivery.blocker_count > 0 && (
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-error" />
                              )}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title={t('engagements.sections.blockers.title')}
          description={t('engagements.sections.blockers.description')}
        >
          {engagement.blockers.length === 0 ? (
            <p className="py-6 text-center text-xs text-[color:var(--ol-fg-muted)]">
              {t('engagements.sections.blockers.empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {engagement.blockers.map((blocker) => (
                <li key={`${blocker.kind}:${blocker.resource_id}`}>
                  <Link
                    to={blocker.deep_link}
                    className="flex gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 hover:bg-warning/15"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
                    <span className="min-w-0 flex-1">
                      <strong className="block text-xs text-[color:var(--ol-fg)]">
                        {t(`engagements.blocker.${blocker.kind}`)}
                      </strong>
                      <span className="mt-0.5 block text-[10px] text-[color:var(--ol-fg-muted)]">
                        {blocker.project_name}
                        {blocker.delivery_title ? ` · ${blocker.delivery_title}` : ''}
                        {blocker.title ? ` · ${blocker.title}` : ''}
                      </span>
                      <span className="mt-1 block text-[10px] text-[color:var(--ol-fg-muted)]">
                        {blocker.detail}
                      </span>
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[color:var(--ol-fg-muted)]" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={t('engagements.sections.activity.title')}
          description={t('engagements.sections.activity.description')}
        >
          {engagement.recent_activity.length === 0 ? (
            <p className="py-6 text-center text-xs text-[color:var(--ol-fg-muted)]">
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
                        {activity.title}
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
        </SectionCard>
      </div>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditError(null);
        }}
      >
        <DialogContent closeLabel={t('engagements.actions.close')} returnFocusRef={editButtonRef}>
          <DialogHeader>
            <DialogTitle>{t('engagements.edit.title')}</DialogTitle>
            <DialogDescription>{t('engagements.edit.description')}</DialogDescription>
          </DialogHeader>
          <form className="mt-4 space-y-4" onSubmit={handleEdit}>
            <div className="space-y-1.5">
              <Label htmlFor="edit-engagement-customer">{t('engagements.fields.customer')}</Label>
              <Input
                id="edit-engagement-customer"
                value={editCustomer}
                onChange={(event) => setEditCustomer(event.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-engagement-title">{t('engagements.fields.title')}</Label>
              <Input
                id="edit-engagement-title"
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                maxLength={200}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-engagement-status">{t('engagements.fields.status')}</Label>
              <select
                id="edit-engagement-status"
                value={editStatus}
                onChange={(event) =>
                  setEditStatus(event.target.value as Exclude<EngagementStatus, 'archived'>)
                }
                className="w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 py-2 text-sm"
              >
                <option value="active">{t('engagements.status.active')}</option>
                <option value="on_hold">{t('engagements.status.on_hold')}</option>
                <option value="completed">{t('engagements.status.completed')}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-engagement-summary">{t('engagements.fields.summary')}</Label>
              <textarea
                id="edit-engagement-summary"
                value={editSummary}
                onChange={(event) => setEditSummary(event.target.value)}
                maxLength={4000}
                rows={4}
                className="w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 py-2 text-sm"
              />
            </div>
            {editError && (
              <p role="alert" className="text-xs text-error">
                {editError}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                {t('engagements.actions.cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('engagements.actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={linkOpen}
        onOpenChange={(open) => {
          setLinkOpen(open);
          if (!open) setLinkError(null);
        }}
      >
        <DialogContent closeLabel={t('engagements.actions.close')} returnFocusRef={linkButtonRef}>
          <DialogHeader>
            <DialogTitle>{t('engagements.link.title')}</DialogTitle>
            <DialogDescription>{t('engagements.link.description')}</DialogDescription>
          </DialogHeader>
          <form className="mt-4 space-y-4" onSubmit={handleLink}>
            <div className="space-y-1.5">
              <Label htmlFor="engagement-project">{t('engagements.fields.project')}</Label>
              <select
                id="engagement-project"
                value={selectedProject}
                onChange={(event) => setSelectedProject(event.target.value)}
                required
                className="w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 py-2 text-sm"
              >
                <option value="">{t('engagements.link.selectProject')}</option>
                {unassigned.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.display_name || project.name}
                  </option>
                ))}
              </select>
            </div>
            {linkError && (
              <p role="alert" className="text-xs text-error">
                {linkError}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLinkOpen(false)}>
                {t('engagements.actions.cancel')}
              </Button>
              <Button type="submit" disabled={busy || !selectedProject}>
                {t('engagements.actions.linkProject')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
